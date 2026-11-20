import { ErrorNoAutorizado, ErrorSinAgente, llamar, type Emparejamiento } from './conexion';
import { callar, hablar as hablarWeb, vozActiva } from './sonido';

/**
 * Chat con el asistente (POST /chat del mac-agent).
 *
 * La voz de verdad (palabra clave, micrófono siempre listo) llega con la app
 * nativa en la fase 4. Mientras tanto, si el navegador trae reconocimiento de
 * voz (Chrome sí, el WebView de Android no), aparece un botón de micrófono, y
 * las respuestas a lo que se dijo por voz se leen en voz alta.
 */

interface RespuestaChat {
  respuesta: string;
  acciones: { herramienta: string; ok: boolean; mensaje: string }[];
  esperandoConfirmacion: boolean;
  efectos?: string[];
}

interface Opciones {
  emparejamiento: () => Emparejamiento | null;
  alNoAutorizado: () => void;
  alAcciones?: (acciones: RespuestaChat['acciones']) => void;
  /** Lo que le toca hacer al panel tras una rutina de voz (p. ej. «modo-noche»). */
  alEfectos?: (efectos: unknown) => void;
  /**
   * La Mac no respondió. Si el texto se puede resolver en la tablet (una rutina), lo hace y devuelve lo
   * que dijo; si no, null y se avisa de que la Mac no contesta.
   */
  alSinMac?: (texto: string) => string | null;
  /**
   * Comandos que la tablet resuelve sola (hora, temporizador, alarma…), antes de molestar a la Mac o a la
   * IA. Devuelve lo que contesta, o null si no era uno.
   */
  alLocal?: (texto: string) => string | null;
}

/** Puente que expone la app Android (android/) dentro de su WebView. */
interface PuenteNativo {
  version(): string;
  estadoVoz(): string;
  escuchar(): void;
  hablar(texto: string, escucharDespues: boolean): void;
  listo(): void;
  ajustes(): void;
  /** Modo noche: brillo mínimo de la pantalla (true) o el normal del sistema (false). */
  brillo?(noche: boolean): void;
  /** Batería de la tablet como JSON: { nivel, cargando, enchufada, temperaturaC }. */
  bateria?(): string;
  /** La app bajó una versión nueva del panel que aún no se está usando. */
  webNueva?(): boolean;
  /** Recarga el panel para estrenar esa versión (se pide de noche, cuando nadie lo usa). */
  recargar?(): void;
}

interface EventoNativo {
  tipo: 'estado-voz' | 'vigilando' | 'palabra' | 'escuchando' | 'parcial' | 'texto' | 'sin-voz' | 'hablando' | 'error';
  texto?: string;
  mensaje?: string;
  estado?: { palabraClave: boolean; palabra: string; error: string | null };
}

export const puenteNativo = (): PuenteNativo | undefined =>
  (window as unknown as { AndroidAsistente?: PuenteNativo }).AndroidAsistente;

const MAX_BURBUJAS = 30;

// ---------- Recordar la charla ----------
// El panel se recarga (versión nueva de noche, un reinicio de la app…): la charla del día no se pierde.

const CLAVE_CHARLA = 'asistente.charla';
const VIGENCIA_CHARLA_MS = 12 * 3_600_000;

export interface Burbuja {
  /** yo = lo que dijo la persona; ia = respuesta; fallo = error. */
  de: 'yo' | 'ia' | 'fallo';
  texto: string;
}

interface CharlaGuardada {
  en: number;
  burbujas: Burbuja[];
}

/** Lo guardado, si es de hace menos de 12 h; exportado para tests. */
export function charlaVigente(guardada: CharlaGuardada | null, ahora: number): Burbuja[] {
  if (!guardada || !Array.isArray(guardada.burbujas) || ahora - guardada.en > VIGENCIA_CHARLA_MS || guardada.en > ahora) return [];
  return guardada.burbujas
    .filter((b) => (b.de === 'yo' || b.de === 'ia' || b.de === 'fallo') && typeof b.texto === 'string' && b.texto.length > 0)
    .slice(-MAX_BURBUJAS);
}

function leerCharla(): Burbuja[] {
  try {
    return charlaVigente(JSON.parse(localStorage.getItem(CLAVE_CHARLA) ?? 'null') as CharlaGuardada | null, Date.now());
  } catch {
    return [];
  }
}

type Reconocimiento = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/** Lo de arriba se resuelve en la tablet (sin Mac); lo de abajo lo hace la Mac. */
const SUGERENCIAS = ['¿Qué tengo hoy?', '¿Cómo está el clima?', 'Temporizador de 10 minutos', 'Mis alarmas', 'Pon música', 'Sube el volumen'];

