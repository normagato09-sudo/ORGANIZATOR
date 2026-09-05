/**
 * ORGANIZATOR — Registro de usuario
 *
 * POST /api/auth/register   body: { email, password, name? }
 *   → 201 { user: { id, email, name } }  (+ cookie de sesión)
 *   → 400/409/500 { error: string }
 */

const bcrypt = require('bcryptjs');
const { getSql } = require('../../lib/db');
const { buildSessionCookie, signSession } = require('../../lib/session');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('[api/auth/register] Falta la variable de entorno JWT_SECRET en Vercel');
    return res.status(500).json({ error: 'El servidor no está configurado todavía.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body && body.password;
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Introduce un email válido.' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (err) {
    console.error('[api/auth/register] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  try {
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO users (email, password_hash, name)
      VALUES (${email}, ${passwordHash}, ${name || null})
      RETURNING id, email, name
    `;
    const user = rows[0];

    const token = signSession({ sub: user.id, email: user.email }, jwtSecret);
    res.setHeader('Set-Cookie', buildSessionCookie(token));
    return res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[api/auth/register] Error al crear el usuario:', err);
    return res.status(500).json({ error: 'No se pudo crear la cuenta. Inténtalo de nuevo.' });
  }
};
