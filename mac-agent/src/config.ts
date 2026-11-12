import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Escena {
  id: string;
  nombre: string;
  /** Nombre exacto del Atajo de macOS que se ejecuta (`shortcuts run`). */
  atajo: string;
  /** Si la IA debe pedir confirmación antes (p. ej. abrir la puerta). El panel no pregunta: tocar ya es confirmar. */
  confirmar?: boolean;
}

export type Esfuerzo = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ConfigAsistente {
  /**
   * `auto` (por defecto): Groq si hay llave de Groq guardada; si no, Claude.
   * Así basta con guardar una llave para que el chat funcione.
   */
  proveedor: 'auto' | 'groq' | 'claude';
  /** Modelo de Claude (solo se usa con el proveedor `claude`). */
  modelo: string;
  /** Modelos de Groq en orden de preferencia; vacío = los que trae el agente. */
  modelosGroq: string[];
  /** `low` por defecto: es conversación por voz y la latencia se nota más que la profundidad. */
  esfuerzo: Esfuerzo;
  /** Minutos sin hablar tras los que se empieza una conversación nueva. */
  minutosConversacion: number;
}

export interface AppPermitida {
  id: string;
  nombre: string;
  /** Nombre de la app tal como lo entiende `open -a`. */
  app: string;
}

export interface Config {
  puerto: number;
  /**
   * 127.0.0.1 por defecto: el único que habla con el agente es cloudflared,
   * que corre en esta misma Mac. Abrirlo a la red local es opcional.
   */
  host: string;
  /** Orígenes que pueden llamar al agente desde el navegador (CORS). */
  origenes: string[];
  escenas: Escena[];
  apps: AppPermitida[];
  asistente: ConfigAsistente;
  /**
   * Dónde publicar la dirección del túnel (cifrada con el token) para que el
   * panel la encuentre solo. Lo rellena el instalador con el remoto del repo.
   */
  publicar?: { remoto: string; rama: string };
  /** Ciudad para el reporte del clima (ej. "Ibague"). Por defecto "Ibague". */
  ciudad?: string;
  token: string;
}

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const PREDETERMINADA: Omit<Config, 'token'> = {
  puerto: 8787,
  host: '127.0.0.1',
  origenes: ['https://juliangonzalez.lat', 'https://www.juliangonzalez.lat', 'http://localhost:5173'],
  ciudad: 'Ibague',
  escenas: [
    { id: 'trabajo', nombre: 'Modo Trabajo', atajo: 'Modo Trabajo' },
    { id: 'buenas-noches', nombre: 'Buenas Noches', atajo: 'Buenas Noches' },
    { id: 'cine', nombre: 'Modo Cine', atajo: 'Modo Cine' },
  ],
  apps: [],
  asistente: { proveedor: 'auto', modelo: 'claude-opus-5-5', modelosGroq: [], esfuerzo: 'low', minutosConversacion: 10 },
};

