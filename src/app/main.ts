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
import { iniciarAgenda, type Aviso, type RespuestaAgenda } from './agenda';
import {
  alternar as alternarAlarma,
  cargarEstado as cargarAlarmasGuardadas,
  crear as crearAlarma,
  eliminar as eliminarAlarma,
  guardarEstado as guardarAlarmas,
  ordenadas,
  reconciliar,
  vencidas,
  type Alarma,
  type EstadoAlarmas,
} from './alarmas';
import { borrarCache, CLAVES, guardarCache, hace, leerCache } from './almacen';
import { obtenerClima, type Clima } from './clima';
import { finDelDia, inicioDelDia, normalizar, resumenManana, resumenNoche, sinRelleno } from '../../mac-agent/src/hablar';
import { iniciarChat, puenteNativo } from './chat';
import { aplicarVidrio, iniciarVidrio, limpiarVidrio, pedirAlineacion } from './vidrio';
import { consejoBateria, estadoCarga, leerBateria, seguimientoAlMaximo, type Bateria } from './bienestar';
import { desplazamientoHora, nocheActiva } from './noche';
import { claveDia, debeResumirManana, duracionAviso, efectosConocidos } from './rutinas';
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
  /** Firma del fondo de pantalla de la Mac: cuando cambia, se vuelve a descargar. */
  fondo?: string | null;
}

interface Catalogo {
  chat?: boolean;
  agenda?: boolean;
  escenas: { id: string; nombre: string }[];
  apps: { id: string; nombre: string }[];
  playlistsRapidas?: PlaylistRapida[];
  rutinas?: { id: string; nombre: string; icono: string; efectos?: string[]; frases?: string[] }[];
  /** Cómo te llama el asistente; sirve para saludar cuando la Mac no responde. */
  nombre?: string;
}

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

let emparejamiento: Emparejamiento | null = null;
let cerrarFlujo: (() => void) | null = null;
let ultimoVolumen: EstadoMac['volumen'] = null;
let tocandoVolumen = false;
let ultimoEstadoMac: EstadoMac | null = null;
/** Las alarmas son de la tablet: se guardan y suenan aquí, con o sin la Mac. */
let estadoAlarmas: EstadoAlarmas = cargarAlarmasGuardadas();
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
    void recordarFondo(entrega.blob, vidrio?.blob ?? null);
  } catch {
    // Mac apagada o sin red: se conserva el fondo que ya había.
  } finally {
    cargandoFondo = false;
  }
}

const aDataUrl = (blob: Blob) =>
  new Promise<string>((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(lector.error);
    lector.readAsDataURL(blob);
  });

/** El fondo se guarda en la tablet: con la Mac apagada (o al arrancar) se ve el último que tuvo. */
async function recordarFondo(nitido: Blob, vidrio: Blob | null) {
  try {
    const grande = await aDataUrl(nitido);
    if (grande.length > 700_000) return; // no vale la pena llenar la memoria de la tablet
    guardarCache(CLAVES.fondo, grande);
    if (vidrio) guardarCache(CLAVES.vidrio, await aDataUrl(vidrio));
  } catch {
    /* sin espacio: se baja de nuevo cuando la Mac responda */
  }
}

/** Pone al instante el último fondo guardado, sin esperar a la Mac. */
async function restaurarFondo() {
  const nitido = leerCache<string>(CLAVES.fondo);
  if (!nitido || urlFondoActual) return;
  $('fondo-mac').style.backgroundImage = `url("${nitido.valor}")`;
  const vidrio = leerCache<string>(CLAVES.vidrio);
  if (!vidrio) return;
  try {
    const blob = await (await fetch(vidrio.valor)).blob();
    if (!urlFondoActual) await aplicarVidrio(blob);
  } catch {
    /* sin vidrio: los widgets quedan lisos hasta que llegue el de la Mac */
  }
}

