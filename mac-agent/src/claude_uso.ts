import { existsSync, openSync, readSync, closeSync, fstatSync, readdirSync, statSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Ejecutor } from './ejecutor.ts';

export interface ClaudeUso {
  activo: boolean;
  organizacion: string;
  suscripcion: string;
  email?: string;
  modelo: string;
  contextoUsado: number;
  contextoLimite: number;
  tokensRestantes: number;
  porcentajeLibre: number;
  tokensHoy: number;
  actualizadoEn: string;
}

export function formatearNombreModelo(raw?: string): string {
  if (!raw) return 'Claude';
  const m = raw.toLowerCase();
  if (m.includes('sonnet-5-5') || m.includes('sonnet-5.5')) return 'Sonnet 5.5';
  if (m.includes('sonnet-4-5') || m.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (m.includes('opus-5-5') || m.includes('opus-5.5')) return 'Opus 5.5';
  if (m.includes('opus-4-5') || m.includes('opus-4.5')) return 'Opus 4.5';
  if (m.includes('haiku-4-5') || m.includes('haiku-4.5')) return 'Haiku 4.5';
  if (m.includes('sonnet-3-7') || m.includes('sonnet-3.7')) return 'Sonnet 3.7';
  if (m.includes('sonnet-3-5') || m.includes('sonnet-3.5')) return 'Sonnet 3.5';
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return raw;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function parsearUltimoUso(lineasTexto: string): { usage: RawUsage; model?: string } | null {
  const lineas = lineasTexto.trim().split('\n');
  for (let i = lineas.length - 1; i >= 0; i--) {
    const l = lineas[i];
    if (!l.includes('"usage"')) continue;
    try {
      const obj = JSON.parse(l);
      const u = obj?.message?.usage;
      if (u && typeof u === 'object') {
        const model = obj?.message?.model || obj?.requestedModel || obj?.advisorModel;
        return { usage: u, model };
      }
    } catch {
      // Ignora línea JSON no válida
    }
  }
  return null;
}

export function buscarUltimoUsoEnArchivo(ruta: string): { usage: RawUsage; model?: string } | null {
  try {
    const fd = openSync(ruta, 'r');
    const stat = fstatSync(fd);
    const size = stat.size;
    if (size === 0) {
      closeSync(fd);
      return null;
    }
    // Leemos los últimos 128 KB
    const bufSize = Math.min(size, 131072);
    const buf = Buffer.alloc(bufSize);
    readSync(fd, buf, 0, bufSize, size - bufSize);
    closeSync(fd);
    const texto = buf.toString('utf8');
    return parsearUltimoUso(texto);
  } catch {
    return null;
  }
}

export function calcularContexto(usage: RawUsage): {
  contextoUsado: number;
  contextoLimite: number;
  tokensRestantes: number;
  porcentajeLibre: number;
} {
  const input = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const contextoUsado = input + cacheRead + cacheCreation;
  // Claude Sonnet/Opus tiene ventana de 200k o extendida de 1M
  const contextoLimite = contextoUsado > 200_000 ? 1_000_000 : 200_000;
  const tokensRestantes = Math.max(0, contextoLimite - contextoUsado);
  const porcentajeLibre = Math.round((tokensRestantes / contextoLimite) * 100);
  return { contextoUsado, contextoLimite, tokensRestantes, porcentajeLibre };
}

export function calcularTokensHoy(projectsDir: string, inicioHoyMs: number): number {
  let total = 0;
  try {
    if (!existsSync(projectsDir)) return 0;
    const dirs = readdirSync(projectsDir, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const sub = path.join(projectsDir, d.name);
      const files = readdirSync(sub);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(sub, f);
        try {
          const stat = statSync(full);
          if (stat.mtimeMs >= inicioHoyMs) {
            const contenido = readFileSync(full, 'utf8');
            for (const linea of contenido.split('\n')) {
              if (!linea.includes('"usage"')) continue;
              try {
                const obj = JSON.parse(linea);
                const u = obj?.message?.usage;
                if (u) {
                  total += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
                }
              } catch {}
            }
          }
        } catch {}
      }
    }
  } catch {
    // Si falla el recorrido devuelve lo acumulado
  }
  return total;
}

export class GestorClaudeUso {
  private authCache: {
    en: number;
    valor: { orgName: string; subscriptionType: string; email: string } | null;
  } = { en: 0, valor: null };

  private hoyCache: {
    en: number;
    dia: number;
    valor: number;
  } = { en: 0, dia: 0, valor: 0 };

  private baseDir: string;
  private binClaude: string;

  constructor(baseDir?: string, binClaude?: string) {
    this.baseDir = baseDir ?? path.join(os.homedir(), '.claude');
    this.binClaude = binClaude ?? '/Users/jsgonzalez/.local/bin/claude';
  }

  async obtenerAuth(ejecutar: Ejecutor): Promise<{ orgName: string; subscriptionType: string; email: string } | null> {
    const ahora = Date.now();
    if (ahora - this.authCache.en < 120_000 && this.authCache.valor) {
      return this.authCache.valor;
    }
    try {
      const salida = await ejecutar(this.binClaude, ['auth', 'status'], { timeoutMs: 5000 });
      const datos = JSON.parse(salida);
      if (datos.loggedIn) {
        this.authCache = {
          en: ahora,
          valor: {
            orgName: datos.orgName || 'Personal',
            subscriptionType: datos.subscriptionType || 'Pro',
            email: datos.email || '',
          },
        };
        return this.authCache.valor;
      }
    } catch {
      // Si claude auth status falla, usa el último valor conocido o null
    }
    return this.authCache.valor;
  }

  obtenerTokensHoy(): number {
    const ahora = Date.now();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const inicioHoyMs = hoy.getTime();

    if (this.hoyCache.dia === inicioHoyMs && ahora - this.hoyCache.en < 60_000) {
      return this.hoyCache.valor;
    }

    const projectsDir = path.join(this.baseDir, 'projects');
    const total = calcularTokensHoy(projectsDir, inicioHoyMs);
    this.hoyCache = {
      en: ahora,
      dia: inicioHoyMs,
      valor: total,
    };
    return total;
  }

  obtenerUltimoArchivoProyecto(): { ruta: string; mtime: number } | null {
    const projectsDir = path.join(this.baseDir, 'projects');
    if (!existsSync(projectsDir)) return null;

    let ultimoArchivo: string | null = null;
    let ultimoMtime = 0;

    try {
      const dirs = readdirSync(projectsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const sub = path.join(projectsDir, d.name);
        const files = readdirSync(sub);
        for (const f of files) {
          if (!f.endsWith('.jsonl')) continue;
          const full = path.join(sub, f);
          try {
            const stat = statSync(full);
            if (stat.mtimeMs > ultimoMtime) {
              ultimoMtime = stat.mtimeMs;
              ultimoArchivo = full;
            }
          } catch {}
        }
      }
    } catch {}

    if (!ultimoArchivo) return null;
    return { ruta: ultimoArchivo, mtime: ultimoMtime };
  }

  async leer(ejecutar: Ejecutor): Promise<ClaudeUso | null> {
    const auth = await this.obtenerAuth(ejecutar);
    const ultimo = this.obtenerUltimoArchivoProyecto();

    if (!ultimo && !auth) return null;

    let usage: RawUsage = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let rawModel: string | undefined;

    if (ultimo) {
      const parsed = buscarUltimoUsoEnArchivo(ultimo.ruta);
      if (parsed) {
        usage = parsed.usage;
        rawModel = parsed.model;
      }
    }

    const ctx = calcularContexto(usage);
    const tokensHoy = this.obtenerTokensHoy();

    return {
      activo: !!ultimo && Date.now() - ultimo.mtime < 86_400_000,
      organizacion: auth?.orgName ?? 'ALIMENNI',
      suscripcion: (auth?.subscriptionType ?? 'team').toUpperCase(),
      email: auth?.email,
      modelo: formatearNombreModelo(rawModel),
      contextoUsado: ctx.contextoUsado,
      contextoLimite: ctx.contextoLimite,
      tokensRestantes: ctx.tokensRestantes,
      porcentajeLibre: ctx.porcentajeLibre,
      tokensHoy,
      actualizadoEn: new Date().toISOString(),
    };
  }
}
