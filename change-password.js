// api/auth/change-password.js
//
// El usuario que se modifica es SIEMPRE el de la sesión (requireAuth),
// nunca un id que venga en el body. Así una cuenta no puede cambiar la
// contraseña de otra aunque intente mandar su userId.
//
// También se limita por intentos, igual que login/recover: aunque hace
// falta ya tener una sesión válida para llegar aquí (p. ej. una sesión
// robada o dejada abierta en un dispositivo compartido), sin este límite
// se podría probar currentPassword en bucle para confirmarla por fuerza
// bruta antes de, por ejemplo, cambiarla y bloquear al dueño real.

const { kv } = require('../../lib/kv');
const { requireAuth, randomHex, hashPassword, verifyPassword } = require('../../lib/auth');
const rateLimit = require('../../lib/rate-limit');

const CHANGE_PASSWORD_LIMIT = { maxAttempts: 8, windowSeconds: 10 * 60 };

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const userId = await requireAuth(req, res);
  if (!userId) return; // requireAuth ya respondió 401

  try {
    const limit = await rateLimit.checkAndCount('change-password', req, userId, CHANGE_PASSWORD_LIMIT);
    if (limit.blocked) {
      res.status(429).json({
        error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
        retryAfterSeconds: limit.retryAfterSeconds,
      });
      return;
    }

    const { currentPassword, newPassword } = req.body || {};
    const user = await kv.get('user:' + userId);
    if (!user) {
      res.status(404).json({ error: 'No se ha podido encontrar tu cuenta.' });
      return;
    }
    if (!verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) {
      res.status(401).json({ error: 'La contraseña actual no es correcta.' });
      return;
    }
    if ((newPassword || '').length < 6) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    user.passwordSalt = randomHex(16);
    user.passwordHash = hashPassword(newPassword, user.passwordSalt);
    await kv.set('user:' + userId, user);

    // Cambio correcto: se limpia el contador para no penalizar futuros
    // cambios legítimos.
    await rateLimit.reset('change-password', req, userId);

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('change-password error', e);
    res.status(500).json({ error: 'No se ha podido cambiar la contraseña.' });
  }
};
