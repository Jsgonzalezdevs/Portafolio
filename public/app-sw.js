/*
 * Service worker del panel de la tablet (/app).
 *
 * Objetivo: que /app abra aunque la tablet se reinicie sin internet (wifi caído, router apagado). Con la
 * página y sus archivos guardados, el panel arranca y las alarmas, la hora y lo último que se supo
 * funcionan igual.
 *
 * - Páginas (/app): primero la red (así los cambios llegan en cuanto hay conexión), y si no responde en
 *   4 s o falla, lo último guardado.
 * - /assets/* (archivos con hash en el nombre, nunca cambian): primero lo guardado.
 * - Todo lo demás (la Mac, el clima, GitHub, el portafolio) ni se toca.
 *
 * Vive en la raíz (/app-sw.js) y no en /app/ porque la página es «/app» sin barra final: un worker dentro
 * de /app/ no la controlaría.
 */
const VERSION = 'asistente-v1';
const ESPERA_RED_MS = 4000;

/**
 * Al instalarse guarda la página y los archivos que ella usa. Sin esto, la primera visita no dejaría nada
 * guardado (la página ya se cargó antes de que el worker existiera) y el primer reinicio sin internet
 * la encontraría vacía.
 */
async function precargar() {
  const cache = await caches.open(VERSION);
  const pagina = await fetch('/app', { cache: 'no-cache' });
  if (!pagina.ok) return;
  await cache.put('/app', pagina.clone());
  const html = await pagina.text();
  const archivos = [...new Set(html.match(/\/assets\/[^"'\s>)]+/g) || [])];
  await Promise.all(archivos.map((a) => cache.add(a).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  // Si no hay red ahora, se instala igual: se guardará con la primera visita.
  event.waitUntil(precargar().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith('asistente-') && n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** La red, pero sin esperar eternamente: un wifi sin internet puede tardar minutos en rendirse. */
function redConTiempo(peticion) {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('sin respuesta a tiempo')), ESPERA_RED_MS);
    fetch(peticion).then(
      (respuesta) => {
        clearTimeout(reloj);
        resolver(respuesta);
      },
      (error) => {
        clearTimeout(reloj);
        rechazar(error);
      },
    );
  });
}

async function guardar(peticion, respuesta) {
  if (!respuesta || !respuesta.ok || respuesta.type === 'opaque') return;
  const cache = await caches.open(VERSION);
  await cache.put(peticion, respuesta.clone());
}

async function redPrimero(event, peticion) {
  try {
    const respuesta = await redConTiempo(peticion);
    event.waitUntil(guardar(peticion, respuesta));
    return respuesta;
  } catch (error) {
    // «/app/» y «/app» son la misma página: se prueba con la que se guardó.
    const guardada = (await caches.match(peticion, { ignoreSearch: true })) || (await caches.match('/app'));
    if (guardada) return guardada;
    throw error;
  }
}

async function guardadoPrimero(event, peticion) {
  const guardada = await caches.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  event.waitUntil(guardar(peticion, respuesta));
  return respuesta;
}

self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  if (peticion.mode === 'navigate') {
    // Solo las páginas del panel; el portafolio y lo demás se quedan como siempre.
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) event.respondWith(redPrimero(event, peticion));
    return;
  }
  if (url.pathname.startsWith('/assets/')) event.respondWith(guardadoPrimero(event, peticion));
});
