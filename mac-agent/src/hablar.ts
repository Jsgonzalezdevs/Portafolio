/**
 * Textos para leer en voz alta: horas como se dicen, listas, y los resúmenes de «buenos días» y
 * «buenas noches».
 *
 * Sin dependencias de Node a propósito: lo usan el agente de la Mac Y el panel de la tablet. Así,
 * cuando la Mac está apagada, la tablet dice exactamente lo mismo con lo que tiene guardado.
 * (Los tipos son los mínimos necesarios; los del agente encajan por estructura.)
 */

export interface EventoVoz {
  titulo: string;
  inicio: string;
  todoElDia: boolean;
}

export interface RecordatorioVoz {
  titulo: string;
}

export interface AlarmaVoz {
  hora: string;
  dias: number[];
  activa: boolean;
}

export interface ClimaVoz {
  ciudad: string;
  tempC: number;
  condicion: string;
}

// ---------- Piezas ----------

/** «a las 6 menos cuarto de la mañana», «a la 1 de la tarde»: como se dice, para que la voz suene natural. */
export function horaHablada(fecha: Date): string {
  const h = fecha.getHours();
  const m = fecha.getMinutes();
  // Con «menos» se nombra la hora siguiente: 5:45 → «6 menos cuarto».
  const base = (m === 45 ? h + 1 : h) % 24;
  const h12 = base % 12 === 0 ? 12 : base % 12;
  const articulo = h12 === 1 ? 'a la' : 'a las';
  const minutos = m === 0 ? '' : m === 15 ? ' y cuarto' : m === 30 ? ' y media' : m === 45 ? ' menos cuarto' : ` y ${m}`;
  const franja =
    m === 0 && base === 12 ? 'del mediodía' : m === 0 && base === 0 ? 'de la medianoche' : base < 6 ? 'de la madrugada' : base < 12 ? 'de la mañana' : base < 20 ? 'de la tarde' : 'de la noche';
  return `${articulo} ${h12}${minutos} ${franja}`;
}

/** Quita emojis y símbolos de un título para leerlo en voz alta («☕ 🍽️ Cena & Descanso» → «Cena y Descanso»). */
export function paraVoz(titulo: string): string {
  const limpio = titulo
    .replace(/\p{Extended_Pictographic}/gu, '')
    // Restos invisibles de los emojis: unión (200D), variante (FE0F) y recuadro de tecla (20E3).
    .replace(/‍|️|⃣/g, '')
    .replace(/&/g, ' y ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio || titulo.trim();
}

/** «a, b y c» */
export function lista(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

const cuantos = (n: number, singular: string, plural: string) => (n === 1 ? `un ${singular}` : `${n} ${plural}`);

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaSemana = (d: Date) => DIAS[d.getDay()];
const mismoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const inicioDelDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
export const finDelDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 0);

/** La próxima vez que suena una alarma activa (respeta los días de la semana), o null. */
export function proximaAlarma(alarmas: AlarmaVoz[], ahora: Date): Date | null {
  let mejor: Date | null = null;
  for (const a of alarmas) {
    if (!a.activa) continue;
    const [hh, mm] = a.hora.split(':').map(Number);
    for (let d = 0; d <= 7; d++) {
      const c = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + d, hh, mm, 0, 0);
      if (c.getTime() <= ahora.getTime()) continue;
      if (a.dias.length && !a.dias.includes(c.getDay())) continue;
      if (!mejor || c < mejor) mejor = c;
      break;
    }
  }
  return mejor;
}

// ---------- Resúmenes ----------

export interface DatosManana {
  ahora: Date;
  clima: ClimaVoz | null;
  /** Eventos de hoy (el filtro por día lo hace quien los pide). */
  eventos: EventoVoz[];
  recordatorios: RecordatorioVoz[];
}

/** El resumen de «buenos días»: clima, cuántos eventos, lo próximo y los recordatorios. */
export function resumenManana({ ahora, clima, eventos, recordatorios }: DatosManana): string {
  const partes: string[] = [];
  if (clima) partes.push(`Ahora mismo en ${clima.ciudad}: ${clima.condicion.toLowerCase()}, ${Math.round(clima.tempC)} grados.`);

  const conHora = eventos.filter((e) => !e.todoElDia).sort((a, b) => a.inicio.localeCompare(b.inicio));
  if (!conHora.length) partes.push('Hoy no tienes eventos.');
  else {
    const proximos = conHora.filter((e) => new Date(e.inicio) > ahora).slice(0, 2);
    const cabeza = `Tienes ${cuantos(conHora.length, 'evento', 'eventos')} hoy.`;
    partes.push(
      proximos.length
        ? `${cabeza} Lo próximo: ${lista(proximos.map((e) => `${paraVoz(e.titulo)} ${horaHablada(new Date(e.inicio))}`))}.`
        : `${cabeza} Ya no te queda ninguno por delante.`,
    );
  }

  if (recordatorios.length) {
    const titulos = recordatorios.slice(0, 3).map((r) => paraVoz(r.titulo));
    partes.push(
      recordatorios.length <= 3
        ? `Tienes ${cuantos(recordatorios.length, 'recordatorio', 'recordatorios')}: ${lista(titulos)}.`
        : `Tienes ${recordatorios.length} recordatorios pendientes, entre ellos ${lista(titulos.slice(0, 2))}.`,
    );
  }
  return partes.join(' ');
}

export interface DatosNoche {
  ahora: Date;
  /** Eventos de mañana. */
  eventosManana: EventoVoz[];
  alarmas: AlarmaVoz[];
}

/** El resumen de «buenas noches»: el primer evento de mañana y la próxima alarma. */
export function resumenNoche({ ahora, eventosManana, alarmas }: DatosNoche): string {
  const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  const partes: string[] = [];
  const primero = eventosManana.filter((e) => !e.todoElDia).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
  partes.push(primero ? `Mañana tu primer evento es ${paraVoz(primero.titulo)} ${horaHablada(new Date(primero.inicio))}.` : 'Mañana no tienes eventos.');

  const alarma = proximaAlarma(alarmas, ahora);
  if (alarma) partes.push(`Tu próxima alarma suena ${mismoDia(alarma, ahora) ? 'hoy ' : mismoDia(alarma, manana) ? '' : `el ${diaSemana(alarma)} `}${horaHablada(alarma)}.`);
  return partes.join(' ');
}

// ---------- Reconocer una frase (la Mac y la tablet entienden «buenas noches» igual) ----------

/** Sin tildes, mayúsculas ni signos: «¡Buenos DÍAS, Julián!» → «buenos dias julian». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RELLENO_INICIO = /^(?:(?:hola|hey|oye|ok|okay|jarvis|asistente|computer|por favor)\s+)+/;
const RELLENO_FINAL = /(?:\s+(?:por favor|gracias|jarvis|asistente))+$/;

/** Quita saludos y cortesías de los bordes: «Jarvis, buenas noches, gracias» → «buenas noches». */
export function sinRelleno(texto: string): string {
  return normalizar(texto).replace(RELLENO_INICIO, '').replace(RELLENO_FINAL, '').trim();
}
