/**
 * Comandos que la tablet entiende sola, sin la Mac y sin IA: la hora, la fecha, el clima, los
 * temporizadores y las alarmas. Son instantáneos, gratis y funcionan aunque no haya red.
 *
 * Igual que las rutinas, solo se reconoce la frase ENTERA («temporizador de 10 minutos»): si hay algo
 * más («¿qué hora es en Tokio?») no se toca y sigue su camino normal hacia la IA.
 */

import { horaHablada, lista, proximaAlarma, sinRelleno, type AlarmaVoz, type ClimaVoz } from '../../mac-agent/src/hablar';

export type Comando =
  | { tipo: 'hora' }
  | { tipo: 'fecha' }
  | { tipo: 'clima' }
  | { tipo: 'alarmas' }
  | { tipo: 'temporizador'; segundos: number }
  | { tipo: 'cancelar-temporizador' }
  | { tipo: 'restante-temporizador' }
  | { tipo: 'alarma'; hora: string; titulo: string };

// ---------- Números ----------

const NUMEROS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
};

/** «12», «quince», «treinta y cinco» → número; null si no es un número. */
function aNumero(texto: string): number | null {
  if (/^\d+$/.test(texto)) return Number(texto);
  const partes = texto.split(' y ');
  if (partes.length === 1) return NUMEROS[texto] ?? null;
  if (partes.length === 2) {
    const decena = NUMEROS[partes[0]];
    const unidad = NUMEROS[partes[1]];
    return decena !== undefined && decena >= 30 && unidad !== undefined && unidad >= 1 && unidad <= 9 ? decena + unidad : null;
  }
  return null;
}

// ---------- Duraciones ----------

const SEGUNDOS_POR_UNIDAD: Record<string, number> = {
  hora: 3600, horas: 3600, hr: 3600, hrs: 3600, h: 3600,
  minuto: 60, minutos: 60, min: 60, mins: 60,
  segundo: 1, segundos: 1, seg: 1, segs: 1,
};

const UNA_DURACION = /(\d+|[a-z]+(?: y [a-z]+)?) ?(horas?|hrs?|h|minutos?|mins?|segundos?|segs?)(?![a-z])/g;

/** «10 minutos», «1 hora y 30 minutos», «media hora», «una hora y media» → segundos (1 s a 24 h). */
export function duracionEnSegundos(texto: string): number | null {
  const resto = texto.replace(/^(?:de|por|a|para|en|dentro de) /, '').trim();
  if (!resto) return null;
  if (/^media hora$/.test(resto)) return 1800;
  if (/^(?:un )?cuarto de hora$/.test(resto)) return 900;
  if (/^tres cuartos de hora$/.test(resto)) return 2700;
  if (/^hora y media$/.test(resto)) return 5400;

  let total = 0;
  let ultima = 0;
  let hubo = false;
  const sobrante = resto.replace(UNA_DURACION, (completo, n: string, u: string) => {
    const valor = aNumero(n);
    if (valor === null) return completo;
    total += valor * SEGUNDOS_POR_UNIDAD[u];
    ultima = SEGUNDOS_POR_UNIDAD[u];
    hubo = true;
    return ' ';
  });
  if (!hubo) return null;

  let cola = sobrante.split(' ').filter(Boolean);
  // «dos horas y media», «una hora y cuarto»
  if (ultima === 3600 && cola.length === 2 && cola[0] === 'y' && (cola[1] === 'media' || cola[1] === 'cuarto')) {
    total += cola[1] === 'media' ? 1800 : 900;
    cola = [];
  }
  if (cola.some((p) => p !== 'y' && p !== 'con')) return null;
  return total >= 1 && total <= 86_400 ? total : null;
}

/** «10 minutos», «1 hora y 30 minutos», «45 segundos». */
export function duracionHablada(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  const partes = [
    h ? `${h} ${h === 1 ? 'hora' : 'horas'}` : '',
    m ? `${m} ${m === 1 ? 'minuto' : 'minutos'}` : '',
    s ? `${s} ${s === 1 ? 'segundo' : 'segundos'}` : '',
  ].filter(Boolean);
  return lista(partes);
}

// ---------- Alarmas ----------

/** Igual que el texto pero cada letra en su sitio (sin tildes ni signos): así se puede volver al original. */
function aplanar(texto: string): string {
  let plano = '';
  for (let i = 0; i < texto.length; i++) {
    const base = texto[i].normalize('NFD')[0].toLowerCase();
    plano += /[a-z0-9]/.test(base) ? base : ' ';
  }
  return plano;
}

