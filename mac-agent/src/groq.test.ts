import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearAcciones } from './acciones.ts';
import { Asistente, ErrorDeAsistente } from './asistente.ts';
import type { Config } from './config.ts';
import type { EstadoMac } from './estado.ts';
import { aMensajeClaude, aMensajesGroq, crearClienteGroq } from './groq.ts';

const json = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado });

test('traduce el historial de Claude al formato de Groq', () => {
  const m = aMensajesGroq({
    system: 'Eres el asistente.',
    messages: [
      { role: 'user', content: 'sube el volumen' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'fijar_volumen', input: { nivel: 40 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Volumen al 40%', is_error: false }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Listo.' }] },
    ],
  });
  assert.deepEqual(m, [
    { role: 'system', content: 'Eres el asistente.' },
    { role: 'user', content: 'sube el volumen' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fijar_volumen', arguments: '{"nivel":40}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'Volumen al 40%' },
    { role: 'assistant', content: 'Listo.' },
  ]);
});

test('traduce la respuesta de Groq (texto, herramientas y argumentos rotos)', () => {
  const r = aMensajeClaude({
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [
          { id: 'a', function: { name: 'silenciar', arguments: '{"silenciar":true}' } },
          { id: 'b', function: { name: 'fijar_volumen', arguments: '{roto' } },
        ],
      },
    }],
  });
  assert.equal(r.stop_reason, 'tool_use');
  assert.deepEqual(r.content, [
    { type: 'tool_use', id: 'a', name: 'silenciar', input: { silenciar: true } },
    { type: 'tool_use', id: 'b', name: 'fijar_volumen', input: {} },
  ]);
  const t = aMensajeClaude({ choices: [{ finish_reason: 'stop', message: { content: ' Hola ' } }] });
  assert.equal(t.stop_reason, 'end_turn');
  assert.deepEqual(t.content, [{ type: 'text', text: 'Hola', citations: null }]);
});

test('si el primer modelo falla o se queda sin cupo, usa el siguiente; 401 = llave inválida', async () => {
  const modelos: string[] = [];
  const pedir = (async (_url: unknown, init?: RequestInit) => {
    const cuerpo = JSON.parse(String(init?.body));
    modelos.push(cuerpo.model);
    const cabeceras = (init?.headers ?? {}) as Record<string, string>;
    assert.equal(cabeceras.Authorization, 'Bearer gsk_prueba');
    return cuerpo.model === 'uno'
      ? json(429, { error: { message: 'rate limit' } })
      : json(200, { choices: [{ finish_reason: 'stop', message: { content: 'Hola' } }] });
  }) as typeof fetch;
  const crear = crearClienteGroq('gsk_prueba', ['uno', 'dos'], pedir);
  const r = await crear({ model: 'x', max_tokens: 1, messages: [{ role: 'user', content: 'hola' }] });
  assert.deepEqual(modelos, ['uno', 'dos']);
  assert.equal(r.stop_reason, 'end_turn');

  const sinCupo = crearClienteGroq('gsk_prueba', ['uno'], pedir);
  await assert.rejects(sinCupo({ model: 'x', max_tokens: 1, messages: [] }), (e: unknown) => e instanceof ErrorDeAsistente && e.estado === 429);

  // Cupo agotado en el principal y respaldo inexistente: se informa del cupo (con la espera), no del 404.
  const registro: string[] = [];
  const mixto = crearClienteGroq('k', ['a', 'b'], (async (_u: unknown, init?: RequestInit) =>
    JSON.parse(String(init?.body)).model === 'a'
      ? new Response('{"error":{"message":"rate limit"}}', { status: 429, headers: { 'retry-after': '42.5' } })
      : json(404, { error: { message: 'no existe' } })) as typeof fetch, (l) => registro.push(l));
  await assert.rejects(mixto({ model: 'x', max_tokens: 1, messages: [] }), /Prueba en 43 segundos/);
  assert.deepEqual(registro, ['groq a → 429 rate limit', 'groq b → 404 no existe']);

  const mala = crearClienteGroq('k', ['uno', 'dos'], (async () => json(401, {})) as typeof fetch);
  await assert.rejects(mala({ model: 'x', max_tokens: 1, messages: [] }), /llave de Groq no es válida/);
});

test('el asistente completo funciona sobre Groq: herramienta → acción → respuesta', async () => {
  const config: Pick<Config, 'escenas' | 'apps' | 'asistente'> = {
    escenas: [],
    apps: [],
    asistente: { proveedor: 'groq', modelo: 'x', modelosGroq: [], esfuerzo: 'low', minutosConversacion: 10 },
  };
  const cuerpos: { messages: { role: string }[]; tools: unknown[] }[] = [];
  const respuestas = [
    { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'fijar_volumen', arguments: '{"nivel":25}' } }] } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'Listo, volumen al veinticinco.' } }] },
  ];
  const pedir = (async (_u: unknown, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)));
    return json(200, respuestas.shift());
  }) as typeof fetch;
  const llamadas: string[][] = [];
  const asistente = new Asistente({
    config,
    acciones: crearAcciones(config, async (bin, args) => {
      llamadas.push([bin, ...args]);
      return '';
    }),
    leerEstado: async () => ({}) as EstadoMac,
    crearMensaje: crearClienteGroq('k', ['m'], pedir),
  });
  const r = await asistente.conversar('volumen al 25');
  assert.equal(r.respuesta, 'Listo, volumen al veinticinco.');
  assert.deepEqual(llamadas, [['osascript', '-e', 'set volume output volume 25 without output muted']]);
  assert.deepEqual(cuerpos[1].messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.ok(cuerpos[0].tools.length >= 5);
});
