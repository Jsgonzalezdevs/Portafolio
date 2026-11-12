import { esDeNoche } from './formato';

/**
 * Modo noche: pantalla negra con solo la hora, el brillo al mínimo (lo baja la app
 * Android; un navegador no puede) y el panel de debajo apagado del todo.
 */

export interface EntradaNoche {
  /** true = lo pidió la persona; false/null = automático según la hora. */
  manual: boolean | null;
  ahora: Date;
  /** Marca de tiempo hasta la que el panel está «despierto» tras un toque, la palabra clave o una alarma. */
  despiertoHasta: number;
  /** Sin emparejar no hay panel que apagar. */
  emparejado: boolean;
}

export function nocheActiva(e: EntradaNoche): boolean {
  if (!e.emparejado) return false;
  return (e.manual ?? esDeNoche(e.ahora)) && e.ahora.getTime() > e.despiertoHasta;
}

/**
 * La hora se corre unos píxeles cada minuto (en rem, para que escale con la pantalla):
 * a un LCD que pasa la noche mostrando lo mismo se le puede quedar una sombra de la imagen.
 */
const PASOS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.7, -0.4],
  [-0.8, 0.3],
  [0.4, 0.8],
  [-0.5, -0.8],
  [0.8, 0.2],
  [-0.3, 0.7],
  [0.2, -0.7],
];

export function desplazamientoHora(ahora: Date): { x: number; y: number } {
  const [x, y] = PASOS[Math.floor(ahora.getTime() / 60_000) % PASOS.length];
  return { x, y };
}
