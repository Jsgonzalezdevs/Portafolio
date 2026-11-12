import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { crearAcciones } from './acciones.ts';
import { resumirEventos, type Agenda } from './agenda.ts';
import type { Config } from './config.ts';
import type { EstadoMac } from './estado.ts';

/**
 * Cerebro conversacional: Claude con las acciones de la Mac como herramientas.
 *
 * Decisiones que importan:
 * - El historial solo crece (append-only) y se descarta entero al expirar o al
 *   fallar. Nunca se recorta por delante: los bloques de pensamiento de los
 *   modelos actuales quedan ligados a la conversación exacta que los produjo.
 * - La IA no puede «autoconfirmarse»: una acción marcada `confirmar` se bloquea
 *   la primera vez y solo se ejecuta si se vuelve a pedir en un turno POSTERIOR
 *   del usuario (es decir, después de que la persona respondiera).
 * - Lo variable (fecha y hora) va en el mensaje del usuario, no en el system
 *   prompt, para no romper la caché del prefijo.
 */

type Acciones = ReturnType<typeof crearAcciones>;
type Mensaje = Anthropic.Beta.BetaMessageParam;

export type CrearMensaje = (
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Beta.BetaMessage>;

export interface AccionRealizada {
  herramienta: string;
  ok: boolean;
  mensaje: string;
}

export interface RespuestaChat {
  respuesta: string;
  acciones: AccionRealizada[];
  /** La IA está esperando un «sí» o «no» antes de ejecutar algo delicado. */
  esperandoConfirmacion: boolean;
}

export class ErrorDeAsistente extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.estado = estado;
  }
}

const MAX_VUELTAS = 6;
const MAX_TEXTO = 2000;
const MAX_MENSAJES = 60;

interface Dependencias {
  config: Pick<Config, 'escenas' | 'apps' | 'asistente'>;
  acciones: Acciones;
  leerEstado: () => Promise<EstadoMac>;
  crearMensaje: CrearMensaje;
  /** Calendario y Recordatorios de macOS; sin ella, Claude no recibe esas herramientas. */
  agenda?: Agenda;
  ahora?: () => Date;
  log?: (linea: string) => void;
}

function objeto(propiedades: Record<string, unknown>, requeridas: string[]) {
  return { type: 'object' as const, properties: propiedades, required: requeridas, additionalProperties: false };
}

const FECHA = 'Fecha y hora local en formato 2026-11-12T08:30';

const HERRAMIENTAS_AGENDA: Anthropic.Beta.BetaTool[] = [
  {
    name: 'ver_agenda',
    description: 'Lista los eventos del calendario entre dos fechas (todas las cuentas de la Mac: iCloud, Google…).',
    input_schema: objeto(
      { desde: { type: 'string', description: FECHA }, hasta: { type: 'string', description: FECHA } },
      ['desde', 'hasta'],
    ),
  },
  {
    name: 'crear_evento',
    description: 'Crea un evento en el calendario por defecto. Si no dicen cuánto dura, una hora.',
    input_schema: objeto(
      {
        titulo: { type: 'string' },
        inicio: { type: 'string', description: FECHA },
        fin: { type: 'string', description: FECHA },
      },
      ['titulo', 'inicio', 'fin'],
    ),
  },
  {
    name: 'ver_recordatorios',
    description: 'Lista los recordatorios pendientes (app Recordatorios), con su id y fecha.',
    input_schema: objeto({}, []),
  },
  {
    name: 'crear_recordatorio',
    description:
      'Crea un recordatorio. Con fecha, suena en el iPhone y la tablet lo anuncia a esa hora. Sin fecha, vence = null.',
    input_schema: objeto(
      { titulo: { type: 'string' }, vence: { type: ['string', 'null'], description: `${FECHA}, o null` } },
      ['titulo', 'vence'],
    ),
  },
  {
    name: 'completar_recordatorio',
    description: 'Marca un recordatorio como hecho. El id sale de ver_recordatorios.',
    input_schema: objeto({ id: { type: 'string' } }, ['id']),
  },
];

