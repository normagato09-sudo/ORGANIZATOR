// api/auth/logout.js

const { clearSessionCookie } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
};
