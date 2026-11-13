import { describe, expect, it } from 'vitest';
import { duracionEnSegundos, duracionHablada, interpretar, interpretarAlarma, responderConsulta } from './comandos';

// Viernes 13 de noviembre de 2026, 15:00.
const AHORA = new Date(2026, 10, 13, 15, 0);

describe('duraciones', () => {
  it.each([
    ['10 minutos', 600],
    ['diez minutos', 600],
    ['1 hora y 30 minutos', 5400],
    ['una hora y media', 5400],
    ['dos horas y media', 9000],
    ['una hora y cuarto', 4500],
    ['media hora', 1800],
    ['un cuarto de hora', 900],
    ['tres cuartos de hora', 2700],
    ['treinta y cinco minutos', 2100],
    ['45 segundos', 45],
    ['5 min', 300],
    ['2 horas 15 minutos', 8100],
    ['cinco minutos y veinte segundos', 320],
  ])('«%s» son %i segundos', (texto, segundos) => {
    expect(duracionEnSegundos(texto)).toBe(segundos);
  });

  it('rechaza lo que no es una duración razonable', () => {
    expect(duracionEnSegundos('')).toBeNull();
    expect(duracionEnSegundos('un rato')).toBeNull();
    expect(duracionEnSegundos('10 minutos para el postre')).toBeNull();
    expect(duracionEnSegundos('30 horas')).toBeNull();
  });

  it('la dice como se habla', () => {
    expect(duracionHablada(600)).toBe('10 minutos');
    expect(duracionHablada(3600)).toBe('1 hora');
    expect(duracionHablada(5400)).toBe('1 hora y 30 minutos');
    expect(duracionHablada(75)).toBe('1 minuto y 15 segundos');
  });
});

describe('alarmas', () => {
  it.each([
    ['despiértame a las 6', '06:00'],
    ['Despiértame a las 6:30', '06:30'],
    ['despiértame a las seis y media', '06:30'],
    ['pon una alarma a las 7 de la mañana', '07:00'],
    ['ponme una alarma a las 8 de la noche', '20:00'],
    ['alarma a las 5 y cuarto de la tarde', '17:15'],
    ['alarma a las 7 menos cuarto de la mañana', '06:45'],
    ['alarma a las 6 pm', '18:00'],
    ['alarma a las 6 a. m.', '06:00'],
    ['crea una alarma para las 22:15', '22:15'],
    ['alarma a las 12 de la noche', '00:00'],
    ['alarma a las 12 del mediodía', '12:00'],
    ['Jarvis, despiértame a las 5 y veinte, por favor', '05:20'],
  ])('«%s» → %s', (texto, hora) => {
    expect(interpretarAlarma(texto, AHORA)?.hora).toBe(hora);
  });

  it('sin mañana ni tarde, elige la próxima vez que llegue esa hora', () => {
    // Son las 15:00: «a las 6» llega antes de tarde (18:00) que de madrugada.
    expect(interpretarAlarma('pon una alarma a las 6', AHORA)?.hora).toBe('18:00');
    // Son las 22:00: la próxima «6» es la de la mañana.
    expect(interpretarAlarma('pon una alarma a las 6', new Date(2026, 10, 13, 22, 0))?.hora).toBe('06:00');
  });

  it('lleva el título que se dice, con tildes y mayúscula', () => {
    expect(interpretarAlarma('alarma a las 6 de la mañana para ir al gimnasio', AHORA)).toEqual({ hora: '06:00', titulo: 'Ir al gimnasio' });
    expect(interpretarAlarma('despiértame a las 6 para la reunión, gracias', AHORA)?.titulo).toBe('La reunión');
  });

  it('no se mete con lo que no entiende', () => {
    expect(interpretarAlarma('pon una alarma', AHORA)).toBeNull();
    expect(interpretarAlarma('alarma a las 25', AHORA)).toBeNull();
    expect(interpretarAlarma('alarma a las 6 y 75', AHORA)).toBeNull();
    expect(interpretarAlarma('despiértame mañana a las 6', AHORA)).toBeNull();
    expect(interpretarAlarma('cuéntame un chiste', AHORA)).toBeNull();
  });
});

