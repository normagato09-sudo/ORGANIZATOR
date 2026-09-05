/**
 * ORGANIZATOR — Comprobar sesión actual
 *
 * GET /api/auth/me
 *   → 200 { user: { id, email, name } }
 *   → 401 { error: string }   (sin sesión, token caducado, o cuenta borrada)
 */

const { getSql } = require('../../lib/db');
const { SESSION_COOKIE, parseCookies, verifySession } = require('../../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido. Usa GET.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('[api/auth/me] Falta la variable de entorno JWT_SECRET en Vercel');
    return res.status(500).json({ error: 'El servidor no está configurado todavía.' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'No has iniciado sesión.' });
  }

  let payload;
  try {
    payload = verifySession(token, jwtSecret);
  } catch (err) {
    return res.status(401).json({ error: 'Tu sesión ha caducado. Inicia sesión de nuevo.' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (err) {
    console.error('[api/auth/me] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  try {
    const rows = await sql`SELECT id, email, name FROM users WHERE id = ${payload.sub}`;
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'La cuenta ya no existe.' });
    }
    return res.status(200).json({ user });
  } catch (err) {
    console.error('[api/auth/me] Error al comprobar la sesión:', err);
    return res.status(500).json({ error: 'No se pudo comprobar la sesión.' });
  }
};
