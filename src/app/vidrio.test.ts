import { describe, expect, it } from 'vitest';
import { geometriaVidrio, recuadroCover } from './vidrio';

describe('vidrio', () => {
  it('cover: una imagen 16:9 en una pantalla 16:10 se escala por el alto y se centra', () => {
    const c = recuadroCover({ ancho: 1280, alto: 800 }, { ancho: 384, alto: 216 });
    expect(c.alto).toBeCloseTo(800, 5);
    expect(c.ancho).toBeCloseTo(1422.2, 1);
    expect(c.x).toBeCloseTo(-71.1, 1);
    expect(c.y).toBeCloseTo(0, 5);
  });

  it('cover: en vertical se escala por el alto y se centra en horizontal', () => {
    const c = recuadroCover({ ancho: 800, alto: 1280 }, { ancho: 384, alto: 216 });
    expect(c.alto).toBeCloseTo(1280, 5);
    expect(c.x).toBeLessThan(0);
  });

  it('el vidrio de un widget es el trozo de imagen que tiene detrás', () => {
    const pantalla = { ancho: 1280, alto: 800 };
    const imagen = { ancho: 384, alto: 216 };
    const c = recuadroCover(pantalla, imagen);
    const g = geometriaVidrio(pantalla, imagen, { left: 300, top: 120 });
    expect(g.tamano).toBe(`auto, ${c.ancho.toFixed(1)}px ${c.alto.toFixed(1)}px`);
    // El punto (300,120) de la pantalla cae en (300 - x, 120 - y) de la imagen.
    expect(g.posicion).toBe(`0 0, ${(c.x - 300).toFixed(1)}px ${(c.y - 120).toFixed(1)}px`);
  });

  it('un widget en la esquina superior izquierda ve el origen de la imagen centrada', () => {
    const g = geometriaVidrio({ ancho: 1000, alto: 500 }, { ancho: 1000, alto: 500 }, { left: 0, top: 0 });
    expect(g.posicion).toBe('0 0, 0.0px 0.0px');
  });
});
