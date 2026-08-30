// api/auth/change-password.js
//
// El usuario que se modifica es SIEMPRE el de la sesión (requireAuth),
// nunca un id que venga en el body. Así una cuenta no puede cambiar la
// contraseña de otra aunque intente mandar su userId.

const { kv } = require('../../lib/kv');
const { requireAuth, randomHex, hashPassword, verifyPassword } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const userId = await requireAuth(req, res);
  if (!userId) return; // requireAuth ya respondió 401

  try {
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

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('change-password error', e);
    res.status(500).json({ error: 'No se ha podido cambiar la contraseña.' });
  }
};
