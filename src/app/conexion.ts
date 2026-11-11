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
}

/**
 * Mantiene abierto /eventos para siempre: reintenta con espera creciente y corta
 * la conexión si pasan 15 s sin datos (un túnel puede morir sin avisar, y la
 * tablet se quedaría mostrando datos viejos como si fueran actuales).
 */
export function abrirFlujo(e: Emparejamiento, op: OpcionesFlujo): () => void {
  let detenido = false;
  let ctrl: AbortController | null = null;
  let espera = 2000;
  let vigilante: number | undefined;
  let reintento: number | undefined;

  const vigilar = () => {
    clearTimeout(vigilante);
    vigilante = window.setTimeout(() => ctrl?.abort(), 15_000);
  };

  const conectar = async () => {
    if (detenido) return;
    op.alCambioConexion('conectando');
    ctrl = new AbortController();
    try {
      vigilar();
      const r = await fetch(`${e.agente}/eventos`, {
        headers: { Authorization: `Bearer ${e.token}` },
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (r.status === 401) {
        detenido = true;
        clearTimeout(vigilante);
        op.alNoAutorizado();
        return;
      }
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const lector = r.body.getReader();
      const decodificador = new TextDecoder();
      const parsear = crearParserSSE();
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        vigilar();
        for (const ev of parsear(decodificador.decode(value, { stream: true }))) {
          op.alCambioConexion('en-linea');
          espera = 2000;
          op.alEvento(ev);
        }
      }
    } catch {
      /* red caída, túnel cerrado o vigilante: se reintenta abajo */
    }
    clearTimeout(vigilante);
    if (detenido) return;
    op.alCambioConexion('sin-conexion');
    reintento = window.setTimeout(conectar, espera);
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
