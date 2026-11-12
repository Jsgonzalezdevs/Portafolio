import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Avisador, crearAgenda, fechaLocal, resumirEventos, sinDuplicados, type Agenda, type Evento, type Recordatorio } from './agenda.ts';
import type { Ejecutor } from './ejecutor.ts';

/** Simula `open … --stdout <archivo> … --args <orden…>`: escribe la respuesta en el archivo. */
function openFalso(responder: (args: string[]) => unknown) {
  const llamadas: string[][] = [];
  const run: Ejecutor = async (bin, args) => {
    llamadas.push([bin, ...args]);
    const salida = args[args.indexOf('--stdout') + 1];
    await writeFile(salida, JSON.stringify(responder(args.slice(args.indexOf('--args') + 1))));
    return '';
  };
  return { run, llamadas };
}

test('lanza la mini app con open (sin pasar por shell) y lee su JSON', async () => {
  const { run, llamadas } = openFalso(() => [{ titulo: 'Dentista', inicio: '2026-11-12T08:00:00-05:00' }]);
  const agenda = crearAgenda('/x/Agenda del asistente.app', run);
  const eventos = await agenda.eventos('2026-11-12T00:00', '2026-11-13T00:00');
  assert.equal(eventos[0].titulo, 'Dentista');
  const [bin, ...args] = llamadas[0];
  assert.equal(bin, 'open');
  assert.deepEqual(args.slice(0, 3), ['-n', '-W', '-g']);
  assert.equal(args[args.indexOf('--args') - 1], '/x/Agenda del asistente.app');
  assert.deepEqual(args.slice(args.indexOf('--args') + 1), ['eventos', '2026-11-12T00:00', '2026-11-13T00:00']);
});

test('un {error} del ayudante se convierte en error con su mensaje', async () => {
  const { run } = openFalso(() => ({ error: 'Sin permiso para Calendarios (denegado).' }));
  await assert.rejects(crearAgenda('/x.app', run).recordatorios(), /Sin permiso para Calendarios/);
});

test('crear recordatorio sin fecha no manda argumento vacío', async () => {
  const { run, llamadas } = openFalso(() => ({ ok: true, id: '1', titulo: 'Leche', vence: null, lista: 'Hogar' }));
  await crearAgenda('/x.app', run).crearRecordatorio('Leche', null);
  assert.deepEqual(llamadas[0].slice(llamadas[0].indexOf('--args') + 1), ['crear-recordatorio', 'Leche']);
});

test('fechaLocal', () => {
  assert.equal(fechaLocal(new Date(2026, 0, 5, 7, 3)), '2026-01-05T07:03');
});

function agendaFalsa(recordatorios: Recordatorio[], permiso = 'concedido'): Agenda {
  return {
    permisos: async () => ({ calendario: permiso, recordatorios: permiso }),
    recordatorios: async () => recordatorios,
  } as unknown as Agenda;
}

test('avisador: avisa una sola vez de lo que acaba de vencer, no de lo atrasado ni lo futuro', async () => {
  const ahora = new Date('2026-11-11T15:00:00-05:00');
  const lista: Recordatorio[] = [
    { id: 'a', titulo: 'Tomar pastilla', vence: '2026-11-11T14:58:00-05:00', lista: '' },
    { id: 'b', titulo: 'Atrasado', vence: '2026-11-11T12:00:00-05:00', lista: '' },
    { id: 'c', titulo: 'Futuro', vence: '2026-11-11T18:00:00-05:00', lista: '' },
    { id: 'd', titulo: 'Sin fecha', vence: null, lista: '' },
  ];
  const av = new Avisador(agendaFalsa(lista), () => ahora);
  assert.equal(await av.revisar(), true);
  assert.deepEqual(av.pendientes.map((a) => a.id), ['a']);
  assert.equal(await av.revisar(), false, 'no se repite');
  assert.equal(av.descartar('a'), true);
  assert.deepEqual(av.pendientes, []);
});

test('avisador: sin permiso no consulta recordatorios', async () => {
  let consultas = 0;
  const agenda = {
    permisos: async () => ({ calendario: 'sin-decidir', recordatorios: 'sin-decidir' }),
    recordatorios: async () => {
      consultas++;
      return [];
    },
  } as unknown as Agenda;
  assert.equal(await new Avisador(agenda).revisar(), false);
  assert.equal(consultas, 0);
});

test('quita eventos duplicados entre calendarios y resume en texto compacto', () => {
  const ev = (titulo: string, inicio: string, fin: string, todoElDia = false): Evento => ({
    titulo, inicio, fin, todoElDia, calendario: 'x', lugar: null,
  });
  const limpio = sinDuplicados([
    ev('🌱 Rutina AM & Traslado', '2026-11-12T05:45:00-05:00', '2026-11-12T07:00:00-05:00'),
    ev('☕ 🌱 Rutina AM & Traslado', '2026-11-12T05:45:00-05:00', '2026-11-12T07:00:00-05:00'),
    ev('Dentista', '2026-11-12T08:00:00-05:00', '2026-11-12T09:00:00-05:00'),
    ev('Llamada', '2026-11-12T08:00:00-05:00', '2026-11-12T09:00:00-05:00'),
    ev('Festivo', '2026-11-12T00:00:00-05:00', '2026-11-12T23:59:59-05:00', true),
  ]);
  assert.deepEqual(limpio.map((e) => e.titulo), ['☕ 🌱 Rutina AM & Traslado', 'Dentista', 'Llamada', 'Festivo']);
  assert.equal(
    resumirEventos(limpio.slice(1)),
    '2026-11-12 08:00-09:00 Dentista\n2026-11-12 08:00-09:00 Llamada\n2026-11-12 todo el día Festivo',
  );
  assert.equal(resumirEventos([]), 'Sin eventos en ese rango.');
});

test('si `open -W` pierde de vista a la app (kevent), igual lee la respuesta escrita', async () => {
  const run: Ejecutor = async (_bin, args) => {
    const salida = args[args.indexOf('--stdout') + 1];
    await writeFile(salida, JSON.stringify({ calendario: 'concedido', recordatorios: 'concedido' }));
    throw new Error('Unable to block on applications (initial call to kevent() failed: No such process)');
  };
  assert.deepEqual(await crearAgenda('/x.app', run).permisos(), { calendario: 'concedido', recordatorios: 'concedido' });

  const otroError: Ejecutor = async () => {
    throw new Error('LSOpenURLsWithRole() failed');
  };
  await assert.rejects(crearAgenda('/x.app', otroError).permisos(), /LSOpenURLsWithRole/);
});
