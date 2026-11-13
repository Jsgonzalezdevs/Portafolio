/**
 * Alarmas propias de la tablet.
 *
 * Antes las guardaba la Mac y era la Mac quien decidía cuándo sonaban: con la Mac apagada, la
 * tablet no despertaba a nadie. Ahora la tablet es la dueña: las guarda aquí, las hace sonar sola
 * y la Mac solo guarda una copia (para que la voz pueda contarlas y crearlas). Cuando las dos se
 * hablan, se reconcilian: gana lo que dice la tablet.
 */

export interface Alarma {
  id: string;
  hora: string;
  dias: number[];
  titulo: string;
  activa: boolean;
}

export interface EstadoAlarmas {
  alarmas: Alarma[];
  /** Alarmas borradas aquí (id → cuándo), para que la copia de la Mac no las resucite. */
  borradas: Record<string, number>;
}

export const VACIO: EstadoAlarmas = { alarmas: [], borradas: {} };

const CLAVE = 'asistente.alarmas';
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const TREINTA_DIAS = 30 * 24 * 3600_000;

export function idNuevo(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // Navegador sin randomUUID: suficiente para distinguir alarmas de una sola tablet.
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function crear(e: EstadoAlarmas, hora: string, titulo: string, dias: number[] = [], id: string = idNuevo()): EstadoAlarmas {
  if (!REGEX_HORA.test(hora)) throw new Error('Hora inválida: debe ser HH:MM');
  const limpios = [...new Set(dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  const alarma: Alarma = { id, hora, dias: limpios, titulo: titulo.trim() || 'Alarma', activa: true };
  return { ...e, alarmas: [...e.alarmas.filter((a) => a.id !== id), alarma] };
}

export function alternar(e: EstadoAlarmas, id: string): EstadoAlarmas {
  return { ...e, alarmas: e.alarmas.map((a) => (a.id === id ? { ...a, activa: !a.activa } : a)) };
}

export function eliminar(e: EstadoAlarmas, id: string, ahora = Date.now()): EstadoAlarmas {
  return { alarmas: e.alarmas.filter((a) => a.id !== id), borradas: { ...e.borradas, [id]: ahora } };
}

/** Ordenadas por hora, para mostrarlas. */
export function ordenadas(alarmas: Alarma[]): Alarma[] {
  return [...alarmas].sort((a, b) => a.hora.localeCompare(b.hora));
}

/** Las que suenan en el minuto de `ahora` (mismo criterio que usaba la Mac). */
export function vencidas(alarmas: Alarma[], ahora: Date): Alarma[] {
  const hora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const dia = ahora.getDay();
  return alarmas.filter((a) => a.activa && a.hora === hora && (a.dias.length === 0 || a.dias.includes(dia)));
}

export interface Plan {
  estado: EstadoAlarmas;
  /** Lo que hay que hacer en la Mac para que quede igual que la tablet (si responde). */
  crearEnMac: Alarma[];
  borrarEnMac: string[];
  /** Alarmas que existen en las dos pero con distinto interruptor: se alterna la de la Mac. */
  alternarEnMac: string[];
}

/**
 * Junta la lista de la tablet con la de la Mac. La tablet manda:
 * - lo que la Mac tiene y la tablet no → se adopta (alarmas puestas por voz), salvo si la tablet la borró;
 * - lo que la tablet tiene y la Mac no → se crea allí;
 * - lo que la tablet borró y la Mac aún tiene → se borra allí;
 * - mismo id con distinto interruptor → la Mac se pone como la tablet.
 */
export function reconciliar(local: EstadoAlarmas, remotas: Alarma[], ahora = Date.now()): Plan {
  const borradas = Object.fromEntries(Object.entries(local.borradas).filter(([, cuando]) => ahora - cuando < TREINTA_DIAS));
  const alarmas = [...local.alarmas];
  const crearEnMac: Alarma[] = [];
  const borrarEnMac: string[] = [];
  const alternarEnMac: string[] = [];

  const enLocal = new Map(local.alarmas.map((a) => [a.id, a]));
  const enRemoto = new Map(remotas.map((a) => [a.id, a]));

  for (const r of remotas) {
    const propia = enLocal.get(r.id);
    if (borradas[r.id] !== undefined) borrarEnMac.push(r.id);
    else if (!propia) alarmas.push(r);
    else if (propia.activa !== r.activa) alternarEnMac.push(r.id);
  }
  for (const a of local.alarmas) if (!enRemoto.has(a.id)) crearEnMac.push(a);

  return { estado: { alarmas, borradas }, crearEnMac, borrarEnMac, alternarEnMac };
}

// ---------- Guardado ----------

export function cargarEstado(): EstadoAlarmas {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Partial<EstadoAlarmas> | null;
    if (!v || !Array.isArray(v.alarmas)) return { alarmas: [], borradas: {} };
    const alarmas = v.alarmas.filter(
      (a): a is Alarma => !!a && typeof a.id === 'string' && REGEX_HORA.test(String(a.hora)) && Array.isArray(a.dias) && typeof a.activa === 'boolean',
    );
    return { alarmas, borradas: v.borradas && typeof v.borradas === 'object' ? v.borradas : {} };
  } catch {
    return { alarmas: [], borradas: {} };
  }
}

export function guardarEstado(e: EstadoAlarmas): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(e));
  } catch {
    /* sin almacenamiento: las alarmas duran solo esta sesión */
  }
}
