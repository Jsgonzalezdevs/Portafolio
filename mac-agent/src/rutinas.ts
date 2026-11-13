import { ErrorDeAccion } from './acciones.ts';
import type { Evento, Recordatorio } from './agenda.ts';
import type { Alarma } from './alarmas.ts';
import type { Clima } from './estado.ts';
import { finDelDia, inicioDelDia, lista, normalizar, resumenManana, resumenNoche, sinRelleno } from './hablar.ts';

/**
 * Rutinas: varias acciones y un resumen hablado con una sola frase («buenas noches»,
 * «buenos días») o un toque en el panel.
 *
 * Los pasos son acciones de la lista blanca del agente (nunca comandos libres). El resumen
 * se arma con código y no con la IA: es instantáneo, gratis y siempre dice lo mismo ante lo mismo.
 */

/** Cosas que le toca hacer al panel de la tablet (el agente no puede). */
export type Efecto = 'modo-noche';
export const EFECTOS: Efecto[] = ['modo-noche'];

export type TipoResumen = 'manana' | 'noche' | 'ninguno';

export interface PasoRutina {
  accion: string;
  params?: Record<string, unknown>;
}

export interface Rutina {
  id: string;
  nombre: string;
  icono: string;
  /** Frases que la disparan por voz (se comparan sin tildes ni mayúsculas, y solo si son la frase entera). */
  frases: string[];
  pasos: PasoRutina[];
  efectos: Efecto[];
  resumen: TipoResumen;
}

export const RUTINAS_PREDETERMINADAS: Rutina[] = [
  {
    id: 'buenos-dias',
    nombre: 'Buenos días',
    icono: '☀️',
    frases: ['buenos dias', 'buen dia', 'resumen del dia', 'resumen de hoy'],
    pasos: [],
    efectos: [],
    resumen: 'manana',
  },
  {
    id: 'buenas-noches',
    nombre: 'Buenas noches',
    icono: '🌙',
    frases: ['buenas noches', 'me voy a dormir', 'voy a dormir', 'a dormir', 'hora de dormir', 'modo dormir'],
    pasos: [
      { accion: 'media.pausar' },
      { accion: 'volumen.limitar', params: { maximo: 20 } },
      { accion: 'pantalla.apagar' },
    ],
    efectos: ['modo-noche'],
    resumen: 'noche',
  },
];

// ---------- Config del usuario ----------

const ID_VALIDO = /^[a-z0-9-]{1,40}$/;
const ACCION_VALIDA = /^[a-z]+\.[a-z_]+$/;

/**
 * Mezcla las rutinas de fábrica con las del usuario (`config.json › rutinas`). Cada clave es un id;
 * si ya existe, se cambian solo los campos que se pongan; si es nueva, hace falta `nombre`.
 * Poner `"buenas-noches": { "pasos": [] }` quita los pasos; no hay forma de borrar una de fábrica
 * (déjala sin pasos y sin resumen si no la quieres).
 */
