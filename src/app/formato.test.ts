import { describe, expect, it } from 'vitest';
import { formatoTiempoPista, formatoTiempoTimer, saludoSegunHora } from './formato';

describe('formato del nuevo dashboard', () => {
  it('saludoSegunHora devuelve saludo y periodo adecuados', () => {
    // Mañana
    const m = new Date(2026, 10, 11, 8, 30);
    expect(saludoSegunHora(m)).toEqual({
      saludo: 'Buenos días, Julian',
      icono: '🌅',
      periodo: 'manana',
    });

    // Tarde
    const t = new Date(2026, 10, 11, 14, 0);
    expect(saludoSegunHora(t)).toEqual({
      saludo: 'Buenas tardes',
      icono: '☀️',
      periodo: 'tarde',
    });

    // Noche
    const n = new Date(2026, 10, 11, 19, 30);
    expect(saludoSegunHora(n)).toEqual({
      saludo: 'Buenas noches',
      icono: '🌙',
      periodo: 'noche',
    });

    // Madrugada
    const mad = new Date(2026, 10, 11, 2, 0);
    expect(saludoSegunHora(mad)).toEqual({
      saludo: 'Buenas noches',
      icono: '🌙',
      periodo: 'madrugada',
    });
  });

  it('formatoTiempoTimer formatea segundos a MM:SS', () => {
    expect(formatoTiempoTimer(0)).toBe('00:00');
    expect(formatoTiempoTimer(5)).toBe('00:05');
    expect(formatoTiempoTimer(65)).toBe('01:05');
    expect(formatoTiempoTimer(300)).toBe('05:00');
    expect(formatoTiempoTimer(900)).toBe('15:00');
  });

  it('formatoTiempoPista formatea segundos a M:SS para reproductores', () => {
    expect(formatoTiempoPista(0)).toBe('0:00');
    expect(formatoTiempoPista(5)).toBe('0:05');
    expect(formatoTiempoPista(65)).toBe('1:05');
    expect(formatoTiempoPista(225)).toBe('3:45');
    expect(formatoTiempoPista(3600)).toBe('60:00');
  });
});
