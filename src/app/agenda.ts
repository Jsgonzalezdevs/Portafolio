import { CLAVES, guardarCache, hace, leerCache } from './almacen';
import { ErrorNoAutorizado, llamar, type Emparejamiento } from './conexion';

/**
 * Tarjeta de agenda (GET /agenda) y avisos de recordatorios vencidos.
 *
 * Lo último que respondió la Mac queda guardado en la tablet: con la Mac apagada se sigue viendo la
 * agenda («datos de hace 2 h») y los recordatorios con hora siguen avisando.
 */

export interface Evento {
  titulo: string;
  inicio: string;
  todoElDia: boolean;
}

export interface Recordatorio {
  id: string;
  titulo: string;
  vence: string | null;
}

export interface RespuestaAgenda {
  permisos: { calendario: string; recordatorios: string };
  eventos: Evento[];
  recordatorios: Recordatorio[];
}

export interface Aviso {
  id: string;
  titulo: string;
  vence: string;
}

interface Opciones {
  emparejamiento: () => Emparejamiento | null;
  alNoAutorizado: () => void;
  /** Lee en voz alta (app nativa o navegador). */
  hablar: (texto: string) => void;
  /** Despierta el panel si está en modo noche. */
  despertar: () => void;
}

const formatoHora = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

const CLAVE_DESCARTADOS = 'asistente.avisosDescartados';
const CLAVE_PENDIENTES = 'asistente.completarPendientes';
const VENTANA_AVISO_MS = 15 * 60_000;

function leerJson<T>(clave: string, vacio: T): T {
  try {
    return (JSON.parse(localStorage.getItem(clave) ?? 'null') as T | null) ?? vacio;
  } catch {
    return vacio;
  }
}

