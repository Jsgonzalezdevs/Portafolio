/*
 * Service worker for the finance app.
 *
 * Its own job is still narrow: make the app OPEN without a connection, by
 * caching the shell and static assets. It never caches a Supabase response or
 * an API call — see NUNCA_CACHEAR below — because a stale HTTP cache showing
 * yesterday's balance as if it were current would be a bug this file could
 * silently cause.
 *
 * Working offline with real, live data is handled elsewhere, deliberately not
 * here: `data/repositorioConCola.ts` keeps a per-account copy in IndexedDB and
 * a queue of writes made without a connection, uploaded once the network is
 * back. That split matters — a service worker caching HTTP responses and an
 * app-level queue replaying database writes are different tools solving
 * different problems, and mixing the two into one mechanism is how a cache
 * quietly becomes a second source of truth that disagrees with the first.
 */

const VERSION = 'v2';
const SHELL = `ecosistema-shell-${VERSION}`;
const ASSETS = `ecosistema-assets-${VERSION}`;

/** The document every in-app route resolves to. */
const SHELL_URL = '/ecosistema';

/**
 * The app's own routes.
 *
 * The worker is registered at scope "/" because the app lives under three
 * different paths, which means it also sees the public portfolio at "/". Those
 * requests must pass straight through: falling back to this app's shell for a
 * portfolio URL would serve the wrong site the moment the network drops.
 */
const RUTAS_APP = ['/ecosistema', '/lukapp', '/superadmin', '/estadisticas'];

const esRutaDeLaApp = (url) =>
  RUTAS_APP.some((r) => url.pathname === r || url.pathname.startsWith(`${r}/`));

/**
 * Requests that must ALWAYS hit the network and must never be stored.
 *
 * Financial data and auth are the obvious ones. A cached API response could
 * show a balance from yesterday as if it were current, and a cached auth
 * response could resurrect a session that was signed out — both are failures a
 * user cannot see, which is what makes them worse than an outright error.
 */
const NUNCA_CACHEAR = (url) =>
  url.pathname.startsWith('/api/') ||
  url.hostname.endsWith('.supabase.co') ||
  url.pathname.includes('/auth/');

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(SHELL_URL))
      // A failed precache must not block activation: the app still works
      // online, and the next navigation will fill the cache.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(
          claves
            .filter((c) => c.startsWith('ecosistema-') && !c.endsWith(VERSION))
            .map((c) => caches.delete(c)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (NUNCA_CACHEAR(url)) return;
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a deployed update is picked up immediately,
  // falling back to the cached shell only when there is genuinely no network.
  if (peticion.mode === 'navigate') {
    // Not ours — let the portfolio be the portfolio, online or off.
    if (!esRutaDeLaApp(url)) return;

    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          // Only cache successful, same-origin HTML responses.
          if (respuesta.ok && respuesta.type === 'basic') {
            const copia = respuesta.clone();
            caches.open(SHELL).then((cache) => cache.put(SHELL_URL, copia));
          }
          return respuesta;
        })
        .catch(() =>
          // Network failed: serve the cached shell so the app opens offline.
          // If the shell isn't cached yet, fall through to a plain network
          // request rather than returning Response.error() — that rejection
          // is what causes the red "FetchEvent resulted in a network error"
          // message in the console, which is more alarming than the actual
          // failure and happens on first load before the cache is warm.
          caches.match(SHELL_URL).then((r) => r ?? fetch(peticion).catch(() => Response.error())),
        ),
    );
    return;
  }

  // Build output is content-hashed, so a cached asset is never a stale version
  // of itself — a new build simply requests a new filename. Cache-first is
  // therefore safe here, and it is what makes a cold offline start possible.
  evento.respondWith(
    caches.match(peticion).then(
      (enCache) =>
        enCache ??
        fetch(peticion).then((respuesta) => {
          if (respuesta.ok && respuesta.type === 'basic') {
            const copia = respuesta.clone();
            caches.open(ASSETS).then((cache) => cache.put(peticion, copia));
          }
          return respuesta;
        }),
    ),
  );
});
