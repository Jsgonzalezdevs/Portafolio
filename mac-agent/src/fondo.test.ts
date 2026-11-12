import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Ejecutor } from './ejecutor.ts';
import { Fondo } from './fondo.ts';

/** Simula la mini app: escribe los JPEG en la carpeta y responde el JSON por --stdout. */
async function montar(respuestas: (() => unknown)[]) {
  const carpeta = await mkdtemp(join(tmpdir(), 'fondo-'));
  const lanzamientos: string[][] = [];
  let reloj = 1_000_000;
  const run: Ejecutor = async (_bin, args) => {
    const propios = args.slice(args.indexOf('--args') + 1);
    lanzamientos.push(propios);
    const r = respuestas.shift()?.();
    if (r instanceof Error) throw r;
    await writeFile(join(carpeta, 'fondo.jpg'), 'NITIDO');
    await writeFile(join(carpeta, 'vidrio.jpg'), 'VIDRIO');
    await writeFile(args[args.indexOf('--stdout') + 1], JSON.stringify(r));
    return '';
  };
  const registro: string[] = [];
  const fondo = new Fondo({ app: '/x/Fondo del asistente.app', carpeta, run, ahora: () => reloj, log: (l) => registro.push(l) });
  return { fondo, lanzamientos, registro, carpeta, avanzar: (ms: number) => (reloj += ms) };
}

test('genera el fondo una vez, lo sirve en sus dos variantes y no relanza la mini app antes de tiempo', async () => {
  const t = await montar([() => ({ firma: 'f1', origen: 'captura', cambiado: true })]);
  const [a, b] = await Promise.all([t.fondo.imagen('fondo'), t.fondo.imagen('vidrio')]);
  assert.equal(a?.datos.toString(), 'NITIDO');
  assert.equal(b?.datos.toString(), 'VIDRIO');
  assert.notEqual(a?.firma, b?.firma, 'cada variante tiene su ETag');
  assert.equal(t.lanzamientos.length, 1, 'dos peticiones a la vez = un solo lanzamiento');
  assert.deepEqual(t.lanzamientos[0], [t.carpeta, '1600']);

  t.avanzar(60_000);
  await t.fondo.imagen('fondo');
  assert.equal(t.fondo.firma, 'f1');
  assert.equal(t.lanzamientos.length, 1, 'dentro de los 5 minutos no vuelve a comprobar');
});

test('pasados 5 minutos comprueba de nuevo; si el fondo cambió, cambia la firma', async () => {
  const t = await montar([
    () => ({ firma: 'f1', origen: 'captura', cambiado: true }),
    () => ({ firma: 'f2', origen: 'captura', cambiado: true }),
  ]);
  await t.fondo.revisar();
  assert.equal(t.fondo.firma, 'f1');
  t.avanzar(5 * 60_000 + 1);
  assert.equal(t.fondo.firma, 'f1', 'la firma no espera: devuelve la anterior y refresca por detrás');
  await t.fondo.revisar();
  assert.equal(t.fondo.firma, 'f2');
  assert.equal(t.lanzamientos.length, 2);
  assert.deepEqual(t.registro, ['fondo: captura (f1)', 'fondo: captura (f2)']);
});

test('si la mini app falla, mata los procesos que hayan quedado colgados', async () => {
  const carpeta = await mkdtemp(join(tmpdir(), 'fondo-'));
  const llamadas: string[][] = [];
  const run: Ejecutor = async (bin, args) => {
    llamadas.push([bin, ...args]);
    if (bin === 'open') throw new Error('Command failed: open …');
    return '';
  };
  const fondo = new Fondo({ app: '/x/Fondo del asistente.app', carpeta, run, log: () => {} });
  await fondo.revisar();
  assert.deepEqual(llamadas.at(-1), ['pkill', '-f', '/x/Fondo del asistente.app/Contents/MacOS']);
  assert.equal(fondo.firma, null);
});

test('si la mini app falla, se conserva el fondo anterior; sin ninguno, 404', async () => {
  const sinNada = await montar([() => ({ error: 'No se pudo determinar el fondo de pantalla' })]);
  assert.equal(await sinNada.fondo.imagen('fondo'), null);
  assert.match(sinNada.registro[0], /No se pudo determinar/);

  const t = await montar([() => ({ firma: 'f1', origen: 'imagen', cambiado: true }), () => new Error('open: falló')]);
  await t.fondo.revisar();
  t.avanzar(5 * 60_000 + 1);
  const img = await t.fondo.imagen('fondo');
  assert.equal(img?.datos.toString(), 'NITIDO');
  assert.equal(t.fondo.firma, 'f1');
});
