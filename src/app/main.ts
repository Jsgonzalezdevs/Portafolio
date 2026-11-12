import './app.css';
import {
  abrirFlujo,
  cargarEmparejamiento,
  emparejamientoDesdeHash,
  ErrorNoAutorizado,
  guardarEmparejamiento,
  llamar,
  normalizarAgente,
  type Emparejamiento,
  type EstadoConexion,
} from './conexion';
import { iniciarAgenda, type Aviso } from './agenda';
import { iniciarChat, puenteNativo } from './chat';
import { bytes, duracion, esDeNoche, formatoTiempoTimer, porcentaje, saludoSegunHora } from './formato';

interface Reproductor {
  app: 'spotify' | 'music';
  estado: 'playing' | 'paused' | 'stopped';
  cancion: string;
  artista: string;
  caratula: string | null;
}

interface Clima {
  ciudad: string;
  tempC: number;
  condicion: string;
  icono: string;
}

/** Lo que manda el mac-agent en /estado y en los eventos `estado`. */
interface EstadoMac {
  nombre: string;
  sistema: string;
  uptimeSeg: number;
  cpuPct: number;
  carga1m: number;
  nucleos: number;
  memoria: { usadaBytes: number; totalBytes: number };
  disco: { libreBytes: number; totalBytes: number } | null;
  bateria: { porcentaje: number; cargando: boolean; conectada: boolean } | null;
  volumen: { nivel: number; silenciado: boolean } | null;
  reproductor?: Reproductor | null;
  clima?: Clima | null;
  /** Recordatorios que acaban de vencer. */
  avisos?: Aviso[];
}

interface Catalogo {
  chat?: boolean;
  agenda?: boolean;
  escenas: { id: string; nombre: string }[];
  apps: { id: string; nombre: string }[];
}

export interface Alarma {
  id: string;
  hora: string;
  dias: number[];
  titulo: string;
  activa: boolean;
}

interface ResumenMac {
  clima?: Clima | null;
  eventosHoy?: { titulo: string; inicio: string; todoElDia?: boolean }[];
  recordatoriosPendientes?: { id: string; titulo: string; vence: string | null }[];
  alarmasHoy?: Alarma[];
  saludo?: string;
  hora?: string;
}

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

let emparejamiento: Emparejamiento | null = null;
let cerrarFlujo: (() => void) | null = null;
let ultimoVolumen: EstadoMac['volumen'] = null;
let tocandoVolumen = false;
let ultimoEstadoMac: EstadoMac | null = null;
let ultimoResumen: ResumenMac | null = null;
let alarmasCache: Alarma[] = [];

// ---------- Fondo dinámico ----------
let temporizadorFondo: number | undefined;
let urlFondoActual: string | null = null;

async function cargarFondo(e: Emparejamiento) {
  try {
    const resp = await fetch(`${e.agente}/fondo`, {
      headers: { Authorization: `Bearer ${e.token}` },
      cache: 'no-store',
    });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const nuevaUrl = URL.createObjectURL(blob);
    const fondoEl = $('fondo-mac');
    if (fondoEl) {
      fondoEl.style.backgroundImage = `url("${nuevaUrl}")`;
    }
    if (urlFondoActual) {
      URL.revokeObjectURL(urlFondoActual);
    }
    urlFondoActual = nuevaUrl;
  } catch {
    // Si falla o la Mac está apagada, se conserva el fondo predeterminado
  }
}

// ---------- Avisos ----------
let temporizadorAviso: number | undefined;
function avisar(texto: string, error = false) {
  const el = $('aviso');
  el.textContent = texto;
  el.className = error ? 'aviso error-aviso' : 'aviso';
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = window.setTimeout(() => (el.hidden = true), 3500);
}

// ---------- Reloj y modo noche ----------
const formatoHora = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const formatoFecha = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
let nocheManual: boolean | null = null; // null = automático según la hora
let despiertoHasta = 0;

