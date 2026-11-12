/**
 * Efecto de «vidrio» sin backdrop-filter (Chrome 106 en la tablet lo hace lento).
 *
 * La Mac entrega dos imágenes: el fondo tal cual y una copia muy desenfocada.
 * Cada widget `.vidrio` pinta como segunda capa de fondo el trozo de la copia
 * desenfocada que tiene justo detrás, así que parece que desenfoca lo que hay
 * debajo, pero el navegador solo dibuja una imagen quieta.
 *
 * El fondo se muestra con `cover` centrado; aquí se calcula el mismo recuadro
 * y se desplaza cada widget la distancia que lo separa de la esquina de la
 * pantalla.
 */

export interface Recuadro {
  left: number;
  top: number;
}

export interface GeometriaVidrio {
  /** `background-size` de la capa de la imagen. */
  tamano: string;
  /** `background-position` de la capa de la imagen. */
  posicion: string;
}

/** Recuadro que ocupa una imagen con `background-size: cover` centrada en la pantalla. */
export function recuadroCover(pantalla: { ancho: number; alto: number }, imagen: { ancho: number; alto: number }) {
  const escala = Math.max(pantalla.ancho / imagen.ancho, pantalla.alto / imagen.alto);
  const ancho = imagen.ancho * escala;
  const alto = imagen.alto * escala;
  return { ancho, alto, x: (pantalla.ancho - ancho) / 2, y: (pantalla.alto - alto) / 2 };
}

/** Qué `background-size/position` darle a un widget en `r` para que su vidrio case con el fondo. */
export function geometriaVidrio(
  pantalla: { ancho: number; alto: number },
  imagen: { ancho: number; alto: number },
  r: Recuadro,
): GeometriaVidrio {
  const c = recuadroCover(pantalla, imagen);
  // Dos capas: el tinte (tamaño automático) y la imagen.
  return {
    tamano: `auto, ${c.ancho.toFixed(1)}px ${c.alto.toFixed(1)}px`,
    posicion: `0 0, ${(c.x - r.left).toFixed(1)}px ${(c.y - r.top).toFixed(1)}px`,
  };
}

let url: string | null = null;
let dimensiones: { ancho: number; alto: number } | null = null;
let pendiente = false;
let observador: ResizeObserver | null = null;
const observados = new WeakSet<Element>();

/** Reposiciona el vidrio de todos los widgets. Barato: un getBoundingClientRect por widget. */
export function alinearVidrio(): void {
  pendiente = false;
  if (!dimensiones) return;
  const pantalla = { ancho: window.innerWidth, alto: window.innerHeight };
  document.querySelectorAll<HTMLElement>('.vidrio').forEach((el) => {
    if (observador && !observados.has(el)) {
      observador.observe(el);
      observados.add(el);
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return; // oculto
    const g = geometriaVidrio(pantalla, dimensiones!, r);
    el.style.backgroundSize = g.tamano;
    el.style.backgroundPosition = g.posicion;
  });
}

/** Pide alinear en el próximo fotograma; muchas llamadas seguidas cuestan una. */
export function pedirAlineacion(): void {
  if (pendiente) return;
  pendiente = true;
  window.requestAnimationFrame(alinearVidrio);
}

/** Engancha los eventos que mueven o cambian de tamaño los widgets. Se llama una vez. */
export function iniciarVidrio(): void {
  window.addEventListener('resize', pedirAlineacion);
  window.addEventListener('orientationchange', pedirAlineacion);
  // Las listas internas y las pantallas se desplazan: los widgets cambian de sitio.
  document.addEventListener('scroll', pedirAlineacion, { capture: true, passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    // Si un widget crece o se oculta, los de abajo cambian de sitio aunque ellos no cambien de tamaño.
    observador = new ResizeObserver(pedirAlineacion);
  }
  pedirAlineacion();
}

function cargarImagen(origen: string): Promise<{ ancho: number; alto: number }> {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => resolver({ ancho: img.naturalWidth || 16, alto: img.naturalHeight || 9 });
    img.onerror = () => rechazar(new Error('imagen de vidrio ilegible'));
    img.src = origen;
  });
}

/** Aplica la copia desenfocada del fondo a todos los widgets. */
export async function aplicarVidrio(imagen: Blob): Promise<void> {
  const nueva = URL.createObjectURL(imagen);
  try {
    dimensiones = await cargarImagen(nueva);
  } catch (e) {
    URL.revokeObjectURL(nueva);
    throw e;
  }
  document.documentElement.style.setProperty('--vidrio', `url("${nueva}")`);
  if (url) URL.revokeObjectURL(url);
  url = nueva;
  alinearVidrio();
}

/** Vuelve al vidrio liso (sin fondo de la Mac). */
export function limpiarVidrio(): void {
  document.documentElement.style.removeProperty('--vidrio');
  if (url) URL.revokeObjectURL(url);
  url = null;
  dimensiones = null;
  document.querySelectorAll<HTMLElement>('.vidrio').forEach((el) => {
    el.style.backgroundSize = '';
    el.style.backgroundPosition = '';
  });
}
