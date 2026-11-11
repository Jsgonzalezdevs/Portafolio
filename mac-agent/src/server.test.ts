import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { crearAcciones } from './acciones.ts';
import type { Config } from './config.ts';
import type { EstadoMac } from './estado.ts';
import { crearServidor } from './server.ts';

const TOKEN = 'a'.repeat(64);
const ORIGEN = 'https://juliangonzalez.lat';
const llamadas: string[][] = [];

const config: Config = {
  puerto: 0,
  host: '127.0.0.1',
  origenes: [ORIGEN],
  escenas: [{ id: 'noche', nombre: 'Noche', atajo: 'Buenas "noches"; rm -rf /' }],
  apps: [{ id: 'safari', nombre: 'Safari', app: 'Safari' }],
  asistente: { proveedor: 'auto', modelo: 'claude-opus-5-5', modelosGroq: [], esfuerzo: 'low', minutosConversacion: 10 },
  token: TOKEN,
};

const estadoFalso = { nombre: 'mac', cpuPct: 12 } as EstadoMac;

const servidor = crearServidor({
  config,
  monitor: { leer: async () => estadoFalso },
  acciones: crearAcciones(config, async (bin, args) => {
    llamadas.push([bin, ...args]);
    return bin === 'osascript' && args[1].includes('Spotify') ? 'Spotify\n' : '';
  }),
  log: () => {},
  intervaloMs: 50,
});

let base = '';
before(async () => {
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

const auth = { Authorization: `Bearer ${TOKEN}` };
const post = (ruta: string, cuerpo: unknown, cabeceras: Record<string, string> = auth) =>
  fetch(`${base}${ruta}`, { method: 'POST', headers: { ...cabeceras, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

test('salud no pide token; estado sí', async () => {
  assert.equal((await fetch(`${base}/salud`)).status, 200);
  assert.equal((await fetch(`${base}/estado`)).status, 401);
  assert.equal((await fetch(`${base}/estado`, { headers: { Authorization: 'Bearer malo' } })).status, 401);
  const r = await fetch(`${base}/estado`, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ...estadoFalso, avisos: [] });
});

test('CORS: permite el dominio y rechaza otros orígenes', async () => {
  const ok = await fetch(`${base}/estado`, { method: 'OPTIONS', headers: { Origin: ORIGEN } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGEN);
  const malo = await fetch(`${base}/estado`, { headers: { ...auth, Origin: 'https://evil.example' } });
  assert.equal(malo.status, 403);
});

test('acciones validan parámetros y nunca pasan por shell', async () => {
  assert.equal((await post('/acciones/volumen.fijar', { nivel: 150 })).status, 400);
  assert.equal((await post('/acciones/volumen.fijar', { nivel: '50' })).status, 400);
  assert.equal((await post('/acciones/shell.ejecutar', { cmd: 'ls' })).status, 404);
  assert.equal((await post('/acciones/app.abrir', { id: 'terminal' })).status, 404);

  const r = await post('/acciones/volumen.fijar', { nivel: 30 });
  assert.equal(r.status, 200);
  assert.deepEqual(llamadas.at(-1), ['osascript', '-e', 'set volume output volume 30 without output muted']);

  await post('/acciones/escena.ejecutar', { id: 'noche' });
  // El nombre del atajo llega como UN argumento literal, sin interpretar.
  assert.deepEqual(llamadas.at(-1), ['shortcuts', 'run', 'Buenas "noches"; rm -rf /']);

  const media = await post('/acciones/media.playpause', {});
  assert.equal(((await media.json()) as { mensaje: string }).mensaje, 'Reproducir/pausar en Spotify');
});

test('JSON inválido → 400', async () => {
  const r = await fetch(`${base}/acciones/volumen.fijar`, { method: 'POST', headers: auth, body: '{nope' });
  assert.equal(r.status, 400);
});

test('eventos SSE envían el estado', async () => {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/eventos`, { headers: auth, signal: ctrl.signal });
  assert.equal(r.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const lector = r.body!.getReader();
  let texto = '';
  while (!texto.includes('event: estado')) texto += new TextDecoder().decode((await lector.read()).value);
  ctrl.abort();
  assert.match(texto, /"cpuPct":12/);
});

test('/chat sin asistente configurado → 503 y el catálogo lo indica', async () => {
  assert.equal((await post('/chat', { texto: 'hola' })).status, 503);
  const cat = (await (await fetch(`${base}/catalogo`, { headers: auth })).json()) as { chat: boolean };
  assert.equal(cat.chat, false);
});

test('/chat pasa el texto al asistente y devuelve su respuesta', async () => {
  const recibido: unknown[] = [];
  const s = crearServidor({
    config,
    monitor: { leer: async () => estadoFalso },
    acciones: crearAcciones(config, async () => ''),
    asistente: {
      conversar: async (texto, nueva) => {
        recibido.push(texto, nueva);
        return { respuesta: 'Hola', acciones: [], esperandoConfirmacion: false };
      },
    },
    log: () => {},
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/chat`;
  const r = await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify({ texto: 'hola', nueva: true }) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { respuesta: 'Hola', acciones: [], esperandoConfirmacion: false });
  assert.deepEqual(recibido, ['hola', true]);
  s.close();
});


test('/agenda: 404 sin agenda; con agenda devuelve permisos, eventos y recordatorios; avisos se descartan', async () => {
  assert.equal((await fetch(`${base}/agenda`, { headers: auth })).status, 404);

  const descartados: string[] = [];
  const completados: string[] = [];
  const s = crearServidor({
    config,
    monitor: { leer: async () => estadoFalso },
    acciones: crearAcciones(config, async () => ''),
    agenda: {
      permisos: async () => ({ calendario: 'concedido', recordatorios: 'sin-decidir' }),
      eventos: async () => [{ titulo: 'Dentista' }],
      recordatorios: async () => {
        throw new Error('no debería llamarse sin permiso');
      },
      completarRecordatorio: async (id: string) => {
        completados.push(id);
        return { titulo: 'x' };
      },
    } as unknown as import('./agenda.ts').Agenda,
    avisador: {
      pendientes: [{ id: 'r/1', titulo: 'Pastilla', vence: '2026-11-11T15:00' }],
      descartar: (id: string) => (descartados.push(id), true),
      olvidarPermiso: () => {},
    },
    log: () => {},
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const ag = (await (await fetch(`${b}/agenda`, { headers: auth })).json()) as Record<string, unknown>;
  assert.deepEqual(ag, {
    permisos: { calendario: 'concedido', recordatorios: 'sin-decidir' },
    eventos: [{ titulo: 'Dentista' }],
    recordatorios: [],
  });
  const est = (await (await fetch(`${b}/estado`, { headers: auth })).json()) as { avisos: unknown[] };
  assert.equal(est.avisos.length, 1);
  const r = await fetch(`${b}/avisos/${encodeURIComponent('r/1')}/descartar`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ completar: true }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(descartados, ['r/1']);
  assert.deepEqual(completados, ['r/1']);
  s.close();
});

// Va al final: deja 127.0.0.1 bloqueado un minuto para el resto del archivo.
test('bloquea tras demasiados tokens inválidos', async () => {
  for (let i = 0; i < 10; i++) await fetch(`${base}/estado`, { headers: { Authorization: 'Bearer x' } });
  assert.equal((await fetch(`${base}/estado`, { headers: auth })).status, 429);
});
