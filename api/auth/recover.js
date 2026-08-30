// api/auth/recover.js
//
// No requiere sesión (es precisamente para cuando no puedes iniciar sesión),
// pero exige el código de recuperación de ESA cuenta concreta.

const { kv } = require('../../lib/kv');
const { randomHex, hashPassword, verifyPassword } = require('../../lib/auth');

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

    const id = await kv.get('idx:username:' + usernameLower);
    const user = id ? await kv.get('user:' + id) : null;
    if (!user) {
      res.status(404).json({ error: 'No existe ninguna cuenta con ese usuario.' });
      return;
    }

    const cleanCode = (code || '').trim().toUpperCase();
    if (!verifyPassword(cleanCode, user.recoverySalt, user.recoveryCodeHash)) {
      res.status(401).json({ error: 'El código de recuperación no es correcto.' });
      return;
    }
    if ((newPassword || '').length < 6) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    user.passwordSalt = randomHex(16);
    user.passwordHash = hashPassword(newPassword, user.passwordSalt);
    await kv.set('user:' + user.id, user);

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('recover error', e);
    res.status(500).json({ error: 'No se ha podido restablecer la contraseña.' });
  }
};
