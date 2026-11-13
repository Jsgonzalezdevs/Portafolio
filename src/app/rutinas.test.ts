import { describe, expect, it } from 'vitest';
import { claveDia, debeResumirManana, duracionAviso, efectosConocidos } from './rutinas';

describe('rutinas en el panel', () => {
  it('solo aplica los efectos que conoce', () => {
    expect(efectosConocidos(['modo-noche', 'apagar-todo', 3])).toEqual(['modo-noche']);
    expect(efectosConocidos(undefined)).toEqual([]);
    expect(efectosConocidos('modo-noche')).toEqual([]);
  });

  it('clave del día en hora local', () => {
    expect(claveDia(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(claveDia(new Date(2026, 10, 12, 0, 0))).toBe('2026-11-12');
  });

  it('el resumen de la mañana: entre 4 y 11 h, una sola vez al día', () => {
    const a = (h: number) => new Date(2026, 10, 12, h, 30);
    expect(debeResumirManana(a(6), null)).toBe(true);
    expect(debeResumirManana(a(6), '2026-11-11')).toBe(true);
    expect(debeResumirManana(a(7), '2026-11-12')).toBe(false);
    expect(debeResumirManana(a(3), null)).toBe(false);
    expect(debeResumirManana(a(4), null)).toBe(true);
    expect(debeResumirManana(a(10), null)).toBe(true);
    expect(debeResumirManana(a(11), null)).toBe(false);
    expect(debeResumirManana(a(15), null)).toBe(false);
  });

  it('los avisos largos duran más, con tope', () => {
    expect(duracionAviso('Listo')).toBe(3800);
    expect(duracionAviso('x'.repeat(100))).toBe(9500);
    expect(duracionAviso('x'.repeat(5000))).toBe(15_000);
  });
});
