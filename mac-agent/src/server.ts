import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { crearAcciones, ErrorDeAccion } from './acciones.ts';
import { Asistente, crearClienteClaude, ErrorDeAsistente } from './asistente.ts';
import { cargarClaveAnthropic, cargarConfig, type Config } from './config.ts';
import { ejecutar } from './ejecutor.ts';
import { Monitor, type EstadoMac } from './estado.ts';

interface Dependencias {
  config: Config;
  monitor: Pick<Monitor, 'leer'>;
  acciones: ReturnType<typeof crearAcciones>;
  asistente?: Pick<Asistente, 'conversar'>;
  log?: (linea: string) => void;
  intervaloMs?: number;
}

const MAX_CUERPO = 16 * 1024;
const MAX_FALLOS = 10;
const VENTANA_FALLOS_MS = 60_000;

export function crearServidor({ config, monitor, acciones, asistente, log = console.log, intervaloMs = 3000 }: Dependencias): Server {
  const token = Buffer.from(config.token);
  const fallos = new Map<string, { n: number; hasta: number }>();
  const suscriptores = new Set<ServerResponse>();
  let temporizador: NodeJS.Timeout | undefined;

  const ipDe = (req: IncomingMessage) => {
    const local = req.socket.remoteAddress;
    // Solo se confía en la cabecera de Cloudflare cuando la conexión viene de cloudflared (local).
    const cf = req.headers['cf-connecting-ip'];
    return (local === '127.0.0.1' || local === '::1') && typeof cf === 'string' ? cf : (local ?? '?');
  };

  const autorizado = (req: IncomingMessage) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m) return false;
    const recibido = Buffer.from(m[1]);
    return recibido.length === token.length && timingSafeEqual(recibido, token);
  };

  const json = (res: ServerResponse, estado: number, cuerpo: unknown) => {
    res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(cuerpo));
  };

  const leerCuerpo = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let tam = 0;
      const partes: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        tam += c.length;
        if (tam > MAX_CUERPO) {
          reject(new ErrorDeAccion('Cuerpo demasiado grande', 413));
          req.destroy();
        } else partes.push(c);
      });
      req.on('end', () => {
        if (!tam) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(partes).toString('utf8'));
          if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
          resolve(v);
        } catch {
          reject(new ErrorDeAccion('JSON inválido'));
        }
      });
      req.on('error', reject);
    });

  const emitir = (estado: EstadoMac) => {
    const datos = `event: estado\ndata: ${JSON.stringify(estado)}\n\n`;
    for (const res of suscriptores) res.write(datos);
  };

  const muestrear = async () => {
    try {
      emitir(await monitor.leer());
    } catch (e) {
      log(`error leyendo estado: ${(e as Error).message}`);
    }
  };

  const detenerSiNadie = () => {
    if (!suscriptores.size && temporizador) {
      clearInterval(temporizador);
      temporizador = undefined;
    }
  };

  const servidor = createServer(async (req, res) => {
    const origen = req.headers.origin;
    if (origen) {
      if (!config.origenes.includes(origen)) return json(res, 403, { error: 'Origen no permitido' });
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }

    const url = new URL(req.url ?? '/', 'http://agente');
    if (req.method === 'GET' && url.pathname === '/salud') return json(res, 200, { ok: true });

    const ip = ipDe(req);
    const registro = fallos.get(ip);
    if (registro && registro.hasta > Date.now() && registro.n >= MAX_FALLOS) {
      return json(res, 429, { error: 'Demasiados intentos, espera un minuto' });
    }
    if (!autorizado(req)) {
      const vigente = registro && registro.hasta > Date.now() ? registro : { n: 0, hasta: Date.now() + VENTANA_FALLOS_MS };
      vigente.n += 1;
      fallos.set(ip, vigente);
      if (fallos.size > 500) for (const [k, v] of fallos) if (v.hasta <= Date.now()) fallos.delete(k);
      log(`token inválido desde ${ip}`);
      return json(res, 401, { error: 'No autorizado' });
    }

    try {
      if (req.method === 'GET' && url.pathname === '/estado') return json(res, 200, await monitor.leer());

      if (req.method === 'GET' && url.pathname === '/catalogo') {
        return json(res, 200, {
          acciones: Object.entries(acciones).map(([id, a]) => ({ id, descripcion: a.descripcion })),
          escenas: config.escenas.map(({ id, nombre }) => ({ id, nombre })),
          apps: config.apps.map(({ id, nombre }) => ({ id, nombre })),
          chat: Boolean(asistente),
        });
      }

      if (req.method === 'GET' && url.pathname === '/eventos') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          // Evita que proxies (Cloudflare incluido) acumulen el flujo antes de enviarlo.
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        });
        res.write(`retry: 5000\n\n`);
        suscriptores.add(res);
        req.on('close', () => {
          suscriptores.delete(res);
          detenerSiNadie();
        });
        if (!temporizador) temporizador = setInterval(muestrear, intervaloMs);
        void muestrear();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/chat') {
        if (!asistente) return json(res, 503, { error: 'El asistente no está activado en este agente' });
        const { texto, nueva } = await leerCuerpo(req);
        const r = await asistente.conversar(texto, nueva === true);
        json(res, 200, r);
        if (r.acciones.length && suscriptores.size) void muestrear();
        return;
      }

      const accion = /^\/acciones\/([a-z.]+)$/.exec(url.pathname);
      if (req.method === 'POST' && accion) {
        const id = accion[1];
        const def = acciones[id];
        if (!def) return json(res, 404, { error: 'Acción desconocida' });
        const params = await leerCuerpo(req);
        const mensaje = await def.ejecutar(params);
        log(`acción ${id} ${JSON.stringify(params)} → ${mensaje}`);
        json(res, 200, { ok: true, mensaje });
        if (suscriptores.size) void muestrear();
        return;
      }

      json(res, 404, { error: 'Ruta no encontrada' });
    } catch (e) {
      if (e instanceof ErrorDeAccion || e instanceof ErrorDeAsistente) return json(res, e.estado, { error: e.message });
      log(`error: ${(e as Error).message}`);
      json(res, 500, { error: 'La Mac no pudo completar la orden' });
    }
  });

  servidor.on('close', () => {
    for (const res of suscriptores) res.end();
    suscriptores.clear();
    detenerSiNadie();
  });

  return servidor;
}

if (import.meta.main) {
  const config = cargarConfig();
  const log = (l: string) => console.log(`[${new Date().toISOString()}] ${l}`);
  const monitor = new Monitor(ejecutar);
  const acciones = crearAcciones(config, ejecutar);
  const servidor = crearServidor({
    config,
    monitor,
    acciones,
    asistente: new Asistente({
      config,
      acciones,
      leerEstado: () => monitor.leer(),
      crearMensaje: crearClienteClaude(cargarClaveAnthropic()),
      log,
    }),
    log,
  });
  servidor.listen(config.puerto, config.host, () => {
    console.log(`mac-agent escuchando en http://${config.host}:${config.puerto}`);
    console.log(`Token guardado en mac-agent/.token (o AGENT_TOKEN). Úsalo para emparejar la tablet en /app.`);
  });
  const salir = () => {
    servidor.close(() => process.exit(0));
    // Los flujos SSE nunca terminan solos; sin esto close() esperaría para siempre.
    servidor.closeAllConnections();
  };
  process.on('SIGTERM', salir);
  process.on('SIGINT', salir);
}
