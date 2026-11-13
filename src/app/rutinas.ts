/**
 * Rutinas de voz, lado del panel: el agente hace los pasos y arma el resumen; aquí se decide
 * cuándo leer el resumen de la mañana y qué hacer con los efectos que le tocan a la tablet.
 */

export type EfectoPanel = 'modo-noche';

/** Efectos que este panel sabe aplicar (el agente podría mandar otros en el futuro). */
export function efectosConocidos(efectos: unknown): EfectoPanel[] {
  return Array.isArray(efectos) ? efectos.filter((e): e is EfectoPanel => e === 'modo-noche') : [];
}

/** «2026-11-12», en hora local: una vez al día. */
export function claveDia(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

/**
 * Al apagar la alarma de la mañana se lee el resumen del día, pero solo la primera vez de cada día
 * y solo entre las 4:00 y las 11:00 (apagar una alarma de la tarde no debe ponerse a hablar).
 */
export function debeResumirManana(ahora: Date, ultimoDia: string | null): boolean {
  const h = ahora.getHours();
  return h >= 4 && h < 11 && ultimoDia !== claveDia(ahora);
}

/** Cuánto tiempo dejar un aviso en pantalla según lo largo que sea: unos 60 ms por letra, entre 3,5 y 15 s. */
export function duracionAviso(texto: string): number {
  return Math.min(15_000, Math.max(3500, 3500 + texto.length * 60));
}
