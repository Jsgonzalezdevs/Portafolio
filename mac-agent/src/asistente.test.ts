import assert from 'node:assert/strict';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { crearAcciones } from './acciones.ts';
import { Asistente, ErrorDeAsistente, type CrearMensaje } from './asistente.ts';
import type { Config } from './config.ts';
import type { EstadoMac } from './estado.ts';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Bloque = Anthropic.Beta.BetaContentBlock;

const config: Pick<Config, 'escenas' | 'apps' | 'asistente'> = {
  escenas: [
    { id: 'luces', nombre: 'Luces sala', atajo: 'Luces sala' },
    { id: 'puerta', nombre: 'Abrir puerta', atajo: 'Abrir puerta', confirmar: true },
  ],
  apps: [{ id: 'safari', nombre: 'Safari', app: 'Safari' }],
  asistente: { proveedor: 'auto', modelo: 'claude-opus-5-5', modelosGroq: [], esfuerzo: 'low', minutosConversacion: 10 },
};

const texto = (t: string): Bloque => ({ type: 'text', text: t, citations: null }) as Bloque;
const herramienta = (id: string, name: string, input: unknown): Bloque => ({ type: 'tool_use', id, name, input }) as Bloque;
const mensaje = (stop: string, content: Bloque[]) =>
  ({ content, stop_reason: stop, role: 'assistant', type: 'message' }) as unknown as Anthropic.Beta.BetaMessage;

/** Cliente falso: devuelve las respuestas en orden y guarda una copia de cada petición. */
function guion(respuestas: (Anthropic.Beta.BetaMessage | Error)[]) {
  const peticiones: Params[] = [];
  const crear: CrearMensaje = async (p) => {
    peticiones.push(structuredClone(p));
    const r = respuestas.shift();
    if (!r) throw new Error('guion agotado');
    if (r instanceof Error) throw r;
    return r;
  };
  return { crear, peticiones };
}

function montar(respuestas: (Anthropic.Beta.BetaMessage | Error)[]) {
  const llamadas: string[][] = [];
  const g = guion(respuestas);
  const asistente = new Asistente({
    config,
    acciones: crearAcciones(config, async (bin, args) => {
      llamadas.push([bin, ...args]);
      return '';
    }),
    leerEstado: async () => ({ cpuPct: 7, memoria: { usadaBytes: 1, totalBytes: 2 }, uptimeSeg: 3600 }) as EstadoMac,
    crearMensaje: g.crear,
    ahora: () => new Date(2026, 10, 11, 15, 30),
  });
  return { asistente, llamadas, peticiones: g.peticiones };
}

test('respuesta simple: modelo, esfuerzo, fallbacks, herramientas estrictas y fecha en el mensaje', async () => {
  const { asistente, peticiones } = montar([mensaje('end_turn', [texto('Hola, ¿qué necesitas?')])]);
  const r = await asistente.conversar('hola');
  assert.deepEqual(r, { respuesta: 'Hola, ¿qué necesitas?', acciones: [], esperandoConfirmacion: false });

  const p = peticiones[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.output_config?.effort, 'low');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(p.tools?.every((t) => 'strict' in t && t.strict === true));
  assert.ok(!('thinking' in p), 'en Opus 5.5 el pensamiento no se desactiva: se omite el parámetro');
  assert.match(String(p.messages[0].content), /^\[miércoles, 11 de noviembre de 2026.*\] hola$/);
});

test('usa una herramienta, ejecuta la acción y devuelve el resultado en el mismo hilo', async () => {
  const { asistente, llamadas, peticiones } = montar([
    mensaje('tool_use', [herramienta('t1', 'fijar_volumen', { nivel: 30 })]),
    mensaje('end_turn', [texto('Listo, volumen al treinta.')]),
  ]);
  const r = await asistente.conversar('pon el volumen al 30');
  assert.equal(r.respuesta, 'Listo, volumen al treinta.');
  assert.deepEqual(r.acciones, [{ herramienta: 'volumen.fijar', ok: true, mensaje: 'Volumen al 30%' }]);
  assert.deepEqual(llamadas, [['osascript', '-e', 'set volume output volume 30 without output muted']]);

  const segunda = peticiones[1].messages;
  assert.equal(segunda.length, 3);
  assert.deepEqual(segunda[2].content, [
    { type: 'tool_result', tool_use_id: 't1', content: 'Volumen al 30%', is_error: false },
  ]);
});