export function construirHerramientas(
  config: Pick<Config, 'escenas' | 'apps'>,
  conAgenda = false,
): Anthropic.Beta.BetaTool[] {
  const herramientas: Anthropic.Beta.BetaTool[] = [
    {
      name: 'leer_estado_mac',
      description: 'Lee el estado actual de la Mac: CPU, RAM, disco, batería, volumen y tiempo encendida.',
      input_schema: objeto({}, []),
    },
    {
      name: 'fijar_volumen',
      description: 'Fija el volumen de salida de la Mac. nivel va de 0 a 100. Quita el silencio.',
      input_schema: objeto({ nivel: { type: 'integer', description: 'De 0 a 100' } }, ['nivel']),
    },
    {
      name: 'silenciar',
      description: 'Silencia (true) o reactiva (false) el audio de la Mac.',
      input_schema: objeto({ silenciar: { type: 'boolean' } }, ['silenciar']),
    },
    {
      name: 'controlar_musica',
      description: 'Controla la música en Spotify o Música de la Mac.',
      input_schema: objeto({ orden: { type: 'string', enum: ['reproducir_pausar', 'siguiente', 'anterior'] } }, ['orden']),
    },
    {
      name: 'apagar_pantalla_mac',
      description: 'Apaga la pantalla de la Mac (y la bloquea si pide contraseña al despertar).',
      input_schema: objeto({}, []),
    },
  ];
  if (config.apps.length) {
    herramientas.push({
      name: 'abrir_app',
      description: `Abre una app en la Mac. Apps permitidas: ${config.apps.map((a) => `${a.id} (${a.nombre})`).join(', ')}.`,
      input_schema: objeto({ id: { type: 'string', enum: config.apps.map((a) => a.id) } }, ['id']),
    });
  }
  if (config.escenas.length) {
    herramientas.push({
      name: 'ejecutar_escena',
      description:
        'Ejecuta una escena de la casa (luces, enchufes, rutinas). Escenas: ' +
        config.escenas.map((e) => `${e.id} (${e.nombre}${e.confirmar ? ', requiere confirmación' : ''})`).join(', ') +
        '.',
      input_schema: objeto({ id: { type: 'string', enum: config.escenas.map((e) => e.id) } }, ['id']),
    });
  }
  if (conAgenda) herramientas.push(...HERRAMIENTAS_AGENDA);
  return herramientas.map((h) => ({ ...h, strict: true }));
}

const SISTEMA = `Eres el asistente de voz de una casa. Hablas desde una tablet en la pared y controlas la Mac del usuario y las escenas de la casa con tus herramientas.

Cómo respondes:
- En español neutro latinoamericano, cálido y directo.
- Tu respuesta se lee en voz alta: una o dos frases cortas. Sin markdown, listas, emojis ni URLs. Escribe los números como se dicen («veinte por ciento»).
- Si una orden es clara, actúa con la herramienta y confirma en pocas palabras lo que pasó. No anuncies lo que vas a hacer.
- Nunca digas que hiciste algo si la herramienta falló o no la usaste; di qué pasó.
- Si algo no está a tu alcance (no hay herramienta para eso), dilo en una frase y, si sirve, sugiere lo que sí puedes hacer.
- Para preguntas generales responde de lo que sabes, breve. No tienes internet.
- Si tienes herramientas de agenda, úsalas para eventos y recordatorios. «Mañana», «el viernes», «en dos horas»: calcúlalo con la fecha actual del mensaje.
- Al contar la agenda no recites todo. Si hay más de cuatro eventos, di cuántos son, menciona los tres o cuatro que se salen de la rutina o tienen hora fija (citas, reuniones, entregas) y ofrece el detalle del resto. No nombres calendarios ni repitas eventos duplicados.
- Di las horas como se hablan: «a las dos de la tarde», «a las ocho y media de la noche»; nunca «catorce» ni «veinte treinta».

Confirmaciones:
- Las escenas marcadas «requiere confirmación» pídelas solo después de preguntar «¿Seguro que quieres …?» y de que el usuario diga que sí. Si intentas ejecutarlas antes, el sistema te lo bloqueará: entonces pregunta.

Cada mensaje del usuario empieza con la fecha y hora actuales entre corchetes; úsalas si te preguntan por ellas.`;

