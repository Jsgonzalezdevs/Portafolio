import type { Config } from './config.ts';
import type { Ejecutor } from './ejecutor.ts';

/**
 * Lista blanca de lo que la tablet (y, más adelante, la IA) puede hacer en la Mac.
 * No hay acción de «shell libre»: cada orden tiene parámetros validados y se
 * traduce a un binario fijo con argumentos fijos.
 */

export class ErrorDeAccion extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

type Params = Record<string, unknown>;

interface Accion {
  descripcion: string;
  ejecutar: (p: Params) => Promise<string>;
}

const MEDIA = (orden: 'playpause' | 'next track' | 'previous track') => `
if application "Spotify" is running then
  tell application "Spotify" to ${orden}
  return "Spotify"
else if application "Music" is running then
  tell application "Music" to ${orden}
  return "Música"
else
  return ""
end if`;

function entero(p: Params, campo: string, min: number, max: number): number {
  const v = p[campo];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ErrorDeAccion(`"${campo}" debe ser un entero entre ${min} y ${max}`);
  }
  return v;
}

function booleano(p: Params, campo: string): boolean {
  const v = p[campo];
  if (typeof v !== 'boolean') throw new ErrorDeAccion(`"${campo}" debe ser true o false`);
  return v;
}

function idDe(p: Params): string {
  if (typeof p.id !== 'string') throw new ErrorDeAccion('"id" es obligatorio');
  return p.id;
}

export function crearAcciones(config: Pick<Config, 'escenas' | 'apps'>, run: Ejecutor): Record<string, Accion> {
  const osa = (script: string) => run('osascript', ['-e', script]);

  const media = (orden: Parameters<typeof MEDIA>[0], hecho: string): Accion => ({
    descripcion: hecho,
    ejecutar: async () => {
      const app = (await osa(MEDIA(orden))).trim();
      if (!app) throw new ErrorDeAccion('No hay Spotify ni Música abiertos', 409);
      return `${hecho} en ${app}`;
    },
  });

  return {
    'volumen.fijar': {
      descripcion: 'Fija el volumen de salida (0–100)',
      ejecutar: async (p) => {
        const nivel = entero(p, 'nivel', 0, 100);
        await osa(`set volume output volume ${nivel} without output muted`);
        return `Volumen al ${nivel}%`;
      },
    },
    'volumen.silenciar': {
      descripcion: 'Silencia o reactiva el audio',
      ejecutar: async (p) => {
        const silenciar = booleano(p, 'silenciar');
        await osa(`set volume ${silenciar ? 'with' : 'without'} output muted`);
        return silenciar ? 'Audio silenciado' : 'Audio activado';
      },
    },
    'media.playpause': media('playpause', 'Reproducir/pausar'),
    'media.siguiente': media('next track', 'Siguiente canción'),
    'media.anterior': media('previous track', 'Canción anterior'),
    'pantalla.apagar': {
      descripcion: 'Apaga la pantalla (y bloquea si la Mac pide contraseña al despertar)',
      ejecutar: async () => {
        await run('pmset', ['displaysleepnow']);
        return 'Pantalla apagada';
      },
    },
    'mac.bloquear': {
      descripcion: 'Bloquea la Mac (apaga pantalla y pide contraseña al despertar)',
      ejecutar: async () => {
        await run('pmset', ['displaysleepnow']);
        return 'Mac bloqueada';
      },
    },
    'app.abrir': {
      descripcion: 'Abre una app de la lista permitida',
      ejecutar: async (p) => {
        const app = config.apps.find((a) => a.id === idDe(p));
        if (!app) throw new ErrorDeAccion('App no permitida', 404);
        await run('open', ['-a', app.app]);
        return `${app.nombre} abierta`;
      },
    },
    'escena.ejecutar': {
      descripcion: 'Ejecuta una escena (Atajo de macOS: HomeKit, luces, etc.)',
      ejecutar: async (p) => {
        const escena = config.escenas.find((e) => e.id === idDe(p));
        if (!escena) throw new ErrorDeAccion('Escena no configurada', 404);
        await run('shortcuts', ['run', escena.atajo]);
        return `Escena «${escena.nombre}» ejecutada`;
      },
    },
  };
}
