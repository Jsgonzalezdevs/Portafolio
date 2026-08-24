import { describe, expect, it } from 'vitest';
import {
  dispositivoDeUA,
  esBot,
  fechaBogota,
  hostDeReferente,
  huellaDelDia,
  paisValido,
  rutaLimpia,
} from './analitica';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1';
const ANDROID_TEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const ANDROID_TAB =
  'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const ESCRITORIO =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

describe('dispositivoDeUA', () => {
  it('reconoce teléfonos', () => {
    expect(dispositivoDeUA(IPHONE)).toBe('movil');
    expect(dispositivoDeUA(ANDROID_TEL)).toBe('movil');
  });

  it('separa la tableta del teléfono', () => {
    expect(dispositivoDeUA(IPAD)).toBe('tablet');
    // Lo que lo distingue es que NO dice "Mobile", aunque sí diga "Android".
    expect(dispositivoDeUA(ANDROID_TAB)).toBe('tablet');
  });

  it('todo lo demás es escritorio', () => {
    expect(dispositivoDeUA(ESCRITORIO)).toBe('escritorio');
    expect(dispositivoDeUA('')).toBe('escritorio');
  });
});

describe('esBot', () => {
  it('reconoce buscadores y monitores', () => {
    expect(esBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(
      true,
    );
    expect(esBot('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true);
    expect(esBot('curl/8.4.0')).toBe(true);
    expect(esBot('python-requests/2.31.0')).toBe(true);
  });

  it('reconoce el previsualizador de enlaces de las mensajerías', () => {
    // Mandar el portafolio por WhatsApp a cinco personas no son cinco visitas.
    expect(esBot('WhatsApp/2.23.20')).toBe(true);
    expect(esBot('facebookexternalhit/1.1')).toBe(true);
    expect(esBot('TelegramBot (like TwitterBot)')).toBe(true);
  });

  it('no confunde a una persona con un robot', () => {
    expect(esBot(IPHONE)).toBe(false);
    expect(esBot(ESCRITORIO)).toBe(false);
    expect(esBot(ANDROID_TEL)).toBe(false);
  });
});

describe('hostDeReferente', () => {
  const PROPIO = 'juliangonzalez.lat';

  it('deja el dominio y bota el resto de la URL', () => {
    // Los términos de búsqueda viajan en el query y no tienen por qué guardarse.
    expect(hostDeReferente('https://www.google.com/search?q=julian+gonzalez', PROPIO)).toBe(
      'google.com',
    );
    expect(hostDeReferente('https://www.linkedin.com/feed/?trk=abc123', PROPIO)).toBe(
      'linkedin.com',
    );
  });

  it('no cuenta el propio sitio como procedencia', () => {
    // Si no, el portafolio aparece como su propio mayor referente.
    expect(hostDeReferente('https://juliangonzalez.lat/proyectos', PROPIO)).toBeNull();
    expect(hostDeReferente('https://www.juliangonzalez.lat/', PROPIO)).toBeNull();
  });

  it('devuelve nulo cuando no hay referente o no es navegable', () => {
    expect(hostDeReferente(null, PROPIO)).toBeNull();
    expect(hostDeReferente('', PROPIO)).toBeNull();
    expect(hostDeReferente('no es una url', PROPIO)).toBeNull();
    expect(hostDeReferente('javascript:alert(1)', PROPIO)).toBeNull();
    expect(hostDeReferente('data:text/html,hola', PROPIO)).toBeNull();
  });
});

describe('rutaLimpia', () => {
  it('bota el query y el hash', () => {
    expect(rutaLimpia('/proyectos?utm_source=linkedin')).toBe('/proyectos');
    expect(rutaLimpia('/?q=algo+privado')).toBe('/');
    expect(rutaLimpia('/proyectos#contacto')).toBe('/proyectos');
  });

  it('unifica la barra final', () => {
    expect(rutaLimpia('/proyectos/')).toBe('/proyectos');
    expect(rutaLimpia('/proyectos')).toBe('/proyectos');
    expect(rutaLimpia('/')).toBe('/');
  });

  it('cae en la raíz cuando la ruta no es utilizable', () => {
    expect(rutaLimpia('')).toBe('/');
    expect(rutaLimpia('https://otro.com/algo')).toBe('/');
    expect(rutaLimpia('sin-barra')).toBe('/');
  });

  it('corta una ruta absurdamente larga', () => {
    expect(rutaLimpia(`/${'a'.repeat(500)}`)).toHaveLength(120);
  });
});

describe('paisValido', () => {
  it('acepta el código de dos letras y lo normaliza', () => {
    expect(paisValido('CO')).toBe('CO');
    expect(paisValido('us')).toBe('US');
    expect(paisValido(' mx ')).toBe('MX');
  });

  it('cae en XX cuando el borde no supo decirlo', () => {
    expect(paisValido(null)).toBe('XX');
    expect(paisValido('')).toBe('XX');
    expect(paisValido('Colombia')).toBe('XX');
    expect(paisValido('C')).toBe('XX');
  });
});

describe('fechaBogota', () => {
  it('usa el día de acá, no el de UTC', () => {
    // 03:00 UTC del 14 son las 22:00 del 13 en Bogotá. Sin esto, una visita de
    // la noche caería en el resumen del día siguiente.
    expect(fechaBogota(new Date('2026-08-14T03:00:00Z'))).toBe('2026-08-13');
    expect(fechaBogota(new Date('2026-08-14T05:00:00Z'))).toBe('2026-08-14');
  });
});

describe('huellaDelDia', () => {
  const IP = '181.49.23.7';
  const SAL = 'sal-secreta';

  it('el mismo visitante da la misma huella el mismo día', async () => {
    const a = await huellaDelDia(IP, IPHONE, '2026-08-13', SAL);
    const b = await huellaDelDia(IP, IPHONE, '2026-08-13', SAL);

    expect(a).toBe(b);
  });

  it('el mismo visitante da OTRA huella al día siguiente', async () => {
    // Esto es lo que impide seguirle el rastro a alguien entre días.
    const hoy = await huellaDelDia(IP, IPHONE, '2026-08-13', SAL);
    const manana = await huellaDelDia(IP, IPHONE, '2026-08-14', SAL);

    expect(hoy).not.toBe(manana);
  });

  it('dos visitantes distintos no se confunden', async () => {
    const uno = await huellaDelDia(IP, IPHONE, '2026-08-13', SAL);
    const otro = await huellaDelDia('190.1.2.3', IPHONE, '2026-08-13', SAL);

    expect(uno).not.toBe(otro);
  });

  it('sin la sal correcta no se puede reproducir', async () => {
    // Quien sospeche de una IP no puede comprobar si estuvo aquí.
    const real = await huellaDelDia(IP, IPHONE, '2026-08-13', SAL);
    const adivinando = await huellaDelDia(IP, IPHONE, '2026-08-13', 'otra-sal');

    expect(real).not.toBe(adivinando);
  });

  it('no deja rastro legible de la IP', async () => {
    const huella = await huellaDelDia(IP, IPHONE, '2026-08-13', SAL);

    expect(huella).not.toContain(IP);
    expect(huella).toMatch(/^[0-9a-f]{32}$/);
  });
});
