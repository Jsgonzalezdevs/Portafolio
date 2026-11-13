import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import codigo from '../../public/app-sw.js?raw';

type Peticion = { method: string; url: string; mode: string };
type Evento = { request: Peticion; respuesta?: Promise<unknown>; respondWith: (p: Promise<unknown>) => void; waitUntil: (p: Promise<unknown>) => void };

const ORIGEN = 'https://ejemplo.lat';
const respuesta = (texto: string) => ({ ok: true, type: 'basic', texto, clone() { return this; }, text: async () => texto });

/** Carga el service worker con una red y un caché de mentira y devuelve sus oyentes. */
function cargar(red: (p: Peticion) => Promise<unknown>) {
  const guardado = new Map<string, unknown>();
  const oyentes: Record<string, (e: unknown) => void> = {};
  const caches = {
    open: async () => ({
      put: async (p: Peticion | string, r: unknown) => void guardado.set(typeof p === 'string' ? `${ORIGEN}${p}` : p.url, r),
      add: async (url: string) => void guardado.set(`${ORIGEN}${url}`, await red({ method: 'GET', url: `${ORIGEN}${url}`, mode: 'cors' })),
    }),
    match: async (p: Peticion | string) => guardado.get(typeof p === 'string' ? `${ORIGEN}${p}` : p.url),
    keys: async () => ['asistente-v0', 'asistente-v1', 'otra-cosa'],
    delete: vi.fn(async () => true),
  };
  const self = {
    location: { origin: ORIGEN },
    addEventListener: (tipo: string, f: (e: unknown) => void) => void (oyentes[tipo] = f),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  new Function('self', 'caches', 'fetch', 'URL', codigo)(self, caches, red, URL);
  const pedir = (url: string, extra: Partial<Peticion> = {}) => {
    const e: Evento = {
      request: { method: 'GET', url, mode: 'navigate', ...extra },
      respondWith: (p) => void (e.respuesta = p),
      waitUntil: () => {},
    };
    oyentes.fetch(e);
    return e;
  };
  return { pedir, guardado, caches, self, oyentes };
}

describe('service worker del panel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('con red sirve la página nueva y la guarda; sin red, la guardada', async () => {
    let hayRed = true;
    const { pedir } = cargar(async () => {
      if (!hayRed) throw new TypeError('sin red');
      return respuesta('versión nueva');
    });
    expect(((await pedir(`${ORIGEN}/app`).respuesta) as { texto: string }).texto).toBe('versión nueva');
    hayRed = false;
    expect(((await pedir(`${ORIGEN}/app`).respuesta) as { texto: string }).texto).toBe('versión nueva');
  });

  it('si la red no contesta en 4 s (wifi sin internet), usa lo guardado', async () => {
    let colgada = false;
    const { pedir } = cargar(() => (colgada ? new Promise(() => {}) : Promise.resolve(respuesta('guardada'))));
    await pedir(`${ORIGEN}/app`).respuesta;
    colgada = true;
    const pendiente = pedir(`${ORIGEN}/app`).respuesta as Promise<{ texto: string }>;
    await vi.advanceTimersByTimeAsync(4100);
    expect((await pendiente).texto).toBe('guardada');
  });

  it('sin red y sin nada guardado, falla como siempre (no inventa una página)', async () => {
    const { pedir } = cargar(async () => {
      throw new TypeError('sin red');
    });
    await expect(pedir(`${ORIGEN}/app`).respuesta).rejects.toThrow('sin red');
  });

  it('no se mete con el portafolio, otros sitios ni lo que no es GET', () => {
    const { pedir } = cargar(async () => respuesta('x'));
    expect(pedir(`${ORIGEN}/`).respuesta).toBeUndefined();
    expect(pedir(`${ORIGEN}/proyectos`).respuesta).toBeUndefined();
    expect(pedir('https://api.open-meteo.com/v1/forecast', { mode: 'cors' }).respuesta).toBeUndefined();
    expect(pedir(`${ORIGEN}/app`, { method: 'POST' }).respuesta).toBeUndefined();
  });

  it('los archivos con hash salen del guardado: la segunda vez no pregunta a la red', async () => {
    const red = vi.fn(async () => respuesta('console.log(1)'));
    const { pedir } = cargar(red);
    await pedir(`${ORIGEN}/assets/app-abc123.js`, { mode: 'cors' }).respuesta;
    await pedir(`${ORIGEN}/assets/app-abc123.js`, { mode: 'cors' }).respuesta;
    expect(red).toHaveBeenCalledTimes(1);
  });

  it('al instalarse guarda la página y los archivos que usa (para el primer reinicio sin internet)', async () => {
    const pedidos: string[] = [];
    const { oyentes, guardado, self } = cargar(async (p) => {
      pedidos.push(p.url ?? String(p));
      return respuesta('<script src="/assets/app-1.js"></script><link href="/assets/app-1.css" rel="stylesheet">');
    });
    let listo: Promise<unknown> = Promise.resolve();
    oyentes.install({ waitUntil: (p: Promise<unknown>) => void (listo = p) });
    await listo;
    expect([...guardado.keys()].sort()).toEqual([`${ORIGEN}/app`, `${ORIGEN}/assets/app-1.css`, `${ORIGEN}/assets/app-1.js`]);
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it('si al instalarse no hay red, se instala igual', async () => {
    const { oyentes, self } = cargar(async () => {
      throw new TypeError('sin red');
    });
    let listo: Promise<unknown> = Promise.resolve();
    oyentes.install({ waitUntil: (p: Promise<unknown>) => void (listo = p) });
    await listo;
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it('«/app/» sirve la página guardada como «/app»', async () => {
    let hayRed = true;
    const { pedir } = cargar(async () => {
      if (!hayRed) throw new TypeError('sin red');
      return respuesta('panel');
    });
    await pedir(`${ORIGEN}/app`).respuesta;
    hayRed = false;
    expect(((await pedir(`${ORIGEN}/app/`).respuesta) as { texto: string }).texto).toBe('panel');
  });

  it('al activarse borra solo los cachés viejos del asistente', async () => {
    const { oyentes, caches, self } = cargar(async () => respuesta('x'));
    let listo: Promise<unknown> = Promise.resolve();
    oyentes.activate({ waitUntil: (p: Promise<unknown>) => void (listo = p) });
    await listo;
    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith('asistente-v0');
    expect(self.clients.claim).toHaveBeenCalled();
  });
});
