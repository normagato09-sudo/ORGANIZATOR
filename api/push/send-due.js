/**
 * ORGANIZATOR — Recepción de la llamada programada de QStash (R-8.2-A)
 *
 * POST /api/push/send-due   (llamado por QStash, NUNCA por el navegador)
 *   body: { pushReminderId: number }
 *   → 200 { ok: true, status: 'sent'|'already_handled'|'no_subscriptions'|'disabled' }
 *   → 401 { error: string }   (firma de QStash ausente/ inválida)
 *   → 400/500 { error: string }
 *
 * SEGURIDAD: este endpoint NO usa la cookie de sesión (quien lo llama es
 * QStash, no un usuario logueado en un navegador) — su autenticación es la
 * verificación de firma `Upstash-Signature` (ver lib/qstash-receiver.js).
 * Cualquier petición sin firma válida se rechaza con 401 antes de tocar la
 * base de datos.
 *
 * `bodyParser` se desactiva a propósito PARA ESTE endpoint (y solo este):
 * la verificación de firma de QStash exige el cuerpo EXACTO, byte a byte,
 * tal como se envió — si Vercel lo parseara a objeto primero, volver a
 * serializarlo con JSON.stringify podría no coincidir con el original
 * (distinto orden de claves/espacios) y la firma dejaría de verificar. Es
 * el mismo patrón estándar que usan los webhooks de Stripe/GitHub.
 *
 * IDEMPOTENCIA (punto 9 del encargo): la única operación que "reclama" el
 * envío es un UPDATE atómico `WHERE status = 'pending'` — si QStash
 * reintenta la entrega (reintentos automáticos documentados de QStash) o
 * si esta función se invoca dos veces por cualquier motivo, la segunda
 * llamada no encuentra ninguna fila en 'pending' y responde
 * 'already_handled' sin enviar una segunda notificación real.
 */

const db = require('../../lib/db');
const vapid = require('../../lib/vapid');
const qstashReceiver = require('../../lib/qstash-receiver');

