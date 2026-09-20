/**
 * ORGANIZATOR — Autenticación compartida para endpoints serverless (R-8.2-A)
 *
 * Envuelve el MISMO mecanismo de sesión que ya usan api/auth/* (cookie
 * httpOnly con JWT, ver lib/session.js) en una única función reutilizable,
 * para no repetir el mismo bloque de "leer cookie -> verificar JWT" en
 * cada endpoint nuevo de push/*.js. No cambia ni reimplementa
 * signSession/verifySession/parseCookies: los reutiliza tal cual.
 *
 * A propósito NO se destructura `getSql`/`verifySession` al importar este
 * módulo desde los endpoints (se usa `session.verifySession(...)`, no
 * `const { verifySession } = require(...)`) para que los tests puedan
 * sustituir esas funciones por mocks reasignando la propiedad del módulo
 * ya cargado, sin necesitar ninguna librería de mocking nueva.
 */

const session = require('./session');

/** Devuelve el `user_id` (payload.sub) de la sesión válida en la cookie de
 * la petición, o `null` si no hay sesión, el JWT_SECRET no está
 * configurado, o el token es inválido/ha caducado. Nunca lanza. */
function getAuthenticatedUserId(req, jwtSecret) {
  if (!jwtSecret) return null;
  const cookies = session.parseCookies(req.headers && req.headers.cookie);
  const token = cookies[session.SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = session.verifySession(token, jwtSecret);
    return (payload && payload.sub) || null;
  } catch (err) {
    return null;
  }
}

module.exports = { getAuthenticatedUserId };