describe('interpretar', () => {
  it('reconoce los comandos de consulta', () => {
    expect(interpretar('¿Qué hora es?')).toEqual({ tipo: 'hora' });
    expect(interpretar('dime la hora por favor')).toEqual({ tipo: 'hora' });
    expect(interpretar('¿Qué día es hoy?')).toEqual({ tipo: 'fecha' });
    expect(interpretar('a cuánto estamos')).toEqual({ tipo: 'fecha' });
    expect(interpretar('¿cómo está el clima?')).toEqual({ tipo: 'clima' });
    expect(interpretar('qué alarmas tengo')).toEqual({ tipo: 'alarmas' });
  });

  it('reconoce temporizadores de varias maneras', () => {
    expect(interpretar('temporizador de 10 minutos')).toEqual({ tipo: 'temporizador', segundos: 600 });
    expect(interpretar('Pon un temporizador de media hora')).toEqual({ tipo: 'temporizador', segundos: 1800 });
    expect(interpretar('ponme un timer de 5 min')).toEqual({ tipo: 'temporizador', segundos: 300 });
    expect(interpretar('avísame en 20 minutos')).toEqual({ tipo: 'temporizador', segundos: 1200 });
    expect(interpretar('cuenta regresiva de 45 segundos')).toEqual({ tipo: 'temporizador', segundos: 45 });
  });

  it('cancela y consulta el temporizador', () => {
    expect(interpretar('cancela el temporizador')).toEqual({ tipo: 'cancelar-temporizador' });
    expect(interpretar('para el timer')).toEqual({ tipo: 'cancelar-temporizador' });
    expect(interpretar('cuánto falta del temporizador')).toEqual({ tipo: 'restante-temporizador' });
  });

  it('crea alarmas', () => {
    expect(interpretar('despiértame a las 6', AHORA)).toEqual({ tipo: 'alarma', hora: '06:00', titulo: '' });
  });

  it('deja pasar lo que no es entero un comando (va a la IA)', () => {
    expect(interpretar('¿qué hora es en Tokio?')).toBeNull();
    expect(interpretar('¿qué hora es? y de paso cuéntame un chiste')).toBeNull();
    expect(interpretar('buenas noches')).toBeNull();
    expect(interpretar('temporizador')).toBeNull();
    expect(interpretar('temporizador de un rato')).toBeNull();
    expect(interpretar('')).toBeNull();
  });
});

describe('respuestas de consulta', () => {
  const datos = { ahora: AHORA, clima: { ciudad: 'Ibagué', tempC: 24, condicion: 'Parcialmente nublado' }, alarmas: [{ hora: '06:00', dias: [] as number[], activa: true }] };

  it('dice la hora como se habla', () => {
    expect(responderConsulta({ tipo: 'hora' }, datos)).toBe('Son las 3 de la tarde.');
    expect(responderConsulta({ tipo: 'hora' }, { ...datos, ahora: new Date(2026, 10, 13, 13, 15) })).toBe('Es la 1 y cuarto de la tarde.');
  });

  it('dice la fecha', () => {
    expect(responderConsulta({ tipo: 'fecha' }, datos)).toMatch(/^Hoy es viernes,? 13 de noviembre/);
  });

  it('cuenta el clima y avisa si no lo tiene', () => {
    expect(responderConsulta({ tipo: 'clima' }, datos)).toBe('En Ibagué hay 24 grados y el cielo está parcialmente nublado.');
    expect(responderConsulta({ tipo: 'clima' }, { ...datos, clima: null })).toMatch(/Todavía no tengo el clima/);
  });

  it('cuenta las alarmas', () => {
    expect(responderConsulta({ tipo: 'alarmas' }, datos)).toBe('Tienes una alarma activa. La próxima suena a las 6 de la mañana, el sábado.');
    expect(responderConsulta({ tipo: 'alarmas' }, { ...datos, alarmas: [] })).toBe('No tienes alarmas activas.');
  });
});
