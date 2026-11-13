import { timingSafeEqual } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { crearAcciones, ErrorDeAccion } from './acciones.ts';
import { agendaInstalada, Avisador, fechaLocal, type Agenda } from './agenda.ts';
import { GestorAlarmas, type Alarma } from './alarmas.ts';
import { Asistente, crearClienteClaude, ErrorDeAsistente } from './asistente.ts';
import { cargarClaveAnthropic, cargarClaveGroq, cargarConfig, RAIZ, type Config } from './config.ts';
import { ejecutar } from './ejecutor.ts';
import { fondoInstalado, type Fondo } from './fondo.ts';
import { Monitor, type EstadoMac } from './estado.ts';
import { crearClienteGroq, MODELOS_GROQ } from './groq.ts';
import { Publicador } from './publicador.ts';
import { Rutinas } from './rutinas.ts';

interface Dependencias {
  config: Config;
  monitor: Pick<Monitor, 'leer'> & Partial<Pick<Monitor, 'leerFondo'>>;
  acciones: ReturnType<typeof crearAcciones>;
  asistente?: Pick<Asistente, 'conversar'>;
  agenda?: Agenda;
  avisador?: Pick<Avisador, 'pendientes' | 'descartar' | 'olvidarPermiso'>;
  gestorAlarmas?: GestorAlarmas;
  fondo?: Pick<Fondo, 'firma' | 'imagen'>;
  rutinas?: Pick<Rutinas, 'listar' | 'ejecutar' | 'porFrase'>;
  log?: (linea: string) => void;
  intervaloMs?: number;
}

const MAX_CUERPO = 16 * 1024;
const MAX_FALLOS = 10;
const VENTANA_FALLOS_MS = 60_000;

