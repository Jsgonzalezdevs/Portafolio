import './app.css';
import {
  abrirFlujo,
  cargarEmparejamiento,
  consultarAgentePublicado,
  emparejamientoDesdeHash,
  ErrorNoAutorizado,
  ErrorSinAgente,
  guardarEmparejamiento,
  llamar,
  normalizarAgente,
  type Emparejamiento,
  type EstadoConexion,
} from './conexion';
import { iniciarAgenda, type Aviso } from './agenda';
import { iniciarChat, puenteNativo } from './chat';
import { aplicarVidrio, iniciarVidrio, limpiarVidrio, pedirAlineacion } from './vidrio';
import { consejoBateria, estadoCarga, leerBateria, seguimientoAlMaximo, type Bateria } from './bienestar';
import { desplazamientoHora, nocheActiva } from './noche';
import { bytes, duracion, formatoTiempoPista, formatoTiempoTimer, porcentaje, saludoSegunHora } from './formato';

export interface PlaylistRapida {
  id: string;
  nombre: string;
  uri: string;
  icono: string;
}

interface Reproductor {
  app: 'spotify' | 'music';
  estado: 'playing' | 'paused' | 'stopped';
  cancion: string;
  artista: string;
  album?: string | null;
  caratula: string | null;
  posicionSeg?: number;
  duracionSeg?: number;
  dispositivoSalida?: string | null;
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
  dispositivoSalida?: string | null;
  clima?: Clima | null;
  /** Recordatorios que acaban de vencer. */
  avisos?: Aviso[];
  /** Alarmas que están sonando este minuto. */
  alarmasActivas?: Alarma[];
  /** Firma del fondo de pantalla de la Mac: cuando cambia, se vuelve a descargar. */
  fondo?: string | null;
}

