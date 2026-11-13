import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearAcciones, ErrorDeAccion } from './acciones.ts';
import type { Evento, Recordatorio } from './agenda.ts';
import type { Alarma } from './alarmas.ts';
import { horaHablada, lista, normalizar, paraVoz, proximaAlarma, Rutinas, RUTINAS_PREDETERMINADAS, sinRelleno, validarRutinas, type FuentesResumen } from './rutinas.ts';

const AHORA = new Date(2026, 10, 12, 6, 0); // jueves 12 nov, 6:00

const evento = (titulo: string, h: number, m = 0, dia = 12, todoElDia = false): Evento => ({
  titulo,
  inicio: new Date(2026, 10, dia, h, m).toISOString(),
  fin: new Date(2026, 10, dia, h + 1, m).toISOString(),
  todoElDia,
  calendario: 'x',
  lugar: null,
});

function montar(opciones: { acciones?: Record<string, (p: Record<string, unknown>) => Promise<string>>; fuentes?: Partial<FuentesResumen>; rutinas?: ReturnType<typeof validarRutinas> } = {}) {
  const hechas: string[] = [];
  const acciones: Record<string, { ejecutar: (p: Record<string, unknown>) => Promise<string> }> = {};
  const base: Record<string, (p: Record<string, unknown>) => Promise<string>> = {
    'media.pausar': async () => 'Música pausada en Spotify',
    'volumen.limitar': async (p) => `Volumen bajado a ${p.maximo}%`,
    'pantalla.apagar': async () => 'Pantalla apagada',
    ...opciones.acciones,
  };
  for (const [id, fn] of Object.entries(base)) {
    acciones[id] = {
      ejecutar: async (p) => {
        hechas.push(id);
        return fn(p);
      },
    };
  }
  const r = new Rutinas({
    rutinas: opciones.rutinas ?? validarRutinas(undefined),
    acciones,
    nombre: 'Julian',
    fuentes: { ahora: () => AHORA, ...opciones.fuentes },
  });
  return { r, hechas };
}

test('horaHablada: como se dice, con «menos», «y media» y franja del día', () => {
  const h = (hh: number, mm = 0) => horaHablada(new Date(2026, 10, 12, hh, mm));
  assert.equal(h(7), 'a las 7 de la mañana');
  assert.equal(h(13), 'a la 1 de la tarde');
  assert.equal(h(12), 'a las 12 del mediodía');
  assert.equal(h(0), 'a las 12 de la medianoche');
  assert.equal(h(5, 45), 'a las 6 menos cuarto de la mañana');
  assert.equal(h(17, 30), 'a las 5 y media de la tarde');
  assert.equal(h(8, 15), 'a las 8 y cuarto de la mañana');
  assert.equal(h(18, 20), 'a las 6 y 20 de la tarde');
  assert.equal(h(21), 'a las 9 de la noche');
  assert.equal(h(3, 10), 'a las 3 y 10 de la madrugada');
});

test('lista y normalizar', () => {
  assert.equal(lista(['a']), 'a');
  assert.equal(lista(['a', 'b']), 'a y b');
  assert.equal(lista(['a', 'b', 'c']), 'a, b y c');
  assert.equal(normalizar('¡Buenos DÍAS, Julián!'), 'buenos dias julian');
});

test('reconoce la frase entera, con saludos y cortesías, y no secuestra frases más largas', () => {
  const { r } = montar();
  assert.equal(r.porFrase('Buenas noches')?.id, 'buenas-noches');
  assert.equal(r.porFrase('¡Buenas noches!')?.id, 'buenas-noches');
  assert.equal(r.porFrase('Jarvis, buenas noches, gracias')?.id, 'buenas-noches');
  assert.equal(r.porFrase('hola buenos días')?.id, 'buenos-dias');
  assert.equal(r.porFrase('me voy a dormir')?.id, 'buenas-noches');
  assert.equal(r.porFrase('Buen día')?.id, 'buenos-dias');
  assert.equal(r.porFrase('buenas noches, ¿qué hora es?'), null, 'una pregunta va a la IA');
  assert.equal(r.porFrase('pon música para dormir'), null);
  assert.equal(r.porFrase(''), null);
  assert.equal(sinRelleno('Oye jarvis, por favor buenas noches'), 'buenas noches');
});

test('buenas noches: ejecuta los pasos en orden, cuenta solo lo que hizo y pide el modo noche', async () => {
  const { r, hechas } = montar({
    fuentes: {
      eventos: async () => [evento('Trabajo en el colegio', 7, 0, 13), evento('Rutina', 5, 45, 13)],
      alarmas: () => [{ id: 'a', hora: '06:00', dias: [], titulo: 'Despertar', activa: true }],
    },
  });
  const res = await r.ejecutar('buenas-noches');
  assert.deepEqual(hechas, ['media.pausar', 'volumen.limitar', 'pantalla.apagar']);
  assert.deepEqual(res.efectos, ['modo-noche']);
  assert.equal(
    res.texto,
    'Buenas noches, Julian. Pausé la música, bajé el volumen al 20 por ciento y apagué la pantalla de la Mac. ' +
      'Mañana tu primer evento es Rutina a las 6 menos cuarto de la mañana. Tu próxima alarma suena a las 6 de la mañana. Que descanses.',
  );
});

