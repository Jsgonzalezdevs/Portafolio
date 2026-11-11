import { execFile } from 'node:child_process';

/**
 * Ejecuta un binario SIN shell (execFile): los argumentos nunca se interpretan,
 * así que un nombre de atajo con comillas o `;` no puede inyectar comandos.
 */
export type Ejecutor = (bin: string, args: string[], opciones?: { timeoutMs?: number }) => Promise<string>;

export const ejecutar: Ejecutor = (bin, args, opciones) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: opciones?.timeoutMs ?? 10_000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout);
    });
  });