function guardarJson(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Recordatorios con hora que acaban de vencer según lo guardado en la tablet. Sirven cuando la Mac no
 * avisa (apagada) y no se repiten si ya se cerraron aquí. Exportado para tests.
 */
export function avisosVencidos(recordatorios: Recordatorio[], descartados: Record<string, number>, ahora: number): Aviso[] {
  return recordatorios
    .filter((r): r is Recordatorio & { vence: string } => !!r.vence && descartados[r.id] === undefined)
    .filter((r) => {
      const t = Date.parse(r.vence);
      return Number.isFinite(t) && t <= ahora && t > ahora - VENTANA_AVISO_MS;
    })
    .map((r) => ({ id: r.id, titulo: r.titulo, vence: r.vence }));
}

/** Une los avisos de la Mac con los de la tablet sin repetir ninguno. */
export function combinarAvisos(...listas: Aviso[][]): Aviso[] {
  const vistos = new Set<string>();
  return listas.flat().filter((a) => !vistos.has(a.id) && !!vistos.add(a.id));
}

function mismoDia(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Agrupa eventos en Hoy / Mañana; exportado para tests. */
export function agruparEventos(eventos: Evento[], ahora: Date): { hoy: Evento[]; manana: Evento[] } {
  const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  return {
    hoy: eventos.filter((e) => mismoDia(new Date(e.inicio), ahora)),
    manana: eventos.filter((e) => mismoDia(new Date(e.inicio), manana)),
  };
}

export function iniciarAgenda({ emparejamiento, alNoAutorizado, hablar, despertar }: Opciones) {
  const $ = (id: string) => document.getElementById(id)!;
  const tarjeta = $('tarjeta-agenda');
  const contenedor = $('agenda');
  const tarjetaRecordatorios = document.getElementById('tarjeta-recordatorios');
  const contenedorRecordatorios = document.getElementById('agenda-recordatorios');
  const cuentaRecordatorios = document.getElementById('recordatorios-cuenta');
  const aviso = $('aviso-recordatorio');
  let temporizador: number | undefined;
  let avisoActual: Aviso | null = null;
  const anunciados = new Set<string>();

  function lista(
    destino: HTMLElement,
    titulo: string | null,
    items: { hora: string; texto: string; clase?: string }[],
  ) {
    if (titulo) {
      const h = document.createElement('h3');
      h.textContent = titulo;
      destino.appendChild(h);
    }
    const ul = document.createElement('ul');
    for (const it of items) {
      const li = document.createElement('li');
      if (it.clase) li.className = it.clase;
      const t = document.createElement('time');
      t.textContent = it.hora;
      const span = document.createElement('span');
      span.textContent = it.texto;
      li.append(t, span);
      ul.appendChild(li);
    }
    destino.appendChild(ul);
  }

  function pintarPermiso(permisos: RespuestaAgenda['permisos']) {
    const caja = document.createElement('div');
    caja.className = 'permiso';
    const p = document.createElement('p');
    p.className = 'tenue';
    p.textContent =
      permisos.calendario === 'denegado' || permisos.recordatorios === 'denegado'
        ? 'macOS negó el acceso. Actívalo en la Mac: Ajustes del Sistema › Privacidad y seguridad › Calendarios y Recordatorios › «Agenda del asistente».'
        : 'Falta dar permiso en la Mac para leer el calendario y los recordatorios.';
    const b = document.createElement('button');
    b.className = 'boton';
    b.type = 'button';
    b.textContent = 'Pedir permiso en la Mac';
    b.addEventListener('click', async () => {
      const e = emparejamiento();
      if (!e) return;
      b.disabled = true;
      b.textContent = 'Acepta el aviso en la pantalla de la Mac…';
      try {
        await llamar(e, '/agenda/permisos', {});
      } catch {
        /* se refleja al recargar */
      }
      void cargar();
    });
    caja.append(p, b);
    contenedor.appendChild(caja);
  }

  /** «Sin conexión con la Mac · datos de hace 2 h», cuando lo que se ve viene de la memoria de la tablet. */
  function notaDeCache(destino: HTMLElement, desde: number | null) {
    if (desde === null) return;
    const p = document.createElement('p');
    p.className = 'nota-cache';
    p.textContent = `Sin conexión con la Mac · datos de ${hace(desde)}`;
    destino.appendChild(p);
  }

  function pintar(r: RespuestaAgenda, desde: number | null = null) {
    contenedor.textContent = '';
    notaDeCache(contenedor, desde);
    const ahora = new Date();
    if (r.permisos.calendario !== 'concedido' || r.permisos.recordatorios !== 'concedido') pintarPermiso(r.permisos);

    if (r.permisos.calendario === 'concedido') {
      const { hoy, manana } = agruparEventos(r.eventos, ahora);
      const fila = (e: Evento) => ({ hora: e.todoElDia ? 'Todo' : formatoHora.format(new Date(e.inicio)), texto: e.titulo });
      lista(contenedor, 'Hoy', hoy.length ? hoy.map(fila) : [{ hora: '', texto: 'Nada en el calendario', clase: 'vacio' }]);
      if (manana.length) lista(contenedor, 'Mañana', manana.map(fila));
    }

    if (tarjetaRecordatorios && contenedorRecordatorios) {
      const permitido = r.permisos.recordatorios === 'concedido';
      tarjetaRecordatorios.hidden = !permitido;
      contenedorRecordatorios.textContent = '';
      notaDeCache(contenedorRecordatorios, desde);
      if (cuentaRecordatorios) cuentaRecordatorios.textContent = String(r.recordatorios.length);
      if (permitido) {
        lista(
          contenedorRecordatorios,
          null,
          r.recordatorios.length
            ? r.recordatorios.map((x) => {
                const vence = x.vence ? new Date(x.vence) : null;
                return {
                  hora: vence ? (mismoDia(vence, ahora) ? formatoHora.format(vence) : `${vence.getDate()}/${vence.getMonth() + 1}`) : '',
                  texto: x.titulo,
                  clase: vence && vence < ahora ? 'vencido' : undefined,
                };
              })
            : [{ hora: '', texto: 'Todo al día', clase: 'vacio' }],
        );
      }
    }
  }

  async function cargar() {
    clearTimeout(temporizador);
    const e = emparejamiento();
    if (!e || tarjeta.hidden) return;
    let reintentoMs = 5 * 60_000;
    try {
      const r = await llamar<RespuestaAgenda>(e, '/agenda');
      guardarCache(CLAVES.agenda, r);
      pintar(r);
      void completarPendientes(e);
      comprobarAvisos();
    } catch (err) {
      if (err instanceof ErrorNoAutorizado) return alNoAutorizado();
      // La Mac no responde: se muestra lo último que se supo, y se reintenta pronto.
      const guardado = leerCache<RespuestaAgenda>(CLAVES.agenda);
      if (guardado) pintar(guardado.valor, guardado.en);
      else if (!contenedor.querySelector('ul')) contenedor.innerHTML = '<p class="tenue">No se pudo leer la agenda.</p>';
      reintentoMs = 60_000;
    }
    temporizador = window.setTimeout(cargar, reintentoMs);
  }

  /** «Hecho» pulsado con la Mac apagada: se avisa a la Mac en cuanto responde. */
  async function completarPendientes(e: Emparejamiento) {
    const pendientes = leerJson<string[]>(CLAVE_PENDIENTES, []);
    if (!pendientes.length) return;
    const quedan: string[] = [];
    for (const id of pendientes) {
      try {
        await llamar(e, `/avisos/${encodeURIComponent(id)}/descartar`, { completar: true });
      } catch (err) {
        if (err instanceof ErrorNoAutorizado) throw err;
        quedan.push(id);
      }
    }
    guardarJson(CLAVE_PENDIENTES, quedan);
  }

  // ---------- Avisos de recordatorios ----------
  async function cerrarAviso(completar: boolean) {
    const a = avisoActual;
    aviso.hidden = true;
    avisoActual = null;
    if (!a) return;
    // Pase lo que pase con la Mac, este aviso ya no vuelve a salir aquí.
    const ahora = Date.now();
    const descartados = Object.fromEntries(Object.entries(leerJson<Record<string, number>>(CLAVE_DESCARTADOS, {})).filter(([, t]) => ahora - t < 24 * 3600_000));
    descartados[a.id] = ahora;
    guardarJson(CLAVE_DESCARTADOS, descartados);
    avisosMac = avisosMac.filter((x) => x.id !== a.id);

    const e = emparejamiento();
    if (!e) return;
    try {
      await llamar(e, `/avisos/${encodeURIComponent(a.id)}/descartar`, { completar });
    } catch (err) {
      if (err instanceof ErrorNoAutorizado) return alNoAutorizado();
      // Sin la Mac no se puede marcar como hecho: queda pendiente para cuando responda.
      if (completar) guardarJson(CLAVE_PENDIENTES, [...new Set([...leerJson<string[]>(CLAVE_PENDIENTES, []), a.id])]);
    }
    void cargar();
  }
  $('recordatorio-hecho').addEventListener('click', () => void cerrarAviso(true));
  $('recordatorio-ok').addEventListener('click', () => void cerrarAviso(false));

  /** Avisos que manda la Mac (en el estado). */
  let avisosMac: Aviso[] = [];

  function mostrarAvisos(avisos: Aviso[] | undefined) {
    avisosMac = avisos ?? [];
    comprobarAvisos();
  }

  /** Mezcla los avisos de la Mac con los que la tablet detecta sola; se llama también cada minuto. */
  function comprobarAvisos() {
    const guardado = leerCache<RespuestaAgenda>(CLAVES.agenda);
    const propios = guardado ? avisosVencidos(guardado.valor.recordatorios, leerJson<Record<string, number>>(CLAVE_DESCARTADOS, {}), Date.now()) : [];
    const siguiente = combinarAvisos(avisosMac, propios)[0];
    if (!siguiente) {
      aviso.hidden = true;
      avisoActual = null;
      return;
    }
    if (avisoActual?.id === siguiente.id) return;
    avisoActual = siguiente;
    $('recordatorio-titulo').textContent = siguiente.titulo;
    aviso.hidden = false;
    despertar();
    if (!anunciados.has(siguiente.id)) {
      anunciados.add(siguiente.id);
      hablar(`Recordatorio: ${siguiente.titulo}`);
    }
  }

  return {
    activar(disponible: boolean) {
      tarjeta.hidden = !disponible;
      if (disponible) void cargar();
    },
    recargar: () => void cargar(),
    mostrarAvisos,
    comprobarAvisos,
  };
}