test('varias herramientas en paralelo: todos los resultados en un solo mensaje; los fallos van con is_error', async () => {
  const { asistente, peticiones } = montar([
    mensaje('tool_use', [
      herramienta('a', 'leer_estado_mac', {}),
      herramienta('b', 'fijar_volumen', { nivel: 500 }),
    ]),
    mensaje('end_turn', [texto('ok')]),
  ]);
  const r = await asistente.conversar('estado y volumen');
  const resultados = peticiones[1].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.equal(resultados.length, 2);
  assert.match(String(resultados[0].content), /"cpu_pct":7/);
  assert.equal(resultados[1].is_error, true);
  assert.equal(r.acciones[0].ok, false);
});

test('una escena con confirmar no se ejecuta hasta el siguiente turno del usuario', async () => {
  const { asistente, llamadas } = montar([
    // Turno 1: la IA intenta abrir directo, y además reintenta en el mismo turno.
    mensaje('tool_use', [herramienta('p1', 'ejecutar_escena', { id: 'puerta' })]),
    mensaje('tool_use', [herramienta('p2', 'ejecutar_escena', { id: 'puerta' })]),
    mensaje('end_turn', [texto('¿Seguro que quieres abrir la puerta?')]),
    // Turno 2: el usuario dijo que sí.
    mensaje('tool_use', [herramienta('p3', 'ejecutar_escena', { id: 'puerta' })]),
    mensaje('end_turn', [texto('Puerta abierta.')]),
  ]);
  const r1 = await asistente.conversar('abre la puerta');
  assert.equal(r1.esperandoConfirmacion, true);
  assert.deepEqual(llamadas, [], 'no puede autoconfirmarse dentro del mismo turno');

  const r2 = await asistente.conversar('sí');
  assert.equal(r2.respuesta, 'Puerta abierta.');
  assert.deepEqual(llamadas, [['shortcuts', 'run', 'Abrir puerta']]);
});

test('una escena normal se ejecuta sin preguntar', async () => {
  const { asistente, llamadas } = montar([
    mensaje('tool_use', [herramienta('l', 'ejecutar_escena', { id: 'luces' })]),
    mensaje('end_turn', [texto('Luces encendidas.')]),
  ]);
  await asistente.conversar('prende las luces');
  assert.deepEqual(llamadas, [['shortcuts', 'run', 'Luces sala']]);
});

test('si Claude falla, la conversación se descarta para no dejar un historial roto', async () => {
  const { asistente, peticiones } = montar([
    mensaje('end_turn', [texto('uno')]),
    new Anthropic.APIConnectionError({ message: 'sin red' }),
    mensaje('end_turn', [texto('de nuevo')]),
  ]);
  await asistente.conversar('primero');
  await assert.rejects(asistente.conversar('segundo'), (e: unknown) => e instanceof ErrorDeAsistente && e.estado === 502);
  await asistente.conversar('tercero');
  assert.equal(peticiones[2].messages.length, 1, 'empieza de cero tras el error');
});

test('rechazo del modelo → respuesta corta; texto vacío → 400; dos a la vez → 409', async () => {
  const { asistente } = montar([mensaje('refusal', [])]);
  assert.equal((await asistente.conversar('algo')).respuesta, 'Con eso no te puedo ayudar.');
  await assert.rejects(asistente.conversar('  '), (e: unknown) => e instanceof ErrorDeAsistente && e.estado === 400);

  let soltar!: () => void;
  const lento = new Asistente({
    config,
    acciones: crearAcciones(config, async () => ''),
    leerEstado: async () => ({}) as EstadoMac,
    crearMensaje: () => new Promise((r) => (soltar = () => r(mensaje('end_turn', [texto('ya')])))),
  });
  const primera = lento.conversar('uno');
  await assert.rejects(lento.conversar('dos'), (e: unknown) => e instanceof ErrorDeAsistente && e.estado === 409);
  soltar();
  await primera;
});

test('«nueva» empieza otra conversación; el historial solo crece mientras tanto', async () => {
  const { asistente, peticiones } = montar([
    mensaje('end_turn', [texto('a')]),
    mensaje('end_turn', [texto('b')]),
    mensaje('end_turn', [texto('c')]),
  ]);
  await asistente.conversar('uno');
  await asistente.conversar('dos');
  assert.equal(peticiones[1].messages.length, 3);
  assert.deepEqual(peticiones[1].messages.slice(0, 2), peticiones[0].messages.concat(peticiones[1].messages[1]));
  await asistente.conversar('tres', true);
  assert.equal(peticiones[2].messages.length, 1);
});

