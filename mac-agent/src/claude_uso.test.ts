import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatearNombreModelo,
  parsearUltimoUso,
  calcularContexto,
  GestorClaudeUso,
} from './claude_uso.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('formatearNombreModelo: traduce modelos conocidos a nombres amigables', () => {
  assert.equal(formatearNombreModelo('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(formatearNombreModelo('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(formatearNombreModelo('claude-haiku-4-5'), 'Haiku 4.5');
  assert.equal(formatearNombreModelo('claude-sonnet-3-5'), 'Sonnet 3.5');
  assert.equal(formatearNombreModelo(undefined), 'Claude');
});

test('parsearUltimoUso: extrae el último usage del archivo JSONL', () => {
  const lineas = [
    JSON.stringify({ type: 'user', content: 'hola' }),
    JSON.stringify({
      type: 'assistant',
      requestedModel: 'claude-sonnet-5-5',
      message: {
        model: 'claude-sonnet-5-5',
        usage: {
          input_tokens: 10,
          output_tokens: 50,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 200,
        },
      },
    }),
    JSON.stringify({ type: 'notification', content: 'test' }),
  ].join('\n');

  const res = parsearUltimoUso(lineas);
  assert.ok(res);
  assert.equal(res.usage.input_tokens, 10);
  assert.equal(res.usage.cache_read_input_tokens, 1000);
  assert.equal(res.model, 'claude-sonnet-5-5');
});

test('calcularContexto: ventana normal de 200k y extendida de 1M', () => {
  // Caso 1: menos de 200k tokens
  const ctxNormal = calcularContexto({
    input_tokens: 500,
    cache_read_input_tokens: 40000,
    cache_creation_input_tokens: 9500,
  });
  assert.equal(ctxNormal.contextoUsado, 50000);
  assert.equal(ctxNormal.contextoLimite, 200000);
  assert.equal(ctxNormal.tokensRestantes, 150000);
  assert.equal(ctxNormal.porcentajeLibre, 75);

  // Caso 2: más de 200k tokens (activa ventana extendida 1M)
  const ctxExtendido = calcularContexto({
    input_tokens: 1000,
    cache_read_input_tokens: 340000,
    cache_creation_input_tokens: 9000,
  });
  assert.equal(ctxExtendido.contextoUsado, 350000);
  assert.equal(ctxExtendido.contextoLimite, 1000000);
  assert.equal(ctxExtendido.tokensRestantes, 650000);
  assert.equal(ctxExtendido.porcentajeLibre, 65);
});

test('GestorClaudeUso: lee auth y calcula el uso completo', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
  const projSub = path.join(tmpDir, 'projects', 'test-project');
  fs.mkdirSync(projSub, { recursive: true });

  const sessionFile = path.join(projSub, 'session-1.jsonl');
  fs.writeFileSync(
    sessionFile,
    JSON.stringify({
      type: 'assistant',
      requestedModel: 'claude-opus-5-5',
      message: {
        model: 'claude-opus-5-5',
        usage: {
          input_tokens: 100,
          output_tokens: 400,
          cache_read_input_tokens: 45000,
          cache_creation_input_tokens: 4900,
        },
      },
    }) + '\n',
  );

  const mockEjecutor = async (_bin: string, args: string[]) => {
    if (args[0] === 'auth' && args[1] === 'status') {
      return JSON.stringify({
        loggedIn: true,
        orgName: 'TEST-ORG',
        subscriptionType: 'team',
        email: 'test@example.com',
      });
    }
    return '';
  };

  const gestor = new GestorClaudeUso(tmpDir);
  const res = await gestor.leer(mockEjecutor);

  assert.ok(res);
  assert.equal(res.activo, true);
  assert.equal(res.organizacion, 'TEST-ORG');
  assert.equal(res.suscripcion, 'TEAM');
  assert.equal(res.modelo, 'Opus 5.5');
  assert.equal(res.contextoUsado, 50000);
  assert.equal(res.contextoLimite, 200000);
  assert.equal(res.porcentajeLibre, 75);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
