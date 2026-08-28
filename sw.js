// sw.js — PARTE 7.3: acciones desde las notificaciones del planificador diario.
//
// Este Service Worker NO programa avisos por sí solo (no hay servidor de push): sigue siendo
// la app, con setTimeout, la que decide cuándo llamar a showNotification. Lo único que aporta
// este archivo es que esas notificaciones puedan tener botones (Empezar / Completar / Posponer)
// y que tocarlas funcione aunque la pestaña de la app esté en segundo plano.
//
// Debe servirse desde la MISMA carpeta que el HTML del planificador, por http/https o localhost
// (los Service Worker no funcionan al abrir el HTML directamente como archivo local ni desde blob:).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Al tocar la notificación (o uno de sus botones), avisamos a la app abierta para que aplique
// la acción sobre el estado real (localStorage/window.storage vive en la pestaña, no aquí).
// Si no hay ninguna pestaña abierta, abrimos una nueva pasándole la acción por la URL, ya que
// no existe ninguna pestaña a la que hacer postMessage todavía.
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action || 'open'; // '' cuando se toca el cuerpo, no un botón
  notification.close();

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (allClients.length) {
      allClients.forEach(c => c.postMessage({ type: 'notif-action', action, blockId: data.blockId, kind: data.kind }));
      await allClients[0].focus();
      return;
    }
    const base = data.url || './';
    const url = base + '?notifAction=' + encodeURIComponent(action)
      + '&blockId=' + encodeURIComponent(data.blockId || '')
      + '&kind=' + encodeURIComponent(data.kind || 'block');
    await self.clients.openWindow(url);
  })());
});

// Si el usuario descarta la notificación sin tocarla, no hace falta hacer nada especial:
// la app ya la había marcado como "pendiente" y volverá a evaluarla en el siguiente recálculo.
self.addEventListener('notificationclose', () => {});