interface Catalogo {
  chat?: boolean;
  agenda?: boolean;
  escenas: { id: string; nombre: string }[];
  apps: { id: string; nombre: string }[];
  playlistsRapidas?: PlaylistRapida[];
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
let tocandoProgreso = false;
let posicionLocalSeg = 0;
let duracionLocalSeg = 0;
let temporizadorProgreso: number | undefined;

function iniciarTemporizadorProgreso() {
  if (temporizadorProgreso !== undefined) return;
  temporizadorProgreso = window.setInterval(() => {
    // De noche el panel está apagado: no se repinta lo que nadie ve (al despertar llega el estado nuevo).
    if (nocheAplicada) return;
    if (duracionLocalSeg > 0 && posicionLocalSeg < duracionLocalSeg) {
      posicionLocalSeg += 1;
      if (!tocandoProgreso) {
        const slider = $<HTMLInputElement>('media-progreso');
        if (slider) {
          slider.value = String(posicionLocalSeg);
          pintarRango(slider);
        }
        const actualEl = $('media-tiempo-actual');
        if (actualEl) actualEl.textContent = formatoTiempoPista(posicionLocalSeg);
      }
    }
  }, 1000);
}

function detenerTemporizadorProgreso() {
  if (temporizadorProgreso !== undefined) {
    clearInterval(temporizadorProgreso);
    temporizadorProgreso = undefined;
  }
}

// ---------- Fondo de pantalla de la Mac ----------
// El agente entrega el fondo tal como se ve en la Mac y una copia desenfocada para el vidrio
// de los widgets. Se vuelve a bajar solo cuando cambia la firma que viaja en el estado.
let urlFondoActual: string | null = null;
let firmaFondo: string | null = null;
let cargandoFondo = false;

async function cargarFondo(e: Emparejamiento, firma: string | null) {
  if (cargandoFondo) return;
  cargandoFondo = true;
  try {
    const pedir = async (ruta: string) => {
      const r = await fetch(`${e.agente}${ruta}`, { headers: { Authorization: `Bearer ${e.token}` }, cache: 'no-store' });
      return r.ok ? { blob: await r.blob(), firma: r.headers.get('X-Fondo') } : null;
    };
    const entrega = await pedir('/fondo');
    if (!entrega) return;
    const nueva = URL.createObjectURL(entrega.blob);
    $('fondo-mac').style.backgroundImage = `url("${nueva}")`;
    if (urlFondoActual) URL.revokeObjectURL(urlFondoActual);
    urlFondoActual = nueva;
    // La firma de lo que de verdad se entregó (la del estado puede ir un paso por detrás).
    firmaFondo = entrega.firma || firma || '';
    // El vidrio es opcional (agentes viejos no lo tienen): sin él, los widgets quedan con vidrio liso.
    const vidrio = await pedir('/fondo?v=vidrio').catch(() => null);
    if (vidrio) await aplicarVidrio(vidrio.blob).catch(() => limpiarVidrio());
    else limpiarVidrio();
  } catch {
    // Mac apagada o sin red: se conserva el fondo que ya había.
  } finally {
    cargandoFondo = false;
  }
}

function olvidarFondo() {
  if (urlFondoActual) URL.revokeObjectURL(urlFondoActual);
  urlFondoActual = null;
  firmaFondo = null;
  $('fondo-mac').style.backgroundImage = '';
  limpiarVidrio();
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
const formatoBarra = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const diaSemana = new Intl.DateTimeFormat('es-CO', { weekday: 'short' });
let nocheManual: boolean | null = null; // null = automático según la hora
let despiertoHasta = 0;

function pintarReloj() {
  const ahora = new Date();
  const hora = formatoHora.format(ahora);
  $('hora').textContent = hora;
  $('noche-hora').textContent = hora;
  const fecha = formatoFecha.format(ahora);
  $('fecha').textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
  // Barra de menús, como la de macOS: «jue 12 nov  12:34».
  $('menubar-reloj').textContent = `${formatoBarra.format(ahora).replace(/\./g, '')}  ${hora}`;
  // Icono del Dock y encabezado del calendario: día de la semana y número.
  const semana = diaSemana.format(ahora).replace(/\./g, '');
  $('dock-dia-semana').textContent = semana.toUpperCase();
  $('dock-dia').textContent = String(ahora.getDate());
  $('calendario-dia-semana').textContent = semana;
  $('calendario-dia').textContent = String(ahora.getDate());
  aplicarNoche();
  if (nocheAplicada) {
    // Un poco de movimiento cada minuto: un LCD que muestra lo mismo toda la noche puede marcarse.
    const d = desplazamientoHora(ahora);
    $('noche-hora').style.transform = `translate(${d.x}rem, ${d.y}rem)`;
  }

  actualizarAhora();

  // Alineado al cambio de minuto: un tic por minuto en vez de uno por segundo.
  window.setTimeout(pintarReloj, 60_000 - (Date.now() % 60_000) + 50);
}

// ---------- Modo noche ----------
let nocheAplicada = false;
let temporizadorDespertar: number | undefined;
let flujoLento = false;

/**
 * Única función que enciende y apaga el modo noche. De noche: pantalla negra con solo la hora,
 * panel de debajo sin pintar, brillo al mínimo (en la app Android) y consultas a la Mac cada 30 s.
 */
function aplicarNoche() {
  const activa = nocheActiva({ manual: nocheManual, ahora: new Date(), despiertoHasta, emparejado: Boolean(emparejamiento) });
  $('noche').hidden = !activa;
  if (activa === nocheAplicada) return;
  nocheAplicada = activa;
  document.body.classList.toggle('noche-activa', activa);
  puenteNativo()?.brillo?.(activa);
  ritmoEstado(activa);
  if (!activa) pedirAlineacion();
}

/** Despierta el panel unos instantes (toque, palabra clave, alarma, recordatorio) y vuelve solo a la noche. */
function despertarPanel(ms: number) {
  despiertoHasta = Date.now() + ms;
  clearTimeout(temporizadorDespertar);
  temporizadorDespertar = window.setTimeout(aplicarNoche, ms + 100);
  aplicarNoche();
}

$('boton-noche').addEventListener('click', () => {
  nocheManual = true;
  despiertoHasta = 0;
  aplicarNoche();
});
$('noche').addEventListener('click', () => {
  // Tocar en modo noche despierta el panel un minuto; si era manual, lo apaga.
  if (nocheManual) nocheManual = null;
  despertarPanel(60_000);
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
const CIRCUNFERENCIA = 163.36; // 2 · π · 26, el radio de los anillos

const COLOR = { azul: '#0a84ff', verde: '#30d158', naranja: '#ff9f0a', rojo: '#ff453a' };

/** Pinta un anillo de actividad (CPU, memoria, disco, batería). */
function anillo(id: string, pct: number, color: string) {
  const arco = document.querySelector<SVGCircleElement>(`#${id} .anillo__arco`);
  if (!arco) return;
  const limpio = Math.max(0, Math.min(100, pct));
  arco.style.strokeDashoffset = String(CIRCUNFERENCIA * (1 - limpio / 100));
  arco.style.stroke = color;
}

/** Para lo que «cuanto menos mejor»: azul, y naranja/rojo cuando se aprieta. */
const colorCarga = (pct: number) => (pct >= 90 ? COLOR.rojo : pct >= 75 ? COLOR.naranja : COLOR.azul);

/** Parte recorrida de un deslizador (la pinta la hoja de estilos con --p). */
function pintarRango(input: HTMLInputElement) {
  const max = Number(input.max) || 100;
  const min = Number(input.min) || 0;
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--p', `${Math.max(0, Math.min(100, pct))}%`);
}

// Color de ambiente del reproductor: la carátula reducida a 8×8 y ampliada da manchas suaves.
let ambienteDe: string | null = null;
function pintarAmbiente(caratula: string | null) {
  const el = document.getElementById('musica-ambiente');
  if (!el) return;
  if (!caratula) {
    ambienteDe = null;
    el.classList.remove('visible');
    return;
  }
  if (caratula === ambienteDe) return;
  ambienteDe = caratula;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (ambienteDe !== caratula) return;
    try {
      const lienzo = document.createElement('canvas');
      lienzo.width = 8;
      lienzo.height = 8;
      lienzo.getContext('2d')!.drawImage(img, 0, 0, 8, 8);
      el.style.backgroundImage = `url("${lienzo.toDataURL('image/jpeg', 0.8)}")`;
      el.classList.add('visible');
    } catch {
      // Servidor de carátulas sin CORS: queda el vidrio liso.
      el.classList.remove('visible');
    }
  };
  img.onerror = () => el.classList.remove('visible');
  img.src = caratula;
}

const ICONO_PLAY = '<path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/>';
const ICONO_PAUSA = '<path fill="currentColor" d="M7 5h3.6v14H7zm6.4 0H17v14h-3.6z"/>';

function pintarEstado(e: EstadoMac) {
  ultimoEstadoMac = e;
  $('mac-nombre').textContent = e.nombre;
  $('mac-sistema').textContent = e.sistema;

  const cpu = Math.round(e.cpuPct);
  $('cpu-valor').textContent = `${cpu}%`;
  anillo('anillo-cpu', cpu, colorCarga(cpu));

  const ram = porcentaje(e.memoria.usadaBytes, e.memoria.totalBytes);
  $('ram-valor').textContent = `${ram}%`;
  anillo('anillo-ram', ram, colorCarga(ram));
  $('ram-detalle').textContent = `${bytes(e.memoria.usadaBytes)} de ${bytes(e.memoria.totalBytes)}`;

  if (e.disco) {
    const usado = porcentaje(e.disco.totalBytes - e.disco.libreBytes, e.disco.totalBytes);
    $('disco-valor').textContent = `${usado}%`;
    anillo('anillo-disco', usado, colorCarga(usado));
    $('disco-detalle').textContent = bytes(e.disco.libreBytes);
  }

  // Batería: anillo en «Mac y Casa» y pila en la barra de menús (solo si la Mac tiene).
  const menuPila = $('menubar-bateria');
  if (e.bateria) {
    const pct = Math.max(0, Math.min(100, Math.round(e.bateria.porcentaje)));
    const enCarga = Boolean(e.bateria.cargando);
    $('bateria-valor').textContent = `${pct}%`;
    anillo('anillo-bateria', pct, enCarga ? COLOR.verde : pct <= 20 ? COLOR.rojo : pct <= 40 ? COLOR.naranja : COLOR.verde);
    $('bateria').textContent = e.bateria.cargando ? 'Cargando' : e.bateria.conectada ? 'Enchufada' : 'Batería';
    menuPila.hidden = false;
    const nivel = $('menubar-bateria-nivel');
    nivel.style.width = `${pct}%`;
    nivel.className = enCarga ? 'cargando' : pct <= 20 ? 'baja' : '';
    $('menubar-bateria-valor').textContent = `${pct}%`;
  } else {
    $('bateria-valor').textContent = '100%';
    anillo('anillo-bateria', 100, COLOR.verde);
    $('bateria').textContent = 'Corriente';
    menuPila.hidden = true;
  }

  $('uptime').textContent = duracion(e.uptimeSeg);
  $('carga').textContent = `${e.carga1m.toFixed(1)} / ${e.nucleos}`;

  // Clima en la barra de menús
  if (e.clima) {
    $('clima').hidden = false;
    $('clima-icono').textContent = e.clima.icono;
    $('clima-temp').textContent = `${e.clima.tempC > 0 ? '+' : ''}${e.clima.tempC}°`;
    $('clima-ciudad').textContent = e.clima.ciudad;
    $('clima').title = e.clima.condicion;
  } else {
    $('clima').hidden = true;
  }

  // Reproductor
  const rep = e.reproductor;
  const activo = $('media-activo');
  const reposo = $('media-reposo');
  const badge = $('media-badge');
  const badgeDisp = $('media-dispositivo');
  const progresoCaja = $('media-progreso-caja');
  const iconoPlayPause = $('icono-playpause');
  const albumEl = $('media-album');

  const salidaAudio = rep?.dispositivoSalida || e.dispositivoSalida;
  if (salidaAudio) {
    badgeDisp.hidden = false;
    badgeDisp.textContent = salidaAudio;
    badgeDisp.title = `Dispositivo de salida: ${salidaAudio}`;
  } else {
    badgeDisp.hidden = true;
  }

  if (rep && (rep.estado === 'playing' || rep.estado === 'paused')) {
    activo.hidden = false;
    reposo.hidden = true;
    badge.hidden = false;
    badge.textContent = rep.app === 'spotify' ? 'Spotify' : 'Música';
    $('media-titulo').textContent = rep.cancion;
    $('media-artista').textContent = rep.artista;

    if (rep.album) {
      albumEl.hidden = false;
      albumEl.textContent = rep.album;
    } else {
      albumEl.hidden = true;
    }

    const caratula = $<HTMLImageElement>('media-caratula');
    if (rep.caratula) {
      if (caratula.src !== rep.caratula) caratula.src = rep.caratula;
      caratula.hidden = false;
    } else {
      caratula.hidden = true;
    }
    pintarAmbiente(rep.caratula);
    iconoPlayPause.innerHTML = rep.estado === 'playing' ? ICONO_PAUSA : ICONO_PLAY;
    $('boton-playpause').setAttribute('aria-label', rep.estado === 'playing' ? 'Pausar' : 'Reproducir');

    // Progreso y duración
    duracionLocalSeg = rep.duracionSeg ?? 0;
    if (duracionLocalSeg > 0) {
      progresoCaja.hidden = false;
      const slider = $<HTMLInputElement>('media-progreso');
      slider.max = String(duracionLocalSeg);
      if (!tocandoProgreso) {
        posicionLocalSeg = rep.posicionSeg ?? 0;
        slider.value = String(posicionLocalSeg);
        $('media-tiempo-actual').textContent = formatoTiempoPista(posicionLocalSeg);
      }
      pintarRango(slider);
      $('media-tiempo-total').textContent = formatoTiempoPista(duracionLocalSeg);
    } else {
      progresoCaja.hidden = true;
    }

    if (rep.estado === 'playing' && duracionLocalSeg > 0) {
      iniciarTemporizadorProgreso();
    } else {
      detenerTemporizadorProgreso();
    }
  } else {
    activo.hidden = true;
    reposo.hidden = false;
    badge.hidden = true;
    albumEl.hidden = true;
    progresoCaja.hidden = true;
    pintarAmbiente(null);
    detenerTemporizadorProgreso();
    iconoPlayPause.innerHTML = ICONO_PLAY;
    $('boton-playpause').setAttribute('aria-label', 'Reproducir o pausar');
  }

  agendaUI.mostrarAvisos(e.avisos);
  mostrarAlarmaSonando(e.alarmasActivas ?? []);
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
  pintarRango(rango);

  // El fondo de la Mac cambió (p. ej. rotó el Aerial): volver a bajarlo.
  if (e.fondo && e.fondo !== firmaFondo && emparejamiento) void cargarFondo(emparejamiento, e.fondo);
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
  $('conexion-texto').textContent = TEXTO_CONEXION[c];
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
  pintarRango(rango);
});
rango.addEventListener('change', async () => {
  await accion('volumen.fijar', { nivel: Number(rango.value) });
  tocandoVolumen = false;
});
$('boton-mute').addEventListener('click', () => {
  void accion('volumen.silenciar', { silenciar: !ultimoVolumen?.silenciado });
});

const sliderProgreso = $<HTMLInputElement>('media-progreso');
if (sliderProgreso) {
  sliderProgreso.addEventListener('input', () => {
    tocandoProgreso = true;
    posicionLocalSeg = Number(sliderProgreso.value);
    $('media-tiempo-actual').textContent = formatoTiempoPista(posicionLocalSeg);
    pintarRango(sliderProgreso);
  });
  sliderProgreso.addEventListener('change', async () => {
    const seg = Math.round(Number(sliderProgreso.value));
    posicionLocalSeg = seg;
    tocandoProgreso = false;
    await accion('media.posicion', { posicionSeg: seg });
  });
}

function pintarPlaylistsRapidas(items: PlaylistRapida[]) {
  const seccion = $('media-playlists-seccion');
  const fila = $('media-playlists');
  if (!seccion || !fila) return;
  if (!items.length) {
    seccion.hidden = true;
    fila.textContent = '';
    return;
  }
  fila.textContent = '';
  for (const p of items) {
    const btn = document.createElement('button');
    btn.className = 'chip-playlist';
    btn.type = 'button';
    btn.setAttribute('data-uri', p.uri);
    const iconoChip = document.createElement('span');
    iconoChip.className = 'chip-playlist__icono';
    iconoChip.textContent = p.icono;
    const nombreChip = document.createElement('span');
    nombreChip.textContent = p.nombre;
    btn.append(iconoChip, nombreChip);
    btn.addEventListener('click', () => {
      void accion('media.reproducir_uri', { uri: p.uri }, btn);
    });
    fila.appendChild(btn);
  }
  seccion.hidden = false;
}

// ---------- Escenas e Íconos ----------
const ICONOS_ESCENAS: Record<string, string> = {
  trabajo: '💼',
  'buenas-noches': '🌙',
  cine: '🎬',
};

function iconoParaEscena(id: string): string {
  return ICONOS_ESCENAS[id] ?? '⚡';
}

/** Colores de marca de las apps conocidas; el resto se reparte por nombre. */
const COLORES_APP: Record<string, [string, string]> = {
  spotify: ['#1ed760', '#14a547'],
  safari: ['#4cb8ff', '#0a6cff'],
  whatsapp: ['#4be07a', '#1ba94c'],
  music: ['#ff5a73', '#e0113a'],
  musica: ['#ff5a73', '#e0113a'],
  chrome: ['#ffb02e', '#e8453c'],
  mail: ['#5ab2ff', '#0a6cff'],
  notas: ['#ffe066', '#f2a900'],
  calendario: ['#ff6a5e', '#e0281d'],
  vscode: ['#3aa0ff', '#0a5fc4'],
  slack: ['#9b59ff', '#5b1fc4'],
  zoom: ['#4d9bff', '#1c60e0'],
};
const PALETA_APP: [string, string][] = [
  ['#ff9f0a', '#e07700'],
  ['#bf5af2', '#8e2bd0'],
  ['#64d2ff', '#1a9fd0'],
  ['#ff6482', '#d6204a'],
  ['#5e5ce6', '#3634b8'],
  ['#30d158', '#1a9a3a'],
];

/** Símbolos de las apps conocidas (SVG fijo, sin datos de fuera). Las demás llevan su inicial. */
const GLIFOS_APP: Record<string, string> = {
  spotify:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4.8 9c4.8-1.4 10.2-.9 14.4 1.5"/><path d="M5.8 12.8c4-1.1 8.4-.7 11.8 1.3"/><path d="M6.9 16.3c3.2-.8 6.4-.4 9.1 1"/></svg>',
  safari:
    '<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><path fill="#fff" d="M16.2 7.8l-2.4 5.9-5.9 2.4 2.4-5.9z"/></svg>',
  whatsapp:
    '<svg viewBox="0 0 24 24" width="28" height="28"><path fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" d="M12 3.6a8.4 8.4 0 0 0-7.2 12.7L3.6 20.4l4.2-1.1A8.4 8.4 0 1 0 12 3.6z"/><path fill="#fff" d="M9.1 8.5c.3 2.7 2.5 5 5.3 5.5l1.2-1.4-2-1-.8.8c-.8-.4-1.5-1.1-1.9-2l.8-.8-1-2z"/></svg>',
};

function colorDeApp(id: string, nombre: string): [string, string] {
  const clave = id.toLowerCase();
  if (COLORES_APP[clave]) return COLORES_APP[clave];
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA_APP[h % PALETA_APP.length];
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
      // Apps: icono redondeado con la inicial, como en Launchpad.
      b.className = 'app';
      const [claro, oscuro] = colorDeApp(item.id, item.nombre);
      const icono = document.createElement('span');
      icono.className = 'app__icono';
      icono.style.background = `linear-gradient(165deg, ${claro}, ${oscuro})`;
      const glifo = GLIFOS_APP[item.id.toLowerCase()];
      if (glifo) icono.innerHTML = glifo;
      else icono.textContent = item.nombre.charAt(0).toUpperCase();
      const nombre = document.createElement('span');
      nombre.className = 'app__nombre';
      nombre.textContent = item.nombre;
      b.append(icono, nombre);
    }
    el.appendChild(b);
  }
}

