import { guardarCache, leerCache } from './almacen';

/**
 * Clima pedido directo a internet (Open-Meteo, gratis y sin llave), sin pasar por la Mac: la tablet
 * sigue sabiendo qué tiempo hace aunque la Mac esté apagada.
 */

export interface Clima {
  ciudad: string;
  tempC: number;
  condicion: string;
  icono: string;
  /** Del día (las lecturas viejas guardadas no lo traen). */
  maxC?: number;
  minC?: number;
  /** «Lluvia hasta las 18:00», «Lluvia hacia las 15:00»; null si no se espera. */
  lluvia?: string | null;
  /** Las próximas horas, para el pronóstico al tocar el clima. */
  horas?: HoraPronostico[];
}

export interface HoraPronostico {
  /** «15:00» */
  hora: string;
  tempC: number;
  prob: number;
  icono: string;
}

export interface Hora {
  /** «2026-11-20T15:00», hora local de la ciudad. */
  t: string;
  prob: number;
  codigo: number;
}

const LLUEVE = (codigo: number) => (codigo >= 51 && codigo <= 67) || (codigo >= 80 && codigo <= 82) || codigo >= 95;
const esLluvia = (h: Hora) => LLUEVE(h.codigo) && h.prob >= 60;
const horaDe = (t: string) => t.slice(11, 16);

/**
 * Aviso corto de lluvia para las próximas horas (la primera es la hora en curso):
 * si ya llueve, hasta cuándo; si no, desde cuándo. Exportado para tests.
 */
export function avisoLluvia(horas: Hora[]): string | null {
  if (!horas.length) return null;
  if (esLluvia(horas[0])) {
    const fin = horas.findIndex((h) => !esLluvia(h));
    return fin === -1 ? 'Lluvia el resto del día' : `Lluvia hasta las ${horaDe(horas[fin].t)}`;
  }
  const inicio = horas.find(esLluvia);
  return inicio ? `Lluvia hacia las ${horaDe(inicio.t)} (${inicio.prob} %)` : null;
}

/** Códigos del tiempo de la OMM → texto en español e icono (con variante de noche donde cambia). */
const CODIGOS: Record<number, readonly [string, string, string?]> = {
  0: ['Despejado', '☀️', '🌙'],
  1: ['Mayormente despejado', '🌤️', '🌙'],
  2: ['Parcialmente nublado', '⛅', '☁️'],
  3: ['Nublado', '☁️'],
  45: ['Niebla', '🌫️'],
  48: ['Niebla con escarcha', '🌫️'],
  51: ['Llovizna ligera', '🌦️'],
  53: ['Llovizna', '🌦️'],
  55: ['Llovizna intensa', '🌧️'],
  56: ['Llovizna helada', '🌧️'],
  57: ['Llovizna helada intensa', '🌧️'],
  61: ['Lluvia ligera', '🌧️'],
  63: ['Lluvia', '🌧️'],
  65: ['Lluvia fuerte', '🌧️'],
  66: ['Lluvia helada', '🌧️'],
  67: ['Lluvia helada fuerte', '🌧️'],
  71: ['Nevada ligera', '🌨️'],
  73: ['Nevada', '🌨️'],
  75: ['Nevada fuerte', '🌨️'],
  77: ['Granizo fino', '🌨️'],
  80: ['Chubascos ligeros', '🌦️'],
  81: ['Chubascos', '🌧️'],
  82: ['Chubascos fuertes', '⛈️'],
  85: ['Chubascos de nieve', '🌨️'],
  86: ['Chubascos de nieve fuertes', '🌨️'],
  95: ['Tormenta', '⛈️'],
  96: ['Tormenta con granizo', '⛈️'],
  99: ['Tormenta con granizo fuerte', '⛈️'],
};

export function describirCodigo(codigo: number, deDia: boolean): { condicion: string; icono: string } {
  const c = CODIGOS[codigo];
  if (!c) return { condicion: 'Tiempo variable', icono: '🌡️' };
  return { condicion: c[0], icono: !deDia && c[2] ? c[2] : c[1] };
}

type Pedir = typeof fetch;

interface Ubicacion {
  latitud: number;
  longitud: number;
  nombre: string;
}

const clave = (ciudad: string) => `geo.${ciudad.trim().toLowerCase()}`;

/** `AbortSignal.timeout` llegó en Chrome 103 y el WebView de la tablet es el 95: el límite se arma a mano. */
function conLimite(ms: number): AbortSignal {
  const control = new AbortController();
  setTimeout(() => control.abort(), ms);
  return control.signal;
}

/** Coordenadas de una ciudad por su nombre (se piden una vez y quedan guardadas). */
export async function ubicar(ciudad: string, pedir: Pedir = fetch): Promise<Ubicacion> {
  const guardada = leerCache<Ubicacion>(clave(ciudad));
  if (guardada) return guardada.valor;
  const r = await pedir(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ciudad)}&count=1&language=es`,
    { signal: conLimite(10_000) },
  );
  if (!r.ok) throw new Error(`No se pudo ubicar «${ciudad}» (${r.status})`);
  const d = (await r.json()) as { results?: { name: string; latitude: number; longitude: number }[] };
  const p = d.results?.[0];
  if (!p) throw new Error(`No encontré «${ciudad}»`);
  const u = { latitud: p.latitude, longitud: p.longitude, nombre: p.name };
  guardarCache(clave(ciudad), u);
  return u;
}

export async function obtenerClima(ciudad: string, pedir: Pedir = fetch): Promise<Clima> {
  const u = await ubicar(ciudad, pedir);
  const r = await pedir(
    `https://api.open-meteo.com/v1/forecast?latitude=${u.latitud}&longitude=${u.longitud}&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code,is_day&forecast_hours=10&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`,
    { signal: conLimite(10_000) },
  );
  if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
  const d = (await r.json()) as {
    current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
    hourly?: { time?: string[]; temperature_2m?: (number | null)[]; precipitation_probability?: (number | null)[]; weather_code?: (number | null)[]; is_day?: (number | null)[] };
    daily?: { temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[] };
  };
  const c = d.current;
  if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number') throw new Error('Respuesta de clima inesperada');
  const { condicion, icono } = describirCodigo(c.weather_code, c.is_day !== 0);
  const h = d.hourly;
  const horas: Hora[] = (h?.time ?? []).map((t, i) => ({ t, prob: h?.precipitation_probability?.[i] ?? 0, codigo: h?.weather_code?.[i] ?? 0 }));
  const max = d.daily?.temperature_2m_max?.[0];
  const min = d.daily?.temperature_2m_min?.[0];
  return {
    ciudad: u.nombre,
    tempC: Math.round(c.temperature_2m),
    condicion,
    icono,
    maxC: typeof max === 'number' ? Math.round(max) : undefined,
    minC: typeof min === 'number' ? Math.round(min) : undefined,
    lluvia: avisoLluvia(horas) ?? undefined,
    horas: horas.length
      ? horas.slice(1, 9).map((x, i) => ({
          hora: horaDe(x.t),
          tempC: Math.round(h?.temperature_2m?.[i + 1] ?? c.temperature_2m!),
          prob: x.prob,
          icono: describirCodigo(x.codigo, (h?.is_day?.[i + 1] ?? 1) !== 0).icono,
        }))
      : undefined,
  };
}
