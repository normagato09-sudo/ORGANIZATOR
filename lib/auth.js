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

function// lib/auth.js
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

function
