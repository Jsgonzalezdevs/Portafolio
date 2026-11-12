import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirFlujo, crearParserSSE, emparejamientoDesdeHash, normalizarAgente, type EventoSSE } from './conexion';
import { duracion, esDeNoche, porcentaje } from './formato';

describe('parser SSE', () => {
  it('une eventos partidos entre trozos e ignora comentarios', () => {
    const parsear = crearParserSSE();
    expect(parsear('retry: 5000\n\n: ping\n\nevent: estado\ndata: {"a"')).toEqual([]);
    expect(parsear(':1}\n\nevent: estado\r\ndata: 2\r\n\r\n')).toEqual([
      { evento: 'estado', datos: '{"a":1}' },
      { evento: 'estado', datos: '2' },
    ]);
  });
});

describe('emparejamiento', () => {
  it('normaliza la URL del agente', () => {
    expect(normalizarAgente('agente.juliangonzalez.lat/')).toBe('https://agente.juliangonzalez.lat');
    expect(normalizarAgente(' http://192.168.1.5:8787/x ')).toBe('http://192.168.1.5:8787');
  });

  it('lee el hash de emparejamiento', () => {
    expect(emparejamientoDesdeHash('#agente=agente.juliangonzalez.lat&token=abc')).toEqual({
      agente: 'https://agente.juliangonzalez.lat',
      token: 'abc',
    });
    expect(emparejamientoDesdeHash('#token=abc')).toEqual({ agente: '', token: 'abc' });
    expect(emparejamientoDesdeHash('#agente=agente.juliangonzalez.lat')).toBeNull();
    expect(emparejamientoDesdeHash('')).toBeNull();
  });

  it('descifra la URL publicada con el token', async () => {
    const { descifrarAgente } = await import('./conexion');
    // Payload generado con cifrarUrl en el backend
    const token = 'd469dd9fd97b2b67568f748216be38211153466ad139b7b6c32a9623a478d2a8';
    const publicado = {
      v: 1 as const,
      iv: 'SL7VKtzoQ8PGhuIY',
      datos: 'pJC7FaKA12TrwbUWUk6OgTJZ0LaVpC5rQfsb2xGwkiRyYIAIlLEDKD+Rf+FJe2nYQ7H9OVva+oVX5eUWVf8XRUefDt2LFoy4bgkd',
      actualizado: '2026-11-12T12:33:20.912Z',
    };
    const url = await descifrarAgente(publicado, token);
    expect(url).toBe('https://comply-divisions-recreation-medal.trycloudflare.com');
  });
});

describe('formato', () => {
  it('duración, porcentaje y noche', () => {
    expect(duracion(90061)).toBe('1 d 1 h');
    expect(duracion(3720)).toBe('1 h 2 min');
    expect(porcentaje(5, 0)).toBe(0);
    expect(porcentaje(150, 100)).toBe(100);
    expect(esDeNoche(new Date(2026, 0, 1, 23))).toBe(true);
    expect(esDeNoche(new Date(2026, 0, 1, 12))).toBe(false);
  });
});

describe('flujo de estado', () => {
  afterEach(() => vi.unstubAllGlobals());
  const e = { agente: 'https://agente.test', token: 'x' };

  /** Cuerpo que se abre y nunca entrega nada, como un proxy que retiene el SSE. */
  const retenido = (signal?: AbortSignal | null) =>
    new ReadableStream({
      start(ctrl) {
        signal?.addEventListener('abort', () => ctrl.error(new DOMException('abortado', 'AbortError')));
      },
    });

  it('si el SSE llega retenido, pasa a consultar /estado', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/eventos')) return new Response(retenido(init.signal), { status: 200 });
      return new Response('{"cpuPct":5}', { status: 200 });
    }));
    const eventos: EventoSSE[] = [];
    const conexion: string[] = [];
    const cerrar = abrirFlujo(e, {
      alEvento: (ev) => eventos.push(ev),
      alCambioConexion: (c) => conexion.push(c),
      alNoAutorizado: () => {},
      tiempos: { primerEvento: 30, sondeo: 20 },
    });
    await vi.waitFor(() => expect(eventos.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    cerrar();
    expect(urls[0]).toBe('https://agente.test/eventos');
    expect(urls.slice(1).every((u) => u.endsWith('/estado'))).toBe(true);
    expect(eventos[0]).toEqual({ evento: 'estado', datos: '{"cpuPct":5}' });
    expect(conexion).toContain('en-linea');
  });

  it('si el SSE funciona, se queda en SSE', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return new Response('event: estado\ndata: {"cpuPct":9}\n\n', { status: 200 });
    }));
    const eventos: EventoSSE[] = [];
    const cerrar = abrirFlujo(e, {
      alEvento: (ev) => eventos.push(ev),
      alCambioConexion: () => {},
      alNoAutorizado: () => {},
      tiempos: { primerEvento: 30 },
    });
    await vi.waitFor(() => expect(eventos.length).toBe(1));
    await new Promise((r) => setTimeout(r, 80));
    cerrar();
    expect(urls.every((u) => u.endsWith('/eventos'))).toBe(true);
  });

  it('401 en el flujo → desemparejar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    let noAut = false;
    abrirFlujo(e, { alEvento: () => {}, alCambioConexion: () => {}, alNoAutorizado: () => (noAut = true) });
    await vi.waitFor(() => expect(noAut).toBe(true));
  });
});