// ---------- Alarma sonando ----------
// El agente manda en el estado las alarmas que coinciden con la hora de este minuto.
let alarmaSonando: string | null = null;
/** Clave «id@hora» de la alarma que se está mostrando, para silenciarla solo en este minuto. */
let claveSonando: string | null = null;
let alarmaSilenciada: string | null = null;
let temporizadorSonido: number | undefined;

function sonarAlarma(a: Alarma) {
  const nativo = puenteNativo();
  if (nativo) nativo.hablar(`Alarma: ${a.titulo}`, false);
  else sonarPitidoTimer();
}

function mostrarAlarmaSonando(activas: Alarma[]) {
  const aviso = $('aviso-alarma');
  // Solo la que sigue vigente este minuto y no se ha detenido.
  const a = activas.find((x) => `${x.id}@${x.hora}` !== alarmaSilenciada);
  if (!a) {
    if (alarmaSonando) {
      aviso.hidden = true;
      alarmaSonando = null;
      clearInterval(temporizadorSonido);
      temporizadorSonido = undefined;
    }
    if (!activas.length) alarmaSilenciada = null;
    return;
  }
  if (alarmaSonando === a.id) return;
  alarmaSonando = a.id;
  claveSonando = `${a.id}@${a.hora}`;
  $('alarma-sonando-hora').textContent = a.hora;
  $('alarma-sonando-titulo').textContent = a.titulo;
  aviso.hidden = false;
  // Despierta el panel si estaba en modo noche.
  despertarPanel(120_000);
  sonarAlarma(a);
  clearInterval(temporizadorSonido);
  temporizadorSonido = window.setInterval(() => sonarAlarma(a), 4000);
}