function describirEstado(e: EstadoMac): string {
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
  return JSON.stringify({
    nombre: e.nombre,
    sistema: e.sistema,
    cpu_pct: e.cpuPct,
    ram: `${gb(e.memoria.usadaBytes)} de ${gb(e.memoria.totalBytes)}`,
    disco_libre: e.disco ? gb(e.disco.libreBytes) : 'desconocido',
    bateria: e.bateria ?? 'sin batería (escritorio)',
    volumen: e.volumen ?? 'desconocido',
    musica: e.reproductor ? `${e.reproductor.cancion} - ${e.reproductor.artista} (${e.reproductor.estado})` : 'nada sonando',
    clima: e.clima ? `${e.clima.tempC}°C, ${e.clima.condicion} en ${e.clima.ciudad}` : undefined,
    encendida_horas: Math.round(e.uptimeSeg / 360) / 10,
  });
}

interface Conversacion {
  mensajes: Mensaje[];
  turno: number;
  ultimoUso: number;
  /** clave de acción → turno del usuario en que se bloqueó por confirmación. */
  pendientes: Map<string, number>;
}

export class Asistente {
  private conversacion: Conversacion | null = null;
  private ocupado = false;
  private readonly deps: Dependencias;
  private readonly herramientas: Anthropic.Beta.BetaTool[];
  private readonly ahora: () => Date;
  private readonly log: (linea: string) => void;
  private readonly formatoFecha = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  constructor(deps: Dependencias) {
    this.deps = deps;
    this.herramientas = construirHerramientas(deps.config, Boolean(deps.agenda));
    this.ahora = deps.ahora ?? (() => new Date());
    this.log = deps.log ?? (() => {});
  }

  private conversacionVigente(nueva: boolean): Conversacion {
    const caduca = this.deps.config.asistente.minutosConversacion * 60_000;
    const c = this.conversacion;
    if (nueva || !c || Date.now() - c.ultimoUso > caduca || c.mensajes.length > MAX_MENSAJES) {
      this.conversacion = { mensajes: [], turno: 0, ultimoUso: Date.now(), pendientes: new Map() };
    }
    return this.conversacion!;
  }

  /** Traduce una llamada de herramienta a una acción de la lista blanca. */
  private async ejecutarHerramienta(
    uso: Anthropic.Beta.BetaToolUseBlock,
    c: Conversacion,
  ): Promise<{ texto: string; error: boolean; registro?: AccionRealizada; bloqueada?: boolean }> {
    const entrada = (uso.input ?? {}) as Record<string, unknown>;
    if (uso.name === 'leer_estado_mac') return { texto: describirEstado(await this.deps.leerEstado()), error: false };
    const agenda = await this.usarAgenda(uso.name, entrada);
    if (agenda) return agenda;

    const ORDENES: Record<string, string> = {
      reproducir_pausar: 'media.playpause',
      siguiente: 'media.siguiente',
      anterior: 'media.anterior',
    };
    const mapa: Record<string, () => [string, Record<string, unknown>] | null> = {
      fijar_volumen: () => ['volumen.fijar', { nivel: entrada.nivel }],
      silenciar: () => ['volumen.silenciar', { silenciar: entrada.silenciar }],
      controlar_musica: () => (ORDENES[String(entrada.orden)] ? [ORDENES[String(entrada.orden)], {}] : null),
      apagar_pantalla_mac: () => ['pantalla.apagar', {}],
      abrir_app: () => ['app.abrir', { id: entrada.id }],
      ejecutar_escena: () => ['escena.ejecutar', { id: entrada.id }],
    };
    const destino = mapa[uso.name]?.();
    if (!destino) return { texto: `Herramienta desconocida o parámetros inválidos: ${uso.name}`, error: true };
    const [idAccion, params] = destino;

    if (idAccion === 'escena.ejecutar') {
      const escena = this.deps.config.escenas.find((e) => e.id === params.id);
      if (escena?.confirmar) {
        const clave = `${idAccion}:${escena.id}`;
        const pedidaEn = c.pendientes.get(clave);
        if (pedidaEn === undefined || pedidaEn >= c.turno) {
          c.pendientes.set(clave, c.turno);
          return {
            texto: `Bloqueado: «${escena.nombre}» requiere confirmación. Pregunta al usuario si está seguro y espera su respuesta.`,
            error: true,
            bloqueada: true,
          };
        }
        c.pendientes.delete(clave);
      }
    }

    const accion = this.deps.acciones[idAccion];
    try {
      const mensaje = await accion.ejecutar(params);
      this.log(`ia → ${idAccion} ${JSON.stringify(params)} → ${mensaje}`);
      return { texto: mensaje, error: false, registro: { herramienta: idAccion, ok: true, mensaje } };
    } catch (e) {
      const mensaje = (e as Error).message;
      this.log(`ia → ${idAccion} falló: ${mensaje}`);
      return { texto: `Falló: ${mensaje}`, error: true, registro: { herramienta: idAccion, ok: false, mensaje } };
    }
  }

