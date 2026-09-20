/**
 * ORGANIZATOR — Registrar una PushSubscription (R-8.2-A)
 *
 * POST /api/push/subscribe   body: la PushSubscription tal cual la
 * devuelve PushManager.subscribe() en el navegador:
 *   { endpoint: string, keys: { p256dh: string, auth: string } }
 *   → 200 { ok: true }
 *   → 400/401/500 { error: string }
 *
 * Autenticado (misma cookie de sesión que api/auth/*, ver lib/auth.js):
 * la suscripción SIEMPRE se asocia al usuario de la sesión actual, nunca a
 * uno indicado por el cliente en el body — así ningún usuario puede
 * registrar (ni pisar) la suscripción de otro.
 *
 * Idempotente por `endpoint` (UNIQUE en push_subscriptions, ver
 * sql/002_push_subscriptions.sql): volver a suscribirse con el mismo
 * endpoint actualiza la fila existente (reasociándola al usuario de la
 * sesión actual y refrescando sus claves/`last_seen_at`) en vez de crear
 * una segunda fila.
 */

const db = require('../../lib/db');
const auth = require('../../lib/auth');

function isValidSubscription(body) {
  return !!body
    && typeof body.endpoint === 'string' && body.endpoint.length > 0
    && body.keys && typeof body.keys === 'object'
    && typeof body.keys.p256dh === 'string' && body.keys.p256dh.length > 0
    && typeof body.keys.auth === 'string' && body.keys.auth.length > 0;
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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  if (!isValidSubscription(body)) {
    return res.status(400).json({ error: 'La suscripción enviada no tiene una forma válida (falta endpoint o keys.p256dh/auth).' });
  }

  let sql;
  try {
    sql = db.getSql();
  } catch (err) {
    console.error('[api/push/subscribe] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  try {
    await sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, last_seen_at)
      VALUES (${userId}, ${body.endpoint}, ${body.keys.p256dh}, ${body.keys.auth}, now())
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            last_seen_at = now()
    `;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/push/subscribe] Error al guardar la suscripción:', err);
    return res.status(500).json({ error: 'No se pudo guardar la suscripción. Inténtalo de nuevo.' });
  }
};