$('alarma-detener').addEventListener('click', () => {
  alarmaSilenciada = claveSonando;
  $('aviso-alarma').hidden = true;
  alarmaSonando = null;
  clearInterval(temporizadorSonido);
  temporizadorSonido = undefined;
  window.speechSynthesis?.cancel();
});

// ---------- Emparejamiento ----------
function mostrarEmparejar(error = '') {
  $('pantalla-panel').hidden = true;
  aplicarNoche();
  $('pantalla-emparejar').hidden = false;
  $('error-emparejar').textContent = error;
}

function desemparejar(error = '') {
  cerrarFlujo?.();
  cerrarFlujo = null;
  emparejamiento = null;
  guardarEmparejamiento(null);
  clearInterval(temporizadorResumen);
  temporizadorResumen = undefined;
  olvidarFondo();
  detenerTimer();
  mostrarEmparejar(error);
}

async function iniciar(e: Emparejamiento) {
  const catalogo = await llamar<Catalogo>(e, '/catalogo');
  emparejamiento = e;
  guardarEmparejamiento(e);
  pintarBotones('escenas', 'escena.ejecutar', catalogo.escenas);
  pintarBotones('apps', 'app.abrir', catalogo.apps);
  pintarPlaylistsRapidas(catalogo.playlistsRapidas ?? []);
  $('tarjeta-chat').hidden = !catalogo.chat;
  agendaUI.activar(Boolean(catalogo.agenda));

  // Pantallas opcionales: el chat y la agenda solo existen si el agente los tiene.
  for (const [dock, pagina, activo] of [
    ['tab-chat', 'pagina-chat', Boolean(catalogo.chat)],
    ['tab-agenda', 'pagina-agenda', Boolean(catalogo.agenda)],
  ] as const) {
    $(dock).hidden = !activo;
    $(pagina).hidden = !activo;
  }
  $('pantalla-emparejar').hidden = true;
  $('pantalla-panel').hidden = false;
  void mantenerPantalla();

  // Fondo de pantalla de la Mac. Luego solo se vuelve a bajar si cambia la firma que viaja en el estado.
  firmaFondo = null;
  void cargarFondo(e, null);
  // Con pantallas nuevas disponibles (o no), la que se mira sigue siendo válida y el vidrio se realinea.
  mostrarPagina(paginaActual);

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

  abrirEstado(e);
}