export function validarRutinas(crudo: unknown): Rutina[] {
  const lista = RUTINAS_PREDETERMINADAS.map((r) => ({ ...r, frases: [...r.frases], pasos: [...r.pasos], efectos: [...r.efectos] }));
  if (crudo === undefined || crudo === null) return lista;
  if (typeof crudo !== 'object' || Array.isArray(crudo)) throw new Error('config: "rutinas" debe ser un objeto con un id por rutina');

  for (const [id, valor] of Object.entries(crudo as Record<string, unknown>)) {
    if (!ID_VALIDO.test(id)) throw new Error(`config: id de rutina inválido "${id}" (solo minúsculas, números y guiones)`);
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error(`config: la rutina "${id}" debe ser un objeto`);
    const v = valor as Record<string, unknown>;

    let rutina = lista.find((r) => r.id === id);
    if (!rutina) {
      if (typeof v.nombre !== 'string' || !v.nombre.trim()) throw new Error(`config: la rutina nueva "${id}" necesita "nombre"`);
      rutina = { id, nombre: v.nombre.trim(), icono: '⚡', frases: [], pasos: [], efectos: [], resumen: 'ninguno' };
      lista.push(rutina);
    }
    if (v.nombre !== undefined) {
      if (typeof v.nombre !== 'string' || !v.nombre.trim()) throw new Error(`config: "nombre" de "${id}" inválido`);
      rutina.nombre = v.nombre.trim();
    }
    if (v.icono !== undefined) {
      if (typeof v.icono !== 'string' || !v.icono.trim() || v.icono.length > 8) throw new Error(`config: "icono" de "${id}" inválido`);
      rutina.icono = v.icono.trim();
    }
    if (v.frases !== undefined) {
      if (!Array.isArray(v.frases) || !v.frases.every((f) => typeof f === 'string' && normalizar(f))) {
        throw new Error(`config: "frases" de "${id}" debe ser una lista de textos`);
      }
      rutina.frases = v.frases as string[];
    }
    if (v.pasos !== undefined) {
      if (!Array.isArray(v.pasos)) throw new Error(`config: "pasos" de "${id}" debe ser una lista`);
      rutina.pasos = v.pasos.map((p: unknown, i: number) => {
        const paso = p as Record<string, unknown> | null;
        if (!paso || typeof paso.accion !== 'string' || !ACCION_VALIDA.test(paso.accion)) {
          throw new Error(`config: el paso ${i + 1} de "${id}" necesita "accion" (p. ej. "volumen.fijar")`);
        }
        if (paso.params !== undefined && (typeof paso.params !== 'object' || paso.params === null || Array.isArray(paso.params))) {
          throw new Error(`config: "params" del paso ${i + 1} de "${id}" debe ser un objeto`);
        }
        return { accion: paso.accion, ...(paso.params ? { params: paso.params as Record<string, unknown> } : {}) };
      });
    }
    if (v.efectos !== undefined) {
      if (!Array.isArray(v.efectos) || !v.efectos.every((e) => EFECTOS.includes(e as Efecto))) {
        throw new Error(`config: "efectos" de "${id}" solo admite: ${EFECTOS.join(', ')}`);
      }
      rutina.efectos = v.efectos as Efecto[];
    }
    if (v.resumen !== undefined) {
      if (!['manana', 'noche', 'ninguno'].includes(String(v.resumen))) throw new Error(`config: "resumen" de "${id}" debe ser manana, noche o ninguno`);
      rutina.resumen = v.resumen as TipoResumen;
    }
  }
  return lista;
}

// ---------- Reconocer la frase ----------

export { normalizar, sinRelleno } from './hablar.ts';

// ---------- Hablar bien (compartido con el panel de la tablet) ----------

export { horaHablada, lista, paraVoz, proximaAlarma } from './hablar.ts';

// ---------- De dónde salen los datos del resumen ----------

export interface FuentesResumen {
  ahora: () => Date;
  clima: () => Promise<Clima | null>;
  eventos: (desde: Date, hasta: Date) => Promise<Evento[]>;
  recordatorios: () => Promise<Recordatorio[]>;
  alarmas: () => Alarma[];
}

const SIN = async () => [] as never[];

export interface ResultadoRutina {
  id: string;
  nombre: string;
  /** Lo que se dice en voz alta. */
  texto: string;
  pasos: { accion: string; ok: boolean; mensaje: string }[];
  efectos: Efecto[];
}

/** Lo que se cuenta de cada paso hecho (solo si de verdad hizo algo). */
const HECHO: Record<string, (mensaje: string, params?: Record<string, unknown>) => string | null> = {
  'media.pausar': (m) => (/pausada/i.test(m) ? 'pausé la música' : null),
  'volumen.limitar': (m, p) => (/bajado/i.test(m) ? `bajé el volumen al ${String(p?.maximo ?? '')} por ciento` : null),
  'pantalla.apagar': () => 'apagué la pantalla de la Mac',
  'mac.bloquear': () => 'bloqueé la Mac',
  'volumen.silenciar': (m) => (/silenciado/i.test(m) ? 'silencié el audio' : null),
};

interface OpcionesRutinas {
  rutinas: Rutina[];
  acciones: Record<string, { ejecutar: (p: Record<string, unknown>) => Promise<string> }>;
  escenas?: { id: string; nombre: string; confirmar?: boolean }[];
  fuentes: Partial<FuentesResumen> & Pick<FuentesResumen, 'ahora'>;
  nombre?: string;
  log?: (linea: string) => void;
}

export class Rutinas {
  private readonly o: OpcionesRutinas;
  private readonly nombre: string;

  constructor(opciones: OpcionesRutinas) {
    this.o = opciones;
    this.nombre = opciones.nombre ?? '';
  }

