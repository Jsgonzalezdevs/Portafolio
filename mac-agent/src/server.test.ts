import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { crearAcciones } from './acciones.ts';
import { GestorAlarmas } from './alarmas.ts';
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

  const pos = await post('/acciones/media.posicion', { posicionSeg: 45 });
  assert.equal(pos.status, 200);
  assert.equal(((await pos.json()) as { mensaje: string }).mensaje, 'Posición a 45s en Spotify');

  const playUri = await post('/acciones/media.reproducir_uri', { uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' });
  assert.equal(playUri.status, 200);
  assert.equal(((await playUri.json()) as { mensaje: string }).mensaje, 'Reproduciendo en Spotify');

  const cat = (await (await fetch(`${base}/catalogo`, { headers: auth })).json()) as { playlistsRapidas: unknown[] };
  assert.ok(Array.isArray(cat.playlistsRapidas));
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

test('GET /fondo: 401 sin auth, 404 si no hay fondo, 200 con imagen y cabeceras correctas', async () => {
  const tmpCarpeta = mkdtempSync(join(tmpdir(), 'fondo-test-'));
  const rutaFondo = join(tmpCarpeta, 'fondo.png');
  const bufferEsperado = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(rutaFondo, bufferEsperado);

  let rutaFondoConfigurada: string | null = null;
  const s = crearServidor({
    config,
    monitor: {
      leer: async () => estadoFalso,
      leerFondo: async () => rutaFondoConfigurada,
    },
    acciones: crearAcciones(config, async () => ''),
    log: () => {},
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  try {
    // 401 sin token
    assert.equal((await fetch(`${b}/fondo`)).status, 401);

    // 404 si leerFondo devuelve null
    const r404 = await fetch(`${b}/fondo`, { headers: auth });
    assert.equal(r404.status, 404);
    assert.deepEqual(await r404.json(), { error: 'Fondo no encontrado' });

    // 404 si el archivo no existe en disco
    rutaFondoConfigurada = join(tmpCarpeta, 'no-existe.jpg');
    const rNoExiste = await fetch(`${b}/fondo`, { headers: auth });
    assert.equal(rNoExiste.status, 404);

    // 200 con archivo real
    rutaFondoConfigurada = rutaFondo;
    const r200 = await fetch(`${b}/fondo`, { headers: auth });
    assert.equal(r200.status, 200);
    assert.equal(r200.headers.get('content-type'), 'image/png');
    assert.equal(r200.headers.get('cache-control'), 'max-age=60');
    assert.ok(r200.headers.get('access-control-allow-origin'));
    const arrayBuffer = await r200.arrayBuffer();
    assert.deepEqual(Buffer.from(arrayBuffer), bufferEsperado);
  } finally {
    s.close();
    rmSync(tmpCarpeta, { recursive: true, force: true });
  }
});

test('alarmas: endpoints CRUD (GET, POST, toggle, DELETE)', async () => {
  const tmpCarpeta = mkdtempSync(join(tmpdir(), 'alarmas-server-test-'));
  const gestor = new GestorAlarmas(tmpCarpeta);

  const s = crearServidor({
    config,
    monitor: { leer: async () => estadoFalso },
    acciones: crearAcciones(config, async () => ''),
    gestorAlarmas: gestor,
    log: () => {},
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  try {
    // 401 sin token
    assert.equal((await fetch(`${b}/alarmas`)).status, 401);

    // GET /alarmas vacío
    const r1 = await fetch(`${b}/alarmas`, { headers: auth });
    assert.equal(r1.status, 200);
    assert.deepEqual(await r1.json(), { alarmas: [] });

    // POST /alarmas datos inválidos
    const rInvalido = await fetch(`${b}/alarmas`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hora: '99:99' }),
    });
    assert.equal(rInvalido.status, 400);

    // POST /alarmas creación exitosa
    const rCrear = await fetch(`${b}/alarmas`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hora: '06:45', titulo: 'Levantarse', dias: [1, 2, 3, 4, 5] }),
    });
    assert.equal(rCrear.status, 200);
    const cuerpoCrear = (await rCrear.json()) as { alarma: import('./alarmas.ts').Alarma };
    assert.equal(cuerpoCrear.alarma.hora, '06:45');
    assert.equal(cuerpoCrear.alarma.titulo, 'Levantarse');
    assert.equal(cuerpoCrear.alarma.activa, true);
    const id = cuerpoCrear.alarma.id;

    // GET /alarmas con 1 alarma
    const rListar = await fetch(`${b}/alarmas`, { headers: auth });
    const cuerpoListar = (await rListar.json()) as { alarmas: import('./alarmas.ts').Alarma[] };
    assert.equal(cuerpoListar.alarmas.length, 1);
    assert.equal(cuerpoListar.alarmas[0].id, id);

    // POST /alarmas/:id/toggle
    const rToggle = await fetch(`${b}/alarmas/${id}/toggle`, { method: 'POST', headers: auth });
    assert.equal(rToggle.status, 200);
    const cuerpoToggle = (await rToggle.json()) as { alarma: import('./alarmas.ts').Alarma };
    assert.equal(cuerpoToggle.alarma.activa, false);

    // POST /alarmas/:id/toggle con id inexistente
    const rToggleInexistente = await fetch(`${b}/alarmas/inexistente/toggle`, { method: 'POST', headers: auth });
    assert.equal(rToggleInexistente.status, 404);

    // DELETE /alarmas/:id
    const rDel = await fetch(`${b}/alarmas/${id}`, { method: 'DELETE', headers: auth });
    assert.equal(rDel.status, 200);
    assert.deepEqual(await rDel.json(), { ok: true });

    // DELETE /alarmas/:id repetido → 404
    const rDel2 = await fetch(`${b}/alarmas/${id}`, { method: 'DELETE', headers: auth });
    assert.equal(rDel2.status, 404);
  } finally {
    s.close();
    rmSync(tmpCarpeta, { recursive: true, force: true });
  }
});

