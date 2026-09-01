// api/auth/recover.js
//
// No requiere sesión (es precisamente para cuando no puedes iniciar sesión),
// pero exige el código de recuperación de ESA cuenta concreta.

const { kv } = require('../../lib/kv');
const { randomHex, genRecoveryCode, hashPassword, verifyPassword } = require('../../lib/auth');
const rateLimit = require('../../lib/rate-limit');

// Mensaje único para "el usuario no existe" y "el código no es correcto":
// si fueran mensajes distintos, alguien podría usar este endpoint para
// averiguar qué nombres de usuario están registrados probando uno a uno.
const GENERIC_RECOVER_ERROR = 'El usuario o el código de recuperación no son correctos.';

// Igual de estricto que login: la recuperación es en la práctica otra
// forma de "adivinar una clave" (el código), así que merece el mismo
// límite de intentos.
const RECOVER_LIMIT = { maxAttempts: 8, windowSeconds: 10 * 60 };

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  try {
    const { username, code, newPassword } = req.body || {};
    const usernameLower = (username || '').trim().toLowerCase();
    if (!usernameLower || !code || !newPassword) {
      res.status(400).json({ error: 'Rellena todos los campos.' });
      return;
    }

    const limit = await rateLimit.checkAndCount('recover', req, usernameLower, RECOVER_LIMIT);
    if (limit.blocked) {
      res.status(429).json({
        error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
        retryAfterSeconds: limit.retryAfterSeconds,
      });
      return;
    }

    const id = await kv.get('idx:username:' + usernameLower);
    const user = id ? await kv.get('user:' + id) : null;

    const cleanCode = (code || '').trim().toUpperCase();

    // Si el usuario no existe, se comprueba igualmente el código contra un
    // hash "señuelo" (mismo coste que un scrypt real) antes de responder.
    // Así el tiempo de respuesta es parecido tanto si el usuario existe
    // como si no, y no se puede distinguir uno de otro por temporización.
    if (!user) {
      verifyPassword(cleanCode, randomHex(16), hashPassword('x', randomHex(16)));
      res.status(401).json({ error: GENERIC_RECOVER_ERROR });
      return;
    }

    if (!verifyPassword(cleanCode, user.recoverySalt, user.recoveryCodeHash)) {
      res.status(401).json({ error: GENERIC_RECOVER_ERROR });
      return;
    }
    if ((newPassword || '').length < 6) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    user.passwordSalt = randomHex(16);
    user.passwordHash = hashPassword(newPassword, user.passwordSalt);

    // El código usado queda invalidado aquí mismo: se sobrescribe por uno
    // nuevo, así que aunque alguien lo hubiera visto no le sirve dos veces.
    const recoveryCode = genRecoveryCode();
    user.recoverySalt = randomHex(16);
    user.recoveryCodeHash = hashPassword(recoveryCode, user.recoverySalt);

    await kv.set('user:' + user.id, user);

    // Recuperación correcta: se limpia el contador de intentos.
    await rateLimit.reset('recover', req, usernameLower);

    res.status(200).json({ ok: true, recoveryCode });
  } catch (e) {
    console.error('recover error', e);
    res.status(500).json({ error: 'No se ha podido restablecer la contraseña.' });
  }
};