/** Abre el enlace con la Mac al ritmo que toque (normal, o lento si es de noche). */
function abrirEstado(e: Emparejamiento) {
  cerrarFlujo?.();
  cerrarFlujo = abrirFlujo(e, {
    lento: flujoLento,
    alEvento: (ev) => {
      if (ev.evento === 'estado') pintarEstado(JSON.parse(ev.datos) as EstadoMac);
    },
    alCambioConexion: pintarConexion,
    alNoAutorizado: () => desemparejar('El token ya no es válido. Vuelve a emparejar.'),
  });
}

function ritmoEstado(lento: boolean) {
  if (flujoLento === lento) return;
  flujoLento = lento;
  if (emparejamiento && cerrarFlujo) abrirEstado(emparejamiento);
}

$<HTMLFormElement>('form-emparejar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = (ev.target as HTMLFormElement).querySelector('button')!;
  boton.disabled = true;
  $('error-emparejar').textContent = '';
  try {
    const token = $<HTMLInputElement>('campo-token').value.trim();
    const escrito = $<HTMLInputElement>('campo-agente').value.trim();
    // Vacío (lo normal): se busca la dirección publicada por la Mac.
    const agente = escrito ? normalizarAgente(escrito) : await consultarAgentePublicado(token);
    if (!agente) throw new ErrorSinAgente('No encontrada');
    await iniciar({ agente, token });
  } catch (e) {
    $('error-emparejar').textContent =
      e instanceof ErrorNoAutorizado
        ? 'Token incorrecto.'
        : e instanceof ErrorSinAgente
          ? 'No encontré la Mac. ¿Está encendida, con sesión iniciada y con internet? Revisa también el token.'
          : 'No se pudo conectar con la Mac. Deja vacía la dirección para que la busque sola.';
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
      despertarPanel(60_000);
    }
  });
}

