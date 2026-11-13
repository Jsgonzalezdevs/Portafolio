import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alFalloDeVoz, callar, elegirVoz, explicar, fijarVozActiva, hablar, trozos, vozActiva } from './sonido';

describe('trozos', () => {
  it('deja intacto un texto corto', () => {
    expect(trozos('Hola, ¿cómo estás?')).toEqual(['Hola, ¿cómo estás?']);
  });

  it('parte por frases sin pasar del máximo', () => {
    const t = trozos('Primera frase corta. Segunda frase algo más larga que la primera. Tercera.', 50);
    expect(t).toEqual(['Primera frase corta.', 'Segunda frase algo más larga que la primera.', 'Tercera.']);
    expect(t.every((x) => x.length <= 50)).toBe(true);
  });

  it('junta frases cortas en una tanda', () => {
    expect(trozos('Uno. Dos. Tres.', 50)).toEqual(['Uno. Dos. Tres.']);
  });

  it('corta una frase larguísima en comas o espacios', () => {
    const larga = 'a'.repeat(30) + ', ' + 'b'.repeat(30) + ', ' + 'c'.repeat(30) + ' ' + 'd'.repeat(30);
    const t = trozos(larga, 70);
    expect(t.every((x) => x.length <= 70)).toBe(true);
    expect(t.join(' ').replace(/,/g, '').replace(/\s+/g, ' ')).toBe(larga.replace(/,/g, '').replace(/\s+/g, ' '));
  });

  it('sin texto no hay nada que decir', () => {
    expect(trozos('   ')).toEqual([]);
  });
});

describe('elegirVoz', () => {
  it('prefiere la colombiana, luego la latina y al final cualquiera en español', () => {
    const voces = [{ lang: 'en-US' }, { lang: 'es-ES' }, { lang: 'es_MX' }, { lang: 'es-CO' }];
    expect(elegirVoz(voces)).toEqual({ lang: 'es-CO' });
    expect(elegirVoz(voces.filter((v) => v.lang !== 'es-CO'))).toEqual({ lang: 'es_MX' });
    expect(elegirVoz([{ lang: 'en-US' }, { lang: 'es-AR' }])).toEqual({ lang: 'es-AR' });
  });

  it('sin ninguna voz en español devuelve null', () => {
    expect(elegirVoz([{ lang: 'en-US' }, { lang: 'fr-FR' }])).toBeNull();
    expect(elegirVoz([])).toBeNull();
  });
});

describe('explicar', () => {
  it('todo bien', () => {
    const l = explicar({ audio: 'activo', hablaDisponible: true, voces: 5, vozEspanola: 'Español de Colombia' });
    expect(l.every((x) => x.tono === 'ok')).toBe(true);
    expect(l[1].texto).toContain('Español de Colombia');
  });

  it('tonos bloqueados: dice que hay que tocar la pantalla', () => {
    const l = explicar({ audio: 'esperando-toque', hablaDisponible: true, voces: 3, vozEspanola: 'x' });
    expect(l[0]).toMatchObject({ tono: 'aviso' });
    expect(l[0].texto).toMatch(/toca la pantalla/);
  });

  it('sin voz en español: dice cómo instalarla', () => {
    const l = explicar({ audio: 'activo', hablaDisponible: true, voces: 3, vozEspanola: null });
    expect(l[1].tono).toBe('aviso');
    expect(l[1].texto).toMatch(/Salida de texto a voz/);
  });

  it('sin voces visibles y sin sintetizador', () => {
    expect(explicar({ audio: 'activo', hablaDisponible: true, voces: 0, vozEspanola: null })[1].texto).toMatch(/No pude ver las voces/);
    expect(explicar({ audio: 'no-disponible', hablaDisponible: false, voces: 0, vozEspanola: null }).map((x) => x.tono)).toEqual(['aviso', 'aviso']);
  });
});

describe('vozActiva', () => {
  beforeEach(() => localStorage.clear());

  it('viene encendida y se recuerda lo que se elija', () => {
    expect(vozActiva()).toBe(true);
    fijarVozActiva(false);
    expect(vozActiva()).toBe(false);
    fijarVozActiva(true);
    expect(vozActiva()).toBe(true);
  });
});

describe('hablar', () => {
  const dichas: { texto: string; lang: string; voice: unknown }[] = [];
  let cancelaciones = 0;

  class Utterance {
    text: string;
    lang = '';
    voice: unknown = null;
    volume = 1;
    onend: (() => void) | null = null;
    onerror: ((ev: { error: string }) => void) | null = null;
    constructor(texto: string) {
      this.text = texto;
    }
  }

  beforeEach(() => {
    dichas.length = 0;
    cancelaciones = 0;
    vi.useFakeTimers();
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ lang: 'en-US', name: 'Inglés' }, { lang: 'es-CO', name: 'Español CO' }],
        speak: (u: Utterance) => dichas.push({ texto: u.text, lang: u.lang, voice: u.voice }),
        cancel: () => (cancelaciones += 1),
        resume: () => {},
      },
    });
  });

  afterEach(() => {
    callar();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'speechSynthesis');
  });

  it('habla con la voz en español, tanda por tanda, tras dejar respirar a Chrome', async () => {
    const hecho = hablar('Primera frase. Segunda frase.');
    await vi.advanceTimersByTimeAsync(200);
    expect(await hecho).toBe(true);
    expect(dichas).toHaveLength(1);
    expect(dichas[0]).toMatchObject({ texto: 'Primera frase. Segunda frase.', lang: 'es-CO', voice: { name: 'Español CO' } });
    expect(cancelaciones).toBeGreaterThan(0);
  });

  it('una orden nueva descarta la anterior que aún no había empezado', async () => {
    const primera = hablar('Esto se pisa.');
    const segunda = hablar('Esto sí suena.');
    await vi.advanceTimersByTimeAsync(300);
    expect(await primera).toBe(false);
    expect(await segunda).toBe(true);
    expect(dichas.map((d) => d.texto)).toEqual(['Esto sí suena.']);
  });

  it('callar descarta lo que estaba por empezar', async () => {
    const orden = hablar('No debería sonar.');
    callar();
    await vi.advanceTimersByTimeAsync(300);
    expect(await orden).toBe(false);
    expect(dichas).toHaveLength(0);
  });

  it('sin sintetizador avisa del fallo y no rompe', async () => {
    Reflect.deleteProperty(window, 'speechSynthesis');
    vi.unstubAllGlobals();
    const fallos: string[] = [];
    alFalloDeVoz((f) => fallos.push(f));
    expect(await hablar('Hola')).toBe(false);
    expect(fallos).toEqual(['sin-sintetizador']);
  });
});
