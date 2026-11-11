import type Anthropic from '@anthropic-ai/sdk';
import { ErrorDeAsistente, type CrearMensaje } from './asistente.ts';

/**
 * Proveedor alternativo y gratuito: Groq (API compatible con OpenAI).
 *
 * El asistente piensa en el formato de mensajes de Claude; este adaptador
 * traduce cada petición al formato de Groq y la respuesta de vuelta, así el
 * bucle de herramientas, las confirmaciones y los tests son los mismos para
 * los dos proveedores. Lo que impone la seguridad (lista blanca, confirmar
 * escenas delicadas) vive en el agente, no en el modelo.
 */

export const MODELOS_GROQ = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
const URL_GROQ = 'https://api.groq.com/openai/v1/chat/completions';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

interface MensajeGroq {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function textoDe(contenido: unknown): string {
  if (typeof contenido === 'string') return contenido;
  if (!Array.isArray(contenido)) return '';
  return contenido
    .map((b: { type?: string; text?: string }) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('');
}

/** Historial en formato Claude → mensajes de Groq. */
export function aMensajesGroq(params: Pick<Params, 'system' | 'messages'>): MensajeGroq[] {
  const salida: MensajeGroq[] = [];
  const sistema = textoDe(params.system);
  if (sistema) salida.push({ role: 'system', content: sistema });

  for (const m of params.messages) {
    if (typeof m.content === 'string') {
      salida.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const llamadas = m.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      const texto = textoDe(m.content);
      salida.push({ role: 'assistant', content: texto || null, ...(llamadas.length ? { tool_calls: llamadas } : {}) });
      continue;
    }
    // Usuario: los resultados de herramientas van cada uno en su mensaje `tool`.
    for (const b of m.content ?? []) {
      if (b.type === 'tool_result') {
        const cuerpo = textoDe(b.content);
        salida.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `ERROR: ${cuerpo}` : cuerpo });
      } else if (b.type === 'text') {
        salida.push({ role: 'user', content: b.text });
      }
    }
  }
  return salida;
}

function aHerramientasGroq(tools: Params['tools']) {
  return (tools ?? []).flatMap((t) =>
    'input_schema' in t
      ? [{ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }]
      : [],
  );
}

interface RespuestaGroq {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
  }[];
  error?: { message?: string; code?: string };
}

/** Respuesta de Groq → mensaje en formato Claude. */
export function aMensajeClaude(r: RespuestaGroq): Anthropic.Beta.BetaMessage {
  const m = r.choices?.[0]?.message;
  const contenido: unknown[] = [];
  if (m?.content?.trim()) contenido.push({ type: 'text', text: m.content.trim(), citations: null });
  for (const c of m?.tool_calls ?? []) {
    let entrada: unknown = {};
    try {
      entrada = JSON.parse(c.function.arguments || '{}');
    } catch {
      /* argumentos rotos: la herramienta fallará su validación y el modelo lo verá */
    }
    contenido.push({ type: 'tool_use', id: c.id, name: c.function.name, input: entrada });
  }
  const usaHerramientas = Boolean(m?.tool_calls?.length);
  return {
    type: 'message',
    role: 'assistant',
    content: contenido,
    stop_reason: usaHerramientas ? 'tool_use' : 'end_turn',
  } as unknown as Anthropic.Beta.BetaMessage;
}

type Fetch = typeof fetch;

/**
 * Cliente de Groq con la misma firma que el de Claude. Prueba los modelos en
 * orden: si uno no existe, llega a su límite gratuito o genera una llamada de
 * herramienta inválida, pasa al siguiente.
 */
export function crearClienteGroq(apiKey: string, modelos = MODELOS_GROQ, pedir: Fetch = fetch): CrearMensaje {
  return async (params) => {
    const cuerpo = {
      messages: aMensajesGroq(params),
      tools: aHerramientasGroq(params.tools),
      tool_choice: 'auto',
      temperature: 0.3,
      max_completion_tokens: 2048,
    };
    let ultimo: ErrorDeAsistente | null = null;
    for (const modelo of modelos) {
      let r: Response;
      try {
        r = await pedir(URL_GROQ, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cuerpo, model: modelo }),
          signal: AbortSignal.timeout(45_000),
        });
      } catch {
        throw new ErrorDeAsistente('La Mac no tiene conexión con Groq.', 502);
      }
      const datos = (await r.json().catch(() => ({}))) as RespuestaGroq;
      if (r.ok) return aMensajeClaude(datos);
      if (r.status === 401 || r.status === 403) throw new ErrorDeAsistente('La llave de Groq no es válida.', 503);
      ultimo =
        r.status === 429
          ? new ErrorDeAsistente('Se acabó el cupo gratuito de Groq por ahora. Prueba en un rato.', 429)
          : new ErrorDeAsistente(`Groq respondió ${r.status}: ${datos.error?.message ?? 'error'}`, 502);
      // 400 (llamada inválida o modelo retirado), 404, 413, 429 y 5xx: se intenta con el siguiente modelo.
    }
    throw ultimo ?? new ErrorDeAsistente('No hay modelos de Groq configurados.', 500);
  };
}
