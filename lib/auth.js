// lib/auth.js
//
// Todo lo relacionado con contraseñas y sesión vive SOLO aquí, en el servidor.
// El navegador nunca ve el hash ni compara nada: manda usuario+contraseña
// por HTTPS y el servidor responde sí/no.

const crypto = require('crypto');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  // Sin esto, cualquiera podría firmar sus propias cookies de sesión y
  // suplantar a cualquier usuario. Mejor fallar de forma clara en el arranque
  // que quedarse con un secreto público conocido en producción.
  throw new Error('Falta la variable de entorno SESSION_SECRET en producción.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-cambia-esto-en-produccion';
const SESSION_COOKIE = 'midia_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function genRecoveryCode() {
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  try {
    const check = Buffer.from(hashPassword(password, salt), 'hex');
    const expected = Buffer.from(hash, 'hex');
    if (check.length !== expected.length) return false;
    return crypto.timingSafeEqual(check, expected);
  } catch (e) {
    return false;
  }
}

function sign(value) {
  const h = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}
function unsign(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const h = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  const hBuf = Buffer.from(h);
  const expBuf = Buffer.from(expected);
  if (hBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(hBuf, expBuf)) return null;
  return value;
}

function parseCookies(str) {
  const out = {};
  (str || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, userId) {
  const token = sign(userId);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secure}`
  );
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}
function getUserIdFromReq(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  return unsign(token);
}

// Para usar al principio de cualquier endpoint que requiera sesión.
// Si no hay sesión válida, responde 401 y devuelve null (el endpoint debe
// cortar ahí: `const userId = await requireAuth(req, res); if (!userId) return;`)
async function requireAuth(req, res) {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    res.status(401).json({ error: 'No has iniciado sesión.' });
    return null;
  }
  return userId;
}

module.exports = {
  randomHex,
  genRecoveryCode,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  getUserIdFromReq,
  requireAuth,
};
