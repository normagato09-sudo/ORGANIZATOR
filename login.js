// api/auth/login.js

const { kv } = require('../../lib/kv');
const { verifyPassword, setSessionCookie } = require('../../lib/auth');

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
    const usernameLower = (username || '').trim().toLowerCase();
    if (!usernameLower || !password) {
      res.status(400).json({ error: 'Escribe tu usuario y tu contraseña.' });
      return;
    }

    const id = await kv.get(usernameKey(usernameLower));
    const user = id ? await kv.get(userKey(id)) : null;
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      return;
    }

    setSessionCookie(res, user.id);
    res.status(200).json({ user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'No se ha podido iniciar sesión.' });
  }
};
