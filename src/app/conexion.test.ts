import { describe, expect, it } from 'vitest';
import { crearParserSSE, emparejamientoDesdeHash, normalizarAgente } from './conexion';
import { duracion, esDeNoche, porcentaje } from './formato';

describe('parser SSE', () => {
  it('une eventos partidos entre trozos e ignora comentarios', () => {
    const parsear = crearParserSSE();
    expect(parsear('retry: 5000\n\n: ping\n\nevent: estado\ndata: {"a"')).toEqual([]);
    expect(parsear(':1}\n\nevent: estado\r\ndata: 2\r\n\r\n')).toEqual([
      { evento: 'estado', datos: '{"a":1}' },
      { evento: 'estado', datos: '2' },
    ]);
  });
});

describe('emparejamiento', () => {
  it('normaliza la URL del agente', () => {
    expect(normalizarAgente('agente.juliangonzalez.lat/')).toBe('https://agente.juliangonzalez.lat');
    expect(normalizarAgente(' http://192.168.1.5:8787/x ')).toBe('http://192.168.1.5:8787');
  });

  it('lee el hash de emparejamiento', () => {
    expect(emparejamientoDesdeHash('#agente=agente.juliangonzalez.lat&token=abc')).toEqual({
      agente: 'https://agente.juliangonzalez.lat',
      token: 'abc',
    });
    expect(emparejamientoDesdeHash('#token=abc')).toBeNull();
    expect(emparejamientoDesdeHash('')).toBeNull();
  });
});

describe('formato', () => {
  it('duración, porcentaje y noche', () => {
    expect(duracion(90061)).toBe('1 d 1 h');
    expect(duracion(3720)).toBe('1 h 2 min');
    expect(porcentaje(5, 0)).toBe(0);
    expect(porcentaje(150, 100)).toBe(100);
    expect(esDeNoche(new Date(2026, 0, 1, 23))).toBe(true);
    expect(esDeNoche(new Date(2026, 0, 1, 12))).toBe(false);
  });
});
