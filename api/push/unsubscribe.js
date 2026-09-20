/**
 * ORGANIZATOR — Eliminar una PushSubscription (R-8.2-A)
 *
 * POST /api/push/unsubscribe   body: { endpoint: string }
 *   → 200 { ok: true }
 *   → 400/401/500 { error: string }
 *
 * Autenticado. Solo borra la suscripción si pertenece al usuario de la
 * sesión actual (WHERE user_id = ...) — nunca permite que un usuario
 * desuscriba el dispositivo de otro adivinando/reenviando un `endpoint`
 * ajeno. Idempotente: borrar un endpoint que ya no existe (o que nunca
 * fue tuyo) responde 200 igualmente, sin filtrar si existía o no.
 */

const db = require('../../lib/db');
const auth = require('../../lib/auth');

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
  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint : '';
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta el campo "endpoint".' });
  }

  let sql;
  try {
    sql = db.getSql();
  } catch (err) {
    console.error('[api/push/unsubscribe] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  try {
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${userId}`;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/push/unsubscribe] Error al borrar la suscripción:', err);
    return res.status(500).json({ error: 'No se pudo eliminar la suscripción. Inténtalo de nuevo.' });
  }
};
