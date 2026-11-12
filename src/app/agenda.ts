import { ErrorNoAutorizado, llamar, type Emparejamiento } from './conexion';

/** Tarjeta de agenda (GET /agenda) y avisos de recordatorios vencidos (llegan en el estado). */

interface Evento {
  titulo: string;
  inicio: string;
  todoElDia: boolean;
}

interface Recordatorio {
  id: string;
  titulo: string;
  vence: string | null;
}

interface RespuestaAgenda {
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

  function pintar(r: RespuestaAgenda) {
    contenedor.textContent = '';
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
    try {
      pintar(await llamar<RespuestaAgenda>(e, '/agenda'));
    } catch (err) {
      if (err instanceof ErrorNoAutorizado) return alNoAutorizado();
      if (!contenedor.querySelector('ul')) contenedor.innerHTML = '<p class="tenue">No se pudo leer la agenda.</p>';
    }
    temporizador = window.setTimeout(cargar, 5 * 60_000);
  }

  // ---------- Avisos de recordatorios ----------
  async function cerrarAviso(completar: boolean) {
    const a = avisoActual;
    aviso.hidden = true;
    avisoActual = null;
    const e = emparejamiento();
    if (!a || !e) return;
    try {
      await llamar(e, `/avisos/${encodeURIComponent(a.id)}/descartar`, { completar });
    } catch {
      /* si falla, el aviso volverá en el siguiente estado */
    }
    void cargar();
  }
  $('recordatorio-hecho').addEventListener('click', () => void cerrarAviso(true));
  $('recordatorio-ok').addEventListener('click', () => void cerrarAviso(false));

  function mostrarAvisos(avisos: Aviso[] | undefined) {
    const siguiente = avisos?.[0];
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
  };
}