  /** Herramientas de agenda: null si la herramienta no es de agenda. */
  private async usarAgenda(
    nombre: string,
    e: Record<string, unknown>,
  ): Promise<{ texto: string; error: boolean; registro?: AccionRealizada } | null> {
    const agenda = this.deps.agenda;
    if (!agenda || !HERRAMIENTAS_AGENDA.some((h) => h.name === nombre)) return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const registro = (mensaje: string, ok = true): AccionRealizada => ({ herramienta: `agenda.${nombre}`, ok, mensaje });
    try {
      switch (nombre) {
        case 'ver_agenda':
          return { texto: resumirEventos(await agenda.eventos(str(e.desde), str(e.hasta))), error: false };
        case 'ver_recordatorios':
          return {
            texto: JSON.stringify((await agenda.recordatorios()).map(({ id, titulo, vence }) => ({ id, titulo, vence }))),
            error: false,
          };
        case 'crear_evento': {
          const r = await agenda.crearEvento(str(e.titulo), str(e.inicio), str(e.fin));
          this.log(`ia → evento «${r.titulo}» ${r.inicio}`);
          return { texto: JSON.stringify(r), error: false, registro: registro(`Evento «${r.titulo}» creado`) };
        }
        case 'crear_recordatorio': {
          const r = await agenda.crearRecordatorio(str(e.titulo), typeof e.vence === 'string' && e.vence ? e.vence : null);
          this.log(`ia → recordatorio «${r.titulo}» ${r.vence ?? 'sin fecha'}`);
          return { texto: JSON.stringify(r), error: false, registro: registro(`Recordatorio «${r.titulo}» creado`) };
        }
        case 'completar_recordatorio': {
          const r = await agenda.completarRecordatorio(str(e.id));
          return { texto: JSON.stringify(r), error: false, registro: registro(`«${r.titulo}» completado`) };
        }
      }
    } catch (err) {
      const mensaje = (err as Error).message;
      return { texto: `Falló: ${mensaje}`, error: true, registro: registro(mensaje, false) };
    }
    return null;
  }

