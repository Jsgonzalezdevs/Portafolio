import { describe, expect, it } from 'vitest';
import { anotarMuestra, consejoBateria, duracionRestante, estadoCarga, ritmoPorHora, type Bateria, type Muestra } from './bienestar';

const MIN = 60_000;
const usb: Bateria = { nivel: 10, cargando: true, enchufada: true, temperaturaC: 27 };

describe('ritmo de carga', () => {
  it('anota una muestra por cambio o cada 5 min y olvida lo viejo', () => {
    let m: Muestra[] = [];
    m = anotarMuestra(m, 12, 0);
    m = anotarMuestra(m, 12, 2 * MIN);
    expect(m).toHaveLength(1);
    m = anotarMuestra(m, 11, 3 * MIN);
    m = anotarMuestra(m, 11, 9 * MIN);
    expect(m).toHaveLength(3);
    m = anotarMuestra(m, 10, 3 * 60 * MIN);
    expect(m).toEqual([{ t: 3 * 60 * MIN, nivel: 10 }]);
  });

  it('no opina con poco tramo', () => {
    expect(ritmoPorHora([{ t: 0, nivel: 12 }, { t: 5 * MIN, nivel: 11 }], 5 * MIN)).toBeNull();
    expect(ritmoPorHora([{ t: 0, nivel: 12 }, { t: 20 * MIN, nivel: 12 }], 20 * MIN)).toBeNull();
    // Un solo punto en 16 min no basta (puede ser casualidad del redondeo).
    expect(ritmoPorHora([{ t: 0, nivel: 10 }, { t: 16 * MIN, nivel: 9 }], 16 * MIN)).toBeNull();
    expect(ritmoPorHora([{ t: 0, nivel: 10 }, { t: 50 * MIN, nivel: 9 }], 50 * MIN)).toBeCloseTo(-1.2);
  });

  it('calcula puntos por hora', () => {
    expect(ritmoPorHora([{ t: 0, nivel: 12 }, { t: 30 * MIN, nivel: 10 }], 30 * MIN)).toBeCloseTo(-4);
    expect(ritmoPorHora([{ t: 0, nivel: 50 }, { t: 60 * MIN, nivel: 50 }], 60 * MIN)).toBe(0);
  });

  it('estima cuánto queda', () => {
    expect(duracionRestante(10, -4)).toBe('unas 2,5 h');
    expect(duracionRestante(5, -12)).toBe('unos 25 min');
    expect(duracionRestante(50, 3)).toBeNull();
  });
});

describe('consejo con el ritmo', () => {
  it('enchufada pero bajando: el cargador no alcanza', () => {
    const c = consejoBateria(usb, null, 0, -4);
    expect(c.tono).toBe('alerta');
    expect(c.texto).toBe('Enchufada, pero baja 4 % por hora: ese cargador no alcanza. Usa uno de pared (le quedan unas 2,5 h).');
    expect(estadoCarga(usb, -4)).toBe('Carga insuficiente');
    expect(consejoBateria({ ...usb, nivel: 60 }, null, 0, -1.5).texto).toMatch(/baja 1,5 % por hora/);
  });

  it('cargando de verdad sigue en orden', () => {
    expect(consejoBateria(usb, null, 0, 8).tono).toBe('ok');
    expect(estadoCarga(usb, 8)).toBe('Cargando');
    expect(consejoBateria(usb, null, 0, null).texto).toBe('Todo en orden.');
  });

  it('sin enchufar dice cuánto le queda', () => {
    expect(consejoBateria({ ...usb, cargando: false, enchufada: false }, null, 0, -6).texto).toBe(
      'Batería baja (10 %, unas 1,5 h): conéctala al cargador.',
    );
  });
});
