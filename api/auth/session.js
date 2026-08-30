// api/auth/session.js
//
// Se llama al cargar la app para saber si el navegador ya tiene una sesión
// válida (cookie firmada). El userId sale SIEMPRE de la cookie, nunca de
// nada que mande el cliente en la query o el body.

const { kv } = require('../../lib/kv');
const { getUserIdFromReq } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const userId = getUserIdFromReq(req);
  if (!userId) {
    res.status(200).json({ user: null });
    return;
  }

  const user = await kv.get('user:' + userId);
  if (!user) {
    res.status(200).json({ user: null });
    return;
  }

  res.status(200).json({ user: { id: user.id, username: user.username } });
};
