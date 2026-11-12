import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GestorAlarmas } from './alarmas.ts';

describe('GestorAlarmas', () => {
  let tmpDir: string;
  let gestor: GestorAlarmas;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alarmas-test-'));
    gestor = new GestorAlarmas(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lista vacío inicialmente', () => {
    assert.deepEqual(gestor.listar(), []);
  });

  it('crea alarmas validando hora y persiste', () => {
    assert.throws(() => gestor.crear('25:00', 'Alarma mala'), /Hora inválida/);
    assert.throws(() => gestor.crear('7:30', 'Alarma mala'), /Hora inválida/);
    assert.throws(() => gestor.crear('invalido', 'Alarma mala'), /Hora inválida/);

    const a1 = gestor.crear('07:30', 'Despertar', [1, 2, 3, 4, 5]);
    assert.equal(a1.hora, '07:30');
    assert.equal(a1.titulo, 'Despertar');
    assert.deepEqual(a1.dias, [1, 2, 3, 4, 5]);
    assert.equal(a1.activa, true);
    assert.ok(a1.id && typeof a1.id === 'string');

    const lista = gestor.listar();
    assert.equal(lista.length, 1);
    assert.deepEqual(lista[0], a1);

    const a2 = gestor.crear('20:00', 'Cena');
    assert.deepEqual(a2.dias, []);
    assert.equal(gestor.listar().length, 2);
  });

  it('toggle cambia el estado activa y persiste', () => {
    const lista = gestor.listar();
    const id = lista[0].id;
    assert.equal(lista[0].activa, true);

    const toggled = gestor.toggle(id);
    assert.equal(toggled.activa, false);

    const listaTrasToggle = gestor.listar();
    assert.equal(listaTrasToggle.find((a) => a.id === id)?.activa, false);

    const reactivada = gestor.toggle(id);
    assert.equal(reactivada.activa, true);

    assert.throws(() => gestor.toggle('no-existe'), /Alarma no encontrada/);
  });

  it('eliminar remueve la alarma', () => {
    const lista = gestor.listar();
    const idAEliminar = lista[0].id;
    const ok = gestor.eliminar(idAEliminar);
    assert.equal(ok, true);
    assert.equal(gestor.listar().find((a) => a.id === idAEliminar), undefined);

    const fallo = gestor.eliminar('no-existe');
    assert.equal(fallo, false);
  });

  it('vencidas retorna las alarmas activas que coinciden con hora y día', () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'alarmas-vencidas-test-'));
    const g2 = new GestorAlarmas(tmpDir2);

    try {
      // Supongamos que ahora es un Miércoles (día 3) a las 08:15
      const ahora = new Date(2026, 10, 11, 8, 15, 0); // 2026-11-11 fue miércoles (día 3)
      assert.equal(ahora.getDay(), 3);

      const alarmaDiaria = g2.crear('08:15', 'Todos los días');
      const alarmaMiercoles = g2.crear('08:15', 'Solo miércoles', [3]);
      const alarmaJueves = g2.crear('08:15', 'Solo jueves', [4]);
      const alarmaOtraHora = g2.crear('09:00', 'Otra hora');
      const alarmaInactiva = g2.crear('08:15', 'Inactiva');
      g2.toggle(alarmaInactiva.id);

      const vencidas = g2.vencidas(ahora);
      const idsVencidas = vencidas.map((a) => a.id);
      assert.ok(idsVencidas.includes(alarmaDiaria.id));
      assert.ok(idsVencidas.includes(alarmaMiercoles.id));
      assert.ok(!idsVencidas.includes(alarmaJueves.id));
      assert.ok(!idsVencidas.includes(alarmaOtraHora.id));
      assert.ok(!idsVencidas.includes(alarmaInactiva.id));
      assert.equal(vencidas.length, 2);
    } finally {
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});
