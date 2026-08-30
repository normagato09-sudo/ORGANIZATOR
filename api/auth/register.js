// api/auth/register.js
//
// Crea una cuenta nueva. El id de usuario se genera aquí, en el servidor;
// el cliente nunca elige ni envía su propio id.

const { kv } = require('../../lib/kv');
const { randomHex, genRecoveryCode, hashPassword, setSessionCookie } = require('../../lib/auth');

function usernameKey(usernameLower) {
  return 'idx:username:' + usernameLower;
}
function userKey(id) {
  return 'user:' + id;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  try {
    const { username, password } = req.body || {};
    const cleanUsername = (username || '').trim();

    if (cleanUsername.length < 3) {
      res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres.' });
      return;
    }
    if ((password || '').length < 6) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    const usernameLower = cleanUsername.toLowerCase();
    const existingId = await kv.get(usernameKey(usernameLower));
    if (existingId) {
      res.status(409).json({ error: 'Ese usuario ya existe. Prueba con otro o inicia sesión.' });
      return;
    }

    const id = 'u' + Date.now() + Math.random().toString(36).slice(2, 8);
    const passwordSalt = randomHex(16);
    const passwordHash = hashPassword(password, passwordSalt);
    const recoveryCode = genRecoveryCode();
    const recoverySalt = randomHex(16);
    const recoveryCodeHash = hashPassword(recoveryCode, recoverySalt);

    const user = {
      id,
      username: cleanUsername,
      usernameLower,
      passwordHash,
      passwordSalt,
      recoveryCodeHash,
      recoverySalt,
      createdAt: Date.now(),
    };

    await kv.set(userKey(id), user);
    await kv.set(usernameKey(usernameLower), id);

    setSessionCookie(res, id);
    res.status(200).json({ user: { id, username: cleanUsername }, recoveryCode });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'No se ha podido crear la cuenta.' });
  }
};
