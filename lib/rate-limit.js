// lib/rate-limit.js
//
// Límite de intentos sencillo basado en el mismo almacén kv que ya usa el
// resto de la app (Redis en producción, fichero JSON en local), así que
// funciona igual en ambos entornos sin dependencias nuevas.
//
// Se limita por DOS claves a la vez para cada intento:
//   - por cuenta (username), para frenar ataques dirigidos a una cuenta concreta.
//   - por IP, para frenar a un atacante que prueba muchas cuentas distintas.
// Basta con que UNA de las dos supere el límite para bloquear el intento.
//
// El contador tiene una ventana (windowSeconds) tras la cual expira solo
// (usa el ttlSeconds que kv.set ya soporta), así nunca hace falta limpieza
// manual y un usuario legítimo que se equivocó nunca queda bloqueado para
// siempre: como mucho espera a que pase la ventana.

const { kv } = require('./kv');

function getClientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Comprueba si una acción (p. ej. "login" o "recover") está bloqueada para
 * esta cuenta y/o esta IP, y si no lo está, cuenta este intento.
 *
 * @returns {Promise<{blocked: boolean, retryAfterSeconds?: number}>}
 */
async function checkAndCount(action, req, accountKey, { maxAttempts, windowSeconds }) {
  const ip = getClientIp(req);
  const keys = [
    `ratelimit:${action}:acct:${accountKey || 'unknown'}`,
    `ratelimit:${action}:ip:${ip}`,
  ];

  let mostRemaining = 0;
  for (const key of keys) {
    const entry = (await kv.get(key)) || { count: 0, resetAt: Date.now() + windowSeconds * 1000 };

    // Si la ventana ya expiró (por si acaso; kv también expira solo por ttl),
    // se reinicia el contador.
    if (Date.now() > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = Date.now() + windowSeconds * 1000;
    }

    if (entry.count >= maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
      mostRemaining = Math.max(mostRemaining, retryAfterSeconds);
      continue;
    }

    entry.count += 1;
    const ttl = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
    await kv.set(key, entry, ttl);
  }

  if (mostRemaining > 0) {
    return { blocked: true, retryAfterSeconds: mostRemaining };
  }
  return { blocked: false };
}

/**
 * Tras un intento CORRECTO (login válido o recuperación completada), se
 * limpian los contadores de esa cuenta/IP para no penalizar al usuario
 * legítimo en sus próximos intentos.
 */
async function reset(action, req, accountKey) {
  const ip = getClientIp(req);
  await kv.del(`ratelimit:${action}:acct:${accountKey || 'unknown'}`);
  await kv.del(`ratelimit:${action}:ip:${ip}`);
}

module.exports = { checkAndCount, reset, getClientIp };
