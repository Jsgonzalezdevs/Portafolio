import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorDeAccion } from './acciones.ts';
import type { Ejecutor } from './ejecutor.ts';

/**
 * Calendario y Recordatorios de macOS a través de «Agenda del asistente.app»
 * (agenda/agenda.swift). Se lanza con `open` para que macOS le pida el permiso
 * a esa app y no a node; la respuesta vuelve en JSON por un archivo temporal.
 */

export interface Evento {
  titulo: string;
  inicio: string;
  fin: string;
  todoElDia: boolean;
  calendario: string;
  lugar: string | null;
}

export interface Recordatorio {
  id: string;
  titulo: string;
  vence: string | null;
  lista: string;
}

export interface Permisos {
  calendario: string;
  recordatorios: string;
}

export interface Agenda {
  permisos(): Promise<Permisos>;
  pedirPermisos(): Promise<{ calendario: boolean; recordatorios: boolean }>;
  eventos(desde: string, hasta: string): Promise<Evento[]>;
  crearEvento(titulo: string, inicio: string, fin: string): Promise<{ titulo: string; inicio: string; calendario: string }>;
  recordatorios(): Promise<Recordatorio[]>;
  crearRecordatorio(titulo: string, vence: string | null): Promise<Recordatorio>;
  completarRecordatorio(id: string): Promise<{ titulo: string }>;
}

export const NOMBRE_APP = 'Agenda del asistente.app';

/**
 * Lanza una mini app del agente con `open` y devuelve el JSON que imprime.
 * Va con `open` (y no ejecutando el binario) para que macOS la trate como
 * responsable de sus propios permisos, no a node.
 */
export async function lanzarMiniApp<T>(run: Ejecutor, app: string, args: string[], timeoutMs = 20_000): Promise<T> {
  const carpeta = await mkdtemp(join(tmpdir(), 'miniapp-'));
  const salida = join(carpeta, 'salida.json');
  try {
    try {
      await run('open', ['-n', '-W', '-g', '--stdout', salida, '--stderr', salida, app, '--args', ...args], { timeoutMs });
    } catch (e) {
      // Si la app termina antes de que `open -W` empiece a vigilarla, open falla con
      // "kevent() failed: No such process" aunque la respuesta ya quedó escrita.
      if (!/kevent\(\) failed|No such process/.test((e as Error).message)) throw e;
    }
    const texto = (await readFile(salida, 'utf8')).trim();
    let datos: unknown;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new ErrorDeAccion(`La mini app respondió algo inesperado: ${texto.slice(0, 200)}`, 502);
    }
    if (datos && typeof datos === 'object' && 'error' in datos) {
      throw new ErrorDeAccion(String((datos as { error: unknown }).error), 409);
    }
    return datos as T;
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

export function crearAgenda(app: string, run: Ejecutor): Agenda {
  const llamar = <T>(args: string[], timeoutMs?: number) => lanzarMiniApp<T>(run, app, args, timeoutMs);

  return {
    permisos: () => llamar(['permisos']),
    // Muestra el diálogo de permisos en la Mac y espera a que respondas.
    pedirPermisos: () => llamar(['pedir-permisos'], 180_000),
    eventos: async (desde, hasta) => sinDuplicados(await llamar<Evento[]>(['eventos', desde, hasta])),
    crearEvento: (titulo, inicio, fin) => llamar(['crear-evento', titulo, inicio, fin]),
    recordatorios: () => llamar(['recordatorios']),
    crearRecordatorio: (titulo, vence) => llamar(['crear-recordatorio', titulo, ...(vence ? [vence] : [])]),
    completarRecordatorio: (id) => llamar(['completar-recordatorio', id]),
  };
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * El mismo evento suele estar en dos calendarios (p. ej. iCloud y Google), a
 * veces con un emoji o prefijo distinto. Se considera duplicado si empieza y
 * termina a la misma hora y un título contiene al otro; se conserva el más largo.
 */
export function sinDuplicados(eventos: Evento[]): Evento[] {
  const salida: Evento[] = [];
  for (const e of eventos) {
    const titulo = normalizar(e.titulo);
    const i = salida.findIndex((o) => {
      if (o.inicio !== e.inicio || o.fin !== e.fin) return false;
      const otro = normalizar(o.titulo);
      return otro.includes(titulo) || titulo.includes(otro);
    });
    if (i === -1) salida.push(e);
    else if (e.titulo.length > salida[i].titulo.length) salida[i] = e;
  }
  return salida;
}

/** Agenda en texto compacto para el modelo: menos tokens que el JSON completo. */
export function resumirEventos(eventos: Evento[]): string {
  if (!eventos.length) return 'Sin eventos en ese rango.';
  const hora = (iso: string) => iso.slice(11, 16);
  return eventos
    .map((e) => `${e.inicio.slice(0, 10)} ${e.todoElDia ? 'todo el día' : `${hora(e.inicio)}-${hora(e.fin)}`} ${e.titulo}`)
    .join('\n');
}

/** La agenda solo existe si el instalador pudo compilar la mini app. */
export function agendaInstalada(raiz: string, run: Ejecutor): Agenda | undefined {
  const app = join(raiz, NOMBRE_APP);
  return existsSync(app) ? crearAgenda(app, run) : undefined;
}

export interface Aviso {
  id: string;
  titulo: string;
  vence: string;
}

/** Fecha local "YYYY-MM-DDTHH:mm" que entiende el ayudante. */
export function fechaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Vigila los recordatorios con fecha y avisa a la tablet cuando vencen.
 * Un aviso dura hasta que se descarta, o 2 horas.
 */
export class Avisador {
  private avisos = new Map<string, Aviso & { desde: number }>();
  private anunciados = new Set<string>();
  private permitido: boolean | null = null;
  private permisoRevisado = 0;
  private readonly agenda: Agenda;
  private readonly ahora: () => Date;

  constructor(agenda: Agenda, ahora: () => Date = () => new Date()) {
    this.agenda = agenda;
    this.ahora = ahora;
  }

  get pendientes(): Aviso[] {
    const limite = this.ahora().getTime() - 2 * 3600_000;
    for (const [id, a] of this.avisos) if (a.desde < limite) this.avisos.delete(id);
    return [...this.avisos.values()].map(({ id, titulo, vence }) => ({ id, titulo, vence }));
  }

  descartar(id: string): boolean {
    return this.avisos.delete(id);
  }

  /** Devuelve true si apareció algún aviso nuevo. */
  async revisar(): Promise<boolean> {
    const ahora = this.ahora();
    if (this.permitido === null || ahora.getTime() - this.permisoRevisado > 10 * 60_000) {
      const p = await this.agenda.permisos().catch(() => null);
      this.permitido = p?.recordatorios === 'concedido';
      this.permisoRevisado = ahora.getTime();
    }
    if (!this.permitido) return false;
    const lista = await this.agenda.recordatorios();
    let nuevo = false;
    for (const r of lista) {
      if (!r.vence || this.anunciados.has(r.id)) continue;
      const vence = new Date(r.vence).getTime();
      // Solo lo que venció hace menos de 15 min: al arrancar no se anuncia todo lo atrasado.
      if (vence <= ahora.getTime() && vence > ahora.getTime() - 15 * 60_000) {
        this.anunciados.add(r.id);
        this.avisos.set(r.id, { id: r.id, titulo: r.titulo, vence: r.vence, desde: ahora.getTime() });
        nuevo = true;
      }
    }
    return nuevo;
  }

  /** Tras cambiar el permiso desde el panel, se vuelve a comprobar en la siguiente vuelta. */
  olvidarPermiso() {
    this.permitido = null;
  }
}
