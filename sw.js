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

const CACHE_VERSION = 'v2.3.22';
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
  '/js/sw-push-ledger.js',
  '/js/sync-merge.js',
  '/js/sync-storage.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

// R-8.2-D: ledger persistente (IndexedDB, independiente de
// window.storage) de qué reminderId ya mostró un push este Service
// Worker — ver js/sw-push-ledger.js para el detalle completo y la
// separación de responsabilidades con state.reminderNotificationLedger
// (R-8.2-C, en organizator.html). Se importa con `importScripts` (API
// síncrona estándar de Service Workers, no requiere `type: module`) y
// se ejecuta en este MISMO scope global, así que expone
// `self.SWPushLedger` sin necesitar ningún otro cambio. Si el import
// fallara (archivo no cacheado y sin red en el primer arranque, muy
// improbable), `self.SWPushLedger` simplemente no existe y el
// manejador de 'push' de más abajo ya está preparado para ese caso
// (comprobación defensiva antes de usarlo, fail-open: nunca deja de
// mostrar el aviso por esto).
try {
  importScripts('/js/sw-push-ledger.js');
} catch (err) {
  console.warn('[SW] No se pudo cargar sw-push-ledger.js (la deduplicación de push quedará deshabilitada esta sesión)', err);
}

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

  // Las respuestas de la API (/api/*) NUNCA se cachean ni se sirven desde
  // caché: dependen de la sesión (cookie) y del usuario, así que servir una
  // copia guardada podría mostrar la sesión o los datos de OTRA cuenta
  // (p. ej. un GET /api/auth/me cacheado tras cerrar sesión). Van siempre
  // directas a la red, igual que las peticiones que no son GET.
  if (new URL(req.url).pathname.startsWith('/api/')) {
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

/* ==================================================================
   R-8 — Notificaciones con la app cerrada: infraestructura del lado del
   Service Worker (evento `push` + `notificationclick`).

   ESTADO (actualizado en R-8.2-D; ver R-8.1/R-8.2-A/R-8.2-B/R-8.2-C para
   el historial completo): el backend de Web Push YA existe (claves de
   servidor, QStash, api/push/*.js, tablas SQL) y organizator.html YA se
   suscribe (tras acción explícita del usuario, nunca sola) y sincroniza
   sus reminders con él — ver el bloque RECORDATORIOS — integración con
   Web Push (R-8.2-B), RECORDATORIOS — reconciliación local↔Web Push
   (R-8.2-C) y RECORDATORIOS — robustez de Web Push (R-8.2-D) en
   organizator.html. Este archivo sigue siendo deliberadamente "tonto":
   nunca lee ni escribe `state.reminders` ni ninguna otra cosa del
   IndexedDB de la página (`organizator-storage`, ver
   storage-polyfill.js), y nunca decide SI debe mostrar un push en
   función de ellos — se limita a:
   - `push`: valida el payload de forma defensiva (nunca asume una forma
     concreta, nunca lanza), DEDUPLICA de forma persistente por
     `reminderId` (R-8.2-D: self.SWPushLedger, ver
     js/sw-push-ledger.js — sobrevive a que el Service Worker se
     reinicie y a que no haya ninguna pestaña abierta) y muestra la
     notificación vía `self.registration.showNotification()` — el único
     mecanismo correcto dentro de un Service Worker (aquí NO existe
     `window`/`document`, así que `new Notification(...)`, que sí se
     sigue usando en organizator.html para las notificaciones con la app
     ABIERTA — ver showReminderNotification, Fase 5 — no está
     disponible). Incluye el `reminderId` del payload en
     `notification.data` y, si hay alguna pestaña de ORGANIZATOR
     abierta, le avisa por `postMessage` (ver R-8.2-C) para que esa
     pestaña registre la entrega en su propio ledger — un mensaje
     puramente informativo, nunca un acceso al IndexedDB de la página.
   - `notificationclick`: enfoca una pestaña de ORGANIZATOR ya abierta, o
     abre una nueva si no había ninguna. Se reutiliza también si algún día
     se muestran notificaciones desde aquí por cualquier otro motivo.
   LÍMITE REAL que sigue existiendo tras R-8.2-D (documentado, no
   disimulado): el ledger persistente tiene una política de limpieza con
   TTL (ver js/sw-push-ledger.js) — si el usuario reabre ORGANIZATOR
   pasado ese TTL con el reminder todavía pending, el polling local SÍ
   podría volver a notificar. Se considera un caso extremo aceptable
   (igual criterio que el TTL de 24h de state.reminderNotificationLedger
   en R-8.2-C): el TTL de este ledger es deliberadamente mucho más
   generoso (7 días) porque su propósito es justo cubrir reaperturas
   tardías, no solo carreras de segundos entre canales.
   ================================================================== */
self.addEventListener('push', (event) => {
  // Nunca se asume que event.data existe o que es JSON válido: un
  // payload ausente o corrupto muestra una notificación genérica en vez
  // de lanzar o de no mostrar nada.
  let payload = {};
  try {
    if (event.data) payload = event.data.json();
  } catch (err) {
    payload = {};
  }
  if (!payload || typeof payload !== 'object') payload = {};

  const title = (typeof payload.title === 'string' && payload.title.trim()) ? payload.title : 'ORGANIZATOR';
  const body = (typeof payload.body === 'string' && payload.body.trim()) ? payload.body : 'Tienes un recordatorio pendiente.';
  const url = (typeof payload.url === 'string' && payload.url) ? payload.url : '/';
  // `tag` agrupa/reemplaza notificaciones del mismo reminder si el
  // backend llegara a reintentar el envío — nunca duplica.
  const tag = (typeof payload.tag === 'string' && payload.tag) ? payload.tag : 'organizator-reminder';
  // R-8.2-C/D: identifica, del lado de ORGANIZATOR, a qué reminder
  // corresponde este push (mismo reminder.id que usa el cliente, ver
  // RECORDATORIOS — integración con Web Push en organizator.html).
  // Puede faltar (payload antiguo, o error de servidor): en ese caso no
  // hay forma de deduplicar ni de relayar nada, pero la notificación se
  // muestra igual (nunca se prefiere silenciar un aviso real).
  const reminderId = (typeof payload.reminderId === 'string' && payload.reminderId) ? payload.reminderId : '';

  event.waitUntil((async () => {
    // R-8.2-D: deduplicación persistente por reminderId. markDelivered()
    // es atómico ("quien llega primero, gana" a nivel de la propia base
    // de datos, ver js/sw-push-ledger.js): si YA había una marca para
    // este reminderId — reintento de QStash, dos pushes casi
    // simultáneos, o el Service Worker reiniciándose justo entre
    // medias — devuelve false y NO se vuelve a mostrar la notificación
    // nativa, evitando duplicados aunque no haya (ni haya habido nunca
    // en esta sesión) ninguna pestaña abierta. Si no hay reminderId, o
    // el ledger no está disponible por cualquier motivo (falló
    // importScripts, IndexedDB restringido...), se falla "abierto": se
    // muestra igual — nunca se prefiere silenciar un aviso real a
    // arriesgarse a un duplicado poco frecuente.
    let alreadyShown = false;
    if (reminderId && self.SWPushLedger && typeof self.SWPushLedger.markDelivered === 'function') {
      try {
        const isNew = await self.SWPushLedger.markDelivered(reminderId);
        alreadyShown = !isNew;
      } catch (err) { alreadyShown = false; }
    }

    if (!alreadyShown) {
      try {
        await self.registration.showNotification(title, {
          body,
          tag,
          data: { url, reminderId },
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
        });
      } catch (err) { /* nunca lanza: un fallo mostrando la notificación no debe tumbar el resto del manejador */ }
    }

    // R-8.2-C: si ORGANIZATOR está abierto en alguna pestaña, avisa
    // (mecanismo estándar: clients.matchAll + postMessage) para que esa
    // pestaña registre la entrega en SU PROPIO ledger
    // (state.reminderNotificationLedger, ver handleServiceWorkerMessage
    // en organizator.html) y el polling local no muestre un segundo
    // aviso. Se hace TAMBIÉN cuando `alreadyShown` es true (duplicado):
    // una pestaña recién abierta que todavía no ha hecho polling se
    // entera al instante en vez de esperar al siguiente tick — idempotente
    // en el lado de la página (markReminderNotified ya lo es, R-8.2-C),
    // así que avisar de más nunca causa una notificación local extra. El
    // Service Worker NUNCA toca state.reminders/IndexedDB de la página
    // desde aquí. Si no hay ninguna pestaña abierta (app completamente
    // cerrada) esto no hace nada — para ESE caso concreto es el ledger
    // persistente de arriba (R-8.2-D) el que evita la duplicación al
    // reabrir, no esta vía.
    if (reminderId) {
      try {
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clientsList.forEach((client) => {
          try { client.postMessage({ type: 'REMINDER_PUSH_DELIVERED', reminderId }); } catch (err) {}
        });
      } catch (err) {}
    }

    // R-8.2-D: aprovecha cada push (evento que de todos modos despierta
    // al Service Worker) para limpiar marcas caducadas del ledger
    // persistente — ver pruneDelivered()/TTL en js/sw-push-ledger.js.
    // Nunca crea un temporizador propio (los Service Workers no pueden
    // fiarse de setInterval mientras están inactivos) ni bloquea/aborta
    // nada de lo de arriba si fallara.
    if (self.SWPushLedger && typeof self.SWPushLedger.pruneDelivered === 'function') {
      try { await self.SWPushLedger.pruneDelivered(Date.now()); } catch (err) {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && typeof event.notification.data.url === 'string')
    ? event.notification.data.url
    : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        // Reutiliza una pestaña de ORGANIZATOR ya abierta en vez de abrir
        // otra: basta con que su URL sea del mismo origen (el shell es
        // siempre '/', ver PRECACHE_URLS arriba).
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return null;
    }).catch(() => {})
  );
});
