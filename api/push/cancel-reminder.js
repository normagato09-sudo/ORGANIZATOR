/**
 * ORGANIZATOR — Cancelar el envío Web Push programado de un reminder (R-8.2-A)
 *
 * POST /api/push/cancel-reminder   body: { reminderId: string }
 *   → 200 { ok: true }
 *   → 400/401/500 { error: string }
 *
 * Autenticado, y SIEMPRE acotado a (userId, reminderId) — un usuario nunca
 * puede cancelar el reminder de otro ni aunque adivine su reminderId.
 * Idempotente: cancelar un reminder que no existe, que ya estaba
 * cancelado, o que ya se disparó, responde 200 igualmente sin cambiar
 * nada (mismo espíritu que cancelReminder() en organizator.html, que
 * tampoco lanza ni distingue esos casos de cara al llamador).
 */

const db = require('../../lib/db');
const auth = require('../../lib/auth');
const qstash = require('../../lib/qstash');

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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const reminderId = body && typeof body.reminderId === 'string' ? body.reminderId : '';
  if (!reminderId) {
    return res.status(400).json({ error: 'Falta el campo "reminderId".' });
  }

  let sql;
  try {
    sql = db.getSql();
  } catch (err) {
    console.error('[api/push/cancel-reminder] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  try {
    const rows = await sql`
      SELECT id, status, qstash_message_id FROM push_reminders
      WHERE user_id = ${userId} AND reminder_id = ${reminderId}
    `;
    const row = rows[0];
    if (!row || row.status !== 'pending') {
      // Nada que cancelar (no existe, ya cancelado, o ya disparado) — no
      // es un error, es el mismo resultado final que se pedía.
      return res.status(200).json({ ok: true });
    }

    if (row.qstash_message_id) {
      try {
        await qstash.cancelMessage(row.qstash_message_id);
      } catch (err) {
        console.warn('[api/push/cancel-reminder] No se pudo cancelar el mensaje QStash (se marca cancelado igualmente):', err);
      }
    }

    await sql`UPDATE push_reminders SET status = 'cancelled' WHERE id = ${row.id} AND user_id = ${userId}`;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/push/cancel-reminder] Error al cancelar el reminder:', err);
    return res.status(500).json({ error: 'No se pudo cancelar el recordatorio. Inténtalo de nuevo.' });
  }
};
