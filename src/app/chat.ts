import { ErrorNoAutorizado, llamar, type Emparejamiento } from './conexion';

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
}

interface Opciones {
  emparejamiento: () => Emparejamiento | null;
  alNoAutorizado: () => void;
  alAcciones?: (acciones: RespuestaChat['acciones']) => void;
}

/** Puente que expone la app Android (android/) dentro de su WebView. */
interface PuenteNativo {
  version(): string;
  estadoVoz(): string;
  escuchar(): void;
  hablar(texto: string, escucharDespues: boolean): void;
  listo(): void;
  ajustes(): void;
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

export function iniciarChat({ emparejamiento, alNoAutorizado, alAcciones }: Opciones) {
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
    historial.querySelector('.chat__vacio')?.remove();
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
    const voz = window.speechSynthesis;
    if (!voz) return;
    voz.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-CO';
    const espanola = voz.getVoices().find((v) => v.lang.toLowerCase().startsWith('es'));
    if (espanola) u.voice = espanola;
    voz.speak(u);
  }

  async function enviar(texto: string, porVoz = false) {
    const e = emparejamiento();
    const limpio = texto.trim();
    if (!e || !limpio || enviando) {
      // La tablet espera una respuesta hablada: si no la habrá, que vuelva a escuchar la palabra clave.
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
      if (porVoz) hablar(r.respuesta, r.esperandoConfirmacion);
    } catch (err) {
      pensando.className = 'chat__ia fallo';
      if (err instanceof ErrorNoAutorizado) {
        pensando.textContent = 'El token ya no es válido.';
        alNoAutorizado();
      } else {
        pensando.textContent = err instanceof TypeError ? 'No pude contactar a la Mac.' : (err as Error).message;
      }
      if (porVoz) hablar(pensando.textContent ?? 'Algo falló.');
    } finally {
      enviando = false;
      enviarBoton.disabled = false;
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
    burbuja('chat__vacio tenue', 'Charla nueva. ¿En qué te ayudo?');
  });

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
      window.speechSynthesis?.cancel();
      rec.start();
    });
  }

  return { enviar };
}
