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

export function consejoBateria(b: Bateria, alMaximoDesde: number | null, ahora: number): Consejo {
  const t = b.temperaturaC;
  if (t !== null && t >= TEMPERATURA_ALERTA) {
    return { tono: 'alerta', texto: `Está muy caliente (${Math.round(t)} °C). Desenchúfala y déjala enfriar.` };
  }
  if (b.nivel !== null && b.nivel <= 15 && !b.enchufada) {
    return { tono: 'alerta', texto: `Batería baja (${b.nivel} %): conéctala al cargador.` };
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
    return { tono: 'aviso', texto: `Se está descargando (${b.nivel} %). Conéctala pronto.` };
  }
  return { tono: 'ok', texto: b.enchufada ? 'Todo en orden.' : 'Funcionando con la batería.' };
}

export function estadoCarga(b: Bateria): string {
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
