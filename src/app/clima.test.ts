import { describe, expect, it } from 'vitest';
import { avisoLluvia, obtenerClima, type Hora } from './clima';

const h = (hora: number, prob: number, codigo: number): Hora => ({ t: `2026-11-20T${String(hora).padStart(2, '0')}:00`, prob, codigo });

describe('aviso de lluvia', () => {
  it('si ya llueve, hasta cuándo', () => {
    expect(avisoLluvia([h(10, 100, 81), h(11, 90, 53), h(12, 40, 3), h(13, 80, 61)])).toBe('Lluvia hasta las 12:00');
    expect(avisoLluvia([h(10, 100, 81), h(11, 90, 53)])).toBe('Lluvia el resto del día');
  });
  it('si no, desde cuándo y con qué probabilidad', () => {
    expect(avisoLluvia([h(10, 10, 1), h(11, 30, 61), h(12, 75, 80)])).toBe('Lluvia hacia las 12:00 (75 %)');
  });
  it('nublado con probabilidad alta no es lluvia; sin datos, nada', () => {
    expect(avisoLluvia([h(10, 90, 3), h(11, 90, 2)])).toBeNull();
    expect(avisoLluvia([])).toBeNull();
  });
});

describe('obtenerClima', () => {
  it('trae la máxima, la mínima y la lluvia', async () => {
    const respuestas: Record<string, unknown> = {
      'geocoding-api': { results: [{ name: 'Ibagué', latitude: 4.4, longitude: -75.2 }] },
      'api.open-meteo': {
        current: { temperature_2m: 22.6, weather_code: 81, is_day: 1 },
        hourly: { time: ['2026-11-20T10:00', '2026-11-20T11:00', '2026-11-20T12:00'], temperature_2m: [22.6, 23.4, 24.6], precipitation_probability: [100, 90, 20], weather_code: [81, 53, 3], is_day: [1, 1, 1] },
        daily: { temperature_2m_max: [26.4], temperature_2m_min: [17.8] },
      },
    };
    const pedir = (async (url: string) => {
      const clave = Object.keys(respuestas).find((k) => url.includes(k))!;
      return { ok: true, json: async () => respuestas[clave] };
    }) as unknown as typeof fetch;
    const c = await obtenerClima(`Prueba ${Math.random()}`, pedir);
    expect(c).toMatchObject({ ciudad: 'Ibagué', tempC: 23, condicion: 'Chubascos', maxC: 26, minC: 18, lluvia: 'Lluvia hasta las 12:00' });
    expect(c.horas).toEqual([
      { hora: '11:00', tempC: 23, prob: 90, icono: '🌦️' },
      { hora: '12:00', tempC: 25, prob: 20, icono: '☁️' },
    ]);
  });
});