const INTRO_ALARMA =
  /^\s*(?:(?:hola|hey|oye|ok|okay|jarvis|asistente|por favor) +)*(?:(?:(?:ponme|pon|poner|crea|crear|programa|programar|configura|configurar|activa|activar|agrega|agregar|quiero|necesito) +)?(?:(?:una|la|mi) +)?alarma|despiertame)\s+(?:(?:para|a) +)?(?:las? +)?/;

/**
 * «a las 6», «a las 6:30», «a las seis y media de la tarde», «a las 7 menos cuarto», «a las 8 pm» →
 * «HH:MM». Sin «de la mañana/tarde/noche» manda `despertar` (siempre de mañana) o, si no, la próxima
 * vez que esa hora llegue.
 */
export function interpretarAlarma(texto: string, ahora: Date): { hora: string; titulo: string } | null {
  const plano = aplanar(texto);
  const intro = INTRO_ALARMA.exec(plano);
  if (!intro) return null;
  const despertar = intro[0].includes('despiertame');
  let i = intro[0].length;
  const toma = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(plano.slice(i));
    if (m) i += m[0].length;
    return m;
  };

  let h: number;
  let min = 0;
  const digitos = toma(/^(\d{1,2})(?: +(\d{2}))?(?= |$)/);
  if (digitos) {
    h = Number(digitos[1]);
    if (digitos[2]) min = Number(digitos[2]);
  } else {
    const palabra = toma(/^([a-z]+)(?= |$)/);
    const valor = palabra ? aNumero(palabra[1]) : null;
    if (valor === null) return null;
    h = valor;
  }

  const mas = toma(/^ +y +(media|cuarto|\d{1,2}|[a-z]+)(?= |$)/);
  if (mas) {
    const v = mas[1] === 'media' ? 30 : mas[1] === 'cuarto' ? 15 : aNumero(mas[1]);
    if (v === null || v > 59) return null;
    min = v;
  } else {
    const menos = toma(/^ +menos +(cuarto|\d{1,2}|[a-z]+)(?= |$)/);
    if (menos) {
      const v = menos[1] === 'cuarto' ? 15 : aNumero(menos[1]);
      if (v === null || v < 1 || v > 59) return null;
      min = 60 - v;
      h = (h + 23) % 24;
    }
  }
  toma(/^ +en punto(?= |$)/);

  const periodo = toma(/^ +(?:(?:de la|de|del|en la|por la) +)(manana|tarde|noche|madrugada|mediodia)(?= |$)/)?.[1] ?? toma(/^ +(a +m|p +m|am|pm)(?= |$)/)?.[1]?.replace(/ +/g, ' ') ?? null;
  toma(/^ +en punto(?= |$)/);

  if (h > 23 || min > 59) return null;
  let h24: number;
  if (periodo === 'tarde' || periodo === 'pm' || periodo === 'p m') h24 = h < 12 ? h + 12 : h;
  else if (periodo === 'noche') h24 = h === 12 ? 0 : h >= 6 && h <= 11 ? h + 12 : h;
  else if (periodo === 'mediodia') h24 = 12;
  else if (periodo) h24 = h === 12 ? 0 : h; // mañana, madrugada, am
  else if (h > 12 || h === 0) h24 = h;
  else if (despertar) h24 = h === 12 ? 12 : h;
  else {
    // Sin «de la mañana/tarde»: la primera vez que esa hora llegue, de día o de noche.
    const proxima = (hh: number) => {
      const c = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), hh, min, 0, 0);
      if (c.getTime() <= ahora.getTime()) c.setDate(c.getDate() + 1);
      return c.getTime();
    };
    const am = h % 12;
    h24 = proxima(am) <= proxima(am + 12) ? am : am + 12;
  }

  let titulo = '';
  const conTitulo = toma(/^ +(?:para|que diga|que dice|llamada|titulada|con el nombre de|con el nombre|con titulo) +/);
  if (conTitulo) {
    titulo = texto
      .slice(i)
      .replace(/[\s,.!?]*(?:por favor|gracias)[\s.!?]*$/i, '')
      .replace(/[\s.!?]+$/, '')
      .trim();
    if (!titulo || titulo.length > 40) return null;
    titulo = titulo[0].toUpperCase() + titulo.slice(1);
  } else if (!/^ *(?:(?:por favor|gracias|jarvis|asistente) *)*$/.test(plano.slice(i))) {
    return null;
  }

  return { hora: `${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`, titulo };
}

// ---------- Reconocer la frase ----------