function calcularSaludo(fecha: Date): string {
  const h = fecha.getHours();
  if (h >= 6 && h < 12) return 'Buenos días';
  if (h >= 12 && h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

export function crearServidor({
  config,
  monitor,
  acciones,
  asistente,
  agenda,
  avisador,
  gestorAlarmas,
  fondo,
  rutinas,
  log = console.log,
  intervaloMs = 3000,
}: Dependencias): Server {
  const token = Buffer.from(config.token);
  const fallos = new Map<string, { n: number; hasta: number }>();
  const suscriptores = new Set<ServerResponse>();
  let temporizador: NodeJS.Timeout | undefined;
  let marcaFondoRespaldo: string | null = null;

  let alarmasActivas: Alarma[] = [];
  const revisarAlarmas = () => {
    if (gestorAlarmas) {
      alarmasActivas = gestorAlarmas.vencidas();
    }
  };
  revisarAlarmas();

  let intervaloAlarmas: NodeJS.Timeout | undefined;
  if (gestorAlarmas) {
    intervaloAlarmas = setInterval(() => {
      const previas = alarmasActivas.length;
      revisarAlarmas();
      if ((alarmasActivas.length > 0 || previas > 0) && suscriptores.size) {
        void muestrear();
      }
    }, 30_000);
    intervaloAlarmas.unref();
  }

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

  /** El estado lleva además los avisos de recordatorios vencidos y las alarmas activas cuando suenan. */
  const leerEstado = async () => {
    if (gestorAlarmas) revisarAlarmas();
    return {
      ...(await monitor.leer()),
      avisos: avisador?.pendientes ?? [],
      // Cuando cambia, el panel vuelve a bajar el fondo de pantalla.
      fondo: fondo?.firma ?? null,
      ...(alarmasActivas.length > 0 ? { alarmasActivas } : {}),
    };
  };

  const emitir = (estado: EstadoMac) => {
    const datos = `event: estado\ndata: ${JSON.stringify(estado)}\n\n`;
    for (const res of suscriptores) res.write(datos);
  };

  const muestrear = async () => {
    try {
      emitir(await leerEstado());
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
      res.setHeader('Access-Control-Expose-Headers', 'X-Fondo');
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
      if (req.method === 'GET' && url.pathname === '/estado') return json(res, 200, await leerEstado());

      if (req.method === 'GET' && url.pathname === '/catalogo') {
        return json(res, 200, {
          acciones: Object.entries(acciones).map(([id, a]) => ({ id, descripcion: a.descripcion })),
          escenas: config.escenas.map(({ id, nombre }) => ({ id, nombre })),
          apps: config.apps.map(({ id, nombre }) => ({ id, nombre })),
          playlistsRapidas: config.playlistsRapidas ?? [],
          rutinas: rutinas?.listar() ?? [],
          chat: Boolean(asistente),
          agenda: Boolean(agenda),
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

      if (url.pathname === '/agenda' || url.pathname.startsWith('/agenda/') || url.pathname.startsWith('/avisos/')) {
        if (!agenda) return json(res, 404, { error: 'La agenda no está instalada en este agente' });

        if (req.method === 'GET' && url.pathname === '/agenda') {
          const permisos = await agenda.permisos();
          const hoy = new Date();
          hoy.setHours(0, 0, 0, 0);
          const pasadoManana = new Date(hoy.getTime() + 2 * 86400_000);
          const [eventos, recordatorios] = await Promise.all([
            permisos.calendario === 'concedido' ? agenda.eventos(fechaLocal(hoy), fechaLocal(pasadoManana)) : [],
            permisos.recordatorios === 'concedido' ? agenda.recordatorios() : [],
          ]);
          return json(res, 200, { permisos, eventos, recordatorios: recordatorios.slice(0, 12) });
        }

        if (req.method === 'POST' && url.pathname === '/agenda/permisos') {
          // Abre el diálogo de macOS en la Mac: alguien tiene que aceptarlo allí.
          const r = await agenda.pedirPermisos();
          avisador?.olvidarPermiso();
          log(`permisos de agenda: ${JSON.stringify(r)}`);
          return json(res, 200, r);
        }

        const aviso = /^\/avisos\/([^/]+)\/descartar$/.exec(url.pathname);
        if (req.method === 'POST' && aviso) {
          const id = decodeURIComponent(aviso[1]);
          const { completar } = await leerCuerpo(req);
          avisador?.descartar(id);
          if (completar === true) await agenda.completarRecordatorio(id);
          json(res, 200, { ok: true });
          if (suscriptores.size) void muestrear();
          return;
        }
        return json(res, 404, { error: 'Ruta no encontrada' });
      }

      if (req.method === 'GET' && url.pathname === '/fondo') {
        const enviarImagen = (datos: Buffer, tipo: string) => {
          res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': datos.length, 'Cache-Control': 'no-store' });
          res.end(datos);
        };

        // Lo normal: la mini app, que da el fondo real (también los Aerial) y su versión de vidrio.
        if (fondo) {
          const imagen = await fondo.imagen(url.searchParams.get('v') === 'vidrio' ? 'vidrio' : 'fondo');
          if (!imagen) return json(res, 404, { error: 'Fondo no disponible todavía' });
          res.setHeader('ETag', `"${imagen.firma}"`);
          // La firma del fondo que se entrega: el panel la compara con la del estado y no lo baja dos veces.
          res.setHeader('X-Fondo', fondo.firma ?? '');
          return enviarImagen(imagen.datos, 'image/jpeg');
        }

        // Respaldo sin mini app (no se pudo compilar): la imagen que diga el sistema, sin vidrio.
        if (url.searchParams.get('v') === 'vidrio') return json(res, 404, { error: 'Sin versión de vidrio' });
        const ruta = monitor.leerFondo ? await monitor.leerFondo() : null;
        if (!ruta || !existsSync(ruta)) return json(res, 404, { error: 'Fondo no encontrado' });
        try {
          // Siempre a JPEG de 1600 px: los originales pueden ser HEIC (que Chrome no abre) o de 6K.
          const cacheJpg = join(RAIZ, '.fondo-cache.jpg');
          const marca = `${ruta}|${statSync(ruta).mtimeMs}`;
          if (marcaFondoRespaldo !== marca || !existsSync(cacheJpg)) {
            await ejecutar('sips', ['-Z', '1600', '-s', 'format', 'jpeg', ruta, '--out', cacheJpg]);
            marcaFondoRespaldo = marca;
          }
          return enviarImagen(await readFile(cacheJpg), 'image/jpeg');
        } catch {
          return json(res, 404, { error: 'No se pudo preparar el fondo' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/resumen') {
        const ahora = new Date();
        const estado = await monitor.leer();
        const clima = estado.clima ?? null;

        let eventosHoy: unknown[] = [];
        let recordatoriosPendientes: unknown[] = [];
        if (agenda) {
          try {
            const permisos = await agenda.permisos();
            const hoyInicio = new Date(ahora);
            hoyInicio.setHours(0, 0, 0, 0);
            const hoyFin = new Date(ahora);
            hoyFin.setHours(23, 59, 59, 999);
            const [evs, recs] = await Promise.all([
              permisos.calendario === 'concedido' ? agenda.eventos(fechaLocal(hoyInicio), fechaLocal(hoyFin)) : [],
              permisos.recordatorios === 'concedido' ? agenda.recordatorios() : [],
            ]);
            eventosHoy = evs;
            recordatoriosPendientes = recs;
          } catch {
            // Continúa con listas vacías si la agenda falla
          }
        }

        const diaHoy = ahora.getDay();
        const alarmasHoy = gestorAlarmas
          ? gestorAlarmas
              .listar()
              .filter((a) => a.activa && (a.dias.length === 0 || a.dias.includes(diaHoy)))
              .sort((a, b) => a.hora.localeCompare(b.hora))
          : [];

        const saludo = calcularSaludo(ahora);
        const hh = String(ahora.getHours()).padStart(2, '0');
        const mm = String(ahora.getMinutes()).padStart(2, '0');
        const hora = `${hh}:${mm}`;

        return json(res, 200, {
          clima,
          eventosHoy,
          recordatoriosPendientes,
          alarmasHoy,
          saludo,
          hora,
        });
      }

      if (url.pathname === '/alarmas' || url.pathname.startsWith('/alarmas/')) {
        if (req.method === 'GET' && url.pathname === '/alarmas') {
          return json(res, 200, { alarmas: gestorAlarmas ? gestorAlarmas.listar() : [] });
        }

        if (!gestorAlarmas) return json(res, 503, { error: 'Gestor de alarmas no configurado' });

        if (req.method === 'POST' && url.pathname === '/alarmas') {
          const cuerpo = await leerCuerpo(req);
          if (typeof cuerpo.hora !== 'string' || typeof cuerpo.titulo !== 'string') {
            return json(res, 400, { error: 'hora y titulo son requeridos' });
          }
          const dias = Array.isArray(cuerpo.dias) ? (cuerpo.dias as number[]) : undefined;
          try {
            const alarma = gestorAlarmas.crear(cuerpo.hora, cuerpo.titulo, dias);
            revisarAlarmas();
            if (suscriptores.size) void muestrear();
            return json(res, 200, { alarma });
          } catch (e) {
            return json(res, 400, { error: (e as Error).message });
          }
        }

        const mToggleAlarma = /^\/alarmas\/([^/]+)\/toggle$/.exec(url.pathname);
        if (req.method === 'POST' && mToggleAlarma) {
          const id = decodeURIComponent(mToggleAlarma[1]);
          try {
            const alarma = gestorAlarmas.toggle(id);
            revisarAlarmas();
            if (suscriptores.size) void muestrear();
            return json(res, 200, { alarma });
          } catch {
            return json(res, 404, { error: 'Alarma no encontrada' });
          }
        }

        const mEliminarAlarma = /^\/alarmas\/([^/]+)$/.exec(url.pathname);
        if (req.method === 'DELETE' && mEliminarAlarma) {
          const id = decodeURIComponent(mEliminarAlarma[1]);
          const ok = gestorAlarmas.eliminar(id);
          if (!ok) return json(res, 404, { error: 'Alarma no encontrada' });
          revisarAlarmas();
          if (suscriptores.size) void muestrear();
          return json(res, 200, { ok: true });
        }

        return json(res, 404, { error: 'Ruta no encontrada' });
      }

      const rutina = /^\/rutinas\/([a-z0-9-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && rutina) {
        if (!rutinas) return json(res, 404, { error: 'Las rutinas no están activadas en este agente' });
        const r = await rutinas.ejecutar(rutina[1]);
        json(res, 200, { ok: true, ...r });
        if (suscriptores.size) void muestrear();
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

      const accion = /^\/acciones\/([a-z._-]+)$/.exec(url.pathname);
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
    if (intervaloAlarmas) clearInterval(intervaloAlarmas);
    for (const res of suscriptores) res.end();
    suscriptores.clear();
    detenerSiNadie();
  });

  return servidor;
}

if (import.meta.main) {
  const config = cargarConfig();
  const log = (l: string) => console.log(`[${new Date().toISOString()}] ${l}`);
  const monitor = new Monitor(ejecutar, config.ciudad ?? 'Ibague');
  const acciones = crearAcciones(config, ejecutar);
  const agenda = agendaInstalada(RAIZ, ejecutar);
  const avisador = agenda ? new Avisador(agenda) : undefined;
  const gestorAlarmas = new GestorAlarmas(RAIZ);
  // Rutinas de voz: «buenas noches» y «buenos días» vienen de fábrica; config.json › rutinas las ajusta.
  const rutinas = new Rutinas({
    rutinas: config.rutinas ?? [],
    acciones,
    escenas: config.escenas,
    nombre: config.asistente.nombre,
    log,
    fuentes: {
      ahora: () => new Date(),
      clima: async () => (await monitor.leer()).clima ?? null,
      eventos: async (desde, hasta) => {
        if (!agenda || (await agenda.permisos()).calendario !== 'concedido') return [];
        return agenda.eventos(fechaLocal(desde), fechaLocal(hasta));
      },
      recordatorios: async () => {
        if (!agenda || (await agenda.permisos()).recordatorios !== 'concedido') return [];
        return agenda.recordatorios();
      },
      alarmas: () => gestorAlarmas.listar(),
    },
  });
  if (!agenda) log('agenda no instalada (falta «Agenda del asistente.app»): sin calendario ni recordatorios');
  // Proveedor del chat: con `auto`, basta con que exista la llave de Groq para usarlo.
  const claveGroq = cargarClaveGroq();
  const { proveedor } = config.asistente;
  const usarGroq = proveedor === 'groq' || (proveedor === 'auto' && Boolean(claveGroq));
  const modelosGroq = config.asistente.modelosGroq.length ? config.asistente.modelosGroq : MODELOS_GROQ;
  const crearMensaje = usarGroq
    ? claveGroq
      ? crearClienteGroq(claveGroq, modelosGroq, fetch, log)
      : async () => {
          throw new ErrorDeAsistente('Falta la llave de Groq: ejecuta  zsh mac-agent/scripts/llave.sh', 503);
        }
    : crearClienteClaude(cargarClaveAnthropic());
  log(`chat: ${usarGroq ? `Groq (${modelosGroq.join(' → ')})` : `Claude (${config.asistente.modelo})`}`);

  const servidor = crearServidor({
    config,
    monitor,
    acciones,
    agenda,
    avisador,
    gestorAlarmas,
    fondo: fondoInstalado(RAIZ, ejecutar, log),
    rutinas,
    asistente: new Asistente({
      config,
      acciones,
      agenda,
      alarmas: gestorAlarmas,
      rutinas,
      leerEstado: () => monitor.leer(),
      crearMensaje,
      log,
    }),
    log,
  });
  if (config.publicar) {
    const publicador = new Publicador({
      token: config.token,
      rutaLog: join(homedir(), 'Library/Logs/mac-agent-tunel.log'),
      carpeta: join(RAIZ, 'publicacion'),
      remoto: config.publicar.remoto,
      rama: config.publicar.rama,
      run: ejecutar,
      log,
    });
    const publicar = () => publicador.revisar().catch((e: Error) => log(`publicar dirección: ${e.message}`));
    setTimeout(publicar, 5000).unref();
    setInterval(publicar, 60_000).unref();
  }

  if (avisador) {
    // Cada minuto: ¿venció algún recordatorio? El panel lo recibe en el estado.
    setInterval(() => {
      avisador.revisar().then(
        (nuevo) => nuevo && log(`aviso: ${avisador.pendientes.map((a) => a.titulo).join(', ')}`),
        (e: Error) => log(`avisos: ${e.message}`),
      );
    }, 60_000).unref();
  }
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