// App de exámenes: interruptor de los avisos de recordatorios (ver abajo).
// Apagado. Solo los tests lo encienden (setPushRemindersEnabledForTests)
// para seguir comprobando el envío por si algún día se vuelve a activar.
let PUSH_REMINDERS_ENABLED = false;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl) {
    console.error('[api/push/send-due] Falta la variable de entorno PUBLIC_APP_URL en Vercel');
    return res.status(500).json({ error: 'Las notificaciones push no están configuradas en el servidor todavía.' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['upstash-signature'];
  const destinationUrl = `${publicAppUrl.replace(/\/$/, '')}/api/push/send-due`;
  const validSignature = await qstashReceiver.verifyQStashSignature({ signature, rawBody, url: destinationUrl });
  if (!validSignature) {
    return res.status(401).json({ error: 'Firma de QStash ausente o inválida.' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
  }
  const pushReminderId = payload && Number.isInteger(payload.pushReminderId) ? payload.pushReminderId : null;
  if (!pushReminderId) {
    return res.status(400).json({ error: 'Falta o es inválido el campo "pushReminderId".' });
  }

  let sql;
  try {
    sql = db.getSql();
  } catch (err) {
    console.error('[api/push/send-due] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  // App de exámenes: los recordatorios están apagados. Un aviso programado
  // antes (en QStash) que llegue ahora se marca como cancelado y NO se
  // envía al móvil, venga de la versión de la app que venga. Para volver
  // a encenderlos basta con poner PUSH_REMINDERS_ENABLED a true arriba.
  if (!PUSH_REMINDERS_ENABLED) {
    try {
      await sql`UPDATE push_reminders SET status = 'cancelled' WHERE id = ${pushReminderId} AND status = 'pending'`;
    } catch (err) {
      console.error('[api/push/send-due] Error al cancelar el reminder (recordatorios apagados):', err);
    }
    return res.status(200).json({ ok: true, status: 'disabled' });
  }

  // Reclamo atómico: solo una invocación (incluidos reintentos de QStash)
  // puede pasar esta fila de 'pending' a 'triggered'. Ninguna otra
  // condición (fecha, etc.) se vuelve a comprobar aquí a propósito: QStash
  // ya es quien decide CUÁNDO llamar (Upstash-Not-Before); este endpoint
  // solo decide SI todavía corresponde enviar algo.
  let claimed;
  try {
    const rows = await sql`
      UPDATE push_reminders SET status = 'triggered'
      WHERE id = ${pushReminderId} AND status = 'pending'
      RETURNING id, user_id, reminder_id, title, body
    `;
    claimed = rows[0] || null;
  } catch (err) {
    console.error('[api/push/send-due] Error al reclamar el reminder:', err);
    return res.status(500).json({ error: 'No se pudo procesar el recordatorio.' });
  }

  if (!claimed) {
    // Ya se envió antes (reintento de QStash), o se canceló entre que se
    // programó y que tocaba enviarlo, o el id no existe. En los tres
    // casos: nada que hacer, y NUNCA se envía una segunda notificación.
    return res.status(200).json({ ok: true, status: 'already_handled' });
  }

  let subscriptions;
  try {
    subscriptions = await sql`
      SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${claimed.user_id}
    `;
  } catch (err) {
    console.error('[api/push/send-due] Error al leer las suscripciones:', err);
    // El reminder ya quedó 'triggered' (mismo criterio que
    // triggerDueReminders() en organizator.html: un fallo mostrando el
    // aviso nunca revierte el estado ya marcado) — se informa el fallo,
    // pero no se reintenta desde aquí.
    return res.status(200).json({ ok: true, status: 'no_subscriptions' });
  }

  if (!subscriptions.length) {
    return res.status(200).json({ ok: true, status: 'no_subscriptions' });
  }

  // R-8.2-C: reminderId (el id de ORGANIZATOR, no el id interno de esta
  // fila) viaja en el payload para que sw.js pueda avisar a la página
  // (si está abierta) de qué reminder concreto recibió el push, y así
  // evitar una doble notificación (ver organizator.html, bloque
  // RECORDATORIOS — reconciliación local↔Web Push).
  const payloadToSend = { title: claimed.title, body: claimed.body, url: '/', tag: `push-reminder-${claimed.id}`, reminderId: claimed.reminder_id };
  let sentCount = 0;
  for (const sub of subscriptions) {
    try {
      await vapid.sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payloadToSend
      );
      sentCount += 1;
    } catch (err) {
      // Gestión de suscripciones inválidas/expiradas (punto 8 del
      // encargo): 404/410 significa que el servicio de push ya no conoce
      // esa suscripción — se elimina para no volver a intentarlo nunca
      // (evita acumular suscripciones muertas indefinidamente). Cualquier
      // otro error se registra pero no borra la suscripción (podría ser
      // un fallo transitorio de red, no una suscripción caducada).
      const statusCode = err && err.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        try {
          await sql`DELETE FROM push_subscriptions WHERE id = ${sub.id}`;
        } catch (deleteErr) {
          console.error('[api/push/send-due] No se pudo eliminar la suscripción caducada:', deleteErr);
        }
      } else {
        console.error('[api/push/send-due] Fallo enviando push a una suscripción:', err);
      }
    }
  }

  return res.status(200).json({ ok: true, status: sentCount > 0 ? 'sent' : 'no_subscriptions' });
};

// Desactiva el parseo automático del cuerpo SOLO para este endpoint: la
// verificación de firma de QStash necesita el cuerpo crudo exacto (ver
// comentario de cabecera). Ningún otro endpoint de api/push/*.js lo
// necesita (ninguno verifica una firma de webhook).
module.exports.config = { api: { bodyParser: false } };
module.exports.setPushRemindersEnabledForTests = (enabled) => { PUSH_REMINDERS_ENABLED = !!enabled; };
