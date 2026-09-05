/**
 * ORGANIZATOR — Service Worker (Fase 6, PWA)
 *
 * Responsabilidad única: cachear el "shell" estático de la app (HTML, JS propio,
 * manifest, iconos) para que ORGANIZATOR pueda abrirse sin conexión después de
 * haber sido visitada al menos una vez. Este archivo NUNCA toca IndexedDB ni
 * ningún dato del usuario — solo gestiona una caché de archivos estáticos.
 *
 * IMPORTANTE PARA FUTURAS ACTUALIZACIONES:
 * Cada vez que se publique una nueva versión de ORGANIZATOR, sube el número de
 * CACHE_VERSION más abajo (a la vez que APP_VERSION en organizator.html). Eso
 * crea una caché nueva y limpia automáticamente las cachés antiguas, evitando
 * que alguien se quede atascado con una versión vieja.
 */

const CACHE_VERSION = 'v2.0.0';
const CACHE_NAME = `organizator-shell-${CACHE_VERSION}`;

// Recursos propios de la app que se pueden precachear con seguridad.
// (Las fuentes de Google Fonts y la llamada a la IA se dejan siempre pasar
// directamente a la red: no tiene sentido cachear peticiones externas de IA,
// y las fuentes ya las gestiona el propio navegador con su caché HTTP.)
const PRECACHE_URLS = [
  '/',
  '/organizator.html',
  '/manifest.json',
  '/js/storage-polyfill.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.warn('[SW] No se pudo precachear todo el shell:', err))
  );
  // No se llama a self.skipWaiting() aquí a propósito: así el Service Worker
  // nuevo se queda "esperando" hasta que la propia app confirme la actualización
  // (ver mensaje 'SKIP_WAITING' más abajo), en vez de forzar la actualización
  // mientras el usuario podría estar a mitad de editar algo.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith('organizator-shell-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

// Permite que la propia app le diga al SW en espera "actívate ya" cuando el
// usuario acepta la actualización (ver el registro en organizator.html).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo gestionamos peticiones GET del propio origen; todo lo demás
  // (fuentes de Google, la API de la IA, etc.) va directo a la red tal cual.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  const isNavigation = req.mode === 'navigate' || req.destination === 'document';

  if (isNavigation) {
    // Shell HTML: red primero (para no quedarse en una versión vieja
    // mientras haya conexión), con la caché como respaldo offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/organizator.html', copy));
          return res;
        })
        .catch(() => caches.match('/organizator.html').then((res) => res || caches.match('/')))
    );
    return;
  }

  // Resto de recursos propios (js, manifest, iconos): caché primero para
  // velocidad y uso offline, actualizando la caché en segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => null);
      return cached || network;
    })
  );
});