function pintarReloj() {
  const ahora = new Date();
  const hora = formatoHora.format(ahora);
  $('hora').textContent = hora;
  $('noche-hora').textContent = hora;
  const fecha = formatoFecha.format(ahora);
  $('fecha').textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
  const noche = (nocheManual ?? esDeNoche(ahora)) && Date.now() > despiertoHasta;
  $('noche').hidden = !noche || !emparejamiento;

  actualizarAhora();

  // Alineado al cambio de minuto: un tic por minuto en vez de uno por segundo.
  window.setTimeout(pintarReloj, 60_000 - (Date.now() % 60_000) + 50);
}

$('boton-noche').addEventListener('click', () => {
  nocheManual = true;
  despiertoHasta = 0;
  $('noche').hidden = false;
});
$('noche').addEventListener('click', () => {
  // Tocar en modo noche despierta el panel un minuto; si era manual, lo apaga.
  if (nocheManual) nocheManual = null;
  despiertoHasta = Date.now() + 60_000;
  $('noche').hidden = true;
  window.setTimeout(() => {
    if (Date.now() >= despiertoHasta && esDeNoche(new Date())) $('noche').hidden = !emparejamiento;
  }, 60_500);
});

// ---------- Tarjeta Ahora ----------
function actualizarAhora() {
  const ahora = new Date();
  const h = ahora.getHours();
  const tarjetaAhora = $('tarjeta-ahora');
  if (!tarjetaAhora) return;

  // De noche (22:00 a 6:00), ocultar la tarjeta
  if (h >= 22 || h < 6) {
    tarjetaAhora.hidden = true;
    return;
  }
  tarjetaAhora.hidden = false;

  const { saludo, icono, periodo } = saludoSegunHora(ahora);
  const elSaludo = $('ahora-saludo');
  const elIcono = $('ahora-icono');
  if (elSaludo) elSaludo.textContent = saludo;
  if (elIcono) elIcono.textContent = icono;

  const clima = ultimoResumen?.clima ?? ultimoEstadoMac?.clima;
  const textoClima = clima ? `${clima.tempC > 0 ? '+' : ''}${clima.tempC}° en ${clima.ciudad} (${clima.condicion.toLowerCase()})` : '';

  let mensajeResumen = '';
  if (periodo === 'manana') {
    // Mañana (6-12): "Buenos días, Julian 🌅" + weather summary + today's event count from agenda + first alarm
    const eventos = ultimoResumen?.eventosHoy ?? [];
    const nEventos = eventos.length;
    const primeraAlarma = alarmasCache.find((a) => a.activa);
    const partes: string[] = [];
    if (textoClima) partes.push(textoClima);
    partes.push(nEventos === 0 ? 'Sin eventos hoy' : `${nEventos} evento${nEventos > 1 ? 's' : ''} hoy`);
    if (primeraAlarma) partes.push(`Alarma a las ${primeraAlarma.hora}`);
    mensajeResumen = partes.join(' · ');
  } else if (periodo === 'tarde') {
    // Tarde (12-18): "Buenas tardes ☀️" + next upcoming event or "Nada pendiente"
    const eventos = ultimoResumen?.eventosHoy ?? [];
    const proximo = eventos.find((ev) => !ev.todoElDia && new Date(ev.inicio) >= ahora);
    if (proximo) {
      const horaEv = formatoHora.format(new Date(proximo.inicio));
      mensajeResumen = `${proximo.titulo} a las ${horaEv}${textoClima ? ` · ${textoClima}` : ''}`;
    } else {
      mensajeResumen = `Nada pendiente por hoy${textoClima ? ` · ${textoClima}` : ''}`;
    }
  } else if (periodo === 'noche') {
    // Noche (18-22): "Buenas noches 🌙" + summary of tomorrow
    mensajeResumen = `Prepárate para descansar${textoClima ? ` · ${textoClima}` : ''}`;
  }

  const elResumen = $('ahora-resumen');
  if (elResumen) elResumen.textContent = mensajeResumen || 'Todo en orden.';
}

