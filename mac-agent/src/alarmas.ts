import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Alarma {
  id: string;
  hora: string;
  dias: number[];
  titulo: string;
  activa: boolean;
}

const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class GestorAlarmas {
  private readonly rutaArchivo: string;

  constructor(raiz: string) {
    this.rutaArchivo = join(raiz, 'alarmas.json');
  }

  private guardar(alarmas: Alarma[]): void {
    writeFileSync(this.rutaArchivo, JSON.stringify(alarmas, null, 2), 'utf8');
  }

  listar(): Alarma[] {
    if (!existsSync(this.rutaArchivo)) return [];
    try {
      const contenido = readFileSync(this.rutaArchivo, 'utf8').trim();
      if (!contenido) return [];
      const datos = JSON.parse(contenido);
      return Array.isArray(datos) ? datos : [];
    } catch {
      return [];
    }
  }

  crear(hora: string, titulo: string, dias?: number[]): Alarma {
    if (!REGEX_HORA.test(hora)) {
      throw new Error('Hora inválida: debe tener formato HH:MM (24h)');
    }
    const tituloLimpio = typeof titulo === 'string' && titulo.trim() ? titulo.trim() : 'Alarma';
    const diasValidos: number[] = [];
    if (Array.isArray(dias)) {
      for (const d of dias) {
        if (Number.isInteger(d) && d >= 0 && d <= 6 && !diasValidos.includes(d)) {
          diasValidos.push(d);
        }
      }
    }

    const nuevaAlarma: Alarma = {
      id: randomUUID(),
      hora,
      dias: diasValidos,
      titulo: tituloLimpio,
      activa: true,
    };

    const alarmas = this.listar();
    alarmas.push(nuevaAlarma);
    this.guardar(alarmas);
    return nuevaAlarma;
  }

  eliminar(id: string): boolean {
    const alarmas = this.listar();
    const indice = alarmas.findIndex((a) => a.id === id);
    if (indice === -1) return false;
    alarmas.splice(indice, 1);
    this.guardar(alarmas);
    return true;
  }

  toggle(id: string): Alarma {
    const alarmas = this.listar();
    const alarma = alarmas.find((a) => a.id === id);
    if (!alarma) {
      throw new Error(`Alarma no encontrada: ${id}`);
    }
    alarma.activa = !alarma.activa;
    this.guardar(alarmas);
    return alarma;
  }

  vencidas(ahora: Date = new Date()): Alarma[] {
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    const horaActual = `${hh}:${mm}`;
    const diaActual = ahora.getDay();

    return this.listar().filter((a) => {
      if (!a.activa) return false;
      if (a.hora !== horaActual) return false;
      return a.dias.length === 0 || a.dias.includes(diaActual);
    });
  }
}
