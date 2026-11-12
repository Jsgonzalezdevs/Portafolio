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
import { bytes, duracion, esDeNoche, porcentaje } from './formato';

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

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let emparejamiento: Emparejamiento | null = null;
let cerrarFlujo: (() => void) | null = null;
let ultimoVolumen: EstadoMac['volumen'] = null;
let tocandoVolumen = false;

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

// ---------- Mantener la pantalla encendida (si el navegador lo permite) ----------
type WakeLock = { request: (t: 'screen') => Promise<unknown> };
async function mantenerPantalla() {
  const wl = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  try {
    await wl?.request('screen');
  } catch {
    /* sin permiso o sin soporte: la app nativa lo resolverá en F4 */
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
  $('bateria').textContent = e.bateria
    ? `${e.bateria.porcentaje}%${e.bateria.cargando ? ' · cargando' : e.bateria.conectada ? ' · enchufada' : ''}`
    : 'Corriente';
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

function pintarBotones(contenedor: string, accionId: string, items: { id: string; nombre: string }[]) {
  if (!items.length) return;
  const el = $(contenedor);
  el.textContent = '';
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'boton';
    b.dataset.accion = accionId;
    b.dataset.id = item.id;
    b.textContent = item.nombre;
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