let temporizadorResumen: number | undefined;
async function cargarResumen(e: Emparejamiento) {
  try {
    ultimoResumen = await llamar<ResumenMac>(e, '/resumen');
    if (ultimoResumen?.alarmasHoy && !alarmasCache.length) {
      pintarAlarmas(ultimoResumen.alarmasHoy);
    }
  } catch {
    // Continúa con estado local si el endpoint no está disponible
  }
  actualizarAhora();
}

// ---------- Alarmas ----------
async function cargarAlarmas(e: Emparejamiento) {
  try {
    const res = await llamar<{ alarmas: Alarma[] }>(e, '/alarmas');
    pintarAlarmas(res.alarmas ?? []);
  } catch {
    // Si falla la Mac
  }
}

function pintarAlarmas(alarmas: Alarma[]) {
  alarmasCache = alarmas;
  const lista = $('lista-alarmas');
  if (!lista) return;
  lista.textContent = '';
  if (!alarmas.length) {
    const vacio = document.createElement('li');
    vacio.className = 'tenue';
    vacio.textContent = 'Sin alarmas';
    lista.appendChild(vacio);
    actualizarAhora();
    return;
  }

  for (const a of alarmas) {
    const li = document.createElement('li');
    li.className = a.activa ? 'alarma-item' : 'alarma-item inactiva';

    const izq = document.createElement('div');
    izq.className = 'alarma-item__izq';
    const hora = document.createElement('time');
    hora.className = 'alarma-item__hora';
    hora.textContent = a.hora;
    const tit = document.createElement('span');
    tit.className = 'alarma-item__titulo';
    tit.textContent = a.titulo;
    izq.append(hora, tit);

    const acciones = document.createElement('div');
    acciones.className = 'alarma-item__acciones';

    const bToggle = document.createElement('button');
    bToggle.type = 'button';
    bToggle.className = a.activa ? 'boton-toggle activa' : 'boton-toggle';
    bToggle.textContent = a.activa ? 'ACTIVA' : 'INACTIVA';
    bToggle.setAttribute('aria-label', `Alternar alarma ${a.titulo}`);
    bToggle.addEventListener('click', async () => {
      if (!emparejamiento) return;
      bToggle.disabled = true;
      try {
        await llamar(emparejamiento, `/alarmas/${encodeURIComponent(a.id)}/toggle`, {});
        await cargarAlarmas(emparejamiento);
      } catch {
        avisar('No se pudo alternar la alarma', true);
      } finally {
        bToggle.disabled = false;
      }
    });

    const bEliminar = document.createElement('button');
    bEliminar.type = 'button';
    bEliminar.className = 'boton-eliminar-alarma';
    bEliminar.textContent = '×';
    bEliminar.setAttribute('aria-label', `Eliminar alarma ${a.titulo}`);
    bEliminar.addEventListener('click', async () => {
      if (!emparejamiento) return;
      bEliminar.disabled = true;
      try {
        await fetch(`${emparejamiento.agente}/alarmas/${encodeURIComponent(a.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${emparejamiento.token}` },
        });
        avisar('Alarma eliminada');
        await cargarAlarmas(emparejamiento);
      } catch {
        avisar('No se pudo eliminar la alarma', true);
      } finally {
        bEliminar.disabled = false;
      }
    });

    acciones.append(bToggle, bEliminar);
    li.append(izq, acciones);
    lista.appendChild(li);
  }
  actualizarAhora();
}

$('boton-nueva-alarma').addEventListener('click', () => {
  $<HTMLInputElement>('campo-alarma-hora').value = '';
  $<HTMLInputElement>('campo-alarma-titulo').value = '';
  $('modal-alarma').hidden = false;
});

$('alarma-cancelar').addEventListener('click', () => {
  $('modal-alarma').hidden = true;
});