function olvidarFondo() {
  borrarCache(CLAVES.fondo);
  borrarCache(CLAVES.vidrio);
  if (urlFondoActual) URL.revokeObjectURL(urlFondoActual);
  urlFondoActual = null;
  firmaFondo = null;
  $('fondo-mac').style.backgroundImage = '';
  limpiarVidrio();
}

// ---------- Avisos ----------
let temporizadorAviso: number | undefined;
function avisar(texto: string, error = false, ms = 3500) {
  const el = $('aviso');
  el.textContent = texto;
  el.className = error ? 'aviso error-aviso' : 'aviso';
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = window.setTimeout(() => (el.hidden = true), ms);
}

/** Lee un texto en voz alta: con la voz de la app Android si está, o la del navegador. */
function hablarTexto(texto: string) {
  const nativo = puenteNativo();
  if (nativo) return nativo.hablar(texto, false);
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'es-CO';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// ---------- Reloj y modo noche ----------
const formatoHora = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const formatoFecha = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
const formatoBarra = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const diaSemana = new Intl.DateTimeFormat('es-CO', { weekday: 'short' });
let nocheManual: boolean | null = null; // null = automático según la hora
let despiertoHasta = 0;

let minutosDesdeClima = 0;

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
  // Cada minuto, sin la Mac: ¿suena una alarma?, ¿venció un recordatorio?, ¿cuánto lleva la Mac fuera?
  evaluarAlarmas();
  agendaUI.comprobarAvisos();
  textoConexion();
  if (++minutosDesdeClima >= 20) {
    minutosDesdeClima = 0;
    void refrescarClima();
  }
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

// ---------- Clima (directo de internet, sin pasar por la Mac) ----------
let climaTablet: { valor: Clima; en: number } | null = leerCache<Clima>(CLAVES.clima);

function ciudadDelClima(): string | null {
  return leerCache<string>(CLAVES.ciudad)?.valor ?? ultimoEstadoMac?.clima?.ciudad ?? null;
}

/** La ciudad se aprende de la Mac la primera vez y queda guardada en la tablet. */
function recordarCiudad(ciudad: string) {
  if (leerCache<string>(CLAVES.ciudad)?.valor === ciudad) return;
  guardarCache(CLAVES.ciudad, ciudad);
  void refrescarClima();
}

async function refrescarClima() {
  const ciudad = ciudadDelClima();
  if (!ciudad) return;
  try {
    const c = await obtenerClima(ciudad);
    climaTablet = { valor: c, en: Date.now() };
    guardarCache(CLAVES.clima, c);
    pintarClima();
  } catch {
    /* sin internet: se queda con lo último que se supo */
  }
}

/** Lo más fresco que se sepa: la lectura propia de la tablet, o la de la Mac, o la última guardada. */
function climaActual(): Clima | null {
  const propio = climaTablet && Date.now() - climaTablet.en < 3 * 3600_000 ? climaTablet.valor : null;
  return propio ?? ultimoEstadoMac?.clima ?? climaTablet?.valor ?? null;
}

function pintarClima() {
  const c = climaActual();
  if (!c) {
    $('clima').hidden = true;
  } else {
    $('clima').hidden = false;
    $('clima-icono').textContent = c.icono;
    $('clima-temp').textContent = `${c.tempC > 0 ? '+' : ''}${c.tempC}°`;
    $('clima-ciudad').textContent = c.ciudad;
    $('clima').title = c.condicion;
  }
  actualizarAhora();
}

// ---------- Tarjeta Ahora ----------
const mismoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Eventos de hoy según lo último que respondió la Mac (guardado en la tablet). */
function eventosDeHoy(): RespuestaAgenda['eventos'] {
  const guardado = leerCache<RespuestaAgenda>(CLAVES.agenda)?.valor;
  const hoy = new Date();
  return guardado ? guardado.eventos.filter((e) => mismoDia(new Date(e.inicio), hoy)) : [];
}

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

  const clima = climaActual();
  const textoClima = clima ? `${clima.tempC > 0 ? '+' : ''}${clima.tempC}° en ${clima.ciudad} (${clima.condicion.toLowerCase()})` : '';

  let mensajeResumen = '';
  if (periodo === 'manana') {
    // Mañana (6-12): clima, cuántos eventos hay hoy y la primera alarma
    const nEventos = eventosDeHoy().length;
    const primeraAlarma = ordenadas(estadoAlarmas.alarmas).find((a) => a.activa);
    const partes: string[] = [];
    if (textoClima) partes.push(textoClima);
    partes.push(nEventos === 0 ? 'Sin eventos hoy' : `${nEventos} evento${nEventos > 1 ? 's' : ''} hoy`);
    if (primeraAlarma) partes.push(`Alarma a las ${primeraAlarma.hora}`);
    mensajeResumen = partes.join(' · ');
  } else if (periodo === 'tarde') {
    // Tarde (12-18): el próximo evento o «nada pendiente»
    const proximo = eventosDeHoy().find((ev) => !ev.todoElDia && new Date(ev.inicio) >= ahora);
    if (proximo) {
      const horaEv = formatoHora.format(new Date(proximo.inicio));
      mensajeResumen = `${proximo.titulo} a las ${horaEv}${textoClima ? ` · ${textoClima}` : ''}`;
    } else {
      mensajeResumen = `Nada pendiente por hoy${textoClima ? ` · ${textoClima}` : ''}`;
    }
  } else if (periodo === 'noche') {
    mensajeResumen = `Prepárate para descansar${textoClima ? ` · ${textoClima}` : ''}`;
  }

  const elResumen = $('ahora-resumen');
  if (elResumen) elResumen.textContent = mensajeResumen || 'Todo en orden.';
}