  async conversar(textoCrudo: unknown, nueva = false): Promise<RespuestaChat> {
    if (typeof textoCrudo !== 'string' || !textoCrudo.trim()) throw new ErrorDeAsistente('"texto" es obligatorio', 400);
    const texto = textoCrudo.trim().slice(0, MAX_TEXTO);
    if (this.ocupado) throw new ErrorDeAsistente('Sigo pensando en lo anterior, dame un segundo.', 409);
    this.ocupado = true;

    const c = this.conversacionVigente(nueva);
    c.turno += 1;
    c.ultimoUso = Date.now();
    c.mensajes.push({ role: 'user', content: `[${this.formatoFecha.format(this.ahora())}] ${texto}` });

    const acciones: AccionRealizada[] = [];
    let esperandoConfirmacion = false;
    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        const r = await this.deps.crearMensaje({
          model: this.deps.config.asistente.modelo,
          max_tokens: 16000,
          system: SISTEMA,
          tools: this.herramientas,
          messages: c.mensajes,
          output_config: { effort: this.deps.config.asistente.esfuerzo },
          cache_control: { type: 'ephemeral' },
          // Si el modelo declina por política, el servidor reintenta con su respaldo por defecto.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
        // Siempre se guarda el contenido completo (pensamiento incluido), sin tocarlo.
        c.mensajes.push({ role: 'assistant', content: r.content });

        if (r.stop_reason === 'refusal') {
          this.conversacion = null;
          return { respuesta: 'Con eso no te puedo ayudar.', acciones, esperandoConfirmacion: false };
        }
        if (r.stop_reason === 'pause_turn') continue;

        const usos = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !usos.length) {
          const respuesta = r.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
            .map((b) => b.text)
            .join(' ')
            .trim();
          return { respuesta: respuesta || 'Listo.', acciones, esperandoConfirmacion };
        }

        // Todas las respuestas de herramientas van juntas en UN mensaje del usuario.
        const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const uso of usos) {
          const res = await this.ejecutarHerramienta(uso, c);
          if (res.registro) acciones.push(res.registro);
          if (res.bloqueada) esperandoConfirmacion = true;
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: res.texto, is_error: res.error });
        }
        c.mensajes.push({ role: 'user', content: resultados });
      }
      // Demasiadas vueltas: la conversación queda con herramientas sin cerrar, así que se descarta.
      this.conversacion = null;
      return { respuesta: 'Me enredé con eso. ¿Me lo pides de otra forma?', acciones, esperandoConfirmacion: false };
    } catch (e) {
      // Un historial a medias (pregunta sin respuesta) rompería la siguiente llamada: se empieza de cero.
      this.conversacion = null;
      throw traducirError(e);
    } finally {
      this.ocupado = false;
    }
  }
}

function traducirError(e: unknown): ErrorDeAsistente {
  if (e instanceof ErrorDeAsistente) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ErrorDeAsistente('La clave de la API de Claude no es válida.', 503);
  }
  if (e instanceof Anthropic.RateLimitError) return new ErrorDeAsistente('Demasiadas peticiones a Claude, espera un momento.', 429);
  if (e instanceof Anthropic.BadRequestError) return new ErrorDeAsistente(`Claude rechazó la petición: ${e.message}`, 502);
  if (e instanceof Anthropic.APIConnectionError) return new ErrorDeAsistente('La Mac no tiene conexión con Claude.', 502);
  if (e instanceof Anthropic.APIError) return new ErrorDeAsistente(`Error de Claude (${e.status ?? '?'}).`, 502);
  return new ErrorDeAsistente(`Error del asistente: ${(e as Error).message}`, 500);
}

const SIN_CLAVE = new ErrorDeAsistente(
  'Falta la llave del chat. Copia tu llave de Groq (gratis) o de Claude y ejecuta:  zsh mac-agent/scripts/llave.sh',
  503,
);

/** ¿Hay alguna credencial que el SDK pueda usar? Clave, token o perfil de `ant auth login`. */
function hayCredenciales(apiKey: string | undefined): boolean {
  if (apiKey || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) return true;
  const base = process.env.ANTHROPIC_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'anthropic');
  return existsSync(base);
}

/** Cliente real. Si no hay credenciales, el error llega como 503 al primer mensaje, no al arrancar. */
export function crearClienteClaude(apiKey: string | undefined): CrearMensaje {
  let cliente: Anthropic | null = null;
  return async (params) => {
    if (!cliente) {
      if (!hayCredenciales(apiKey)) throw SIN_CLAVE;
      cliente = new Anthropic({ ...(apiKey ? { apiKey } : {}), timeout: 60_000 });
    }
    return cliente.beta.messages.create(params);
  };
}