$<HTMLFormElement>('form-alarma').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!emparejamiento) return;
  const hora = $<HTMLInputElement>('campo-alarma-hora').value.trim();
  const titulo = $<HTMLInputElement>('campo-alarma-titulo').value.trim() || 'Alarma';
  if (!hora) return;

  const submitBtn = (ev.target as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    await llamar(emparejamiento, '/alarmas', { hora, titulo });
    $('modal-alarma').hidden = true;
    avisar('Alarma creada');
    await cargarAlarmas(emparejamiento);
  } catch (err) {
    avisar(err instanceof Error ? err.message : 'Error al crear alarma', true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ---------- Temporizador (Frontend) ----------
let timerSegundosRestantes = 0;
let timerSegundosTotales = 0;
let timerIntervalo: number | undefined;

function sonarPitidoTimer() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const inicio = t0 + i * 0.5;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, inicio);
      gain.gain.setValueAtTime(0.3, inicio);
      gain.gain.exponentialRampToValueAtTime(0.001, inicio + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.3);
    }
  } catch {
    /* contexto de audio no disponible */
  }
}

function actualizarTimerUI() {
  const texto = formatoTiempoTimer(timerSegundosRestantes);
  $('timer-cuenta').textContent = texto;
  $('timer-indicador-texto').textContent = texto;
  const arco = $<SVGCircleElement>('timer-arco');
  if (arco && timerSegundosTotales > 0) {
    const circunferencia = 314.16; // 2 * PI * 50
    const fraccion = timerSegundosRestantes / timerSegundosTotales;
    arco.style.strokeDashoffset = String(circunferencia * (1 - fraccion));
  }
}

function iniciarTimer(minutos: number) {
  detenerTimer();
  timerSegundosTotales = Math.max(1, Math.round(minutos * 60));
  timerSegundosRestantes = timerSegundosTotales;
  actualizarTimerUI();
  $('timer-activo-vista').hidden = false;
  $('timer-config-vista').hidden = true;
  $('timer-indicador').hidden = false;

  timerIntervalo = window.setInterval(() => {
    timerSegundosRestantes--;
    if (timerSegundosRestantes <= 0) {
      detenerTimer();
      sonarPitidoTimer();
      avisar('⏱ ¡Temporizador finalizado!');
    } else {
      actualizarTimerUI();
    }
  }, 1000);
}

function detenerTimer() {
  if (timerIntervalo !== undefined) {
    clearInterval(timerIntervalo);
    timerIntervalo = undefined;
  }
  timerSegundosRestantes = 0;
  timerSegundosTotales = 0;
  $('timer-activo-vista').hidden = true;
  $('timer-config-vista').hidden = false;
  $('timer-indicador').hidden = true;
}

$('boton-timer').addEventListener('click', () => {
  $('modal-timer').hidden = false;
});

$('timer-indicador').addEventListener('click', () => {
  $('modal-timer').hidden = false;
});

$('timer-cerrar').addEventListener('click', () => {
  $('modal-timer').hidden = true;
});

$('timer-cerrar-activo').addEventListener('click', () => {
  $('modal-timer').hidden = true;
});

$('timer-cancelar').addEventListener('click', () => {
  detenerTimer();
});

document.querySelectorAll<HTMLButtonElement>('.boton--preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mins = Number(btn.dataset.minutos);
    if (mins > 0) {
      iniciarTimer(mins);
    }
  });
});

$<HTMLFormElement>('form-timer-personalizado').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $<HTMLInputElement>('timer-custom-min');
  const mins = Number(input.value);
  if (mins > 0) {
    iniciarTimer(mins);
    input.value = '';
  }
});

// ---------- Mantener la pantalla encendida (si el navegador lo permite) ----------
type WakeLock = { request: (t: 'screen') => Promise<unknown> };
async function mantenerPantalla() {
  const wl = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  try {
    await wl?.request('screen');
  } catch {
    /* sin permiso o sin soporte: la app nativa lo resolverá */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void mantenerPantalla();
});