test('GET /resumen: devuelve saludo, hora, clima, eventos, recordatorios y alarmas', async () => {
  const tmpCarpeta = mkdtempSync(join(tmpdir(), 'resumen-server-test-'));
  const gestor = new GestorAlarmas(tmpCarpeta);
  gestor.crear('08:00', 'Alarma de hoy'); // dias: [] significa todos los días

  const s = crearServidor({
    config,
    monitor: {
      leer: async () => ({
        ...estadoFalso,
        clima: { ciudad: 'Bogotá', tempC: 19, condicion: 'Nublado', icono: '☁️' },
      }),
    },
    acciones: crearAcciones(config, async () => ''),
    gestorAlarmas: gestor,
    agenda: {
      permisos: async () => ({ calendario: 'concedido', recordatorios: 'concedido' }),
      eventos: async () => [{ titulo: 'Reunión de equipo', inicio: '2026-11-12T09:00', fin: '2026-11-12T10:00' }],
      recordatorios: async () => [{ id: 'rec-1', titulo: 'Comprar café', vence: null, lista: 'Hogar' }],
    } as unknown as import('./agenda.ts').Agenda,
    log: () => {},
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  try {
    assert.equal((await fetch(`${b}/resumen`)).status, 401);

    const r = await fetch(`${b}/resumen`, { headers: auth });
    assert.equal(r.status, 200);
    const resumen = (await r.json()) as {
      clima: { ciudad: string; tempC: number; condicion: string; icono: string };
      eventosHoy: unknown[];
      recordatoriosPendientes: unknown[];
      alarmasHoy: import('./alarmas.ts').Alarma[];
      saludo: string;
      hora: string;
    };

    assert.equal(resumen.clima.ciudad, 'Bogotá');
    assert.equal(resumen.eventosHoy.length, 1);
    assert.equal(resumen.recordatoriosPendientes.length, 1);
    assert.equal(resumen.alarmasHoy.length, 1);
    assert.equal(resumen.alarmasHoy[0].titulo, 'Alarma de hoy');
    assert.ok(['Buenos días', 'Buenas tardes', 'Buenas noches'].includes(resumen.saludo));
    assert.match(resumen.hora, /^\d{2}:\d{2}$/);
  } finally {
    s.close();
    rmSync(tmpCarpeta, { recursive: true, force: true });
  }
});

// Va al final: deja 127.0.0.1 bloqueado un minuto para el resto del archivo.
test('bloquea tras demasiados tokens inválidos', async () => {
  for (let i = 0; i < 10; i++) await fetch(`${base}/estado`, { headers: { Authorization: 'Bearer x' } });
  assert.equal((await fetch(`${base}/estado`, { headers: auth })).status, 429);
});