test('si no había música ni hacía falta bajar el volumen, no lo cuenta; un paso que falla no frena los demás', async () => {
  const { r, hechas } = montar({
    acciones: {
      'media.pausar': async () => 'No había música sonando',
      'volumen.limitar': async () => 'El volumen ya estaba en 12%',
      'pantalla.apagar': async () => {
        throw new ErrorDeAccion('pmset falló');
      },
    },
  });
  const res = await r.ejecutar('buenas-noches');
  assert.equal(hechas.length, 3);
  assert.deepEqual(res.pasos.map((p) => p.ok), [true, true, false]);
  assert.match(res.texto, /^Buenas noches, Julian\. Mañana no tienes eventos\. Que descanses\.$/);
});

test('buenos días: clima, cuántos eventos, lo próximo y los recordatorios; sin los de todo el día ni los ya pasados', async () => {
  const { r } = montar({
    fuentes: {
      clima: async () => ({ ciudad: 'Ibagué', tempC: 26.4, condicion: 'Parcialmente nublado', icono: '⛅' }),
      eventos: async () => [
        evento('Festivo', 0, 0, 12, true),
        evento('Rutina de mañana', 5, 45),
        evento('Trabajo en el colegio', 7),
        evento('Almuerzo', 13),
        evento('Gimnasio', 17),
      ],
      recordatorios: async (): Promise<Recordatorio[]> => [
        { id: '1', titulo: 'Tomar la pastilla', vence: null, lista: 'x' },
        { id: '2', titulo: 'Comprar leche', vence: null, lista: 'x' },
      ],
    },
  });
  const res = await r.ejecutar('buenos-dias');
  assert.deepEqual(res.efectos, []);
  assert.equal(
    res.texto,
    'Buenos días, Julian. Ahora mismo en Ibagué: parcialmente nublado, 26 grados. ' +
      'Tienes 4 eventos hoy. Lo próximo: Trabajo en el colegio a las 7 de la mañana y Almuerzo a la 1 de la tarde. ' +
      'Tienes 2 recordatorios: Tomar la pastilla y Comprar leche.',
  );
});

test('buenos días: singular, sin eventos y con muchos recordatorios; si una fuente falla, se omite sin romper', async () => {
  const sinNada = montar({
    fuentes: {
      clima: async () => {
        throw new Error('sin red');
      },
      eventos: async () => [evento('Dentista', 8)],
      recordatorios: async () => {
        throw new Error('sin permiso');
      },
    },
  });
  assert.equal((await sinNada.r.ejecutar('buenos-dias')).texto, 'Buenos días, Julian. Tienes un evento hoy. Lo próximo: Dentista a las 8 de la mañana.');

  const muchos = montar({
    fuentes: {
      eventos: async () => [],
      recordatorios: async () => ['A', 'B', 'C', 'D', 'E'].map((t, i) => ({ id: String(i), titulo: t, vence: null, lista: 'x' })),
    },
  });
  assert.equal((await muchos.r.ejecutar('buenos-dias')).texto, 'Buenos días, Julian. Hoy no tienes eventos. Tienes 5 recordatorios pendientes, entre ellos A y B.');
});

test('una escena que requiere confirmación nunca corre dentro de una rutina', async () => {
  const hechas: string[] = [];
  const rutinas = validarRutinas({ salir: { nombre: 'Salir', pasos: [{ accion: 'escena.ejecutar', params: { id: 'puerta' } }, { accion: 'media.pausar' }] } });
  const r = new Rutinas({
    rutinas,
    acciones: {
      'escena.ejecutar': { ejecutar: async () => (hechas.push('escena'), 'ok') },
      'media.pausar': { ejecutar: async () => (hechas.push('pausa'), 'Música pausada en Spotify') },
    },
    escenas: [{ id: 'puerta', nombre: 'Abrir puerta', confirmar: true }],
    fuentes: { ahora: () => AHORA },
  });
  const res = await r.ejecutar('salir');
  assert.deepEqual(hechas, ['pausa']);
  assert.equal(res.pasos[0].ok, false);
  assert.match(res.pasos[0].mensaje, /requiere confirmación/);
});

test('rutina desconocida → 404; acción desconocida → paso fallido', async () => {
  const { r } = montar();
  await assert.rejects(r.ejecutar('inventada'), (e: unknown) => e instanceof ErrorDeAccion && e.estado === 404);
  const otra = new Rutinas({
    rutinas: validarRutinas({ x: { nombre: 'X', pasos: [{ accion: 'no.existe' }] } }),
    acciones: {},
    fuentes: { ahora: () => AHORA },
  });
  assert.equal((await otra.ejecutar('x')).pasos[0].ok, false);
});