const HORA = /^(?:que )?hora (?:es|son)(?: ahora| ya| en este momento)?$|^que horas son(?: ahora)?$|^dime la hora$|^la hora$|^hora actual$|^me dices la hora$/;
const FECHA = /^(?:que )?(?:dia|fecha) (?:es|estamos)(?: hoy)?$|^en que dia (?:estamos|vivimos)$|^a cuanto estamos$|^dime (?:la fecha|el dia)$|^la fecha$|^fecha de hoy$|^que dia es$/;
const CLIMA = /^(?:como|que tal) (?:esta|va) el (?:clima|tiempo)(?: hoy| ahora)?$|^que (?:clima|tiempo|temperatura) hace(?: hoy| ahora)?$|^(?:el )?(?:clima|tiempo|temperatura)$|^cuantos grados hace(?: hoy| ahora)?$|^como esta el dia$/;
const ALARMAS = /^(?:que|cuales) alarmas (?:tengo|hay)(?: puestas| activas)?$|^mis alarmas$|^(?:a que hora|cuando) (?:suena|sonara) (?:mi|la) (?:proxima )?alarma$|^cuando es mi proxima alarma$|^que alarma sigue$/;
const CANCELAR = /^(?:cancela|cancelar|para|parar|deten|detener|quita|quitar|apaga|apagar|elimina|borra) (?:el |mi |ese )?(?:temporizador|timer|cuenta regresiva)$/;
const RESTANTE = /^cuanto (?:falta|queda)(?: en| para| del| de)?(?: el| mi)? (?:temporizador|timer|cuenta regresiva)$|^cuanto le queda al (?:temporizador|timer)$/;
const TEMPORIZADOR =
  /^(?:(?:ponme|pon|poner|crea|crear|inicia|iniciar|empieza|empezar|arranca|programa|programar|activa|activar|configura|configurar) )?(?:(?:un|el|mi) )?(?:temporizador|timer|cuenta regresiva|cuenta atras)(?: (.+))?$/;
const AVISAME = /^(?:avisame|recuerdame|despiertame|llamame) (?:en|dentro de) (.+)$/;

/** Qué quiere la persona, si es algo que la tablet resuelve sola; null si no. */
export function interpretar(texto: string, ahora: Date = new Date()): Comando | null {
  const alarma = interpretarAlarma(texto, ahora);
  if (alarma) return { tipo: 'alarma', ...alarma };

  const frase = sinRelleno(texto);
  if (!frase) return null;
  if (HORA.test(frase)) return { tipo: 'hora' };
  if (FECHA.test(frase)) return { tipo: 'fecha' };
  if (CLIMA.test(frase)) return { tipo: 'clima' };
  if (ALARMAS.test(frase)) return { tipo: 'alarmas' };
  if (CANCELAR.test(frase)) return { tipo: 'cancelar-temporizador' };
  if (RESTANTE.test(frase)) return { tipo: 'restante-temporizador' };

  const duracion = TEMPORIZADOR.exec(frase)?.[1] ?? AVISAME.exec(frase)?.[1];
  if (duracion !== undefined) {
    const segundos = duracionEnSegundos(duracion);
    return segundos === null ? null : { tipo: 'temporizador', segundos };
  }
  return null;
}

// ---------- Respuestas que no cambian nada ----------

const formatoFechaLarga = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const formatoDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long' });

export interface DatosRespuesta {
  ahora: Date;
  clima: ClimaVoz | null;
  alarmas: AlarmaVoz[];
}

/** El texto para los comandos que solo consultan (hora, fecha, clima, alarmas). */
export function responderConsulta(c: Comando, { ahora, clima, alarmas }: DatosRespuesta): string | null {
  switch (c.tipo) {
    case 'hora': {
      const dicha = horaHablada(ahora).replace(/^a /, '');
      return `${dicha.startsWith('la ') ? 'Es' : 'Son'} ${dicha}.`;
    }
    case 'fecha':
      return `Hoy es ${formatoFechaLarga.format(ahora)}.`;
    case 'clima':
      return clima ? `En ${clima.ciudad} hay ${clima.tempC} grados y el cielo está ${clima.condicion.toLowerCase()}.` : 'Todavía no tengo el clima. Lo busco cuando haya conexión.';
    case 'alarmas': {
      const siguiente = proximaAlarma(alarmas, ahora);
      const activas = alarmas.filter((a) => a.activa).length;
      if (!siguiente) return 'No tienes alarmas activas.';
      const cuando = siguiente.toDateString() === ahora.toDateString() ? '' : `, el ${formatoDia.format(siguiente)}`;
      return `Tienes ${activas === 1 ? 'una alarma activa' : `${activas} alarmas activas`}. La próxima suena ${horaHablada(siguiente)}${cuando}.`;
    }
    default:
      return null;
  }
}