// ---------- Estado de la Mac ----------
function medidor(barra: string, valor: string, pct: number, texto: string) {
  const b = $(barra);
  b.style.width = `${pct}%`;
  b.className = pct >= 90 ? 'critico' : pct >= 75 ? 'alto' : '';
  $(valor).textContent = texto;
}

function pintarEstado(e: EstadoMac) {
  ultimoEstadoMac = e;
  $('mac-nombre').textContent = e.nombre;
  $('mac-sistema').textContent = e.sistema;
  const cpu = Math.round(e.cpuPct);
  medidor('cpu-barra', 'cpu-valor', cpu, `${cpu}%`);
  const ram = porcentaje(e.memoria.usadaBytes, e.memoria.totalBytes);
  medidor('ram-barra', 'ram-valor', ram, bytes(e.memoria.usadaBytes));
  if (e.disco) {
    const usado = porcentaje(e.disco.totalBytes - e.disco.libreBytes, e.disco.totalBytes);
    medidor('disco-barra', 'disco-valor', usado, `${usado}%`);
  }

  // Anillo de batería SVG
  const bateriaArco = $<SVGCircleElement>('bateria-arco');
  const bateriaValor = $<SVGTextElement>('bateria-valor');
  const bateriaIcono = $<SVGTextElement>('bateria-icono');
  const elBateriaLegacy = document.getElementById('bateria');
  const circunferencia = 163.36; // 2 * PI * 26

  if (e.bateria) {
    const pct = Math.max(0, Math.min(100, Math.round(e.bateria.porcentaje)));
    const offset = circunferencia * (1 - pct / 100);
    if (bateriaArco) {
      bateriaArco.style.strokeDashoffset = String(offset);
      bateriaArco.style.stroke = pct > 50 ? '#3ecf8e' : pct >= 20 ? '#f5b544' : '#ff6b6b';
    }
    if (bateriaValor) bateriaValor.textContent = `${pct}%`;
    const cargando = Boolean(e.bateria.cargando || e.bateria.conectada);
    if (bateriaIcono) bateriaIcono.style.display = cargando ? 'inline' : 'none';
    if (bateriaValor) bateriaValor.setAttribute('y', cargando ? '42' : '37');
    if (elBateriaLegacy) {
      elBateriaLegacy.textContent = `${pct}%${e.bateria.cargando ? ' · cargando' : e.bateria.conectada ? ' · enchufada' : ''}`;
    }
  } else {
    if (bateriaArco) {
      bateriaArco.style.strokeDashoffset = '0';
      bateriaArco.style.stroke = '#3ecf8e';
    }
    if (bateriaValor) {
      bateriaValor.textContent = '100%';
      bateriaValor.setAttribute('y', '42');
    }
    if (bateriaIcono) bateriaIcono.style.display = 'inline';
    if (elBateriaLegacy) elBateriaLegacy.textContent = 'Corriente';
  }

  $('uptime').textContent = duracion(e.uptimeSeg);
  $('carga').textContent = `${e.carga1m.toFixed(1)} / ${e.nucleos}`;

  // Clima junto al reloj
  if (e.clima) {
    $('clima').hidden = false;
    $('clima-icono').textContent = e.clima.icono;
    $('clima-temp').textContent = `${e.clima.tempC > 0 ? '+' : ''}${e.clima.tempC}°`;
    $('clima-ciudad').textContent = e.clima.ciudad;
    $('clima').title = e.clima.condicion;
  } else {
    $('clima').hidden = true;
  }

  // Reproductor multimedia en la tarjeta de control
  const rep = e.reproductor;
  const activo = $('media-activo');
  const reposo = $('media-reposo');
  const badge = $('media-badge');
  const iconoPlayPause = $('icono-playpause');
  if (rep && (rep.estado === 'playing' || rep.estado === 'paused')) {
    activo.hidden = false;
    reposo.hidden = true;
    badge.hidden = false;
    badge.textContent = rep.app === 'spotify' ? 'Spotify' : 'Música';
    $('media-titulo').textContent = rep.cancion;
    $('media-artista').textContent = rep.artista;
    const caratula = $<HTMLImageElement>('media-caratula');
    if (rep.caratula) {
      if (caratula.src !== rep.caratula) caratula.src = rep.caratula;
      caratula.hidden = false;
    } else {
      caratula.hidden = true;
    }
    iconoPlayPause.innerHTML =
      rep.estado === 'playing'
        ? '<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
        : '<path fill="currentColor" d="M8 5v14l11-7z"/>';
    $('boton-playpause').setAttribute('aria-label', rep.estado === 'playing' ? 'Pausar' : 'Reproducir');
  } else {
    activo.hidden = true;
    reposo.hidden = false;
    badge.hidden = true;
    iconoPlayPause.innerHTML = '<path fill="currentColor" d="M8 5v14l11-7z"/>';
    $('boton-playpause').setAttribute('aria-label', 'Reproducir o pausar');
  }

  agendaUI.mostrarAvisos(e.avisos);
  actualizarAhora();

  ultimoVolumen = e.volumen;
  const rango = $<HTMLInputElement>('volumen');
  rango.disabled = !e.volumen;
  if (e.volumen && !tocandoVolumen) {
    rango.value = String(e.volumen.nivel);
    $('volumen-valor').textContent = String(e.volumen.nivel);
    $('icono-vol').hidden = e.volumen.silenciado;
    $('icono-mute').hidden = !e.volumen.silenciado;
  }
}

