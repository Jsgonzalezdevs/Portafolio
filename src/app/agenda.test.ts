import { beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../app/index.html?raw';
import { agruparEventos, avisosVencidos, combinarAvisos, iniciarAgenda } from './agenda';

const cuerpo = /<body>([\s\S]*)<script/.exec(html)![1];

describe('agenda en el panel', () => {
  describe('avisos de recordatorios sin la Mac', () => {
    const ahora = new Date(2026, 10, 11, 15, 0).getTime();
    const rec = (id: string, minutosAntes: number | null) => ({
      id,
      titulo: `Tarea ${id}`,
      vence: minutosAntes === null ? null : new Date(ahora - minutosAntes * 60_000).toISOString(),
    });

    it('avisa de los que vencieron hace poco y no de los futuros, viejos o sin hora', () => {
      const r = avisosVencidos([rec('a', 2), rec('b', -30), rec('c', 120), rec('d', null)], {}, ahora);
      expect(r.map((x) => x.id)).toEqual(['a']);
    });

    it('no repite los que ya se cerraron en la tablet', () => {
      expect(avisosVencidos([rec('a', 2)], { a: ahora - 1000 }, ahora)).toEqual([]);
    });

    it('une los de la Mac y los de la tablet sin duplicar', () => {
      const mac = [{ id: 'a', titulo: 'Tarea a', vence: '2026-11-11T19:58:00.000Z' }];
      const propios = avisosVencidos([rec('a', 2), rec('b', 5)], {}, ahora);
      expect(combinarAvisos(mac, propios).map((x) => x.id)).toEqual(['a', 'b']);
    });
  });

  it('agrupa los eventos en hoy y mañana', () => {
    const ahora = new Date(2026, 10, 11, 15, 0);
    const ev = (d: Date, titulo: string) => ({ titulo, inicio: d.toISOString(), todoElDia: false });
    const r = agruparEventos(
      [ev(new Date(2026, 10, 11, 18), 'Gimnasio'), ev(new Date(2026, 10, 12, 8), 'Dentista'), ev(new Date(2026, 10, 14, 9), 'Viaje')],
      ahora,
    );
    expect(r.hoy.map((e) => e.titulo)).toEqual(['Gimnasio']);
    expect(r.manana.map((e) => e.titulo)).toEqual(['Dentista']);
  });

  describe('avisos', () => {
    let hablar: ReturnType<typeof vi.fn<(texto: string) => void>>;
    let despertar: ReturnType<typeof vi.fn<() => void>>;
    let ui: ReturnType<typeof iniciarAgenda>;

    beforeEach(() => {
      document.body.innerHTML = cuerpo;
      hablar = vi.fn<(texto: string) => void>();
      despertar = vi.fn<() => void>();
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
      ui = iniciarAgenda({
        emparejamiento: () => ({ agente: 'https://agente.test', token: 't' }),
        alNoAutorizado: () => {},
        hablar,
        despertar,
      });
    });

    it('muestra el recordatorio, despierta el panel y lo dice una sola vez', () => {
      const avisos = [{ id: 'r1', titulo: 'Tomar la pastilla', vence: '2026-11-11T15:00' }];
      ui.mostrarAvisos(avisos);
      ui.mostrarAvisos(avisos);
      expect(document.getElementById('aviso-recordatorio')!.hidden).toBe(false);
      expect(document.getElementById('recordatorio-titulo')!.textContent).toBe('Tomar la pastilla');
      expect(despertar).toHaveBeenCalled();
      expect(hablar).toHaveBeenCalledOnce();
      expect(hablar).toHaveBeenCalledWith('Recordatorio: Tomar la pastilla');
    });

    it('«Hecho» lo descarta y completa en la Mac', async () => {
      ui.mostrarAvisos([{ id: 'r/1', titulo: 'Pastilla', vence: '' }]);
      document.getElementById('recordatorio-hecho')!.click();
      expect(document.getElementById('aviso-recordatorio')!.hidden).toBe(true);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://agente.test/avisos/r%2F1/descartar');
      expect(JSON.parse(init.body)).toEqual({ completar: true });
      vi.unstubAllGlobals();
    });

    it('sin avisos, el recuadro se oculta', () => {
      ui.mostrarAvisos([{ id: 'a', titulo: 'x', vence: '' }]);
      ui.mostrarAvisos([]);
      expect(document.getElementById('aviso-recordatorio')!.hidden).toBe(true);
    });
  });
});
