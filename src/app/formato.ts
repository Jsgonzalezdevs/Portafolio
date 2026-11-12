export function bytes(n: number): string {
  const gb = n / 1024 ** 3;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

export function duracion(seg: number): string {
  const d = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export function porcentaje(parte: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((parte / total) * 100))) : 0;
}

/** Entre 22:00 y 6:00 el dashboard pasa solo a modo noche. */
export function esDeNoche(fecha: Date): boolean {
  const h = fecha.getHours();
  return h >= 22 || h < 6;
}

export type PeriodoDia = 'manana' | 'tarde' | 'noche' | 'madrugada';

export function saludoSegunHora(fecha: Date): { saludo: string; icono: string; periodo: PeriodoDia } {
  const h = fecha.getHours();
  if (h >= 6 && h < 12) {
    return { saludo: 'Buenos días, Julian', icono: '🌅', periodo: 'manana' };
  }
  if (h >= 12 && h < 18) {
    return { saludo: 'Buenas tardes', icono: '☀️', periodo: 'tarde' };
  }
  if (h >= 18 && h < 22) {
    return { saludo: 'Buenas noches', icono: '🌙', periodo: 'noche' };
  }
  return { saludo: 'Buenas noches', icono: '🌙', periodo: 'madrugada' };
}

export function formatoTiempoTimer(segundosTotal: number): string {
  const s = Math.max(0, Math.floor(segundosTotal));
  const m = Math.floor(s / 60);
  const segRestantes = s % 60;
  return `${String(m).padStart(2, '0')}:${String(segRestantes).padStart(2, '0')}`;
}
