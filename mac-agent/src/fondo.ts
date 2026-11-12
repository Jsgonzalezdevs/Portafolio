import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lanzarMiniApp } from './agenda.ts';
import type { Ejecutor } from './ejecutor.ts';

/**
 * Fondo de pantalla de la Mac para el panel, a través de «Fondo del asistente.app»
 * (fondo/fondo.swift). La mini app deja dos JPEG en una carpeta: el fondo tal
 * como se ve en el escritorio y una versión desenfocada para el efecto de vidrio.
 *
 * Revisar si cambió cuesta lanzar la mini app, así que se hace como mucho cada
 * `refrescoMs` y nunca dos veces a la vez. La tablet se entera del cambio por
 * la `firma` que viaja en /estado y solo entonces vuelve a bajar las imágenes.
 */

export const NOMBRE_APP_FONDO = 'Fondo del asistente.app';

export type Variante = 'fondo' | 'vidrio';

const ESPERA_MINI_APP_MS = 90_000;

export interface ImagenFondo {
  datos: Buffer;
  firma: string;
}

interface Respuesta {
  firma: string;
  origen: string;
  cambiado: boolean;
}

export class Fondo {
  private firmaActual: string | null = null;
  private revisadoEn = 0;
  private enCurso: Promise<void> | null = null;
  private readonly app: string;
  private readonly carpeta: string;
  private readonly run: Ejecutor;
  private readonly refrescoMs: number;
  private readonly ahora: () => number;
  private readonly log: (linea: string) => void;

  constructor(o: {
    app: string;
    carpeta: string;
    run: Ejecutor;
    refrescoMs?: number;
    ahora?: () => number;
    log?: (linea: string) => void;
  }) {
    this.app = o.app;
    this.carpeta = o.carpeta;
    this.run = o.run;
    this.refrescoMs = o.refrescoMs ?? 5 * 60_000;
    this.ahora = o.ahora ?? Date.now;
    this.log = o.log ?? (() => {});
  }

  /** Firma del fondo ya generado (null si aún no hay). Nunca espera: refresca por detrás. */
  get firma(): string | null {
    if (this.ahora() - this.revisadoEn > this.refrescoMs) void this.revisar();
    return this.firmaActual;
  }

  /** Lanza la mini app si toca. Un fallo deja el fondo anterior y se reintenta en el siguiente ciclo. */
  revisar(): Promise<void> {
    if (!this.enCurso) {
      this.revisadoEn = this.ahora();
      // La mini app se rinde sola a los 75 s (macOS puede estar esperando un permiso); aquí 15 s más de margen.
      this.enCurso = lanzarMiniApp<Respuesta>(this.run, this.app, [this.carpeta, '1600'], ESPERA_MINI_APP_MS)
        .then((r) => {
          if (r.cambiado || r.firma !== this.firmaActual) this.log(`fondo: ${r.origen} (${r.firma})`);
          this.firmaActual = r.firma;
        })
        .catch(async (e: Error) => {
          this.log(`fondo: ${e.message}`);
          // Si `open` se rindió antes que la mini app, no se deja un proceso colgado por cada intento.
          await this.run('pkill', ['-f', `${this.app}/Contents/MacOS`]).catch(() => undefined);
        })
        .finally(() => {
          this.enCurso = null;
        });
    }
    return this.enCurso;
  }

  async imagen(variante: Variante): Promise<ImagenFondo | null> {
    if (!this.firmaActual || this.ahora() - this.revisadoEn > this.refrescoMs) await this.revisar();
    const ruta = join(this.carpeta, variante === 'vidrio' ? 'vidrio.jpg' : 'fondo.jpg');
    if (!this.firmaActual || !existsSync(ruta)) return null;
    const datos = await readFile(ruta);
    // La firma identifica el fondo; se le suma la variante para que sirva de ETag.
    return { datos, firma: createHash('sha1').update(`${this.firmaActual}:${variante}`).digest('hex').slice(0, 16) };
  }
}

/** Solo hay fondo real si el instalador pudo compilar la mini app. */
export function fondoInstalado(raiz: string, run: Ejecutor, log?: (linea: string) => void): Fondo | undefined {
  const app = join(raiz, NOMBRE_APP_FONDO);
  return existsSync(app) ? new Fondo({ app, carpeta: join(raiz, 'fondo-actual'), run, log }) : undefined;
}
