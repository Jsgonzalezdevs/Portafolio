import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { WavesBackground } from './WavesBackground';

/**
 * jsdom has no canvas, so the 2D context is a recorder. Nothing here asserts on
 * what gets painted — the point is when it gets painted, and when it stops.
 */
const contextoFalso = () => ({
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  setTransform: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
});

let ctx: ReturnType<typeof contextoFalso>;
let reduce = false;
let oyentesMedia: (() => void)[] = [];

/**
 * Frames only advance when this is called, so timing is exact.
 *
 * Keyed by id rather than a plain list because cancelling has to actually drop
 * the queued callback — a no-op `cancelAnimationFrame` would run the pending
 * frame anyway and report a component that never pauses as one that does.
 */
let pendientes = new Map<number, FrameRequestCallback>();
let siguienteId = 1;
const correrFrames = (n: number) => {
  for (let i = 0; i < n; i += 1) {
    const cola = [...pendientes.values()];
    pendientes = new Map();
    for (const cb of cola) cb(performance.now());
  }
};

const pintadas = () => ctx.fillRect.mock.calls.length;

beforeEach(() => {
  ctx = contextoFalso();
  reduce = false;
  oyentesMedia = [];
  pendientes = new Map();
  siguienteId = 1;

  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx,
  ) as unknown as HTMLCanvasElement['getContext'];

  vi.stubGlobal('matchMedia', (query: string) => ({
    // A getter, not a fixed value: the real `matches` is live, and a frozen one
    // would make "the OS setting changed" untestable — the component holds the
    // MediaQueryList it got at mount.
    get matches() {
      return query.includes('reduced-motion') ? reduce : false;
    },
    addEventListener: (_: string, cb: () => void) => oyentesMedia.push(cb),
    removeEventListener: vi.fn(),
  }));

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = siguienteId;
    siguienteId += 1;
    pendientes.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pendientes.delete(id);
  });

  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ocultar = (oculto: boolean) => {
  Object.defineProperty(document, 'hidden', { value: oculto, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('fondo animado', () => {
  it('anima cuando la pestaña está a la vista', () => {
    render(<WavesBackground />);
    const antes = pintadas();

    correrFrames(3);

    expect(pintadas()).toBeGreaterThan(antes);
  });

  it('deja de dibujar mientras la pestaña está oculta', () => {
    // Son ~1.800 puntos proyectados por frame. Seguir a 60fps detrás de una
    // pestaña en segundo plano es batería gastada en dibujar para nadie.
    render(<WavesBackground />);
    correrFrames(2);

    ocultar(true);
    const congelado = pintadas();
    correrFrames(5);

    expect(pintadas()).toBe(congelado);
  });

  it('vuelve a animar al regresar a la pestaña', () => {
    render(<WavesBackground />);
    ocultar(true);
    correrFrames(3);

    ocultar(false);
    const alVolver = pintadas();
    correrFrames(3);

    expect(pintadas()).toBeGreaterThan(alVolver);
  });

  it('con movimiento reducido dibuja un cuadro y se queda quieto', () => {
    // Quieto, no en blanco: lo que se pidió es que deje de moverse, no que
    // desaparezca.
    reduce = true;
    render(<WavesBackground />);

    expect(pintadas()).toBeGreaterThan(0);

    const quieto = pintadas();
    correrFrames(5);
    expect(pintadas()).toBe(quieto);
  });

  it('obedece el ajuste del sistema en cuanto cambia, sin recargar', () => {
    render(<WavesBackground />);
    correrFrames(2);

    reduce = true;
    for (const cb of oyentesMedia) cb();

    const quieto = pintadas();
    correrFrames(5);
    expect(pintadas()).toBe(quieto);
  });

  it('dimensiona el lienzo en píxeles reales de pantalla', () => {
    // Sin esto el lienzo se estira por el ratio del dispositivo en cualquier
    // pantalla retina, que es lo que convertía estas líneas en manchas grises.
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });

    render(<WavesBackground />);
    const canvas = document.querySelector('canvas');

    // Topado en 2: una tercera pasada cuesta frame y no se ve.
    expect(canvas?.width).toBe(800);
    expect(canvas?.style.width).toBe('400px');
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });
});