const TEXTO_CONEXION: Record<EstadoConexion, string> = {
  conectando: 'Conectando…',
  'en-linea': 'Mac en línea',
  'sin-conexion': 'Mac sin conexión',
};
function pintarConexion(c: EstadoConexion) {
  const el = $('conexion');
  if (el.dataset.estado === c) return;
  el.dataset.estado = c;
  el.textContent = TEXTO_CONEXION[c];
}

// ---------- Acciones ----------
async function accion(id: string, params: Record<string, unknown> = {}, boton?: HTMLButtonElement) {
  if (!emparejamiento) return;
  if (boton) boton.disabled = true;
  try {
    const r = await llamar<{ mensaje: string }>(emparejamiento, `/acciones/${id}`, params);
    avisar(r.mensaje);
  } catch (e) {
    if (e instanceof ErrorNoAutorizado) return desemparejar('El token ya no es válido. Vuelve a emparejar.');
    avisar(e instanceof TypeError ? 'No se pudo contactar a la Mac' : (e as Error).message, true);
  } finally {
    if (boton) boton.disabled = false;
  }
}

document.addEventListener('click', (ev) => {
  const boton = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-accion]');
  if (!boton) return;
  const params = boton.dataset.id ? { id: boton.dataset.id } : {};
  void accion(boton.dataset.accion!, params, boton);
});

const rango = $<HTMLInputElement>('volumen');
rango.addEventListener('input', () => {
  tocandoVolumen = true;
  $('volumen-valor').textContent = rango.value;
});
rango.addEventListener('change', async () => {
  await accion('volumen.fijar', { nivel: Number(rango.value) });
  tocandoVolumen = false;
});
$('boton-mute').addEventListener('click', () => {
  void accion('volumen.silenciar', { silenciar: !ultimoVolumen?.silenciado });
});

// ---------- Escenas e Íconos ----------
const ICONOS_ESCENAS: Record<string, string> = {
  trabajo: '💼',
  'buenas-noches': '🌙',
  cine: '🎬',
};

function iconoParaEscena(id: string): string {
  return ICONOS_ESCENAS[id] ?? '⚡';
}