test('herramientas de agenda: solo existen si hay agenda, y crean con los argumentos de Claude', async () => {
  const creados: unknown[] = [];
  const agenda = {
    crearRecordatorio: async (titulo: string, vence: string | null) => {
      creados.push([titulo, vence]);
      return { id: 'r1', titulo, vence, lista: 'Hogar' };
    },
    eventos: async () => [{ titulo: 'Dentista', inicio: '2026-11-12T08:00:00-05:00' }],
  } as unknown as import('./agenda.ts').Agenda;

  const sinAgenda = montar([mensaje('end_turn', [texto('ok')])]);
  await sinAgenda.asistente.conversar('hola');
  assert.ok(!sinAgenda.peticiones[0].tools?.some((t) => 'name' in t && t.name === 'ver_agenda'));

  const g = guion([
    mensaje('tool_use', [herramienta('r', 'crear_recordatorio', { titulo: 'Sacar la basura', vence: '2026-11-11T20:00' })]),
    mensaje('end_turn', [texto('Listo, te aviso a las ocho.')]),
  ]);
  const a = new Asistente({
    config,
    acciones: crearAcciones(config, async () => ''),
    leerEstado: async () => ({}) as EstadoMac,
    crearMensaje: g.crear,
    agenda,
  });
  const r = await a.conversar('recuérdame sacar la basura a las 8 de la noche');
  assert.ok(g.peticiones[0].tools?.some((t) => 'name' in t && t.name === 'ver_agenda'));
  assert.deepEqual(creados, [['Sacar la basura', '2026-11-11T20:00']]);
  assert.deepEqual(r.acciones, [{ herramienta: 'agenda.crear_recordatorio', ok: true, mensaje: 'Recordatorio «Sacar la basura» creado' }]);
});

test('herramienta bloquear_mac ejecuta mac.bloquear', async () => {
  const { asistente, llamadas } = montar([
    mensaje('tool_use', [herramienta('t_bloq', 'bloquear_mac', {})]),
    mensaje('end_turn', [texto('Mac bloqueada.')]),
  ]);
  const r = await asistente.conversar('bloquea la mac');
  assert.equal(r.respuesta, 'Mac bloqueada.');
  assert.deepEqual(r.acciones, [{ herramienta: 'mac.bloquear', ok: true, mensaje: 'Mac bloqueada' }]);
  assert.deepEqual(llamadas, [['pmset', 'displaysleepnow']]);
});

test('herramientas de alarmas: solo existen si hay alarmas, y operan sobre GestorAlarmas', async () => {
  const sinAlarmas = montar([mensaje('end_turn', [texto('ok')])]);
  await sinAlarmas.asistente.conversar('hola');
  assert.ok(!sinAlarmas.peticiones[0].tools?.some((t) => 'name' in t && t.name === 'crear_alarma'));

  const alarmasFalsas: import('./alarmas.ts').Alarma[] = [
    { id: 'alm-1', hora: '07:00', dias: [1, 2, 3], titulo: 'Gimnasio', activa: true },
  ];
  const gestorMock = {
    listar: () => alarmasFalsas,
    crear: (hora: string, titulo: string, dias?: number[]) => {
      const a = { id: 'alm-2', hora, dias: dias ?? [], titulo, activa: true };
      alarmasFalsas.push(a);
      return a;
    },
    eliminar: (id: string) => {
      const idx = alarmasFalsas.findIndex((a) => a.id === id);
      if (idx === -1) return false;
      alarmasFalsas.splice(idx, 1);
      return true;
    },
    toggle: () => alarmasFalsas[0],
    vencidas: () => [],
  } as unknown as import('./alarmas.ts').GestorAlarmas;

  const g = guion([
    mensaje('tool_use', [
      herramienta('c1', 'crear_alarma', { hora: '08:30', titulo: 'Despertar', dias: [1, 2, 3, 4, 5] }),
      herramienta('c2', 'listar_alarmas', {}),
      herramienta('c3', 'eliminar_alarma', { id: 'alm-1' }),
    ]),
    mensaje('end_turn', [texto('Alarmas gestionadas.')]),
  ]);
  const a = new Asistente({
    config,
    acciones: crearAcciones(config, async () => ''),
    leerEstado: async () => ({}) as EstadoMac,
    crearMensaje: g.crear,
    alarmas: gestorMock,
  });
  const r = await a.conversar('pon alarma a las 8:30');
  assert.ok(g.peticiones[0].tools?.some((t) => 'name' in t && t.name === 'crear_alarma'));
  assert.equal(r.respuesta, 'Alarmas gestionadas.');
  assert.equal(alarmasFalsas.length, 1);
  assert.equal(alarmasFalsas[0].id, 'alm-2');
});
