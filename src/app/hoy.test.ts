import { describe, expect, it } from 'vitest';
import { enCuanto, estadoDelDia, finDe, momento, quedan, respuestaAgenda, type EventoDia } from './hoy';

const iso = (h: number, m = 0, dia = 20) => new Date(2026, 10, dia, h, m).toISOString();
const ev = (titulo: string, h: number, m: number, hf?: number, mf = 0, dia = 20): EventoDia => ({
  titulo,
  inicio: iso(h, m, dia),
  fin: hf === undefined ? undefined : iso(hf, mf, dia),
  todoElDia: false,
});

const DIA: EventoDia[] = [
  ev('☕ 🌱 Rutina AM & Traslado', 5, 45, 7, 0),
  ev('💻 Trabajo Colegio', 7, 0, 13, 0),
  ev('☕ 🍽️ Almuerzo & Descanso', 13, 0, 14, 0),
  ev('⚡ Gym', 16, 0, 17, 0),
  { titulo: 'Cumpleaños de Ana', inicio: iso(0, 0), fin: iso(0, 0, 21), todoElDia: true },
  ev('Clase temprano', 6, 30, 8, 0, 21),
];

describe('qué pasa hoy', () => {
  it('encuentra el evento en curso con su avance', () => {
    const d = estadoDelDia(DIA, new Date(2026, 10, 20, 10, 0));
    expect(d.actual?.evento.titulo).toContain('Trabajo');
    expect(d.actual?.avance).toBeCloseTo(0.5);
    expect(d.actual?.quedanMin).toBe(180);
    expect(d.proximos.map((e) => e.titulo)).toEqual(['☕ 🍽️ Almuerzo & Descanso', '⚡ Gym', 'Clase temprano']);
    expect(d.todoElDia).toHaveLength(1);
    expect(d.quedanHoy).toBe(3);
  });

  it('sin fin, el evento dura una hora', () => {
    expect(finDe({ titulo: 'x', inicio: iso(9), todoElDia: false }) - Date.parse(iso(9))).toBe(3600_000);
  });

  it('entre eventos no hay actual', () => {
    const d = estadoDelDia(DIA, new Date(2026, 10, 20, 14, 30));
    expect(d.actual).toBeNull();
    expect(d.proximos[0].titulo).toBe('⚡ Gym');
  });

  it('pasado, ahora y futuro', () => {
    const ahora = new Date(2026, 10, 20, 13, 30);
    expect(DIA.map((e) => momento(e, ahora))).toEqual(['pasado', 'pasado', 'ahora', 'futuro', 'ahora', 'futuro']);
  });

  it('cuenta regresiva legible', () => {
    expect(enCuanto(30_000)).toBe('en 1 min');
    expect(enCuanto(25 * 60_000)).toBe('en 25 min');
    expect(enCuanto(60 * 60_000)).toBe('en 1 h');
    expect(enCuanto(147 * 60_000)).toBe('en 2 h 27 min');
    expect(enCuanto(0)).toBe('ahora');
    expect(quedan(1)).toBe('queda 1 min');
    expect(quedan(60)).toBe('queda 1 h');
    expect(quedan(65)).toBe('quedan 1 h 5 min');
  });

  it('responde «qué tengo hoy» sin emojis', () => {
    const r = respuestaAgenda(DIA, new Date(2026, 10, 20, 12, 40));
    expect(r).toBe(
      'Ahora: Trabajo Colegio, quedan 20 min. Después: Almuerzo y Descanso a la 1 de la tarde y Gym a las 4 de la tarde. Todo el día: Cumpleaños de Ana.',
    );
    expect(respuestaAgenda(DIA, new Date(2026, 10, 20, 18, 0))).toBe(
      'No te queda nada hoy. Mañana empiezas con Clase temprano a las 6 y media de la mañana. Todo el día: Cumpleaños de Ana.',
    );
    expect(respuestaAgenda(null, new Date())).toMatch(/Todavía no tengo/);
  });
});

describe('aviso antes de cada evento', () => {
  it('avisa una vez, dentro de los 5 min previos', async () => {
    const { eventosPorAvisar } = await import('./hoy');
    const a = (h: number, m: number) => new Date(2026, 10, 20, h, m);
    expect(eventosPorAvisar(DIA, a(12, 54), new Set())).toEqual([]);
    const ahora = eventosPorAvisar(DIA, a(12, 56), new Set());
    expect(ahora.map((x) => x.evento.titulo)).toEqual(['☕ 🍽️ Almuerzo & Descanso']);
    expect(eventosPorAvisar(DIA, a(12, 58), new Set([ahora[0].clave]))).toEqual([]);
    expect(eventosPorAvisar(DIA, a(13, 0), new Set())).toEqual([]);
  });
});
