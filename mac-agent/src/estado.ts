import { existsSync, statfsSync } from 'node:fs';
import os from 'node:os';
import type { Ejecutor } from './ejecutor.ts';

export interface Bateria {
  porcentaje: number;
  cargando: boolean;
  conectada: boolean;
}

export interface Volumen {
  nivel: number;
  silenciado: boolean;
}

export interface Reproductor {
  app: 'spotify' | 'music';
  estado: 'playing' | 'paused' | 'stopped';
  cancion: string;
  artista: string;
  album?: string | null;
  caratula: string | null;
  posicionSeg: number;
  duracionSeg: number;
  dispositivoSalida?: string | null;
}

export interface Clima {
  ciudad: string;
  tempC: number;
  condicion: string;
  icono: string;
}

export interface EstadoMac {
  nombre: string;
  sistema: string;
  uptimeSeg: number;
  cpuPct: number;
  carga1m: number;
  nucleos: number;
  memoria: { usadaBytes: number; totalBytes: number };
  disco: { libreBytes: number; totalBytes: number } | null;
  bateria: Bateria | null;
  volumen: Volumen | null;
  reproductor?: Reproductor | null;
  dispositivoSalida?: string | null;
  clima?: Clima | null;
  momento: string;
}

/** Bytes que Monitor de Actividad llama «Memoria usada»: apps + fija + comprimida. */
export function parsearVmStat(salida: string): number | null {
  const tam = /page size of (\d+) bytes/.exec(salida);
  if (!tam) return null;
  const pag = (etiqueta: string) => {
    const m = new RegExp(`${etiqueta}:\\s+(\\d+)\\.`).exec(salida);
    return m ? Number(m[1]) : 0;
  };
  const paginas =
    Math.max(0, pag('Anonymous pages') - pag('Pages purgeable')) +
    pag('Pages wired down') +
    pag('Pages occupied by compressor');
  return paginas * Number(tam[1]);
}

/** `pmset -g batt` → null en Macs de escritorio, que no tienen batería. */
export function parsearPmset(salida: string): Bateria | null {
  const m = /(\d+)%;\s*([^;]+);/.exec(salida);
  if (!m) return null;
  const detalle = m[2].trim().toLowerCase();
  return {
    porcentaje: Number(m[1]),
    cargando: detalle === 'charging',
    conectada: salida.includes("'AC Power'"),
  };
}

/** `get volume settings` → { nivel, silenciado }. */
export function parsearVolumen(salida: string): Volumen | null {
  const nivel = /output volume:(\d+)/.exec(salida);
  const mudo = /output muted:(true|false)/.exec(salida);
  if (!nivel) return null;
  return { nivel: Number(nivel[1]), silenciado: mudo?.[1] === 'true' };
}