export function iniciarChat({ emparejamiento, alNoAutorizado, alAcciones, alEfectos, alSinMac, alLocal }: Opciones) {
  const $ = (id: string) => document.getElementById(id)!;
  const historial = $('chat-historial');
  const campo = $('chat-texto') as HTMLInputElement;
  const enviarBoton = $('chat-enviar') as HTMLButtonElement;
  const confirmar = $('chat-confirmar');
  const mic = $('chat-mic') as HTMLButtonElement;
  let nueva = false;
  let enviando = false;
  const nativo = puenteNativo();
  const placeholderBase = campo.placeholder;

  function burbuja(clase: string, texto: string): HTMLLIElement {
    historial.querySelector('.chat__vacio, .chat__bienvenida')?.remove();
    const li = document.createElement('li');
    li.className = clase;
    li.textContent = texto;
    historial.appendChild(li);
    // La tablet pasa días encendida: el DOM no puede crecer sin límite.
    while (historial.children.length > MAX_BURBUJAS) historial.firstElementChild!.remove();
    historial.scrollTop = historial.scrollHeight;
    return li;
  }

  function hablar(texto: string, escucharDespues = false) {
    if (nativo) return nativo.hablar(texto, escucharDespues);
    void hablarWeb(texto);
  }

  /**
   * ¿Se lee la respuesta en voz alta? En la app Android, solo si se preguntó por voz. En el navegador, siempre
   * (aunque se haya escrito) mientras la voz no esté silenciada en el 🔊.
   */
  const debeHablar = (porVoz: boolean) => (nativo ? porVoz : vozActiva());

  async function enviar(texto: string, porVoz = false) {
    const e = emparejamiento();
    const limpio = texto.trim();
    if (!limpio || enviando) {
      // La tablet espera una respuesta hablada: si no la habrá, que vuelva a escuchar la palabra clave.
      if (porVoz) nativo?.listo();
      return;
    }
    // Hora, temporizador, alarma…: la tablet lo hace sola, al instante y aunque no haya Mac.
    const local = alLocal?.(limpio);
    if (local) {
      burbuja('chat__yo', limpio);
      burbuja('chat__ia', local);
      guardarCharla();
      if (debeHablar(porVoz)) hablar(local);
      else if (porVoz) nativo?.listo();
      return;
    }
    if (!e) {
      if (porVoz) nativo?.listo();
      return;
    }
    enviando = true;
    enviarBoton.disabled = true;
    confirmar.hidden = true;
    burbuja('chat__yo', limpio);
    const pensando = burbuja('chat__ia pensando', 'Pensando…');
    try {
      const r = await llamar<RespuestaChat>(e, '/chat', { texto: limpio, nueva });
      nueva = false;
      pensando.className = 'chat__ia';
      pensando.textContent = r.respuesta;
      if (r.acciones.length) alAcciones?.(r.acciones);
      const fallidas = r.acciones.filter((a) => !a.ok);
      if (fallidas.length) {
        const nota = document.createElement('small');
        nota.textContent = fallidas.map((a) => a.mensaje).join(' · ');
        pensando.appendChild(nota);
      }
      confirmar.hidden = !r.esperandoConfirmacion;
      // Si la IA pide confirmación por voz, la tablet escucha la respuesta sin esperar la palabra clave.
      if (debeHablar(porVoz)) hablar(r.respuesta, r.esperandoConfirmacion);
      // Después de empezar a hablar: el modo noche apaga la pantalla, pero la voz sigue.
      if (r.efectos?.length) alEfectos?.(r.efectos);
    } catch (err) {
      pensando.className = 'chat__ia fallo';
      if (err instanceof ErrorNoAutorizado) {
        pensando.textContent = 'El token ya no es válido.';
        alNoAutorizado();
      } else {
        const sinMac = err instanceof TypeError || err instanceof ErrorSinAgente;
        const local = sinMac ? alSinMac?.(limpio) : null;
        if (local) {
          // La tablet lo resolvió sola (y ya lo leyó en voz alta).
          pensando.className = 'chat__ia';
          pensando.textContent = local;
          return;
        }
        pensando.textContent = sinMac ? 'No pude contactar a la Mac.' : (err as Error).message;
      }
      if (debeHablar(porVoz)) hablar(pensando.textContent ?? 'Algo falló.');
    } finally {
      enviando = false;
      enviarBoton.disabled = false;
      guardarCharla();
      historial.scrollTop = historial.scrollHeight;
    }
  }

  $('chat-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const texto = campo.value;
    campo.value = '';
    void enviar(texto);
  });

  confirmar.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-respuesta]');
    if (b) void enviar(b.dataset.respuesta!);
  });

  $('chat-nueva').addEventListener('click', () => {
    nueva = true;
    confirmar.hidden = true;
    historial.textContent = '';
    guardarCharla();
    bienvenida('Charla nueva. ¿En qué te ayudo?');
  });

  /** Pantalla vacía con ideas para tocar: muestra lo que sabe hacer sin tener que adivinarlo. */
  function bienvenida(texto: string) {
    const li = document.createElement('li');
    li.className = 'chat__bienvenida';
    const p = document.createElement('p');
    p.textContent = texto;
    const fila = document.createElement('div');
    fila.className = 'chat__sugerencias';
    for (const s of SUGERENCIAS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat__sugerencia';
      b.textContent = s;
      b.addEventListener('click', () => void enviar(s));
      fila.appendChild(b);
    }
    li.append(p, fila);
    historial.appendChild(li);
  }
  /** Guarda lo que se ve (sin «Pensando…» ni la bienvenida). */
  function guardarCharla() {
    const burbujas: Burbuja[] = [];
    for (const li of Array.from(historial.children)) {
      const c = li.classList;
      if (c.contains('pensando') || !li.textContent) continue;
      // El texto de la burbuja sin la nota de acciones fallidas (<small>), que se añade aparte.
      const texto = li.firstChild?.nodeType === Node.TEXT_NODE ? (li.firstChild.textContent ?? '') : (li.textContent ?? '');
      if (c.contains('chat__yo')) burbujas.push({ de: 'yo', texto });
      else if (c.contains('fallo')) burbujas.push({ de: 'fallo', texto });
      else if (c.contains('chat__ia')) burbujas.push({ de: 'ia', texto });
    }
    try {
      if (burbujas.length) localStorage.setItem(CLAVE_CHARLA, JSON.stringify({ en: Date.now(), burbujas }));
      else localStorage.removeItem(CLAVE_CHARLA);
    } catch {
      /* sin almacenamiento */
    }
  }

  const anteriores = leerCharla();
  if (anteriores.length) {
    for (const b of anteriores) burbuja(b.de === 'yo' ? 'chat__yo' : b.de === 'fallo' ? 'chat__ia fallo' : 'chat__ia', b.texto);
  } else {
    bienvenida('Pregúntame algo o pídeme que controle la Mac.');
  }

  // ---------- Voz nativa (app Android) ----------
  if (nativo) {
    mic.hidden = false;
    mic.addEventListener('click', () => nativo.escuchar());
    const pintarEstadoVoz = (estado: EventoNativo['estado']) => {
      campo.placeholder = estado?.palabraClave ? `Di «${estado.palabra}» o escribe…` : placeholderBase;
    };
    try {
      pintarEstadoVoz(JSON.parse(nativo.estadoVoz()));
    } catch {
      /* versión vieja de la app */
    }
    window.addEventListener('asistente-nativo', (ev) => {
      const d = (ev as CustomEvent<EventoNativo>).detail;
      switch (d.tipo) {
        case 'estado-voz':
          return pintarEstadoVoz(d.estado);
        case 'palabra':
        case 'escuchando':
          mic.classList.add('escuchando');
          campo.value = '';
          campo.placeholder = 'Te escucho…';
          return;
        case 'parcial':
          campo.value = d.texto ?? '';
          return;
        case 'texto':
          mic.classList.remove('escuchando');
          campo.value = '';
          campo.placeholder = placeholderBase;
          void enviar(d.texto ?? '', true);
          return;
        case 'sin-voz':
        case 'vigilando':
          mic.classList.remove('escuchando');
          if (campo.placeholder === 'Te escucho…') campo.placeholder = placeholderBase;
          return;
        case 'error':
          mic.classList.remove('escuchando');
          burbuja('chat__ia fallo', d.mensaje ?? 'Error de voz');
          return;
      }
    });
    return { enviar };
  }

  // ---------- Micrófono del navegador (Chrome; el WebView de Android no lo trae) ----------
  const w = window as unknown as { SpeechRecognition?: new () => Reconocimiento; webkitSpeechRecognition?: new () => Reconocimiento };
  const Clase = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (Clase) {
    mic.hidden = false;
    let activo: Reconocimiento | null = null;
    mic.addEventListener('click', () => {
      if (activo) return activo.stop();
      const rec = new Clase();
      rec.lang = 'es-CO';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (ev) => void enviar(ev.results[0][0].transcript, true);
      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed') burbuja('chat__ia fallo', 'Sin permiso para usar el micrófono.');
      };
      rec.onend = () => {
        activo = null;
        mic.classList.remove('escuchando');
      };
      activo = rec;
      mic.classList.add('escuchando');
      callar();
      rec.start();
    });
  }

  return { enviar };
}