test('próxima alarma: respeta los días y salta lo ya pasado', () => {
  const alarmas: Alarma[] = [
    { id: '1', hora: '05:00', dias: [], titulo: 'pasada hoy', activa: true },
    { id: '2', hora: '07:30', dias: [5], titulo: 'solo viernes', activa: true },
    { id: '3', hora: '06:00', dias: [], titulo: 'apagada', activa: false },
  ];
  const p = proximaAlarma(alarmas, AHORA)!;
  assert.equal(p.getDate(), 13); // viernes 13: 05:00 de mañana gana a las 07:30 del viernes
  assert.equal(p.getHours(), 5);
  assert.equal(proximaAlarma([], AHORA), null);
  const hoy9: Alarma[] = [{ id: '4', hora: '09:00', dias: [], titulo: 'x', activa: true }];
  assert.equal(proximaAlarma(hoy9, AHORA)!.getDate(), 12);
});

test('config: personalizar una rutina de fábrica, crear una nueva y rechazar lo inválido', () => {
  const rutinas = validarRutinas({
    'buenas-noches': { pasos: [{ accion: 'media.pausar' }], icono: '😴' },
    cine: { nombre: 'Cine', frases: ['modo cine'], pasos: [{ accion: 'volumen.fijar', params: { nivel: 40 } }], efectos: ['modo-noche'], resumen: 'ninguno' },
  });
  assert.equal(rutinas.length, RUTINAS_PREDETERMINADAS.length + 1);
  assert.deepEqual(rutinas.find((x) => x.id === 'buenas-noches')?.pasos, [{ accion: 'media.pausar' }]);
  assert.equal(rutinas.find((x) => x.id === 'buenas-noches')?.icono, '😴');
  assert.equal(rutinas.find((x) => x.id === 'buenos-dias')?.resumen, 'manana', 'lo que no se toca, queda de fábrica');
  assert.equal(validarRutinas(undefined).length, RUTINAS_PREDETERMINADAS.length);

  assert.throws(() => validarRutinas({ 'Mala Id': {} }), /id de rutina inválido/);
  assert.throws(() => validarRutinas({ nueva: { pasos: [] } }), /necesita "nombre"/);
  assert.throws(() => validarRutinas({ x: { nombre: 'X', pasos: [{ accion: 'rm -rf /' }] } }), /necesita "accion"/);
  assert.throws(() => validarRutinas({ x: { nombre: 'X', efectos: ['apagar-todo'] } }), /solo admite/);
  assert.throws(() => validarRutinas({ x: { nombre: 'X', resumen: 'siempre' } }), /manana, noche o ninguno/);
  assert.throws(() => validarRutinas([]), /debe ser un objeto/);
});

test('acciones nuevas: media.pausar y volumen.limitar', async () => {
  const llamadas: string[][] = [];
  let volumen = '60';
  let sonando = 'Spotify';
  const acciones = crearAcciones({ escenas: [], apps: [] }, async (bin, args) => {
    llamadas.push([bin, ...args]);
    const script = args[1] ?? '';
    if (script.includes('output volume of')) return `${volumen}\n`;
    if (script.includes('player state is playing')) return sonando;
    return '';
  });
  assert.equal(await acciones['media.pausar'].ejecutar({}), 'Música pausada en Spotify');
  sonando = '';
  assert.equal(await acciones['media.pausar'].ejecutar({}), 'No había música sonando');

  assert.equal(await acciones['volumen.limitar'].ejecutar({ maximo: 20 }), 'Volumen bajado a 20%');
  assert.deepEqual(llamadas.at(-1), ['osascript', '-e', 'set volume output volume 20 without output muted']);
  volumen = '12';
  const antes = llamadas.length;
  assert.equal(await acciones['volumen.limitar'].ejecutar({ maximo: 20 }), 'El volumen ya estaba en 12%');
  assert.equal(llamadas.length, antes + 1, 'si ya estaba más bajo, no lo toca');
  await assert.rejects(acciones['volumen.limitar'].ejecutar({ maximo: 500 }), /entre 0 y 100/);
});

test('los emojis y símbolos de los títulos no se leen en voz alta, ni en eventos ni en recordatorios', async () => {
  assert.equal(paraVoz('☕ 🍽️ Cena & Descanso'), 'Cena y Descanso');
  assert.equal(paraVoz('📚 Repaso Temas'), 'Repaso Temas');
  assert.equal(paraVoz('🌱'), '🌱', 'si solo hay un emoji, no se deja vacío');
  const { r } = montar({
    fuentes: {
      eventos: async () => [evento('☕ 🍽️ Cena & Descanso', 20, 30)],
      recordatorios: async () => [{ id: '1', titulo: '💊 Tomar la pastilla', vence: null, lista: 'x' }],
    },
  });
  const t = (await r.ejecutar('buenos-dias')).texto;
  assert.match(t, /Cena y Descanso a las 8 y media de la noche/);
  assert.match(t, /Tienes un recordatorio: Tomar la pastilla\./);
  assert.ok(!/[☕🍽💊]/u.test(t));
});
