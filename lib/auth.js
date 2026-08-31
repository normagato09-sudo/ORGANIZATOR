// lib/auth.js
//
// Todo lo relacionado con contraseñas y sesión vive SOLO aquí, en el servidor.
// El navegador nunca ve el hash ni compara nada: manda usuario+contraseña
// por HTTPS y el servidor responde sí/no.

const crypto = require('crypto');

const DEV_FALLBACK_SECRET = 'dev-secret-cambia-esto-en-produccion';

// En producción es obligatorio configurar SESSION_SECRET como variable de
// entorno: si faltara, cualquiera que conociera el valor por defecto podría
// firmar cookies de sesión válidas para cualquier cuenta. Por eso la app no
// debe arrancar en ese caso, en vez de arrancar "funcionando" pero insegura.
//
// En desarrollo (NODE_ENV distinto de "production") se mantiene el valor
// por defecto cómodo de siempre, solo con un aviso por consola, para no
// obligar a configurar nada al probar la app en local.
let SESSION_SECRET;
if (process.env.SESSION_SECRET) {
  SESSION_SECRET = process.env.SESSION_SECRET;
} else if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'Falta configurar la variable de entorno SESSION_SECRET en producción. ' +
      'Genera un valor aleatorio largo (por ejemplo con `openssl rand -hex 32`) ' +
      'y añádelo en la configuración del proyecto antes de desplegar.'
  );
} else {
  console.warn(
    '[aviso] SESSION_SECRET no está configurado: usando un valor de desarrollo ' +
      'no seguro. Esto NO debe ocurrir en producción.'
  );
  SESSION_SECRET = DEV_FALLBACK_SECRET;
}

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

// Formato XXXX-XXXX-XXXX. Se usa tanto al registrarse como al recuperar
// la cuenta (cada uso de recover invalida el código anterior y genera uno
// nuevo con esta misma función, para que ambos flujos sean coherentes).
function genRecoveryCode() {
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}`;
}

// --- Contraseñas ---
//
// scrypt (nativo de Node, sin dependencias externas) con salt único por
// usuario y por código de recuperación. La comparación se hace con
// timingSafeEqual para no filtrar información por tiempo de respuesta.
const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt) {
  const derived = crypto.scryptSync(String(password), String(salt), SCRYPT_KEYLEN);
  return derived.toString('hex');
}

function verifyPassword(password, salt, hash) {
  if (!hash) return false;
  let expected;
  let actual;
  try {
    expected = Buffer.from(hash, 'hex');
    actual = crypto.scryptSync(String(password), String(salt), SCRYPT_KEYLEN);
  } catch (e) {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// --- Cookie de sesión firmada ---
//
// La cookie guarda "userId.expiresAt.firma" (HMAC-SHA256 con SESSION_SECRET).
// No es un JWT ni nada estándar a propósito: es lo mínimo necesario y fácil
// de auditar. El servidor nunca confía en el userId sin comprobar antes la
// firma y la expiración.

function signPayload(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    if (!key) return;
    const value = pair.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (e) {
      cookies[key] = value;
    }
  });
  return cookies;
}

function cookieAttributes() {
  const isProd = process.env.NODE_ENV === 'production';
  // Secure solo en producción (en local por HTTP el navegador la descartaría).
  // HttpOnly siempre: el JavaScript del frontend nunca debe poder leerla.
  // SameSite=Lax: la protege de CSRF básico sin romper la navegación normal.
  return isProd ? ['HttpOnly', 'SameSite=Lax', 'Secure'] : ['HttpOnly', 'SameSite=Lax'];
}

function setSessionCookie(res, userId) {
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${userId}.${expiresAt}`;
  const signature = signPayload(payload);
  const value = `${payload}.${signature}`;

  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE}`,
    ...cookieAttributes(),
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'Max-Age=0', ...cookieAttributes()];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getUserIdFromReq(req) {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  const segments = raw.split('.');
  if (segments.length !== 3) return null;
  const [userId, expiresAtStr, signature] = segments;
  if (!userId || !expiresAtStr || !signature) return null;

  const expectedSignature = signPayload(`${userId}.${expiresAtStr}`);
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return userId;
}

// Middleware ligero para los endpoints que exigen sesión: si no hay una
// sesión válida, responde 401 él mismo y devuelve null (el endpoint debe
// cortar ahí: "if (!userId) return;").
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