const ESFUERZOS: Esfuerzo[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const ID_VALIDO = /^[a-z0-9_-]{1,40}$/;

/** Valida a mano: un config.json mal escrito debe fallar al arrancar, no a mitad de una orden. */
export function validarConfig(crudo: unknown): Omit<Config, 'token'> {
  const c = { ...PREDETERMINADA, ...(crudo as Partial<Config>) };
  if (!Number.isInteger(c.puerto) || c.puerto < 1 || c.puerto > 65535) throw new Error('config: "puerto" inválido');
  if (typeof c.host !== 'string' || !c.host) throw new Error('config: "host" inválido');
  if (!Array.isArray(c.origenes) || !c.origenes.every((o) => typeof o === 'string')) {
    throw new Error('config: "origenes" debe ser una lista de URLs');
  }
  const revisarLista = (lista: unknown, campo: 'atajo' | 'app', nombre: string) => {
    if (!Array.isArray(lista)) throw new Error(`config: "${nombre}" debe ser una lista`);
    const ids = new Set<string>();
    for (const item of lista as Record<string, unknown>[]) {
      if (typeof item?.id !== 'string' || !ID_VALIDO.test(item.id)) throw new Error(`config: id inválido en "${nombre}"`);
      if (ids.has(item.id)) throw new Error(`config: id repetido "${item.id}" en "${nombre}"`);
      ids.add(item.id);
      if (typeof item.nombre !== 'string' || typeof item[campo] !== 'string' || !item[campo]) {
        throw new Error(`config: "${item.id}" necesita "nombre" y "${campo}"`);
      }
      if (item.confirmar !== undefined && typeof item.confirmar !== 'boolean') {
        throw new Error(`config: "confirmar" de "${item.id}" debe ser true o false`);
      }
    }
  };
  revisarLista(c.escenas, 'atajo', 'escenas');
  revisarLista(c.apps, 'app', 'apps');
  const asistente = { ...PREDETERMINADA.asistente, ...(c.asistente as Partial<ConfigAsistente> | undefined) };
  if (typeof asistente.modelo !== 'string' || !asistente.modelo) throw new Error('config: "asistente.modelo" inválido');
  if (!['auto', 'groq', 'claude'].includes(asistente.proveedor)) {
    throw new Error('config: "asistente.proveedor" debe ser auto, groq o claude');
  }
  if (!Array.isArray(asistente.modelosGroq) || !asistente.modelosGroq.every((m) => typeof m === 'string' && m)) {
    throw new Error('config: "asistente.modelosGroq" debe ser una lista de nombres de modelo');
  }
  if (!ESFUERZOS.includes(asistente.esfuerzo)) throw new Error(`config: "asistente.esfuerzo" debe ser ${ESFUERZOS.join(', ')}`);
  if (typeof asistente.minutosConversacion !== 'number' || asistente.minutosConversacion <= 0) {
    throw new Error('config: "asistente.minutosConversacion" debe ser un número positivo');
  }
  const publicar = (crudo as { publicar?: unknown } | null)?.publicar as Config['publicar'];
  if (publicar !== undefined) {
    if (typeof publicar?.remoto !== 'string' || !/^https:\/\//.test(publicar.remoto)) {
      throw new Error('config: "publicar.remoto" debe ser una URL https de git');
    }
    if (typeof publicar.rama !== 'string' || !/^[a-z0-9-]+$/.test(publicar.rama) || publicar.rama === 'main') {
      throw new Error('config: "publicar.rama" debe ser una rama propia (no main)');
    }
  }
  const ciudad =
    typeof (crudo as Record<string, unknown>)?.ciudad === 'string' &&
    ((crudo as Record<string, unknown>).ciudad as string).trim()
      ? ((crudo as Record<string, unknown>).ciudad as string).trim()
      : 'Ibague';
  return { puerto: c.puerto, host: c.host, origenes: c.origenes, escenas: c.escenas, apps: c.apps, asistente, publicar, ciudad };
}

/** Token del dispositivo: AGENT_TOKEN si existe; si no, uno generado y guardado en .token (permisos 600). */
function cargarToken(): string {
  const env = process.env.AGENT_TOKEN?.trim();
  if (env) {
    if (env.length < 32) throw new Error('AGENT_TOKEN debe tener al menos 32 caracteres');
    return env;
  }
  const ruta = join(RAIZ, '.token');
  if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim();
  const nuevo = randomBytes(32).toString('hex');
  writeFileSync(ruta, `${nuevo}\n`, { mode: 0o600 });
  chmodSync(ruta, 0o600);
  return nuevo;
}

export function cargarConfig(): Config {
  const ruta = process.env.AGENT_CONFIG ?? join(RAIZ, 'config.json');
  const crudo = existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : {};
  return { ...validarConfig(crudo), token: cargarToken() };
}

/**
 * Clave de la API de Claude para el agente bajo launchd, que no hereda las
 * variables de tu terminal: ANTHROPIC_API_KEY si existe; si no, el archivo
 * .anthropic-key (permisos 600) junto al agente. Sin ninguna, el SDK prueba el
 * perfil de `ant auth login`.
 */
export function cargarClaveAnthropic(): string | undefined {
  return cargarClave('ANTHROPIC_API_KEY', '.anthropic-key');
}

/** Llave de Groq: GROQ_API_KEY o el archivo .groq-key junto al agente. */
export function cargarClaveGroq(): string | undefined {
  return cargarClave('GROQ_API_KEY', '.groq-key');
}

function cargarClave(variable: string, archivo: string): string | undefined {
  const env = process.env[variable]?.trim();
  if (env) return env;
  const ruta = join(RAIZ, archivo);
  return existsSync(ruta) ? readFileSync(ruta, 'utf8').trim() || undefined : undefined;
}
