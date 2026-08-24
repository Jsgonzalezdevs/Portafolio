/**
 * Lo que se puede saber de una visita sin saber de quién es.
 *
 * Cada función de aquí hace lo mismo: toma un dato que identifica y devuelve
 * uno que solo describe. El user agent completo es una huella con la que se
 * reconoce a una persona entre miles; "móvil" no lo es. La URL de donde llegó
 * puede llevar términos de búsqueda o un id de sesión; el dominio solo dice
 * "vino por LinkedIn".
 *
 * Nada de esto vive en `features/lukapp`, aunque allá haya fechas de Bogotá:
 * el portafolio y el ecosistema son bundles disjuntos a propósito, y un import
 * cruzado metería el código de finanzas en la descarga de cualquier visitante.
 */

/** Grueso a propósito. Tres valores no distinguen a nadie; el user agent sí. */
export type Dispositivo = 'movil' | 'tablet' | 'escritorio';

// Tablet primero: un Android de tableta dice "Android" pero NO dice "Mobile",
// y ese es justo el detalle que lo separa de un teléfono.
const TABLET = /\b(ipad|tablet|playbook|silk|kindle)\b|android(?!.*\bmobile\b)/i;
const MOVIL = /\b(iphone|ipod|android|blackberry|iemobile|opera mini|windows phone)\b/i;

export const dispositivoDeUA = (ua: string): Dispositivo => {
  if (TABLET.test(ua)) return 'tablet';
  if (MOVIL.test(ua)) return 'movil';
  return 'escritorio';
};

/**
 * Robots, monitores y los previsualizadores de enlaces de las mensajerías.
 *
 * Sin esto el panel miente por exceso: mandar el enlace por WhatsApp a cinco
 * personas dispara cinco "visitas" que nadie hizo.
 */
const BOTS =
  /bot\b|bots\b|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|slackbot|preview|lighthouse|headless|pingdom|uptime|monitor|curl\/|wget|python-requests|axios\/|postman|go-http-client/i;

export const esBot = (ua: string): boolean => BOTS.test(ua);

/**
 * De dónde llegó, como dominio y nada más.
 *
 * Nunca la URL completa: una búsqueda de Google la trae con los términos
 * dentro, y algunos sitios cuelgan ahí un id de sesión. El dominio responde la
 * pregunta que uno de verdad tiene — por dónde me encontraron — sin traerse
 * nada de lo que esa persona estaba haciendo antes.
 */
export const hostDeReferente = (
  referente: string | null | undefined,
  propio: string,
): string | null => {
  if (!referente) return null;

  let url: URL;
  try {
    url = new URL(referente);
  } catch {
    return null;
  }

  // Un `javascript:` o un `data:` no es una procedencia, y no tiene por qué
  // llegar a una fila de la base.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === '') return null;

  // Moverse dentro del propio sitio no es una fuente de tráfico. Contarlo
  // pondría a juliangonzalez.lat como su propio mayor referente.
  if (host === propio.replace(/^www\./, '').toLowerCase()) return null;

  return host;
};

/** Tope de la ruta guardada: nadie tiene rutas legítimas más largas. */
const LARGO_MAX_RUTA = 120;

/**
 * La ruta sin nada que la vuelva única.
 *
 * Fuera el query y el hash: ahí es donde viajan los `utm_`, los términos de
 * búsqueda y, si algún día hay formularios, lo que la persona escribió.
 */
export const rutaLimpia = (ruta: string): string => {
  const sinQuery = ruta.split(/[?#]/)[0];
  if (sinQuery === '' || !sinQuery.startsWith('/')) return '/';

  // La barra final se cae para que "/proyectos" y "/proyectos/" sean una fila
  // y no dos, pero la raíz sigue siendo "/".
  const sinBarra = sinQuery.length > 1 ? sinQuery.replace(/\/+$/, '') : sinQuery;
  return (sinBarra === '' ? '/' : sinBarra).slice(0, LARGO_MAX_RUTA);
};

/** Código ISO de dos letras, o `XX` cuando el borde no supo decirlo. */
export const paisValido = (pais: string | null | undefined): string => {
  if (!pais) return 'XX';
  const codigo = pais.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(codigo) ? codigo : 'XX';
};

/**
 * La fecha en Bogotá, en `YYYY-MM-DD`.
 *
 * El día tiene que ser el de acá, no el de UTC: entre las 7 y las 12 de la
 * noche UTC ya va un día adelante, y con eso una visita de la noche caería en
 * el resumen del día siguiente.
 */
export const fechaBogota = (ahora: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);

/** Hora del día en Bogotá, 0..23. */
export const horaBogota = (ahora: Date): number => {
  const str = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    hour12: false,
  }).format(ahora);
  return Number(str) % 24;
};

/** Largo del hash guardado. 32 hex = 128 bits: de sobra para no chocar. */
const LARGO_HUELLA = 32;

/**
 * Quién es esta visita, hoy y solo hoy.
 *
 * `sha256(ip + user agent + fecha + sal)`. La IP entra al cálculo y no sale:
 * lo único que se guarda es el hash, y de un hash no se vuelve.
 *
 * La fecha va adentro a propósito. Mañana la misma persona produce otro valor,
 * así que las filas de dos días no se pueden enlazar y nadie queda seguido en
 * el tiempo — que es la diferencia entre contar cuántos entraron y llevarle el
 * rastro a alguien.
 *
 * La sal es secreta por una razón concreta: sin ella, quien sospeche de una IP
 * podría calcular el hash él mismo y comprobar si esa persona estuvo aquí.
 */
export const huellaDelDia = async (
  ip: string,
  ua: string,
  fecha: string,
  sal: string,
): Promise<string> => {
  const datos = new TextEncoder().encode(`${ip}|${ua}|${fecha}|${sal}`);
  const resumen = await crypto.subtle.digest('SHA-256', datos);

  return [...new Uint8Array(resumen)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, LARGO_HUELLA);
};
