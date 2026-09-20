/**
 * ORGANIZATOR — Envío Web Push real vía VAPID (R-8.2-A)
 *
 * Envuelve la librería oficial `web-push` (única forma correcta de firmar
 * y cifrar un mensaje Web Push con VAPID sin reimplementar ECDH/AES-GCM a
 * mano — un candidato claro a "no reinventar criptografía").
 *
 * SEGURIDAD: `VAPID_PRIVATE_KEY` se lee EXCLUSIVAMENTE de la variable de
 * entorno del servidor (Vercel). Nunca se expone en ninguna respuesta HTTP,
 * nunca llega a organizator.html ni a sw.js. Solo `VAPID_PUBLIC_KEY` es
 * seguro de exponer al cliente (ver api/push/vapid-public-key.js).
 *
 * `setVapidDetails` se llama una sola vez, de forma perezosa (la primera
 * vez que se necesita), igual que getSql() en lib/db.js reutiliza una
 * única conexión — evita reconfigurar la librería en cada invocación de
 * una misma instancia de función serverless.
 */

const webpush = require('web-push');

let configured = false;

/** Configura `web-push` con las claves VAPID del entorno la primera vez
 * que se llama. Lanza si faltan las variables de entorno necesarias (fallo
 * de configuración del servidor, nunca del usuario — el propio endpoint
 * que llame a esto debe capturarlo y devolver 500, mismo patrón que
 * getSql() en lib/db.js). */
function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error('Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT en las variables de entorno de Vercel');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/** Clave pública VAPID, la única mitad segura de exponer al cliente (ver
 * api/push/vapid-public-key.js). Lanza el mismo error de configuración que
 * ensureConfigured() si falta la variable de entorno. */
function getPublicKey() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error('Falta VAPID_PUBLIC_KEY en las variables de entorno de Vercel');
  }
  return publicKey;
}

/** Envía una notificación Web Push real a una PushSubscription concreta.
 * `subscription` es { endpoint, keys: { p256dh, auth } } — la MISMA forma
 * que devuelve PushManager.subscribe() en el navegador (ver
 * push_subscriptions, R-8.1-E). `payload` es un objeto plano (se
 * serializa a JSON aquí, nunca se pide al llamador que lo haga dos veces).
 * Nunca atrapa errores: el llamador (api/push/send-due.js) necesita
 * inspeccionar `err.statusCode` para distinguir una suscripción caducada
 * (404/410, ver R-8.1-H "gestión de suscripciones inválidas") de un fallo
 * transitorio de red. */
async function sendPush(subscription, payload) {
  ensureConfigured();
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

module.exports = { ensureConfigured, getPublicKey, sendPush };