let temporizadorResumen: number | undefined;

// ---------- Alarmas (de la tablet; la Mac guarda una copia) ----------
/** Cambia las alarmas, las guarda, las repinta y avisa a la Mac si responde. */
function cambiarAlarmas(nuevo: EstadoAlarmas) {
  estadoAlarmas = nuevo;
  guardarAlarmas(estadoAlarmas);
  pintarAlarmas();
  actualizarAvisoSonido();
  evaluarAlarmas();
  void sincronizarAlarmas();
}

let sincronizandoAlarmas = false;

/**
 * Pone la copia de la Mac al día y adopta lo que ella tenga de más (alarmas puestas por voz).
 * Si la Mac no responde no pasa nada: se reintenta cada minuto.
 */
async function sincronizarAlarmas() {
  const e = emparejamiento;
  if (!e || sincronizandoAlarmas) return;
  sincronizandoAlarmas = true;
  try {
    const remotas = (await llamar<{ alarmas: Alarma[] }>(e, '/alarmas')).alarmas ?? [];
    const plan = reconciliar(estadoAlarmas, remotas);
    const cambio =
      plan.estado.alarmas.length !== estadoAlarmas.alarmas.length ||
      JSON.stringify(plan.estado.borradas) !== JSON.stringify(estadoAlarmas.borradas);
    estadoAlarmas = plan.estado;
    guardarAlarmas(estadoAlarmas);
    if (cambio) {
      pintarAlarmas();
      actualizarAvisoSonido();
    }
    for (const a of plan.crearEnMac) {
      await llamar(e, '/alarmas', { id: a.id, hora: a.hora, titulo: a.titulo, dias: a.dias });
      if (!a.activa) await llamar(e, `/alarmas/${encodeURIComponent(a.id)}/toggle`, {});
    }
    for (const id of plan.borrarEnMac) {
      await fetch(`${e.agente}/alarmas/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${e.token}` } });
    }
    for (const id of plan.alternarEnMac) await llamar(e, `/alarmas/${encodeURIComponent(id)}/toggle`, {});
  } catch (err) {
    if (err instanceof ErrorNoAutorizado) desemparejar('El token ya no es válido. Vuelve a emparejar.');
    /* si no, la Mac no responde: las alarmas siguen sonando desde la tablet */
  } finally {
    sincronizandoAlarmas = false;
  }
}

