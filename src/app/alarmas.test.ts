import { describe, expect, it } from 'vitest';
import { crear, textoDias } from './alarmas';

describe('días de las alarmas', () => {
  it.each([
    [[], 'Todos los días'],
    [[0, 1, 2, 3, 4, 5, 6], 'Todos los días'],
    [[5, 1, 3, 2, 4], 'Lun–Vie'],
    [[6, 0], 'Fin de semana'],
    [[0, 1, 3], 'L X D'],
  ])('%j → %s', (dias, texto) => expect(textoDias(dias)).toBe(texto));

  it('crear guarda los días elegidos', () => {
    const e = crear({ alarmas: [], borradas: {} }, '06:00', '', [1, 2, 3, 4, 5], 'a1');
    expect(e.alarmas[0]).toMatchObject({ hora: '06:00', dias: [1, 2, 3, 4, 5], titulo: 'Alarma', activa: true });
  });
});