function pintarBotones(contenedor: string, accionId: string, items: { id: string; nombre: string }[]) {
  if (!items.length) return;
  const el = $(contenedor);
  el.textContent = '';
  const esEscenas = contenedor === 'escenas';

  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.accion = accionId;
    b.dataset.id = item.id;

    if (esEscenas) {
      b.className = 'boton boton--escena';
      const icono = document.createElement('span');
      icono.className = 'escena-icono';
      icono.textContent = iconoParaEscena(item.id);
      const nombre = document.createElement('span');
      nombre.className = 'escena-nombre';
      nombre.textContent = item.nombre;
      b.append(icono, nombre);
    } else {
      b.className = 'boton';
      b.textContent = item.nombre;
    }
    el.appendChild(b);
  }
}

// ---------- Emparejamiento ----------
function mostrarEmparejar(error = '') {
  $('pantalla-panel').hidden = true;
  $('noche').hidden = true;
  $('pantalla-emparejar').hidden = false;
  $('error-emparejar').textContent = error;
}

function desemparejar(error = '') {
  cerrarFlujo?.();
  cerrarFlujo = null;
  emparejamiento = null;
  guardarEmparejamiento(null);
  clearInterval(temporizadorFondo);
  temporizadorFondo = undefined;
  clearInterval(temporizadorResumen);
  temporizadorResumen = undefined;
  if (urlFondoActual) {
    URL.revokeObjectURL(urlFondoActual);
    urlFondoActual = null;
  }
  const fondoEl = $('fondo-mac');
  if (fondoEl) fondoEl.style.backgroundImage = '';
  detenerTimer();
  mostrarEmparejar(error);
}

async function iniciar(e: Emparejamiento) {
  const catalogo = await llamar<Catalogo>(e, '/catalogo');
  emparejamiento = e;
  guardarEmparejamiento(e);
  pintarBotones('escenas', 'escena.ejecutar', catalogo.escenas);
  pintarBotones('apps', 'app.abrir', catalogo.apps);
  $('tarjeta-chat').hidden = !catalogo.chat;
  agendaUI.activar(Boolean(catalogo.agenda));
  $('pantalla-panel').classList.toggle('panel--sin-chat', !catalogo.chat);
  $('pantalla-emparejar').hidden = true;
  $('pantalla-panel').hidden = false;
  void mantenerPantalla();

  // Fondo dinámico
  void cargarFondo(e);
  clearInterval(temporizadorFondo);
  temporizadorFondo = window.setInterval(() => void cargarFondo(e), 120_000);

  // Resumen y Alarmas
  void cargarResumen(e);
  void cargarAlarmas(e);
  clearInterval(temporizadorResumen);
  temporizadorResumen = window.setInterval(() => {
    if (emparejamiento) {
      void cargarResumen(emparejamiento);
      void cargarAlarmas(emparejamiento);
    }
  }, 60_000);

  cerrarFlujo?.();
  cerrarFlujo = abrirFlujo(e, {
    alEvento: (ev) => {
      if (ev.evento === 'estado') pintarEstado(JSON.parse(ev.datos) as EstadoMac);
    },
    alCambioConexion: pintarConexion,
    alNoAutorizado: () => desemparejar('El token ya no es válido. Vuelve a emparejar.'),
  });
}

$<HTMLFormElement>('form-emparejar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = (ev.target as HTMLFormElement).querySelector('button')!;
  boton.disabled = true;
  $('error-emparejar').textContent = '';
  try {
    await iniciar({
      agente: normalizarAgente($<HTMLInputElement>('campo-agente').value),
      token: $<HTMLInputElement>('campo-token').value.trim(),
    });
  } catch (e) {
    $('error-emparejar').textContent =
      e instanceof ErrorNoAutorizado ? 'Token incorrecto.' : 'No se pudo conectar. ¿Está corriendo el agente y el túnel?';
  } finally {
    boton.disabled = false;
  }
});

// Desemparejar: protegido con pulsación larga de 2 segundos + modal de confirmación
let temporizadorAjustes: number | undefined;
const botonAjustes = $('boton-ajustes');
const modalDesemparejar = $('modal-desemparejar');