function parsearSegundos(val?: string): number {
  if (!val) return 0;
  const num = Number(val.trim().replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

/** `osascript` con Spotify / Música → Reproductor o null si nada suena. */
export function parsearReproductor(salida: string): Reproductor | null {
  const limpia = salida.trim();
  if (!limpia || limpia === 'none') return null;
  const partes = limpia.split('\t');
  if (partes.length < 4) return null;
  const app = partes[0] === 'spotify' || partes[0] === 'music' ? partes[0] : null;
  if (!app) return null;
  const estadoRaw = partes[1].toLowerCase();
  const estado: Reproductor['estado'] =
    estadoRaw === 'playing' ? 'playing' : estadoRaw === 'paused' ? 'paused' : 'stopped';
  const cancion = partes[2].trim();
  const artista = partes[3].trim();
  const caratula = partes[4]?.trim() || null;
  const posicionSeg = parsearSegundos(partes[5]);
  const duracionSeg = parsearSegundos(partes[6]);
  const album = partes[7]?.trim() || null;
  if (!cancion) return null;
  return { app, estado, cancion, artista, caratula, posicionSeg, duracionSeg, album };
}

/** `system_profiler SPAudioDataType -json` → Nombre del dispositivo de salida activo o null. */
export function parsearDispositivoSalida(salida: string): string | null {
  try {
    const datos = JSON.parse(salida) as {
      SPAudioDataType?: { _items?: { _name?: string; coreaudio_default_audio_output_device?: string; coreaudio_output_source?: string }[] }[];
    };
    const items = datos?.SPAudioDataType?.[0]?._items ?? [];
    const activo = items.find((it) => it.coreaudio_default_audio_output_device === 'spaudio_yes');
    return activo?.coreaudio_output_source || activo?._name || null;
  } catch {
    return null;
  }
}

/** `wttr.in/?format=%c|%t|%C|%l&lang=es` → Clima o null. */
export function parsearClima(salida: string): Clima | null {
  const limpia = salida.trim();
  if (!limpia || limpia.startsWith('<') || limpia.includes('502') || limpia.includes('404')) return null;
  const partes = limpia.split('|');
  if (partes.length < 4) return null;
  const icono = partes[0].trim();
  const tempStr = partes[1].replace(/[^0-9-]/g, '');
  const tempC = Number(tempStr);
  if (Number.isNaN(tempC)) return null;
  const condicion = partes[2].trim();
  let ciudad = partes[3].split(',')[0].trim();
  if (!ciudad) return null;
  if (ciudad.toLowerCase() === 'ibague') ciudad = 'Ibagué';
  return { ciudad, tempC, condicion, icono };
}

function tiemposCpu() {
  let ocupado = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    ocupado += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { ocupado, total };
}

function leerDisco(): EstadoMac['disco'] {
  // En APFS «/» es el volumen de sistema sellado; los datos del usuario viven en Data.
  const ruta = existsSync('/System/Volumes/Data') ? '/System/Volumes/Data' : '/';
  try {
    const s = statfsSync(ruta);
    return { libreBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

const SCRIPT_REPRODUCTOR = `
if application "Spotify" is running then
  tell application "Spotify"
    set estado to player state as string
    if estado is not "stopped" then
      set trackName to name of current track
      set artistName to artist of current track
      set albumName to ""
      try
        set albumName to album of current track
      end try
      set albumArt to ""
      try
        set albumArt to artwork url of current track
      end try
      set posSec to 0
      try
        set posSec to player position
      end try
      set durSec to 0
      try
        set durSec to (duration of current track) / 1000
      end try
      return "spotify" & character id 9 & estado & character id 9 & trackName & character id 9 & artistName & character id 9 & albumArt & character id 9 & posSec & character id 9 & durSec & character id 9 & albumName
    end if
  end tell
else if application "Music" is running then
  tell application "Music"
    set estado to player state as string
    if estado is not "stopped" then
      set trackName to name of current track
      set artistName to artist of current track
      set albumName to ""
      try
        set albumName to album of current track
      end try
      set posSec to 0
      try
        set posSec to player position
      end try
      set durSec to 0
      try
        set durSec to duration of current track
      end try
      return "music" & character id 9 & estado & character id 9 & trackName & character id 9 & artistName & character id 9 & "" & character id 9 & posSec & character id 9 & durSec & character id 9 & albumName
    end if
  end tell
end if
return "none"
`;

/**
 * Muestrea el estado con caché por campo: lo barato (CPU, RAM) en cada lectura,
 * lo que lanza procesos (batería, versión de macOS) con menos frecuencia.
 */
export class Monitor {
  private previoCpu = tiemposCpu();
  private sistema = '';
  private bateria: { valor: Bateria | null; en: number } = { valor: null, en: 0 };
  private reproductor: { valor: Reproductor | null; en: number } = { valor: null, en: 0 };
  private salidaAudio: { valor: string | null; en: number } = { valor: null, en: 0 };
  private clima: { valor: Clima | null; en: number } = { valor: null, en: 0 };
  private fondo: { valor: string | null; en: number } = { valor: null, en: 0 };
  private readonly ejecutar: Ejecutor;
  private ciudad: string;

  constructor(ejecutar: Ejecutor, ciudad = 'Ibague') {
    this.ejecutar = ejecutar;
    this.ciudad = ciudad;
  }

  fijarCiudad(c: string) {
    this.ciudad = c.trim();
    this.clima = { valor: null, en: 0 };
  }

  private cpuPct(): number {
    const ahora = tiemposCpu();
    const dTotal = ahora.total - this.previoCpu.total;
    const dOcupado = ahora.ocupado - this.previoCpu.ocupado;
    this.previoCpu = ahora;
    return dTotal > 0 ? Math.round((dOcupado / dTotal) * 1000) / 10 : 0;
  }

  private async intentar<T>(fn: () => Promise<T>, respaldo: T): Promise<T> {
    try {
      return await fn();
    } catch {
      return respaldo;
    }
  }

  private async obtenerRutaFondo(): Promise<string | null> {
    const scripts = [
      'tell application "System Events" to get POSIX path of (desktop picture as text)',
      'tell app "Finder" to get POSIX path of (desktop picture as alias)',
      'tell application "System Events" to tell every desktop to get picture as text',
    ];
    for (const script of scripts) {
      try {
        const salida = (await this.ejecutar('osascript', ['-e', script])).trim();
        if (!salida || salida === 'missing value') continue;
        const partes = salida.split(',');
        for (const parte of partes) {
          const ruta = parte.trim();
          if (ruta && ruta !== 'missing value') {
            return ruta;
          }
        }
      } catch {
        // Ignora y prueba el siguiente script
      }
    }

    // Fallbacks para macOS donde el fondo es dinámico o un video Aerial:
    const candidatos = [
      '/System/Library/Desktop Pictures/Sonoma.heic',
      '/System/Library/CoreServices/DefaultDesktop.heic',
      '/System/Library/Desktop Pictures/Mac Blue.heic',
      '/System/Library/Desktop Pictures/Radial Sky Blue.heic',
    ];
    for (const c of candidatos) {
      if (existsSync(c)) return c;
    }

    return null;
  }

  async leerFondo(): Promise<string | null> {
    if (Date.now() - this.fondo.en > 60_000) {
      this.fondo = {
        valor: await this.obtenerRutaFondo(),
        en: Date.now(),
      };
    }
    return this.fondo.valor;
  }

  async leerDispositivoSalida(): Promise<string | null> {
    if (Date.now() - this.salidaAudio.en > 20_000) {
      this.salidaAudio = {
        valor: await this.intentar(async () => {
          const salida = await this.ejecutar('system_profiler', ['SPAudioDataType', '-json']);
          return parsearDispositivoSalida(salida);
        }, this.salidaAudio.valor),
        en: Date.now(),
      };
    }
    return this.salidaAudio.valor;
  }

  async leer(): Promise<EstadoMac> {
    if (!this.sistema) {
      this.sistema = await this.intentar(
        async () => `macOS ${(await this.ejecutar('sw_vers', ['-productVersion'])).trim()}`,
        'macOS',
      );
    }
    if (Date.now() - this.bateria.en > 30_000) {
      this.bateria = {
        valor: await this.intentar(async () => parsearPmset(await this.ejecutar('pmset', ['-g', 'batt'])), null),
        en: Date.now(),
      };
    }
    if (Date.now() - this.reproductor.en > 2500) {
      this.reproductor = {
        valor: await this.intentar(async () => {
          const salida = await this.ejecutar('osascript', ['-e', SCRIPT_REPRODUCTOR]);
          return parsearReproductor(salida);
        }, null),
        en: Date.now(),
      };
    }
    const reintentoClima = this.clima.valor ? 20 * 60_000 : 60_000;
    if (Date.now() - this.clima.en > reintentoClima) {
      this.clima = {
        valor: await this.intentar(async () => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 4000);
          const q = this.ciudad ? encodeURIComponent(this.ciudad) : '';
          const res = await fetch(`https://wttr.in/${q}?format=%c|%t|%C|%l&lang=es`, { signal: ctrl.signal });
          clearTimeout(t);
          if (!res.ok) return this.clima.valor;
          const txt = await res.text();
          return parsearClima(txt) ?? this.clima.valor;
        }, this.clima.valor),
        en: Date.now(),
      };
    }
    const [dispositivoSalida, memUsada, volumen] = await Promise.all([
      this.leerDispositivoSalida(),
      this.intentar(async () => parsearVmStat(await this.ejecutar('vm_stat', [])), null),
      this.intentar(
        async () => parsearVolumen(await this.ejecutar('osascript', ['-e', 'get volume settings'])),
        null,
      ),
    ]);
    const rep = this.reproductor.valor ? { ...this.reproductor.valor, dispositivoSalida } : null;
    const total = os.totalmem();
    return {
      nombre: os.hostname().replace(/\.local$/, ''),
      sistema: this.sistema,
      uptimeSeg: Math.round(os.uptime()),
      cpuPct: this.cpuPct(),
      carga1m: Math.round(os.loadavg()[0] * 100) / 100,
      nucleos: os.cpus().length,
      memoria: { usadaBytes: Math.min(memUsada ?? total - os.freemem(), total), totalBytes: total },
      disco: leerDisco(),
      bateria: this.bateria.valor,
      volumen,
      reproductor: rep,
      dispositivoSalida,
      clima: this.clima.valor,
      momento: new Date().toISOString(),
    };
  }
}
