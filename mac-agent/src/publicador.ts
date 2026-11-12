import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Ejecutor } from './ejecutor.ts';

/**
 * Publica la dirección actual del túnel para que el panel la encuentre solo.
 *
 * El túnel rápido de Cloudflare cambia de URL cada vez que se reinicia (por
 * ejemplo, al reiniciar la Mac). El agente la lee del log del túnel, comprueba
 * que funciona y la sube CIFRADA con el token (AES-256-GCM) a la rama `agente`
 * del repo. El panel, que ya conoce el token, la descarga y la descifra; sin
 * el token el archivo no dice nada.
 */

export interface Publicado {
  v: 1;
  iv: string;
  datos: string;
  actualizado: string;
}

const claveDe = (token: string) => createHash('sha256').update(`mac-agent/url/v1:${token}`).digest();

export function cifrarUrl(url: string, token: string, ahora = new Date()): Publicado {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', claveDe(token), iv);
  const cuerpo = Buffer.concat([c.update(url, 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64'), datos: cuerpo.toString('base64'), actualizado: ahora.toISOString() };
}

/** Solo para tests: el panel hace lo mismo con WebCrypto. */
export function descifrarUrl(p: Publicado, token: string): string {
  const cuerpo = Buffer.from(p.datos, 'base64');
  const d = createDecipheriv('aes-256-gcm', claveDe(token), Buffer.from(p.iv, 'base64'));
  d.setAuthTag(cuerpo.subarray(cuerpo.length - 16));
  return Buffer.concat([d.update(cuerpo.subarray(0, -16)), d.final()]).toString('utf8');
}

/** Última URL *.trycloudflare.com que escribió cloudflared en su log. */
export function ultimaUrlDelLog(log: string): string | null {
  const todas = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  return todas ? todas[todas.length - 1] : null;
}

interface Opciones {
  token: string;
  /** Log del servicio del túnel (scripts/tunel.sh). */
  rutaLog: string;
  /** Carpeta de trabajo git propia del publicador. */
  carpeta: string;
  remoto: string;
  rama: string;
  run: Ejecutor;
  comprobar?: (url: string) => Promise<boolean>;
  log?: (linea: string) => void;
}

export class Publicador {
  private publicada: string | null = null;
  private readonly o: Opciones;

  constructor(opciones: Opciones) {
    this.o = opciones;
  }

  private git(...args: string[]) {
    return this.o.run('git', ['-C', this.o.carpeta, ...args], { timeoutMs: 60_000 });
  }

  private async comprobar(url: string): Promise<boolean> {
    if (this.o.comprobar) return this.o.comprobar(url);
    try {
      const r = await fetch(`${url}/salud`, { signal: AbortSignal.timeout(10_000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Devuelve la URL si la publicó en esta vuelta; null si no había nada nuevo. */
  async revisar(): Promise<string | null> {
    const contenido = await readFile(this.o.rutaLog, 'utf8').catch(() => '');
    const url = ultimaUrlDelLog(contenido);
    if (!url || url === this.publicada) return null;
    // Una URL vieja del log (túnel caído) no se publica: el panel la descartaría igual.
    if (!(await this.comprobar(url))) return null;

    const archivo = join(this.o.carpeta, 'agente.json');
    if (!existsSync(join(this.o.carpeta, '.git'))) {
      await this.o.run('git', ['init', '-q', this.o.carpeta]);
      await this.git('remote', 'add', 'origin', this.o.remoto);
      await this.git('checkout', '-q', '--orphan', this.o.rama);
    }
    await writeFile(archivo, `${JSON.stringify(cifrarUrl(url, this.o.token), null, 2)}\n`);
    await this.git('add', 'agente.json');
    const yaHayCommit = await this.git('rev-parse', '--verify', '-q', 'HEAD').then(
      () => true,
      () => false,
    );
    // Siempre un único commit (se reemplaza): la rama no acumula historial.
    await this.git(
      '-c', 'user.name=mac-agent',
      '-c', 'user.email=mac-agent@juliangonzalez.lat',
      'commit', '-q', ...(yaHayCommit ? ['--amend'] : []), '-m', 'agente: dirección actual (cifrada)',
    );
    await this.git('push', '-q', '-f', 'origin', `HEAD:refs/heads/${this.o.rama}`);
    this.publicada = url;
    this.o.log?.(`dirección publicada en la rama ${this.o.rama}`);
    return url;
  }
}
