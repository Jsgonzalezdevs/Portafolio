import { describe, it, expect } from 'vitest';
import { activarProteccionCodigo } from './proteccionCodigo';

describe('activarProteccionCodigo', () => {
  it('se ejecuta sin lanzar excepciones', () => {
    expect(() => activarProteccionCodigo()).not.toThrow();
  });
});