function pintarAlarmas() {
  const alarmas = ordenadas(estadoAlarmas.alarmas);
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
    bToggle.addEventListener('click', () => cambiarAlarmas(alternarAlarma(estadoAlarmas, a.id)));

    const bEliminar = document.createElement('button');
    bEliminar.type = 'button';
    bEliminar.className = 'boton-eliminar-alarma';
    bEliminar.textContent = '×';
    bEliminar.setAttribute('aria-label', `Eliminar alarma ${a.titulo}`);
    bEliminar.addEventListener('click', () => {
      cambiarAlarmas(eliminarAlarma(estadoAlarmas, a.id));
      avisar('Alarma eliminada');
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

$<HTMLFormElement>('form-alarma').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const hora = $<HTMLInputElement>('campo-alarma-hora').value.trim().slice(0, 5);
  const titulo = $<HTMLInputElement>('campo-alarma-titulo').value.trim();
  if (!hora) return;
  try {
    cambiarAlarmas(crearAlarma(estadoAlarmas, hora, titulo));
    $('modal-alarma').hidden = true;
    avisar('Alarma creada');
  } catch (err) {
    avisar(err instanceof Error ? err.message : 'No se pudo crear la alarma', true);
  }
});

// ---------- Temporizador (Frontend) ----------
let timerSegundosRestantes = 0;
let timerSegundosTotales = 0;
let timerIntervalo: number | undefined;

// Un solo contexto de audio para toda la página: Chrome limita cuántos se pueden abrir, y una alarma
// que repite cada 4 s los agotaría. Además solo suena tras un toque de la persona en la pantalla.
let contextoAudio: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    contextoAudio ??= new AudioCtx();
    if (contextoAudio.state === 'suspended') void contextoAudio.resume();
    return contextoAudio;
  } catch {
    return null;
  }
}

