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
