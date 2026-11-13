/**
 * Memoria de la tablet: lo último que se supo de la Mac (agenda, recordatorios, botones, fondo…) se
 * guarda aquí con su hora, para que el panel siga siendo útil cuando la Mac está apagada o dormida.
 *
 * Todo va en localStorage con try/catch: puede estar lleno, bloqueado o vacío (ventana privada) y el
 * panel debe seguir funcionando sin él.
 */

const PREFIJO = 'asistente.cache.';

export interface Guardado<T> {
  valor: T;
  /** Cuándo se guardó (ms desde 1970). */
  en: number;
}

export function guardarCache<T>(clave: string, valor: T, ahora = Date.now()): void {
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify({ valor, en: ahora } satisfies Guardado<T>));
  } catch {
    /* sin espacio o sin almacenamiento: se sigue sin memoria */
  }
}

export function leerCache<T>(clave: string): Guardado<T> | null {
  try {
    const crudo = localStorage.getItem(PREFIJO + clave);
    if (!crudo) return null;
    const g = JSON.parse(crudo) as Guardado<T>;
    return g && typeof g.en === 'number' && 'valor' in g ? g : null;
  } catch {
    return null;
  }
}

export function borrarCache(clave: string): void {
  try {
    localStorage.removeItem(PREFIJO + clave);
  } catch {
    /* nada */
  }
}

/** «hace un momento», «hace 5 min», «hace 3 h», «ayer», «hace 4 días». */
export function hace(en: number, ahora = Date.now()): string {
  const min = Math.max(0, Math.floor((ahora - en) / 60_000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
}

/** Claves que se usan (para no repetir textos sueltos por el código). */
export const CLAVES = {
  catalogo: 'catalogo',
  agenda: 'agenda',
  clima: 'clima',
  ultimaConexion: 'ultimaConexion',
  fondo: 'fondo',
  vidrio: 'vidrio',
  ciudad: 'ciudad',
} as const;
