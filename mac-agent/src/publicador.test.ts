import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Ejecutor } from './ejecutor.ts';
import { cifrarUrl, descifrarUrl, FALLOS_PARA_REINICIAR, Publicador, ultimaUrlDelLog, VERCEL_JSON } from './publicador.ts';

const TOKEN = 'd'.repeat(64);

test('cifra la URL con el token; con otro token no se puede leer', () => {
  const p = cifrarUrl('https://abc-def.trycloudflare.com', TOKEN);
  assert.equal(p.v, 1);
  assert.ok(!p.datos.includes('trycloudflare'));
  assert.equal(descifrarUrl(p, TOKEN), 'https://abc-def.trycloudflare.com');
  assert.throws(() => descifrarUrl(p, 'e'.repeat(64)));
});

test('toma la última URL del log del túnel', () => {
  const log = 'INF https://viejo-uno.trycloudflare.com\n...\nINF |  https://nuevo-dos.trycloudflare.com  |\n';
  assert.equal(ultimaUrlDelLog(log), 'https://nuevo-dos.trycloudflare.com');
  assert.equal(ultimaUrlDelLog('nada'), null);
});

test('publica solo si la URL es nueva y funciona; un único commit forzado en su rama', async () => {
  const carpetaBase = await mkdtemp(join(tmpdir(), 'pub-'));
  const rutaLog = join(carpetaBase, 'tunel.log');
  const carpeta = join(carpetaBase, 'repo');
  const llamadas: string[][] = [];
  let hayHead = false;
  const run: Ejecutor = async (bin, args) => {
    llamadas.push([bin, ...args]);
    if (args[0] === 'init') {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(args[2], '.git'), { recursive: true });
    }
    if (args.includes('rev-parse')) {
      if (!hayHead) throw new Error('sin HEAD');
    }
    if (args.includes('commit')) hayHead = true;
    return '';
  };
  const vivas = new Set(['https://uno.trycloudflare.com', 'https://dos.trycloudflare.com']);
  const pub = new Publicador({
    token: TOKEN, rutaLog, carpeta, remoto: 'https://github.com/x/y.git', rama: 'agente', run,
    comprobar: async (u) => vivas.has(u),
  });

  assert.equal(await pub.revisar(), null, 'sin log no hace nada');
  await writeFile(rutaLog, 'https://uno.trycloudflare.com\n');
  assert.equal(await pub.revisar(), 'https://uno.trycloudflare.com');
  const json = JSON.parse(await readFile(join(carpeta, 'agente.json'), 'utf8'));
  assert.equal(descifrarUrl(json, TOKEN), 'https://uno.trycloudflare.com');
  assert.equal(await pub.revisar(), null, 'misma URL: no vuelve a publicar');

  // La rama lleva su vercel.json para que Vercel no intente construirla (y falle) en cada publicación.
  assert.equal(await readFile(join(carpeta, 'vercel.json'), 'utf8'), VERCEL_JSON);
  const reglas = JSON.parse(VERCEL_JSON);
  assert.deepEqual(reglas.git.deploymentEnabled, { agente: false });
  assert.equal(reglas.ignoreCommand, 'exit 0');
  assert.ok(llamadas.some((l) => l.includes('add') && l.includes('agente.json') && l.includes('vercel.json')));

  await writeFile(rutaLog, 'https://uno.trycloudflare.com\nhttps://muerta.trycloudflare.com\n');
  assert.equal(await pub.revisar(), null, 'URL que no responde: no se publica');

  await writeFile(rutaLog, 'https://dos.trycloudflare.com\n');
  assert.equal(await pub.revisar(), 'https://dos.trycloudflare.com');

  const commits = llamadas.filter((l) => l.includes('commit'));
  assert.equal(commits.length, 2);
  assert.ok(!commits[0].includes('--amend') && commits[1].includes('--amend'));
  const pushes = llamadas.filter((l) => l.includes('push'));
  assert.ok(pushes.every((p) => p.includes('-f') && p.at(-1) === 'HEAD:refs/heads/agente'));
  assert.ok(llamadas.some((l) => l.includes('--orphan')), 'rama huérfana: no arrastra el historial de main');
});

test('reinicia el túnel solo tras varios fallos seguidos, o si Cloudflare lo dio por expirado', async () => {
  const carpetaBase = await mkdtemp(join(tmpdir(), 'pub2-'));
  const rutaLog = join(carpetaBase, 'tunel.log');
  const reinicios: string[][] = [];
  const run: Ejecutor = async (bin, args) => {
    if (bin === 'launchctl') reinicios.push(args);
    if (args[0] === 'init') {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(args[2], '.git'), { recursive: true });
    }
    return '';
  };
  let viva = false;
  const pub = new Publicador({
    token: TOKEN, rutaLog, carpeta: join(carpetaBase, 'repo'), remoto: 'https://github.com/x/y.git', rama: 'agente', run,
    comprobar: async () => viva,
  });
  // Error viejo ANTES de la URL actual: no cuenta.
  await writeFile(rutaLog, 'ERR Unauthorized: Tunnel not found\nhttps://nueva.trycloudflare.com\n');
  for (let i = 0; i < FALLOS_PARA_REINICIAR - 1; i++) await pub.revisar();
  assert.equal(reinicios.length, 0, 'un par de cortes sueltos no reinician');
  viva = true;
  await pub.revisar(); // se recupera: el contador vuelve a cero
  viva = false;
  for (let i = 0; i < FALLOS_PARA_REINICIAR - 1; i++) await pub.revisar();
  assert.equal(reinicios.length, 0);
  await pub.revisar();
  assert.equal(reinicios.length, 1, 'caído varios minutos seguidos: reinicia');
  assert.equal(reinicios[0][0], 'kickstart');

  // Expirado DESPUÉS de la URL actual: reinicia de inmediato.
  await writeFile(rutaLog, 'https://nueva.trycloudflare.com\nERR Unauthorized: Tunnel not found\n');
  await pub.revisar();
  assert.equal(reinicios.length, 2);
});
