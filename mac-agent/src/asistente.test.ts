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
  asistente: { modelo: 'claude-opus-5-5', esfuerzo: 'low', minutosConversacion: 10 },
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
