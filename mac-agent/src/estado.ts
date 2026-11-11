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

/**
 * Muestrea el estado con caché por campo: lo barato (CPU, RAM) en cada lectura,
 * lo que lanza procesos (batería, versión de macOS) con menos frecuencia.
 */
export class Monitor {
  private previoCpu = tiemposCpu();
  private sistema = '';
  private bateria: { valor: Bateria | null; en: number } = { valor: null, en: 0 };
  private readonly ejecutar: Ejecutor;

  constructor(ejecutar: Ejecutor) {
    this.ejecutar = ejecutar;
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
    const [memUsada, volumen] = await Promise.all([
      this.intentar(async () => parsearVmStat(await this.ejecutar('vm_stat', [])), null),
      this.intentar(
        async () => parsearVolumen(await this.ejecutar('osascript', ['-e', 'get volume settings'])),
        null,
      ),
    ]);
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
      momento: new Date().toISOString(),
    };
  }
}
