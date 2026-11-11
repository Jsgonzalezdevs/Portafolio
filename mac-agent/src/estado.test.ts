import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsearPmset, parsearVmStat, parsearVolumen } from './estado.ts';

test('vm_stat: suma apps (sin purgable) + fija + comprimida', () => {
  const salida = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4725.
Pages wired down:                             100.
Pages purgeable:                                   10.
Anonymous pages:                              210.
Pages occupied by compressor:                 50.`;
  assert.equal(parsearVmStat(salida), (200 + 100 + 50) * 16384);
  assert.equal(parsearVmStat('basura'), null);
});

test('pmset: batería cargando, conectada, sin cargar y escritorio', () => {
  assert.deepEqual(
    parsearPmset(`Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; AC attached; not charging present: true`),
    { porcentaje: 80, cargando: false, conectada: true },
  );
  assert.deepEqual(
    parsearPmset(`Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t42%; charging; 1:10 remaining present: true`),
    { porcentaje: 42, cargando: true, conectada: true },
  );
  assert.deepEqual(
    parsearPmset(`Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t63%; discharging; 4:00 remaining present: true`),
    { porcentaje: 63, cargando: false, conectada: false },
  );
  assert.equal(parsearPmset(`Now drawing from 'AC Power'`), null);
});

test('volumen', () => {
  assert.deepEqual(parsearVolumen('output volume:69, input volume:34, alert volume:100, output muted:false'), {
    nivel: 69,
    silenciado: false,
  });
  assert.equal(parsearVolumen('missing value'), null);
});