// Batería de la tablet: lectura inicial y avisos de la app cuando cambia algo (fuera de la app no llega nada).
const puenteBateria = puenteNativo();
if (puenteBateria?.bateria) {
  try {
    pintarTablet(leerBateria(JSON.parse(puenteBateria.bateria())));
  } catch {
    /* app vieja o sin dato */
  }
}
window.addEventListener('asistente-nativo', (ev) => {
  const d = (ev as CustomEvent<{ tipo: string }>).detail;
  if (d.tipo === 'bateria') pintarTablet(leerBateria(d));
});

const agendaUI = iniciarAgenda({
  emparejamiento: () => emparejamiento,
  alNoAutorizado: () => desemparejar('El token ya no es válido. Vuelve a emparejar.'),
  hablar: (texto) => {
    if (nativo) return nativo.hablar(texto, false);
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-CO';
    window.speechSynthesis?.speak(u);
  },
  despertar: () => despertarPanel(60_000),
});

iniciarChat({
  // Si Claude tocó la agenda, la tarjeta se actualiza al momento.
  alAcciones: (acciones) => {
    if (acciones.some((a) => a.herramienta.startsWith('agenda.'))) agendaUI.recargar();
  },
  emparejamiento: () => emparejamiento,
  alNoAutorizado: () => desemparejar('El token ya no es válido. Vuelve a emparejar.'),
});

