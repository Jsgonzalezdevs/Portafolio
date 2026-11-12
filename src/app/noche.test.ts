import { describe, expect, it } from 'vitest';
import { consejoBateria, estadoCarga, leerBateria, seguimientoAlMaximo, type Bateria } from './bienestar';
import { desplazamientoHora, nocheActiva } from './noche';

const base = { manual: null, despiertoHasta: 0, emparejado: true };
const hora = (h: number) => new Date(2026, 10, 12, h, 0);

describe('modo noche', () => {
  it('automático: de 22:00 a 6:00; de día no', () => {
    expect(nocheActiva({ ...base, ahora: hora(23) })).toBe(true);
    expect(nocheActiva({ ...base, ahora: hora(3) })).toBe(true);
    expect(nocheActiva({ ...base, ahora: hora(14) })).toBe(false);
  });

  it('manual: de día lo activa la persona; sin emparejar nunca', () => {
    expect(nocheActiva({ ...base, ahora: hora(14), manual: true })).toBe(true);
    expect(nocheActiva({ ...base, ahora: hora(23), emparejado: false })).toBe(false);
  });

  it('un toque despierta el panel hasta cierta hora y luego vuelve la noche', () => {
    const ahora = hora(23);
    const hasta = ahora.getTime() + 60_000;
    expect(nocheActiva({ ...base, ahora, despiertoHasta: hasta })).toBe(false);
    expect(nocheActiva({ ...base, ahora: new Date(hasta + 1), despiertoHasta: hasta })).toBe(true);
  });

  it('la hora se mueve cada minuto dentro de un margen pequeño y se repite en ciclo', () => {
    const a = desplazamientoHora(new Date(2026, 10, 12, 23, 0));
    const b = desplazamientoHora(new Date(2026, 10, 12, 23, 1));
    expect(a).not.toEqual(b);
    for (let m = 0; m < 30; m++) {
      const d = desplazamientoHora(new Date(2026, 10, 12, 23, m));
      expect(Math.abs(d.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(1);
    }
    expect(desplazamientoHora(new Date(2026, 10, 12, 23, 0))).toEqual(desplazamientoHora(new Date(2026, 10, 12, 23, 8)));
  });
});

describe('cuidado de la batería', () => {
  const ok: Bateria = { nivel: 60, cargando: false, enchufada: true, temperaturaC: 30 };
  const HORA = 3_600_000;

  it('todo bien', () => {
    expect(consejoBateria(ok, null, 0)).toEqual({ tono: 'ok', texto: 'Todo en orden.' });
    expect(consejoBateria({ ...ok, enchufada: false }, null, 0).tono).toBe('ok');
  });

  it('el calor manda sobre todo lo demás', () => {
    expect(consejoBateria({ ...ok, temperaturaC: 40 }, null, 0).tono).toBe('aviso');
    expect(consejoBateria({ ...ok, temperaturaC: 46 }, null, 0)).toMatchObject({ tono: 'alerta' });
    expect(consejoBateria({ ...ok, nivel: 5, enchufada: false, temperaturaC: 46 }, null, 0).texto).toMatch(/muy caliente/);
  });

  it('batería baja sin cargador: alerta a 15 % o menos, aviso a 30 %', () => {
    expect(consejoBateria({ ...ok, nivel: 12, enchufada: false }, null, 0).tono).toBe('alerta');
    expect(consejoBateria({ ...ok, nivel: 28, enchufada: false }, null, 0).tono).toBe('aviso');
    expect(consejoBateria({ ...ok, nivel: 12, enchufada: true }, null, 0).tono).toBe('ok');
  });

  it('horas seguidas al máximo enchufada → aviso a las 6 h, no antes', () => {
    const lleno: Bateria = { ...ok, nivel: 100 };
    expect(consejoBateria(lleno, 0, 5 * HORA).tono).toBe('ok');
    const c = consejoBateria(lleno, 0, 7 * HORA);
    expect(c.tono).toBe('aviso');
    expect(c.texto).toMatch(/7 h/);
  });

  it('el seguimiento empieza al llegar al máximo y se borra al bajar o desenchufar', () => {
    const lleno: Bateria = { ...ok, nivel: 100 };
    expect(seguimientoAlMaximo(lleno, null, 1000)).toBe(1000);
    expect(seguimientoAlMaximo(lleno, 1000, 9000)).toBe(1000);
    expect(seguimientoAlMaximo({ ...lleno, nivel: 90 }, 1000, 9000)).toBeNull();
    expect(seguimientoAlMaximo({ ...lleno, enchufada: false }, 1000, 9000)).toBeNull();
  });

  it('lee el JSON de la app y rechaza lo inválido', () => {
    expect(leerBateria({ nivel: 87.4, cargando: true, enchufada: true, temperaturaC: 31.5 })).toEqual({
      nivel: 87, cargando: true, enchufada: true, temperaturaC: 31.5,
    });
    expect(leerBateria({ nivel: 50, temperaturaC: null })).toMatchObject({ cargando: false, enchufada: false, temperaturaC: null });
    expect(leerBateria({})).toBeNull();
    expect(leerBateria(null)).toBeNull();
    expect(leerBateria({ nivel: 250 })?.nivel).toBe(100);
  });

  it('describe el estado de carga', () => {
    expect(estadoCarga({ ...ok, cargando: true })).toBe('Cargando');
    expect(estadoCarga(ok)).toBe('Enchufada');
    expect(estadoCarga({ ...ok, enchufada: false })).toBe('Con batería');
  });
});