function sonarPitidoTimer() {
  const ctx = audio();
  if (!ctx) return;
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

  // Clima: la tablet lo pide por su cuenta; aquí solo se aprende la ciudad de la Mac y se repinta.
  if (e.clima) recordarCiudad(e.clima.ciudad);
  pintarClima();

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
let conexionActual: EstadoConexion = 'conectando';
let ultimaMarcaConexion = 0;

/** Texto de la barra de menús: con la Mac fuera dice desde cuándo («Mac sin conexión · hace 3 h»). */
function textoConexion() {
  $('conexion').dataset.estado = conexionActual;
  let t = TEXTO_CONEXION[conexionActual];
  if (conexionActual === 'sin-conexion') {
    const ultima = leerCache<number>(CLAVES.ultimaConexion);
    if (ultima) t = `Mac sin conexión · ${hace(ultima.en)}`;
  }
  $('conexion-texto').textContent = t;
}

function pintarConexion(c: EstadoConexion) {
  const anterior = conexionActual;
  conexionActual = c;
  if (c === 'en-linea' && Date.now() - ultimaMarcaConexion > 60_000) {
    ultimaMarcaConexion = Date.now();
    guardarCache(CLAVES.ultimaConexion, ultimaMarcaConexion);
  }
  // Con la Mac fuera, lo que solo ella puede hacer (música, apps, pantalla…) se ve apagado.
  document.body.classList.toggle('mac-fuera', c === 'sin-conexion');
  textoConexion();
  // La Mac volvió: se refresca lo que se había quedado con datos guardados.
  if (c === 'en-linea' && anterior === 'sin-conexion') {
    agendaUI.recargar();
    void sincronizarAlarmas();
  }
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

// ---------- Rutinas («buenas noches», «buenos días») ----------
const rutinasDisponibles = new Set<string>();

interface ResultadoRutina {
  texto: string;
  efectos?: unknown;
}

/** Lo que el agente no puede hacer y le toca a la tablet (hoy: pasar a modo noche). */
function aplicarEfectos(efectos: unknown) {
  for (const e of efectosConocidos(efectos)) {
    if (e === 'modo-noche') {
      nocheManual = true;
      despiertoHasta = 0;
      aplicarNoche();
    }
  }
}

let rutinasCatalogo: NonNullable<Catalogo['rutinas']> = [];
let nombreUsuario = '';

/** Lo que se hace al terminar una rutina: mostrar el texto, leerlo y aplicar los efectos en la tablet. */
function mostrarRutina(texto: string, efectos: unknown) {
  // Si la rutina apaga la pantalla (modo noche), un aviso brillante encima sobra: la voz ya lo dice.
  if (!efectosConocidos(efectos).includes('modo-noche')) avisar(texto, false, duracionAviso(texto));
  hablarTexto(texto);
  aplicarEfectos(efectos);
}

/**
 * La Mac no responde: se hace lo que la tablet puede (modo noche) y se lee un resumen con lo último que
 * se supo de la agenda, el clima y las alarmas. Los textos son los mismos que arma la Mac.
 */
function rutinaSinMac(id: string): string | null {
  const rutina = rutinasCatalogo.find((r) => r.id === id);
  if (!rutina) {
    avisar('No se pudo contactar a la Mac', true);
    return null;
  }
  const ahora = new Date();
  const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  const agenda = leerCache<RespuestaAgenda>(CLAVES.agenda)?.valor;
  const del = (dia: Date) => (agenda?.eventos ?? []).filter((e) => new Date(e.inicio) >= inicioDelDia(dia) && new Date(e.inicio) <= finDelDia(dia));
  const coma = nombreUsuario ? `, ${nombreUsuario}` : '';

  let partes: string[];
  if (id === 'buenos-dias') {
    partes = [`Buenos días${coma}.`, resumenManana({ ahora, clima: climaActual(), eventos: del(ahora), recordatorios: agenda?.recordatorios ?? [] })];
  } else if (id === 'buenas-noches') {
    partes = [`Buenas noches${coma}.`, 'La Mac no responde, así que hice solo lo de la tablet.', resumenNoche({ ahora, eventosManana: del(manana), alarmas: estadoAlarmas.alarmas }), 'Que descanses.'];
  } else {
    partes = [`${rutina.nombre}.`, 'La Mac no responde, así que hice solo lo de la tablet.'];
  }
  const texto = partes.filter(Boolean).join(' ');
  mostrarRutina(texto, rutina.efectos);
  return texto;
}

/** Lo que se escribió en el chat es justo la frase de una rutina («buenas noches»): la tablet la hace sola. */
function rutinaDelChat(texto: string): string | null {
  const dicho = sinRelleno(texto);
  if (!dicho) return null;
  const rutina = rutinasCatalogo.find((r) => (r.frases ?? []).some((f) => normalizar(f) === dicho));
  return rutina ? rutinaSinMac(rutina.id) : null;
}

async function ejecutarRutina(id: string, boton?: HTMLButtonElement) {
  if (!emparejamiento) return;
  if (boton) boton.disabled = true;
  try {
    const r = await llamar<ResultadoRutina>(emparejamiento, `/rutinas/${encodeURIComponent(id)}`, {});
    mostrarRutina(r.texto, r.efectos);
  } catch (e) {
    if (e instanceof ErrorNoAutorizado) return desemparejar('El token ya no es válido. Vuelve a emparejar.');
    // Sin respuesta de la Mac (apagada, dormida, sin red): la tablet hace lo suyo.
    if (e instanceof TypeError || e instanceof ErrorSinAgente) rutinaSinMac(id);
    else avisar((e as Error).message, true);
  } finally {
    if (boton) boton.disabled = false;
  }
}

document.addEventListener('click', (ev) => {
  const boton = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-rutina]');
  if (boton) void ejecutarRutina(boton.dataset.rutina!, boton);
});

function pintarRutinas(items: { id: string; nombre: string; icono: string }[]) {
  rutinasDisponibles.clear();
  const caja = $('rutinas');
  caja.textContent = '';
  caja.hidden = !items.length;
  for (const r of items) {
    rutinasDisponibles.add(r.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'boton boton--escena';
    b.dataset.rutina = r.id;
    const icono = document.createElement('span');
    icono.className = 'escena-icono';
    icono.textContent = r.icono;
    const nombre = document.createElement('span');
    nombre.className = 'escena-nombre';
    nombre.textContent = r.nombre;
    b.append(icono, nombre);
    caja.appendChild(b);
  }
  // Sin escenas pero con rutinas, el aviso de «aún no hay escenas» sobra.
  $('escenas').hidden = items.length > 0 && !$('escenas').querySelector('button');
}

const CLAVE_RESUMEN = 'asistente.resumenManana';

/** Al apagar la alarma de la mañana, el resumen del día en voz alta (una vez al día). */
async function resumenDeLaManana() {
  if (!rutinasDisponibles.has('buenos-dias')) return;
  const ahora = new Date();
  let ultimo: string | null = null;
  try {
    ultimo = localStorage.getItem(CLAVE_RESUMEN);
  } catch {
    /* sin almacenamiento: se repetiría tras recargar */
  }
  if (!debeResumirManana(ahora, ultimo)) return;
  try {
    localStorage.setItem(CLAVE_RESUMEN, claveDia(ahora));
  } catch {
    /* idem */
  }
  await ejecutarRutina('buenos-dias');
}

// ---------- Alarma sonando ----------
// La tablet decide cuándo suena (la Mac ya no interviene) y suena hasta que se apaga o pasan 10 minutos.
let alarmaSonando: Alarma | null = null;
let sonandoDesde = 0;
let temporizadorSonido: number | undefined;
/** Alarmas ya apagadas hoy, por id, día y hora (para que no vuelvan a sonar en su mismo minuto). */
const silenciadas = new Set<string>();
const claveAlarma = (a: Alarma, ahora: Date) => `${a.id}|${claveDia(ahora)}|${a.hora}`;
const DIEZ_MINUTOS = 10 * 60_000;

function sonarAlarma(a: Alarma, primera: boolean) {
  const nativo = puenteNativo();
  if (nativo) return nativo.hablar(`Alarma: ${a.titulo}`, false);
  sonarPitidoTimer();
  if (primera) hablarTexto(`Alarma: ${a.titulo}`);
}

/** Mira si toca que suene alguna alarma. Se llama cada minuto, al arrancar y al cambiar las alarmas. */
function evaluarAlarmas() {
  const ahora = new Date();
  if (alarmaSonando && Date.now() - sonandoDesde > DIEZ_MINUTOS) detenerAlarma(false);
  if (alarmaSonando) return;
  const a = vencidas(estadoAlarmas.alarmas, ahora).find((x) => !silenciadas.has(claveAlarma(x, ahora)));
  if (a) empezarAlarma(a);
}

function empezarAlarma(a: Alarma) {
  alarmaSonando = a;
  sonandoDesde = Date.now();
  $('alarma-sonando-hora').textContent = a.hora;
  $('alarma-sonando-titulo').textContent = a.titulo;
  $('aviso-alarma').hidden = false;
  // Despierta el panel si estaba en modo noche.
  despertarPanel(DIEZ_MINUTOS);
  sonarAlarma(a, true);
  clearInterval(temporizadorSonido);
  temporizadorSonido = window.setInterval(() => sonarAlarma(a, false), 4000);
}

function detenerAlarma(porLaPersona: boolean) {
  if (alarmaSonando) silenciadas.add(claveAlarma(alarmaSonando, new Date(sonandoDesde)));
  $('aviso-alarma').hidden = true;
  alarmaSonando = null;
  clearInterval(temporizadorSonido);
  temporizadorSonido = undefined;
  window.speechSynthesis?.cancel();
  despertarPanel(60_000);
  if (porLaPersona) void resumenDeLaManana();
}

$('alarma-detener').addEventListener('click', () => detenerAlarma(true));

// Chrome no deja sonar hasta que alguien toca la pantalla una vez: si hay alarmas puestas y aún no se
// ha tocado, se avisa para que una alarma de madrugada no se quede muda tras un reinicio.
function actualizarAvisoSonido() {
  const hayAlarmas = estadoAlarmas.alarmas.some((a) => a.activa);
  const activacion = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  $('aviso-sonido').hidden = !hayAlarmas || activacion?.hasBeenActive !== false;
}

for (const evento of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(
    evento,
    () => {
      audio();
      actualizarAvisoSonido();
    },
    { passive: true },
  );
}

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
  for (const clave of [CLAVES.catalogo, CLAVES.agenda, CLAVES.ultimaConexion]) borrarCache(clave);
  detenerTimer();
  mostrarEmparejar(error);
}

/** Pone en pantalla lo que la Mac ofrece (botones, rutinas, chat, agenda). Sirve con datos vivos o guardados. */
function aplicarCatalogo(catalogo: Catalogo) {
  nombreUsuario = catalogo.nombre ?? '';
  rutinasCatalogo = catalogo.rutinas ?? [];
  pintarBotones('escenas', 'escena.ejecutar', catalogo.escenas);
  pintarBotones('apps', 'app.abrir', catalogo.apps);
  pintarRutinas(catalogo.rutinas ?? []);
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
}

async function iniciar(e: Emparejamiento) {
  const catalogo = await llamar<Catalogo>(e, '/catalogo');
  guardarCache(CLAVES.catalogo, catalogo);
  emparejamiento = e;
  guardarEmparejamiento(e);
  aplicarCatalogo(catalogo);
  $('pantalla-emparejar').hidden = true;
  $('pantalla-panel').hidden = false;
  void mantenerPantalla();

  // Fondo de pantalla de la Mac. Luego solo se vuelve a bajar si cambia la firma que viaja en el estado.
  firmaFondo = null;
  void cargarFondo(e, null);
  // Con pantallas nuevas disponibles (o no), la que se mira sigue siendo válida y el vidrio se realinea.
  mostrarPagina(paginaActual);

  // Las alarmas son de la tablet; cada minuto se pone al día la copia de la Mac (si responde).
  void sincronizarAlarmas();
  clearInterval(temporizadorResumen);
  temporizadorResumen = window.setInterval(() => {
    if (emparejamiento) void sincronizarAlarmas();
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
  hablar: hablarTexto,
  despertar: () => despertarPanel(60_000),
});

iniciarChat({
  // La Mac no responde: si era una rutina, se hace aquí; para lo demás hace falta la Mac (o la IA).
  alSinMac: rutinaDelChat,
  // Si Claude tocó la agenda, la tarjeta se actualiza al momento.
  alAcciones: (acciones) => {
    if (acciones.some((a) => a.herramienta.startsWith('agenda.'))) agendaUI.recargar();
  },
  alEfectos: aplicarEfectos,
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
  // Lo propio de la tablet se pone al instante, sin esperar a nadie: fondo, alarmas y clima guardados.
  void restaurarFondo();
  pintarAlarmas();
  actualizarAvisoSonido();
  evaluarAlarmas();
  pintarClima();
  void refrescarClima();
  const desdeHash = emparejamientoDesdeHash(location.hash);
  if (desdeHash) history.replaceState(null, '', location.pathname); // el token no se queda en la barra ni en el historial
  const guardado = desdeHash ?? cargarEmparejamiento();
  if (!guardado) return mostrarEmparejar();
  // Esta tablet ya es de esta Mac: si se guardó su catálogo, el panel aparece de una vez con lo último que se supo.
  const catalogoGuardado = leerCache<Catalogo>(CLAVES.catalogo);
  if (catalogoGuardado) {
    emparejamiento = guardado;
    $('pantalla-panel').hidden = false;
    aplicarCatalogo(catalogoGuardado.valor);
    mostrarPagina(paginaActual);
    aplicarNoche();
  }
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
