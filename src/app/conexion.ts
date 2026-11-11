/**
 * Cliente del mac-agent para el dashboard de la tablet.
 *
 * Restricción que manda aquí: la tablet (Android 6) tiene Chrome/WebView 106 para
 * siempre. Por eso nada de EventSource (no permite la cabecera Authorization):
 * el flujo SSE se lee a mano con fetch + ReadableStream, que 106 sí soporta.
 */

export interface Emparejamiento {
  agente: string;
  token: string;
}

export class ErrorNoAutorizado extends Error {}

const CLAVE = 'asistente.emparejamiento';

export function normalizarAgente(url: string): string {
  const limpia = url.trim().replace(/\/+$/, '');
  const u = new URL(/^https?:\/\//.test(limpia) ? limpia : `https://${limpia}`);
  return u.origin;
}

/** Lee `#agente=...&token=...` (el fragmento nunca viaja al servidor) para emparejar sin teclear. */
export function emparejamientoDesdeHash(hash: string): Emparejamiento | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const agente = p.get('agente');
  const token = p.get('token');
  if (!agente || !token) return null;
  try {
    return { agente: normalizarAgente(agente), token: token.trim() };
  } catch {
    return null;
  }
}

export function cargarEmparejamiento(): Emparejamiento | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
    return v && typeof v.agente === 'string' && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function guardarEmparejamiento(e: Emparejamiento | null): void {
  try {
    if (e) localStorage.setItem(CLAVE, JSON.stringify(e));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* almacenamiento bloqueado: el emparejamiento dura solo esta sesión */
  }
}

export async function llamar<T>(e: Emparejamiento, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${e.agente}${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${e.token}`,
      ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    cache: 'no-store',
  });
  if (r.status === 401) throw new ErrorNoAutorizado('Token inválido');
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((datos as { error?: string }).error ?? `Error ${r.status}`);
  return datos as T;
}

export interface EventoSSE {
  evento: string;
  datos: string;
}

/** Parser SSE incremental: recibe trozos de texto y devuelve los eventos completos. */
export function crearParserSSE(): (trozo: string) => EventoSSE[] {
  let pendiente = '';
  return (trozo) => {
    pendiente += trozo.replace(/\r\n?/g, '\n');
    const eventos: EventoSSE[] = [];
    let corte: number;
    while ((corte = pendiente.indexOf('\n\n')) !== -1) {
      const bloque = pendiente.slice(0, corte);
      pendiente = pendiente.slice(corte + 2);
      let evento = 'message';
      const datos: string[] = [];
      for (const linea of bloque.split('\n')) {
        if (linea.startsWith(':')) continue;
        const dos = linea.indexOf(':');
        const campo = dos === -1 ? linea : linea.slice(0, dos);
        const valor = dos === -1 ? '' : linea.slice(dos + 1).replace(/^ /, '');
        if (campo === 'event') evento = valor;
        else if (campo === 'data') datos.push(valor);
      }
      if (datos.length) eventos.push({ evento, datos: datos.join('\n') });
    }
    return eventos;
  };
}

export type EstadoConexion = 'conectando' | 'en-linea' | 'sin-conexion';

interface OpcionesFlujo {
  alEvento: (e: EventoSSE) => void;
  alCambioConexion: (c: EstadoConexion) => void;
  alNoAutorizado: () => void;
  /** Milisegundos; solo los cambian los tests. */
  tiempos?: { primerEvento?: number; silencio?: number; sondeo?: number };
}

/**
 * Mantiene el estado de la Mac llegando para siempre.
 *
 * Primero intenta el flujo SSE (/eventos). Algunos proxies lo retienen entero
 * en vez de pasarlo en vivo (el túnel rápido de Cloudflare, por ejemplo): si la
 * conexión se abre pero en 8 s no llega ningún evento, pasa a consultar
 * /estado cada 4 s y se queda así. Además, si un flujo que sí funcionaba pasa
 * 15 s callado, se corta y se reconecta (un túnel puede morir sin avisar, y la
 * tablet mostraría datos viejos como si fueran actuales).
 */
export function abrirFlujo(e: Emparejamiento, op: OpcionesFlujo): () => void {
  const T = { primerEvento: 8000, silencio: 15_000, sondeo: 4000, ...op.tiempos };
  let detenido = false;
  let ctrl: AbortController | null = null;
  let espera = 2000;
  let vigilante: number | undefined;
  let reintento: number | undefined;
  let hubiEventos = false;

  const vigilar = (ms: number) => {
    clearTimeout(vigilante);
    vigilante = window.setTimeout(() => ctrl?.abort(), ms);
  };

  const noAutorizado = () => {
    detenido = true;
    clearTimeout(vigilante);
    op.alNoAutorizado();
  };

  const programar = (fn: () => void, ms: number) => {
    if (!detenido) reintento = window.setTimeout(fn, ms);
  };

  const sondear = async () => {
    if (detenido) return;
    ctrl = new AbortController();
    vigilar(10_000);
    try {
      const r = await fetch(`${e.agente}/estado`, {
        headers: { Authorization: `Bearer ${e.token}` },
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (r.status === 401) return noAutorizado();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const datos = await r.text();
      clearTimeout(vigilante);
      op.alCambioConexion('en-linea');
      op.alEvento({ evento: 'estado', datos });
      espera = T.sondeo;
    } catch {
      clearTimeout(vigilante);
      op.alCambioConexion('sin-conexion');
      espera = Math.min(espera * 2, 30_000);
    }
    programar(sondear, espera);
  };

  const conectar = async () => {
    if (detenido) return;
    op.alCambioConexion('conectando');
    ctrl = new AbortController();
    let eventosEstaConexion = 0;
    let abierta = false;
    try {
      vigilar(T.silencio);
      const r = await fetch(`${e.agente}/eventos`, {
        headers: { Authorization: `Bearer ${e.token}` },
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (r.status === 401) return noAutorizado();
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      abierta = true;
      // El agente manda el primer estado al instante: 8 s sin nada = flujo retenido.
      if (!hubiEventos) vigilar(T.primerEvento);
      const lector = r.body.getReader();
      const decodificador = new TextDecoder();
      const parsear = crearParserSSE();
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        for (const ev of parsear(decodificador.decode(value, { stream: true }))) {
          eventosEstaConexion += 1;
          hubiEventos = true;
          vigilar(T.silencio);
          op.alCambioConexion('en-linea');
          espera = 2000;
          op.alEvento(ev);
        }
      }
    } catch {
      /* red caída, túnel cerrado o vigilante: se decide abajo */
    }
    clearTimeout(vigilante);
    if (detenido) return;
    if (abierta && !eventosEstaConexion && !hubiEventos) {
      espera = 0;
      return void sondear();
    }
    op.alCambioConexion('sin-conexion');
    programar(conectar, espera);
    espera = Math.min(espera * 2, 30_000);
  };

  void conectar();
  return () => {
    detenido = true;
    clearTimeout(vigilante);
    clearTimeout(reintento);
    ctrl?.abort();
  };
}
