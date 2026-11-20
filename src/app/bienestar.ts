/**
 * Cuidado de la batería de la tablet. La app Android le pasa al panel el nivel, si
 * está enchufada y la temperatura; aquí se decide qué consejo dar. La tablet pasa el
 * día enchufada y lo que más desgasta una batería de litio es el calor y vivir al 100 %.
 */

export interface Bateria {
  nivel: number | null;
  cargando: boolean;
  enchufada: boolean;
  temperaturaC: number | null;
}

export type Tono = 'ok' | 'aviso' | 'alerta';

export interface Consejo {
  tono: Tono;
  texto: string;
}

/** Desde cuántas horas al máximo enchufada se recomienda un enchufe con temporizador. */
export const HORAS_AL_MAXIMO = 6;
const UMBRAL_MAXIMO = 95;
export const TEMPERATURA_AVISO = 40;
export const TEMPERATURA_ALERTA = 45;

/**
 * Desde cuándo está la batería llena y enchufada (marca de tiempo), o null si no lo está.
 * `previo` es lo que devolvió la llamada anterior (se guarda para sobrevivir a recargas).
 */
export function seguimientoAlMaximo(b: Bateria, previo: number | null, ahora: number): number | null {
  const alMaximo = b.enchufada && (b.nivel ?? 0) >= UMBRAL_MAXIMO;
  if (!alMaximo) return null;
  return previo ?? ahora;
}

// ---------- Ritmo de carga ----------

export interface Muestra {
  t: number;
  nivel: number;
}

const VENTANA_MUESTRAS_MS = 2 * 3_600_000;
const MIN_TRAMO_MS = 10 * 60_000;

/** Añade una lectura (una por cambio de nivel o cada 5 min) y olvida las de hace más de 2 h. */
export function anotarMuestra(muestras: Muestra[], nivel: number, ahora: number): Muestra[] {
  const vigentes = muestras.filter((m) => ahora - m.t <= VENTANA_MUESTRAS_MS && m.t <= ahora);
  const ultima = vigentes[vigentes.length - 1];
  if (ultima && ultima.nivel === nivel && ahora - ultima.t < 5 * 60_000) return vigentes;
  return [...vigentes, { t: ahora, nivel }];
}

/**
 * Cuántos puntos por hora sube (+) o baja (−) la batería, o null si aún no hay datos suficientes
 * (hace falta un tramo de al menos 10 min y que el nivel se haya movido o lleve 30 min quieto).
 */
export function ritmoPorHora(muestras: Muestra[], ahora: number): number | null {
  const vigentes = muestras.filter((m) => ahora - m.t <= VENTANA_MUESTRAS_MS);
  if (vigentes.length < 2) return null;
  const primera = vigentes[0];
  const ultima = vigentes[vigentes.length - 1];
  const tramo = ultima.t - primera.t;
  if (tramo < MIN_TRAMO_MS) return null;
  if (ultima.nivel === primera.nivel && tramo < 30 * 60_000) return null;
  return ((ultima.nivel - primera.nivel) / tramo) * 3_600_000;
}

/** «unas 3 h», «unos 40 min» hasta quedarse sin batería al ritmo actual. */
export function duracionRestante(nivel: number, ritmo: number): string | null {
  if (ritmo >= -0.1) return null;
  const min = Math.round((nivel / -ritmo) * 60);
  if (min < 60) return `unos ${Math.max(5, Math.round(min / 5) * 5)} min`;
  const h = Math.round(min / 30) / 2;
  return `unas ${String(h).replace('.', ',')} h`;
}

export function consejoBateria(b: Bateria, alMaximoDesde: number | null, ahora: number, ritmo: number | null = null): Consejo {
  const t = b.temperaturaC;
  if (t !== null && t >= TEMPERATURA_ALERTA) {
    return { tono: 'alerta', texto: `Está muy caliente (${Math.round(t)} °C). Desenchúfala y déjala enfriar.` };
  }
  const resta = b.nivel !== null && ritmo !== null ? duracionRestante(b.nivel, ritmo) : null;
  // Enchufada pero bajando: el cargador (o el USB de un computador) no da para lo que gasta la pantalla.
  if (b.enchufada && b.nivel !== null && ritmo !== null && ritmo <= -0.5) {
    return {
      tono: b.nivel <= 20 ? 'alerta' : 'aviso',
      texto: `Enchufada, pero baja ${String(Math.round(-ritmo * 10) / 10).replace('.', ',')} % por hora: ese cargador no alcanza. Usa uno de pared${resta ? ` (le quedan ${resta})` : ''}.`,
    };
  }
  if (b.nivel !== null && b.nivel <= 15 && !b.enchufada) {
    return { tono: 'alerta', texto: `Batería baja (${b.nivel} %${resta ? `, ${resta}` : ''}): conéctala al cargador.` };
  }
  if (t !== null && t >= TEMPERATURA_AVISO) {
    return { tono: 'aviso', texto: `Está caliente (${Math.round(t)} °C). Que no esté tapada ni le dé el sol.` };
  }
  if (alMaximoDesde !== null) {
    const horas = (ahora - alMaximoDesde) / 3_600_000;
    if (horas >= HORAS_AL_MAXIMO) {
      return {
        tono: 'aviso',
        texto: `Lleva ${Math.floor(horas)} h al 100 % enchufada. La batería dura más entre 40 y 80 %: un enchufe con temporizador ayuda.`,
      };
    }
  }
  if (b.nivel !== null && b.nivel <= 30 && !b.enchufada) {
    return { tono: 'aviso', texto: `Se está descargando (${b.nivel} %${resta ? `, ${resta}` : ''}). Conéctala pronto.` };
  }
  return { tono: 'ok', texto: b.enchufada ? 'Todo en orden.' : 'Funcionando con la batería.' };
}

export function estadoCarga(b: Bateria, ritmo: number | null = null): string {
  if (b.enchufada && ritmo !== null && ritmo <= -0.5) return 'Carga insuficiente';
  return b.cargando ? 'Cargando' : b.enchufada ? 'Enchufada' : 'Con batería';
}

/** Lo que manda la app Android (JSON del puente); null si no es un dato válido. */
export function leerBateria(crudo: unknown): Bateria | null {
  if (!crudo || typeof crudo !== 'object') return null;
  const c = crudo as Record<string, unknown>;
  const nivel = typeof c.nivel === 'number' && Number.isFinite(c.nivel) ? Math.max(0, Math.min(100, Math.round(c.nivel))) : null;
  if (nivel === null) return null;
  return {
    nivel,
    cargando: c.cargando === true,
    enchufada: c.enchufada === true,
    temperaturaC: typeof c.temperaturaC === 'number' && Number.isFinite(c.temperaturaC) ? c.temperaturaC : null,
  };
}