  /** Frases incluidas: la tablet reconoce la rutina sola cuando la Mac no responde. */
  listar(): { id: string; nombre: string; icono: string; efectos: Efecto[]; frases: string[] }[] {
    return this.o.rutinas.map(({ id, nombre, icono, efectos, frases }) => ({ id, nombre, icono, efectos, frases }));
  }

  /** La rutina que dispara esta frase (entera, sin contar saludos ni cortesías), o null. */
  porFrase(texto: string): Rutina | null {
    const dicho = sinRelleno(texto);
    if (!dicho) return null;
    return this.o.rutinas.find((r) => r.frases.some((f) => normalizar(f) === dicho)) ?? null;
  }

  async ejecutar(id: string): Promise<ResultadoRutina> {
    const rutina = this.o.rutinas.find((r) => r.id === id);
    if (!rutina) throw new ErrorDeAccion('Rutina desconocida', 404);

    const pasos: ResultadoRutina['pasos'] = [];
    const hechos: string[] = [];
    for (const paso of rutina.pasos) {
      const r = await this.paso(paso);
      pasos.push({ accion: paso.accion, ok: r.ok, mensaje: r.mensaje });
      if (r.ok) {
        const frase = HECHO[paso.accion]?.(r.mensaje, paso.params);
        if (frase) hechos.push(frase);
      }
    }
    this.o.log?.(`rutina ${id}: ${pasos.map((p) => `${p.accion}${p.ok ? '' : ' ✗'}`).join(', ') || 'sin pasos'}`);

    const resumen = rutina.resumen === 'ninguno' ? '' : await this.resumen(rutina.resumen).catch(() => '');
    const saludo = this.saludo(rutina);
    const hecho = hechos.length ? `${lista(hechos).replace(/^./, (c) => c.toUpperCase())}.` : '';
    const cierre = rutina.resumen === 'noche' ? 'Que descanses.' : '';
    const texto = [saludo, hecho, resumen, cierre].filter(Boolean).join(' ');
    return { id, nombre: rutina.nombre, texto, pasos, efectos: rutina.efectos };
  }

  private async paso(paso: PasoRutina): Promise<{ ok: boolean; mensaje: string }> {
    const accion = this.o.acciones[paso.accion];
    if (!accion) return { ok: false, mensaje: `Acción desconocida: ${paso.accion}` };
    // Una escena delicada (abrir la puerta…) nunca se ejecuta sola dentro de una rutina.
    if (paso.accion === 'escena.ejecutar') {
      const escena = this.o.escenas?.find((e) => e.id === paso.params?.id);
      if (escena?.confirmar) return { ok: false, mensaje: `«${escena.nombre}» requiere confirmación y no puede ir en una rutina` };
    }
    try {
      return { ok: true, mensaje: await accion.ejecutar(paso.params ?? {}) };
    } catch (e) {
      return { ok: false, mensaje: (e as Error).message };
    }
  }

  private saludo(r: Rutina): string {
    const n = this.nombre ? `, ${this.nombre}` : '';
    if (r.id === 'buenos-dias') return `Buenos días${n}.`;
    if (r.id === 'buenas-noches') return `Buenas noches${n}.`;
    return `${r.nombre}.`;
  }

  private async resumen(tipo: 'manana' | 'noche'): Promise<string> {
    const f = this.o.fuentes;
    const ahora = f.ahora();
    const intentar = async <T>(fn: (() => Promise<T>) | undefined, vacio: T): Promise<T> => {
      if (!fn) return vacio;
      try {
        return await fn();
      } catch {
        return vacio;
      }
    };

    if (tipo === 'manana') {
      const [clima, eventos, recordatorios] = await Promise.all([
        intentar(f.clima, null),
        intentar(() => (f.eventos ?? SIN)(inicioDelDia(ahora), finDelDia(ahora)), [] as Evento[]),
        intentar(f.recordatorios, [] as Recordatorio[]),
      ]);
      return resumenManana({ ahora, clima, eventos, recordatorios });
    }
    const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
    const eventosManana = await intentar(() => (f.eventos ?? SIN)(inicioDelDia(manana), finDelDia(manana)), [] as Evento[]);
    return resumenNoche({ ahora, eventosManana, alarmas: f.alarmas?.() ?? [] });
  }
}
