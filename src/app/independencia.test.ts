import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crear, alternar, cargarEstado, eliminar, guardarEstado, reconciliar, vencidas, VACIO, type Alarma } from './alarmas';
import { guardarCache, hace, leerCache } from './almacen';
import { describirCodigo, obtenerClima } from './clima';

beforeEach(() => localStorage.clear());

describe('caché de la tablet', () => {
  it('guarda y lee con la hora; tolera datos rotos', () => {
    guardarCache('agenda', { a: 1 }, 1000);
    expect(leerCache('agenda')).toEqual({ valor: { a: 1 }, en: 1000 });
    expect(leerCache('nada')).toBeNull();
    localStorage.setItem('asistente.cache.rota', '{no es json');
    expect(leerCache('rota')).toBeNull();
  });

  it('«hace X» en español', () => {
    const ahora = 10_000_000_000;
    expect(hace(ahora - 20_000, ahora)).toBe('hace un momento');
    expect(hace(ahora - 5 * 60_000, ahora)).toBe('hace 5 min');
    expect(hace(ahora - 3 * 3600_000, ahora)).toBe('hace 3 h');
    expect(hace(ahora - 30 * 3600_000, ahora)).toBe('ayer');
    expect(hace(ahora - 4 * 86400_000, ahora)).toBe('hace 4 días');
    expect(hace(ahora + 5000, ahora)).toBe('hace un momento');
  });
});

describe('alarmas de la tablet', () => {
  const a = (id: string, hora: string, activa = true, dias: number[] = []): Alarma => ({ id, hora, dias, titulo: id, activa });

  it('crear, alternar y borrar (el borrado deja constancia)', () => {
    let e = crear(VACIO, '06:00', '  Despertar ', [1, 1, 9, 3], 'a1');
    expect(e.alarmas).toEqual([{ id: 'a1', hora: '06:00', dias: [1, 3], titulo: 'Despertar', activa: true }]);
    e = alternar(e, 'a1');
    expect(e.alarmas[0].activa).toBe(false);
    e = eliminar(e, 'a1', 5000);
    expect(e).toEqual({ alarmas: [], borradas: { a1: 5000 } });
    expect(() => crear(VACIO, '6:00', 'x')).toThrow(/HH:MM/);
    expect(crear(VACIO, '07:30', '').alarmas[0].titulo).toBe('Alarma');
  });

  it('suena solo en su minuto, activa y en sus días', () => {
    const lunes = new Date(2026, 10, 9, 6, 0); // lunes
    const lista = [a('1', '06:00'), a('2', '06:00', false), a('3', '06:00', true, [2]), a('4', '06:01'), a('5', '06:00', true, [1])];
    expect(vencidas(lista, lunes).map((x) => x.id)).toEqual(['1', '5']);
  });

  it('reconciliar: la tablet manda y la Mac se pone igual', () => {
    const local = { alarmas: [a('solo-tablet', '06:00'), a('ambas', '07:00', false), a('ambas2', '08:00')], borradas: { vieja: 100, antigua: 1 } };
    const remotas = [a('ambas', '07:00', true), a('ambas2', '08:00'), a('por-voz', '09:00'), a('vieja', '10:00')];
    const p = reconciliar(local, remotas, 100 + 1000);
    expect(p.estado.alarmas.map((x) => x.id)).toEqual(['solo-tablet', 'ambas', 'ambas2', 'por-voz']);
    expect(p.crearEnMac.map((x) => x.id)).toEqual(['solo-tablet']);
    expect(p.borrarEnMac).toEqual(['vieja']);
    expect(p.alternarEnMac).toEqual(['ambas']);
    // Las constancias de más de 30 días se olvidan.
    const m = reconciliar(local, [], 100 + 31 * 86400_000);
    expect(m.estado.borradas).toEqual({});
  });

  it('una alarma puesta por voz en la Mac se adopta una sola vez, aunque se repita la sincronización', () => {
    const remotas = [a('por-voz', '09:00')];
    const uno = reconciliar(VACIO, remotas);
    const dos = reconciliar(uno.estado, remotas);
    expect(dos.estado.alarmas).toHaveLength(1);
    expect(dos.crearEnMac).toEqual([]);
  });

  it('se guarda y se recupera; ignora lo corrupto', () => {
    guardarEstado(crear(VACIO, '06:00', 'Despertar', [], 'x1'));
    expect(cargarEstado().alarmas[0].id).toBe('x1');
    localStorage.setItem('asistente.alarmas', JSON.stringify({ alarmas: [{ id: 1 }, { id: 'ok', hora: '25:00', dias: [], activa: true }] }));
    expect(cargarEstado().alarmas).toEqual([]);
    localStorage.setItem('asistente.alarmas', 'basura');
    expect(cargarEstado()).toEqual({ alarmas: [], borradas: {} });
  });
});

describe('clima directo', () => {
  const respuesta = (cuerpo: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => cuerpo }) as Response;

  it('códigos del tiempo con variante de noche', () => {
    expect(describirCodigo(2, true)).toEqual({ condicion: 'Parcialmente nublado', icono: '⛅' });
    expect(describirCodigo(0, false).icono).toBe('🌙');
    expect(describirCodigo(95, true).icono).toBe('⛈️');
    expect(describirCodigo(1234, true).condicion).toBe('Tiempo variable');
  });

  it('busca la ciudad una sola vez y luego el clima', async () => {
    const urls: string[] = [];
    const pedir = vi.fn(async (url: string) => {
      urls.push(url);
      return url.includes('geocoding')
        ? respuesta({ results: [{ name: 'Ibagué', latitude: 4.43, longitude: -75.2 }] })
        : respuesta({ current: { temperature_2m: 25.6, weather_code: 3, is_day: 1 } });
    }) as unknown as typeof fetch;
    expect(await obtenerClima('Ibague', pedir)).toEqual({ ciudad: 'Ibagué', tempC: 26, condicion: 'Nublado', icono: '☁️' });
    expect(await obtenerClima('Ibague', pedir)).toMatchObject({ tempC: 26 });
    expect(urls.filter((u) => u.includes('geocoding'))).toHaveLength(1);
    expect(urls.find((u) => u.includes('forecast'))).toContain('latitude=4.43&longitude=-75.2');
  });

  it('falla con claridad si no hay red, ciudad o datos', async () => {
    await expect(obtenerClima('Nada', (async () => respuesta({ results: [] })) as unknown as typeof fetch)).rejects.toThrow(/No encontré/);
    const sinRed = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(obtenerClima('Otra', sinRed)).rejects.toThrow();
    const rara = (async (u: string) => (u.includes('geocoding') ? respuesta({ results: [{ name: 'X', latitude: 1, longitude: 2 }] }) : respuesta({ current: {} }))) as unknown as typeof fetch;
    await expect(obtenerClima('Tercera', rara)).rejects.toThrow(/inesperada/);
  });
});
