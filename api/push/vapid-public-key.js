/**
 * ORGANIZATOR — Clave pública VAPID (R-8.2-A)
 *
 * GET /api/push/vapid-public-key
 *   → 200 { publicKey: string }
 *   → 500 { error: string }   (VAPID no configurado en el servidor)
 *
 * Endpoint PÚBLICO a propósito: la clave pública VAPID está pensada para
 * viajar al navegador (la necesita PushManager.subscribe() como
 * applicationServerKey) — nunca es un secreto. La clave PRIVADA
 * (VAPID_PRIVATE_KEY) nunca pasa por aquí ni por ningún otro endpoint.
 */

const vapid = require('../../lib/vapid');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido. Usa GET.' });
  }

  let publicKey;
  try {
    publicKey = vapid.getPublicKey();
  } catch (err) {
    console.error('[api/push/vapid-public-key] Error de configuración:', err);
    return res.status(500).json({ error: 'Las notificaciones push no están configuradas en el servidor todavía.' });
  }

  return res.status(200).json({ publicKey });
};
