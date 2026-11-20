import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validarConfig } from './config.ts';

test('config: la red local viene apagada y solo acepta true o false', () => {
  assert.equal(validarConfig({}).redLocal, false);
  assert.equal(validarConfig({ redLocal: true }).redLocal, true);
  assert.equal(validarConfig({ redLocal: false }).redLocal, false);
  assert.throws(() => validarConfig({ redLocal: 'si' }), /redLocal/);
});
