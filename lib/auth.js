// lib/auth.js
//
// Todo lo relacionado con contraseñas y sesión vive SOLO aquí, en el servidor.
// El navegador nunca ve el hash ni compara nada: manda usuario+contraseña
// por HTTPS y el servidor responde sí/no.

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-cambia-esto-en-produccion';
const SESSION_COOKIE = 'midia_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Formato XXXX-XXXX-XXXX. Se usa tanto al registrarse como al recuperar
// la cuenta (cada uso de recover invalida el código anterior y genera uno
// nuevo con esta misma función, para que ambos flujos sean coherentes).
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
  const
