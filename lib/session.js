/**
 * ORGANIZATOR — Sesión de usuario
 *
 * La sesión se guarda en una cookie httpOnly con un JWT firmado
 * (variable de entorno JWT_SECRET, solo en el servidor). El navegador
 * nunca ve ni manipula el contenido del token.
 */

const jwt = require('jsonwebtoken');

const SESSION_COOKIE = 'organizator_session';
const SESSION_DAYS = 30;

function buildSessionCookie(token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function signSession(payload, secret) {
  return jwt.sign(payload, secret, { expiresIn: `${SESSION_DAYS}d` });
}

function verifySession(token, secret) {
  return jwt.verify(token, secret);
}

module.exports = {
  SESSION_COOKIE,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  signSession,
  verifySession,
};