const cancelarPresionAjustes = () => {
  if (temporizadorAjustes !== undefined) {
    clearTimeout(temporizadorAjustes);
    temporizadorAjustes = undefined;
    botonAjustes.classList.remove('presionado');
  }
};

botonAjustes.addEventListener('pointerdown', () => {
  cancelarPresionAjustes();
  botonAjustes.classList.add('presionado');
  temporizadorAjustes = window.setTimeout(() => {
    temporizadorAjustes = undefined;
    botonAjustes.classList.remove('presionado');
    modalDesemparejar.hidden = false;
  }, 2000);
});

botonAjustes.addEventListener('pointerup', () => {
  if (temporizadorAjustes !== undefined) {
    cancelarPresionAjustes();
    avisar('Mantén presionado 2 segundos para desemparejar');
  }
});
botonAjustes.addEventListener('pointercancel', cancelarPresionAjustes);
botonAjustes.addEventListener('pointerleave', cancelarPresionAjustes);

$('desemparejar-cancelar').addEventListener('click', () => {
  modalDesemparejar.hidden = true;
});

$('desemparejar-confirmar').addEventListener('click', () => {
  modalDesemparejar.hidden = true;
  desemparejar();
});

// En la app Android: botón de ajustes de voz, y la palabra clave despierta el modo noche.
const nativo = puenteNativo();
if (nativo) {
  $('boton-voz').hidden = false;
  $('boton-voz').addEventListener('click', () => nativo.ajustes());
  window.addEventListener('asistente-nativo', (ev) => {
    const tipo = (ev as CustomEvent<{ tipo: string }>).detail.tipo;
    if (tipo === 'palabra' || tipo === 'escuchando') {
      despiertoHasta = Date.now() + 60_000;
      $('noche').hidden = true;
    }
  });
}

const agendaUI = iniciarAgenda({
  emparejamiento: () => emparejamiento,
  alNoAutorizado: () => desemparejar('El token ya no es válido. Vuelve a emparejar.'),
  hablar: (texto) => {
    if (nativo) return nativo.hablar(texto, false);
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-CO';
    window.speechSynthesis?.speak(u);
  },
  despertar: () => {
    despiertoHasta = Date.now() + 60_000;
    $('noche').hidden = true;
  },
});

iniciarChat({
  // Si Claude tocó la agenda, la tarjeta se actualiza al momento.
  alAcciones: (acciones) => {
    if (acciones.some((a) => a.herramienta.startsWith('agenda.'))) agendaUI.recargar();
  },
  emparejamiento: () => emparejamiento,
  alNoAutorizado: () => desemparejar('El token ya no es válido. Vuelve a emparejar.'),
});

// ---------- Arranque ----------
async function arrancar() {
  pintarReloj();
  const desdeHash = emparejamientoDesdeHash(location.hash);
  if (desdeHash) history.replaceState(null, '', location.pathname); // el token no se queda en la barra ni en el historial
  const guardado = desdeHash ?? cargarEmparejamiento();
  if (!guardado) return mostrarEmparejar();
  try {
    await iniciar(guardado);
  } catch (e) {
    if (e instanceof ErrorNoAutorizado) return desemparejar('El token ya no es válido. Vuelve a emparejar.');
    // La Mac puede estar apagada al encender la tablet: se muestra el panel y el flujo reintenta solo.
    emparejamiento = guardado;
    guardarEmparejamiento(guardado);
    $('pantalla-panel').classList.add('panel--sin-chat');
    $('pantalla-panel').hidden = false;
    pintarConexion('sin-conexion');
    window.setTimeout(() => void arrancarDeNuevo(guardado), 10_000);
  }
}

async function arrancarDeNuevo(e: Emparejamiento) {
  if (emparejamiento !== e || cerrarFlujo) return;
  try {
    await iniciar(e);
  } catch (err) {
    if (err instanceof ErrorNoAutorizado) return desemparejar('El token ya no es válido. Vuelve a emparejar.');
    window.setTimeout(() => void arrancarDeNuevo(e), 15_000);
  }
}

void arrancar();
