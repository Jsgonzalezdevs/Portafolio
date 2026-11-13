/**
 * Sonido y voz del panel cuando corre en el navegador (sin la app Android).
 *
 * Por qué existe: en Chrome de Android 6 «que suene» tiene varias trampas, y cualquiera de ellas deja
 * la tablet muda sin avisar:
 *  - los tonos y la voz no funcionan hasta que alguien toca la pantalla una vez;
 *  - la lista de voces llega tarde (vacía al principio) y `speak()` justo después de `cancel()` se pierde;
 *  - un texto largo se corta a la mitad, y Chrome puede recoger el objeto de voz antes de terminar;
 *  - si la tablet no tiene instalada una voz en español, habla en otro idioma o no dice nada.
 * Aquí se resuelve lo que se puede y se deja un diagnóstico para ver lo que no (volumen de multimedia,
 * falta del motor de voz de Google).
 */

const CLAVE_VOZ = 'asistente.vozActiva';

/** ¿El asistente responde en voz alta? Por defecto sí. Los tonos de alarma no dependen de esto. */
export function vozActiva(): boolean {
  try {
    return localStorage.getItem(CLAVE_VOZ) !== '0';
  } catch {
    return true;
  }
}

export function fijarVozActiva(activa: boolean): void {
  try {
    localStorage.setItem(CLAVE_VOZ, activa ? '1' : '0');
  } catch {
    /* sin almacenamiento: vale solo hasta recargar */
  }
  if (!activa) callar();
}

// ---------- Tonos ----------

// Un solo contexto de audio para toda la página: Chrome limita cuántos se pueden abrir, y una alarma
// que repite cada 4 s los agotaría.
let contexto: AudioContext | null = null;

export function audio(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    contexto ??= new AudioCtx();
    if (contexto.state === 'suspended') void contexto.resume();
    return contexto;
  } catch {
    return null;
  }
}

/** Tres pitidos. Onda cuadrada: tiene más cuerpo que una senoidal y se oye mejor en altavoces pequeños. */
export function pitido(): void {
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const ganancia = ctx.createGain();
    const inicio = t0 + i * 0.5;
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, inicio);
    ganancia.gain.setValueAtTime(0.25, inicio);
    ganancia.gain.exponentialRampToValueAtTime(0.001, inicio + 0.35);
    osc.connect(ganancia);
    ganancia.connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + 0.35);
  }
}

// ---------- Voz ----------

type Fallo = 'sin-sintetizador' | 'error';
let alFallo: ((fallo: Fallo) => void) | null = null;

/** Para avisar a la persona (una vez) cuando el navegador no logra hablar. */
export function alFalloDeVoz(cb: (fallo: Fallo) => void): void {
  alFallo = cb;
}

function sintetizador(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null;
  return window.speechSynthesis;
}

// Chrome recoge los SpeechSynthesisUtterance sin referencia y entonces nunca termina de hablar.
const enCurso = new Set<SpeechSynthesisUtterance>();
/** Cada orden de hablar o callar sube el turno; una orden que ya no es la última se descarta. */
let turno = 0;

/** La lista de voces llega tarde en Chrome: se espera a `voiceschanged`, con tope. */
export function esperarVoces(ms = 1200): Promise<SpeechSynthesisVoice[]> {
  const s = sintetizador();
  if (!s) return Promise.resolve([]);
  const ya = s.getVoices();
  if (ya.length) return Promise.resolve(ya);
  return new Promise((resolver) => {
    let hecho = false;
    const terminar = () => {
      if (hecho) return;
      hecho = true;
      s.removeEventListener?.('voiceschanged', terminar);
      clearTimeout(reloj);
      resolver(s.getVoices());
    };
    const reloj = setTimeout(terminar, ms);
    s.addEventListener?.('voiceschanged', terminar);
  });
}

const PREFERIDAS = ['es-co', 'es-419', 'es-us', 'es-mx', 'es-es'];
const normalizarLang = (lang: string) => lang.toLowerCase().replace('_', '-');

/** La mejor voz en español disponible (colombiana, latina, o cualquiera), o null si no hay ninguna. */
export function elegirVoz<T extends { lang: string }>(voces: T[]): T | null {
  const espanolas = voces.filter((v) => normalizarLang(v.lang).startsWith('es'));
  if (!espanolas.length) return null;
  const puesto = (v: T) => {
    const i = PREFERIDAS.indexOf(normalizarLang(v.lang));
    return i === -1 ? PREFERIDAS.length : i;
  };
  return [...espanolas].sort((a, b) => puesto(a) - puesto(b))[0];
}

