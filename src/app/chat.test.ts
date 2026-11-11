import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../app/index.html?raw';

/**
 * Ciclo de voz con la app Android simulada: el puente `AndroidAsistente` y los
 * eventos `asistente-nativo` que la app dispara dentro del WebView.
 */

const cuerpo = /<body>([\s\S]*)<script/.exec(html)![1];

const emparejamiento = { agente: 'https://agente.test', token: 't'.repeat(40) };

function emitirNativo(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('asistente-nativo', { detail }));
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('chat con la app Android', () => {
  let puente: Record<string, ReturnType<typeof vi.fn>>;
  let respuestas: unknown[];
  const oyentes: [string, EventListenerOrEventListenerObject][] = [];

  beforeEach(async () => {
    vi.resetModules();
    // Cada test monta el chat de nuevo: los oyentes del anterior no deben seguir vivos.
    const original = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((tipo, oyente, opciones) => {
      oyentes.push([tipo, oyente]);
      original(tipo, oyente, opciones);
    });
    document.body.innerHTML = cuerpo;
    puente = {
      version: vi.fn(() => '0.1.0'),
      estadoVoz: vi.fn(() => JSON.stringify({ palabraClave: true, palabra: 'jarvis', error: null })),
      escuchar: vi.fn(),
      hablar: vi.fn(),
      listo: vi.fn(),
      ajustes: vi.fn(),
    };
    (window as unknown as { AndroidAsistente: unknown }).AndroidAsistente = puente;
    respuestas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const r = respuestas.shift();
        if (r instanceof Error) throw r;
        return new Response(JSON.stringify(r), { status: 200 });
      }),
    );
    const { iniciarChat } = await import('./chat');
    iniciarChat({ emparejamiento: () => emparejamiento, alNoAutorizado: () => {} });
  });

  afterEach(() => {
    for (const [tipo, oyente] of oyentes.splice(0)) window.removeEventListener(tipo, oyente);
    vi.restoreAllMocks();
    delete (window as unknown as { AndroidAsistente?: unknown }).AndroidAsistente;
    vi.unstubAllGlobals();
  });

  it('muestra el micrófono y la palabra clave; el botón pide escuchar a la app', () => {
    const mic = document.getElementById('chat-mic') as HTMLButtonElement;
    expect(mic.hidden).toBe(false);
    expect((document.getElementById('chat-texto') as HTMLInputElement).placeholder).toBe('Di «jarvis» o escribe…');
    mic.click();
    expect(puente.escuchar).toHaveBeenCalledOnce();
  });

  it('texto reconocido → /chat → la app lo lee en voz alta', async () => {
    respuestas.push({ respuesta: 'Volumen al treinta.', acciones: [], esperandoConfirmacion: false });
    emitirNativo({ tipo: 'palabra' });
    expect(document.getElementById('chat-mic')!.classList.contains('escuchando')).toBe(true);
    emitirNativo({ tipo: 'texto', texto: 'pon el volumen al treinta' });
    await vi.waitFor(() => expect(puente.hablar).toHaveBeenCalled());

    expect(puente.hablar).toHaveBeenCalledWith('Volumen al treinta.', false);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://agente.test/chat');
    expect(JSON.parse(init.body)).toEqual({ texto: 'pon el volumen al treinta', nueva: false });
  });

  it('si la IA pide confirmación, la app vuelve a escuchar sin palabra clave', async () => {
    respuestas.push({ respuesta: '¿Seguro que quieres abrir la puerta?', acciones: [], esperandoConfirmacion: true });
    emitirNativo({ tipo: 'texto', texto: 'abre la puerta' });
    await vi.waitFor(() => expect(puente.hablar).toHaveBeenCalledWith('¿Seguro que quieres abrir la puerta?', true));
  });

  it('si la Mac no responde, lo dice en voz alta para que la app no se quede esperando', async () => {
    respuestas.push(new TypeError('Failed to fetch'));
    emitirNativo({ tipo: 'texto', texto: 'hola' });
    await vi.waitFor(() => expect(puente.hablar).toHaveBeenCalledWith('No pude contactar a la Mac.', false));
  });

  it('un texto que llega mientras otro se envía libera a la app', async () => {
    respuestas.push({ respuesta: 'ok', acciones: [], esperandoConfirmacion: false });
    emitirNativo({ tipo: 'texto', texto: 'uno' });
    emitirNativo({ tipo: 'texto', texto: 'dos' });
    expect(puente.listo).toHaveBeenCalledOnce();
    await esperar();
  });

  it('los errores de voz aparecen en el chat', () => {
    emitirNativo({ tipo: 'error', mensaje: 'El reconocimiento de voz necesita internet.' });
    expect(document.getElementById('chat-historial')!.textContent).toContain('necesita internet');
  });
});
