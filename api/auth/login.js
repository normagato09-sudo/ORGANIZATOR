/**
 * ORGANIZATOR — Inicio de sesión
 *
 * POST /api/auth/login   body: { email, password }
 *   → 200 { user: { id, email, name } }  (+ cookie de sesión)
 *   → 400/401/500 { error: string }
 */

const bcrypt = require('bcryptjs');
const { getSql } = require('../../lib/db');
const { buildSessionCookie, signSession } = require('../../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('[api/auth/login] Falta la variable de entorno JWT_SECRET en Vercel');
    return res.status(500).json({ error: 'El servidor no está configurado todavía.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body && body.password;

  if (!email || typeof password !== 'string') {
    return res.status(400).json({ error: 'Introduce tu email y contraseña.' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (err) {
    console.error('[api/auth/login] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  try {
    const rows = await sql`SELECT id, email, name, password_hash FROM users WHERE email = ${email}`;
    const user = rows[0];

    // Mismo mensaje tanto si el email no existe como si la contraseña falla,
    // para no revelar qué emails están registrados.
    if (!user) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    const token = signSession({ sub: user.id, email: user.email }, jwtSecret);
    res.setHeader('Set-Cookie', buildSessionCookie(token));
    return res.status(200).json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[api/auth/login] Error al iniciar sesión:', err);
    return res.status(500).json({ error: 'No se pudo iniciar sesión. Inténtalo de nuevo.' });
  }
};
