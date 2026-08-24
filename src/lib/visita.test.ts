import { describe, expect, it } from 'vitest';
import { debeRegistrar } from './visita';

describe('debeRegistrar', () => {
  it('respeta "no me rastrees"', () => {
    // Aunque sea producción: si el navegador lo pide, no se cuenta.
    expect(debeRegistrar('1', true)).toBe(false);
    expect(debeRegistrar('yes', true)).toBe(false);
  });

  it('cuenta en producción cuando no se pidió lo contrario', () => {
    expect(debeRegistrar(null, true)).toBe(true);
    expect(debeRegistrar(undefined, true)).toBe(true);
    expect(debeRegistrar('0', true)).toBe(true);
    expect(debeRegistrar('unspecified', true)).toBe(true);
  });

  it('no cuenta las recargas de uno mismo programando', () => {
    expect(debeRegistrar(null, false)).toBe(false);
    expect(debeRegistrar('0', false)).toBe(false);
  });
});
