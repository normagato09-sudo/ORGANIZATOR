/**
 * ORGANIZATOR — Cerrar sesión
 *
 * POST /api/auth/logout
 *   → 200 { ok: true }   (borra la cookie de sesión)
 */

const { clearSessionCookie } = require('../../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.status(200).json({ ok: true });
};
