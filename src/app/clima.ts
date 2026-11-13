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

/** Coordenadas de una ciudad por su nombre (se piden una vez y quedan guardadas). */
export async function ubicar(ciudad: string, pedir: Pedir = fetch): Promise<Ubicacion> {
  const guardada = leerCache<Ubicacion>(clave(ciudad));
  if (guardada) return guardada.valor;
  const r = await pedir(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ciudad)}&count=1&language=es`,
    { signal: AbortSignal.timeout(10_000) },
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
    `https://api.open-meteo.com/v1/forecast?latitude=${u.latitud}&longitude=${u.longitud}&current=temperature_2m,weather_code,is_day&timezone=auto`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
  const d = (await r.json()) as { current?: { temperature_2m?: number; weather_code?: number; is_day?: number } };
  const c = d.current;
  if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number') throw new Error('Respuesta de clima inesperada');
  const { condicion, icono } = describirCodigo(c.weather_code, c.is_day !== 0);
  return { ciudad: u.nombre, tempC: Math.round(c.temperature_2m), condicion, icono };
}
