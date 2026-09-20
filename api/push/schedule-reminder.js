/**
 * ORGANIZATOR — Programar el envío Web Push de un reminder (R-8.2-A)
 *
 * POST /api/push/schedule-reminder
 *   body: { reminderId: string, remindAt: string (ISO), title: string, body: string }
 *   → 200 { ok: true, pushReminderId: number }
 *   → 400/401/500 { error: string }
 *
 * NO se llama todavía desde createReminderForTarget()/syncReminderForTarget()
 * ni desde ninguna UI (eso es R-8.2-B, deliberadamente fuera de esta fase).
 * Este endpoint es la pieza de infraestructura que esa integración futura
 * usará.
 *
 * `title`/`body` llegan YA resueltos por el llamador (el cliente, en
 * R-8.2-B, reutilizará reminderNotificationBody() tal cual) — este
 * endpoint nunca reconstruye esos textos a partir de tasks/events, porque
 * nunca los recibe (ver sql/003_push_reminders.sql).
 *
 * Reprogramación: si ya existía una fila para (userId, reminderId) con un
 * mensaje QStash pendiente, se cancela ANTES de programar el nuevo (mejor
 * esfuerzo: si la cancelación falla porque el mensaje ya se entregó, no se
 * aborta la nueva programación — la idempotencia real la da de todos
 * modos el `status='pending'` que exige send-due.js antes de enviar nada).
 */

const db = require('../../lib/db');
const auth = require('../../lib/auth');
const qstash = require('../../lib/qstash');

function isValidPayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (typeof body.reminderId !== 'string' || !body.reminderId) return false;
  if (typeof body.title !== 'string' || !body.title) return false;
  if (typeof body.body !== 'string' || !body.body) return false;
  if (typeof body.remindAt !== 'string' || !body.remindAt) return false;
  const d = new Date(body.remindAt);
  return !isNaN(d.getTime());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  const userId = auth.getAuthenticatedUserId(req, jwtSecret);
  if (!userId) {
    return res.status(401).json({ error: 'No has iniciado sesión.' });
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl) {
    console.error('[api/push/schedule-reminder] Falta la variable de entorno PUBLIC_APP_URL en Vercel');
    return res.status(500).json({ error: 'Las notificaciones push no están configuradas en el servidor todavía.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!isValidPayload(body)) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (reminderId/remindAt/title/body) o remindAt no es una fecha válida.' });
  }

  let sql;
  try {
    sql = db.getSql();
  } catch (err) {
    console.error('[api/push/schedule-reminder] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  try {
    // Reprogramación: cancela el mensaje QStash anterior de ESTE reminder
    // (si lo había y seguía pendiente) antes de programar el nuevo.
    const existingRows = await sql`
      SELECT qstash_message_id, status FROM push_reminders
      WHERE user_id = ${userId} AND reminder_id = ${body.reminderId}
    `;
    const existing = existingRows[0];
    if (existing && existing.status === 'pending' && existing.qstash_message_id) {
      try {
        await qstash.cancelMessage(existing.qstash_message_id);
      } catch (err) {
        console.warn('[api/push/schedule-reminder] No se pudo cancelar el mensaje QStash anterior (se continúa igualmente):', err);
      }
    }

    const upserted = await sql`
      INSERT INTO push_reminders (user_id, reminder_id, remind_at, status, title, body, qstash_message_id)
      VALUES (${userId}, ${body.reminderId}, ${body.remindAt}, 'pending', ${body.title}, ${body.body}, NULL)
      ON CONFLICT (user_id, reminder_id) DO UPDATE
        SET remind_at = EXCLUDED.remind_at,
            status = 'pending',
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            qstash_message_id = NULL
      RETURNING id
    `;
    const pushReminderId = upserted[0].id;

    const destinationUrl = `${publicAppUrl.replace(/\/$/, '')}/api/push/send-due`;
    const messageId = await qstash.scheduleMessage({
      destinationUrl,
      body: { pushReminderId },
      notBeforeDate: new Date(body.remindAt),
    });

    await sql`UPDATE push_reminders SET qstash_message_id = ${messageId} WHERE id = ${pushReminderId}`;

    return res.status(200).json({ ok: true, pushReminderId });
  } catch (err) {
    console.error('[api/push/schedule-reminder] Error al programar el reminder:', err);
    return res.status(500).json({ error: 'No se pudo programar el recordatorio. Inténtalo de nuevo.' });
  }
};