// ---------- Cuidado de la tablet ----------
const CLAVE_MAXIMO = 'asistente.alMaximoDesde';
let bateriaTablet: Bateria | null = null;

function leerMaximoDesde(): number | null {
  try {
    const v = Number(localStorage.getItem(CLAVE_MAXIMO));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function guardarMaximoDesde(v: number | null) {
  try {
    if (v === null) localStorage.removeItem(CLAVE_MAXIMO);
    else localStorage.setItem(CLAVE_MAXIMO, String(v));
  } catch {
    /* sin almacenamiento: el aviso de «horas al 100 %» empieza de cero tras recargar */
  }
}

/** Batería de la tablet en la barra de menús y en «Mac y Casa». Solo existe si la app Android la entrega. */
function pintarTablet(b: Bateria | null) {
  bateriaTablet = b;
  const tarjeta = $('tarjeta-tablet');
  const item = $('menubar-tablet');
  if (!b || b.nivel === null) {
    tarjeta.hidden = true;
    item.hidden = true;
    return;
  }
  const ahora = Date.now();
  const desde = seguimientoAlMaximo(b, leerMaximoDesde(), ahora);
  guardarMaximoDesde(desde);
  const consejo = consejoBateria(b, desde, ahora);

  tarjeta.hidden = false;
  item.hidden = false;
  item.dataset.tono = consejo.tono;
  item.title = `Batería de la tablet${b.temperaturaC !== null ? ` · ${Math.round(b.temperaturaC)} °C` : ''}`;
  $('menubar-tablet-valor').textContent = `${b.nivel}%`;

  $('tablet-valor').textContent = `${b.nivel}%`;
  anillo(
    'anillo-tablet',
    b.nivel,
    consejo.tono === 'alerta' ? COLOR.rojo : consejo.tono === 'aviso' ? COLOR.naranja : b.nivel <= 30 && !b.enchufada ? COLOR.naranja : COLOR.verde,
  );
  const temperatura = b.temperaturaC !== null ? ` · ${Math.round(b.temperaturaC)} °C` : '';
  $('tablet-estado').textContent = `${estadoCarga(b)}${temperatura}`;
  const textoConsejo = $('tablet-consejo');
  textoConsejo.textContent = consejo.texto;
  textoConsejo.dataset.tono = consejo.tono;
}

// «Lleva horas al 100 %» cuenta tiempo: se reevalúa aunque la batería no cambie.
window.setInterval(() => {
  if (bateriaTablet) pintarTablet(bateriaTablet);
}, 10 * 60_000);

// ---------- Pantallas, Dock y deslizamiento ----------
let paginaActual = 'inicio';

/** Las pantallas que se pueden ver ahora, en el orden del Dock. */
function paginasVisibles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.pagina')).filter((p) => !p.hidden);
}

function mostrarPagina(nombre: string) {
  const visibles = paginasVisibles();
  const destino = visibles.find((p) => p.dataset.pagina === nombre) ?? visibles[0];
  if (!destino) return;
  paginaActual = destino.dataset.pagina ?? 'inicio';
  for (const p of document.querySelectorAll<HTMLElement>('.pagina')) p.classList.toggle('pagina--activa', p === destino);
  for (const d of document.querySelectorAll<HTMLElement>('.dock__item[data-ir]')) {
    d.classList.toggle('dock__item--activo', d.dataset.ir === paginaActual);
  }
  $('menubar-pagina').textContent = destino.dataset.titulo ?? '';
  pedirAlineacion();
}

function inicializarNavegacion() {
  for (const d of document.querySelectorAll<HTMLElement>('.dock__item[data-ir]')) {
    d.addEventListener('click', () => mostrarPagina(d.dataset.ir ?? 'inicio'));
  }

  // Deslizar a los lados cambia de pantalla (no en deslizadores ni en la fila de mezclas).
  const zona = $('panel-paginas');
  let x0 = 0;
  let y0 = 0;
  let valido = false;
  zona.addEventListener(
    'touchstart',
    (ev) => {
      const t = ev.touches[0];
      x0 = t.clientX;
      y0 = t.clientY;
      valido = ev.touches.length === 1 && !(ev.target as HTMLElement).closest('input[type="range"], .musica__mezclas-fila');
    },
    { passive: true },
  );
  zona.addEventListener(
    'touchend',
    (ev) => {
      if (!valido) return;
      valido = false;
      const t = ev.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const visibles = paginasVisibles();
      const i = visibles.findIndex((p) => p.dataset.pagina === paginaActual);
      const siguiente = visibles[i + (dx < 0 ? 1 : -1)];
      if (siguiente) mostrarPagina(siguiente.dataset.pagina ?? 'inicio');
    },
    { passive: true },
  );
}

// ---------- Arranque ----------
async function arrancar() {
  pintarReloj();
  inicializarNavegacion();
  iniciarVidrio();
  const desdeHash = emparejamientoDesdeHash(location.hash);
  if (desdeHash) history.replaceState(null, '', location.pathname); // el token no se queda en la barra ni en el historial
  const guardado = desdeHash ?? cargarEmparejamiento();
  if (!guardado) return mostrarEmparejar();
  // Solo con el token: la dirección de la Mac se descubre de la publicada (cifrada).
  if (!guardado.agente) guardado.agente = (await consultarAgentePublicado(guardado.token)) ?? '';
  try {
    await iniciar(guardado);
  } catch (e) {
    if (e instanceof ErrorNoAutorizado) return desemparejar('El token ya no es válido. Vuelve a emparejar.');
    // Si la URL del túnel cambió, busca automáticamente la nueva publicada en la nube
    const nuevaUrl = await consultarAgentePublicado(guardado.token);
    if (nuevaUrl && nuevaUrl !== guardado.agente) {
      guardado.agente = nuevaUrl;
      guardarEmparejamiento(guardado);
      try {
        await iniciar(guardado);
        return;
      } catch {
        // continúa abajo con el sondeo
      }
    }
    // La Mac puede estar apagada al encender la tablet: se muestra el panel y el flujo reintenta solo.
    emparejamiento = guardado;
    guardarEmparejamiento(guardado);
    $('pantalla-panel').hidden = false;
    mostrarPagina(paginaActual);
    pintarConexion('sin-conexion');
    window.setTimeout(() => void arrancarDeNuevo(guardado), 10_000);
  }
}

async function arrancarDeNuevo(e: Emparejamiento) {
  if (emparejamiento !== e || cerrarFlujo) return;
  try {
    const nuevaUrl = await consultarAgentePublicado(e.token);
    if (nuevaUrl && nuevaUrl !== e.agente) {
      e.agente = nuevaUrl;
      guardarEmparejamiento(e);
    }
    await iniciar(e);
  } catch (err) {
    if (err instanceof ErrorNoAutorizado) return desemparejar('El token ya no es válido. Vuelve a emparejar.');
    window.setTimeout(() => void arrancarDeNuevo(e), 15_000);
  }
}

void arrancar();