/** Parte un texto en tandas cortas por frases: Chrome corta la voz de los textos largos. */
export function trozos(texto: string, max = 170): string[] {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio) return [];
  const salida: string[] = [];
  let actual = '';
  for (const frase of limpio.split(/(?<=[.!?…])\s+/)) {
    if (actual && `${actual} ${frase}`.length <= max) {
      actual = `${actual} ${frase}`;
      continue;
    }
    if (actual) salida.push(actual);
    actual = frase;
    // Una sola frase larguísima: se corta en una coma o, si no, en un espacio.
    while (actual.length > max) {
      let corte = actual.lastIndexOf(',', max);
      if (corte < 40) corte = actual.lastIndexOf(' ', max);
      if (corte < 1) corte = max;
      salida.push(actual.slice(0, corte).replace(/,$/, '').trim());
      actual = actual.slice(corte).replace(/^[,\s]+/, '');
    }
  }
  if (actual) salida.push(actual);
  return salida;
}

/** Calla lo que esté hablando y descarta lo que estuviera por empezar. */
export function callar(): void {
  turno += 1;
  enCurso.clear();
  sintetizador()?.cancel();
}

/** Lee un texto en voz alta. Devuelve false si no pudo ponerse a hablar. */
export async function hablar(texto: string): Promise<boolean> {
  const s = sintetizador();
  if (!s) {
    alFallo?.('sin-sintetizador');
    return false;
  }
  const partes = trozos(texto);
  if (!partes.length) return false;
  callar();
  const mio = turno;
  const voz = elegirVoz(await esperarVoces());
  // Chrome ignora un speak() pegado a un cancel(): se le deja respirar un instante.
  await new Promise((r) => setTimeout(r, 80));
  if (mio !== turno) return false;
  s.resume?.();
  for (const parte of partes) {
    const u = new SpeechSynthesisUtterance(parte);
    u.lang = voz?.lang ?? 'es-CO';
    if (voz) u.voice = voz;
    u.volume = 1;
    u.onend = () => enCurso.delete(u);
    u.onerror = (ev) => {
      enCurso.delete(u);
      if (ev.error !== 'canceled' && ev.error !== 'interrupted') alFallo?.('error');
    };
    enCurso.add(u);
    s.speak(u);
  }
  return true;
}

// ---------- Diagnóstico ----------

export interface Diagnostico {
  /** `esperando-toque`: el navegador tiene los tonos bloqueados hasta que alguien toque la pantalla. */
  audio: 'activo' | 'esperando-toque' | 'no-disponible';
  hablaDisponible: boolean;
  voces: number;
  vozEspanola: string | null;
}

export async function diagnosticar(): Promise<Diagnostico> {
  const ctx = audio();
  // `resume()` tarda un instante: si no, justo tras el toque se vería «bloqueado» por error.
  if (ctx?.state === 'suspended') await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 400))]);
  const voces = await esperarVoces(1500);
  const espanola = elegirVoz(voces) as SpeechSynthesisVoice | null;
  return {
    audio: !ctx ? 'no-disponible' : ctx.state === 'running' ? 'activo' : 'esperando-toque',
    hablaDisponible: sintetizador() !== null,
    voces: voces.length,
    vozEspanola: espanola ? espanola.name : null,
  };
}

export interface Linea {
  tono: 'ok' | 'aviso';
  texto: string;
}

/** El diagnóstico en frases para la persona, con qué hacer en cada caso. */
export function explicar(d: Diagnostico): Linea[] {
  const lineas: Linea[] = [];
  if (d.audio === 'activo') lineas.push({ tono: 'ok', texto: 'Tonos de alarma y temporizador: listos.' });
  else if (d.audio === 'esperando-toque') lineas.push({ tono: 'aviso', texto: 'Los tonos aún están bloqueados: toca la pantalla una vez o pulsa «Probar sonido».' });
  else lineas.push({ tono: 'aviso', texto: 'Este navegador no puede reproducir tonos.' });

  if (!d.hablaDisponible) {
    lineas.push({ tono: 'aviso', texto: 'Este navegador no sabe hablar: el asistente solo responderá por escrito.' });
  } else if (d.vozEspanola) {
    lineas.push({ tono: 'ok', texto: `Voz en español: ${d.vozEspanola}.` });
  } else if (d.voces > 0) {
    lineas.push({ tono: 'aviso', texto: 'La tablet no tiene una voz en español. En Android: Ajustes › Idioma y entrada › Salida de texto a voz › Motor de Google › Instalar datos de voz › Español.' });
  } else {
    lineas.push({ tono: 'aviso', texto: 'No pude ver las voces de la tablet. Si al probar no oyes nada, revisa Ajustes › Idioma y entrada › Salida de texto a voz.' });
  }
  return lineas;
}

/** Suena un pitido y dice una frase, para comprobar de oído que todo funciona. */
export async function probar(): Promise<Diagnostico> {
  pitido();
  const diagnostico = await diagnosticar();
  // Después de los pitidos (1,3 s), para que no se pisen.
  setTimeout(() => void hablar('Hola, soy tu asistente. Si me escuchas, el sonido funciona.'), 1500);
  return diagnostico;
}
