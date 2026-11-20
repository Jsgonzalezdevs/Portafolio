/**
 * Qué está pasando ahora y qué sigue, a partir de los eventos del calendario guardados en la tablet.
 * Todo es puro (sin DOM) para poder probarlo y para que funcione con la Mac apagada.
 */

import { horaHablada, lista, paraVoz } from '../../mac-agent/src/hablar';

export interface EventoDia {
  titulo: string;
  inicio: string;
  /** Las respuestas viejas guardadas en la tablet no lo traen: se supone una hora. */
  fin?: string;
  todoElDia: boolean;
}

export interface EventoEnCurso {
  evento: EventoDia;
  /** 0 a 1: cuánto del evento ya pasó. */
  avance: number;
  /** Minutos que faltan para que termine. */
  quedanMin: number;
}

export interface EstadoDelDia {
  actual: EventoEnCurso | null;
  /** Los que aún no empiezan, de hoy y de mañana, en orden. */
  proximos: EventoDia[];
  /** Eventos de todo el día de hoy. */
  todoElDia: EventoDia[];
  /** Cuántos eventos con hora quedan hoy (incluido el actual). */
  quedanHoy: number;
}

const HORA_MS = 3600_000;

const mismoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function inicioDe(e: EventoDia): number {
  return Date.parse(e.inicio);
}

export function finDe(e: EventoDia): number {
  const fin = e.fin ? Date.parse(e.fin) : NaN;
  const inicio = inicioDe(e);
  return Number.isFinite(fin) && fin > inicio ? fin : inicio + HORA_MS;
}

/** Estado del evento respecto a «ahora», para pintarlo en la agenda. */
export function momento(e: EventoDia, ahora: Date): 'pasado' | 'ahora' | 'futuro' {
  if (e.todoElDia) return 'ahora';
  const t = ahora.getTime();
  if (finDe(e) <= t) return 'pasado';
  return inicioDe(e) <= t ? 'ahora' : 'futuro';
}

export function estadoDelDia(eventos: EventoDia[], ahora: Date, maxProximos = 3): EstadoDelDia {
  const t = ahora.getTime();
  const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  const conHora = eventos
    .filter((e) => !e.todoElDia && Number.isFinite(inicioDe(e)))
    .sort((a, b) => inicioDe(a) - inicioDe(b));

  // Si hay varios a la vez, manda el que empezó más tarde (el más concreto).
  const enCurso = conHora.filter((e) => inicioDe(e) <= t && finDe(e) > t);
  const ev = enCurso[enCurso.length - 1];
  const actual: EventoEnCurso | null = ev
    ? {
        evento: ev,
        avance: Math.min(1, Math.max(0, (t - inicioDe(ev)) / (finDe(ev) - inicioDe(ev)))),
        quedanMin: Math.max(1, Math.ceil((finDe(ev) - t) / 60_000)),
      }
    : null;

  const proximos = conHora
    .filter((e) => inicioDe(e) > t && (mismoDia(new Date(inicioDe(e)), ahora) || mismoDia(new Date(inicioDe(e)), manana)))
    .slice(0, maxProximos);

  return {
    actual,
    proximos,
    todoElDia: eventos.filter((e) => e.todoElDia && mismoDia(new Date(e.inicio), ahora)),
    quedanHoy: conHora.filter((e) => finDe(e) > t && mismoDia(new Date(inicioDe(e)), ahora)).length,
  };
}

/** Lo primero con hora que viene (de hoy o mañana), para la pantalla de noche. */
export function primeroQueViene(eventos: EventoDia[], ahora: Date): EventoDia | null {
  return estadoDelDia(eventos, ahora, 1).proximos[0] ?? null;
}

/** «en 5 min», «en 2 h 27 min», «en 1 h», «ahora». */
export function enCuanto(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (min <= 0) return 'ahora';
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `en ${h} h ${resto} min` : `en ${h} h`;
}

/** «quedan 25 min», «queda 1 h 5 min». */
export function quedan(min: number): string {
  if (min < 60) return `${min === 1 ? 'queda' : 'quedan'} ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `${h === 1 && !resto ? 'queda' : 'quedan'} ${h} h${resto ? ` ${resto} min` : ''}`;
}

/** Respuesta hablada a «¿qué tengo hoy?», sin IA ni Mac. */
export function respuestaAgenda(eventos: EventoDia[] | null, ahora: Date): string {
  if (!eventos) return 'Todavía no tengo tu agenda. La traigo en cuanto la Mac responda.';
  const d = estadoDelDia(eventos, ahora, 4);
  const partes: string[] = [];
  if (d.actual) partes.push(`Ahora: ${paraVoz(d.actual.evento.titulo)}, ${quedan(d.actual.quedanMin)}.`);
  const deHoy = d.proximos.filter((e) => mismoDia(new Date(e.inicio), ahora));
  if (deHoy.length) {
    partes.push(`Después: ${lista(deHoy.map((e) => `${paraVoz(e.titulo)} ${horaHablada(new Date(e.inicio))}`))}.`);
  } else if (!d.actual) {
    const manana = d.proximos[0];
    partes.push(
      manana
        ? `No te queda nada hoy. Mañana empiezas con ${paraVoz(manana.titulo)} ${horaHablada(new Date(manana.inicio))}.`
        : 'No te queda nada en el calendario por hoy.',
    );
  }
  if (d.todoElDia.length) partes.push(`Todo el día: ${lista(d.todoElDia.map((e) => paraVoz(e.titulo)))}.`);
  return partes.join(' ');
}

/**
 * Eventos con hora que empiezan dentro de `minutosAntes` (y aún no se avisaron). La clave incluye la
 * hora de inicio: si el evento se mueve, se vuelve a avisar.
 */
export function eventosPorAvisar(eventos: EventoDia[], ahora: Date, avisados: Set<string>, minutosAntes = 5): { clave: string; evento: EventoDia }[] {
  const t = ahora.getTime();
  return eventos
    .filter((e) => !e.todoElDia)
    .map((e) => ({ clave: `${e.titulo}|${e.inicio}`, evento: e, falta: inicioDe(e) - t }))
    .filter((x) => x.falta > 0 && x.falta <= minutosAntes * 60_000 && !avisados.has(x.clave))
    .map(({ clave, evento }) => ({ clave, evento }));
}
