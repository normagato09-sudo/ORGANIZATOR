// api/auth/login.js

const { kv } = require('../../lib/kv');
const { verifyPassword, setSessionCookie } = require('../../lib/auth');
const rateLimit = require('../../lib/rate-limit');

function usernameKey(usernameLower) {
  return 'idx:username:' + usernameLower;
}
function userKey(id) {
  return 'user:' + id;
}

// 8 intentos por cuenta/IP cada 10 minutos: suficiente margen para que
// alguien que se equivoca escribiendo su contraseña no se vea bloqueado,
// pero corta un ataque de fuerza bruta muy por debajo de lo que haría
// falta para probar contraseñas con posibilidades reales de acierto.
const LOGIN_LIMIT = { maxAttempts: 8, windowSeconds: 10 * 60 };

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

    const limit = await rateLimit.checkAndCount('login', req, usernameLower, LOGIN_LIMIT);
    if (limit.blocked) {
      res.status(429).json({
        error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
        retryAfterSeconds: limit.retryAfterSeconds,
      });
      return;
    }

    const id = await kv.get(usernameKey(usernameLower));
    const user = id ? await kv.get(userKey(id)) : null;
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      return;
    }

    // Login correcto: se limpia el contador para que un usuario legítimo
    // nunca arrastre intentos fallidos anteriores (suyos o de otro
    // probando su cuenta) a sus próximos inicios de sesión.
    await rateLimit.reset('login', req, usernameLower);

    setSessionCookie(res, user.id);
    res.status(200).json({ user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'No se ha podido iniciar sesión.' });
  }
};
