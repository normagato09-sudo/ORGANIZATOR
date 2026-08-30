// api/data.js
//
// Guarda y lee los datos de la app (planner o chat) para la cuenta que tiene
// la sesión activa. El userId NUNCA sale del body/query que manda el cliente:
// sale siempre de la cookie de sesión firmada (requireAuth). Así es imposible
// que una cuenta lea o escriba los datos de otra, aunque cambie a mano el
// "type" o cualquier otro campo del body.

const { kv } = require('../lib/kv');
const { requireAuth } = require('../lib/auth');

const ALLOWED_TYPES = new Set(['planner', 'chat']);

function dataKey(userId, type) {
  return 'data:' + userId + ':' + type;
}

module.exports = async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return; // requireAuth ya respondió 401

  const type = (req.method === 'GET' ? req.query.type : (req.body || {}).type);
  if (!ALLOWED_TYPES.has(type)) {
    res.status(400).json({ error: 'Tipo de datos no válido.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const value = await kv.get(dataKey(userId, type));
      res.status(200).json({ data: value || null });
    } catch (e) {
      console.error('data get error', e);
      res.status(500).json({ error: 'No se han podido cargar los datos.' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const { data } = req.body || {};
      await kv.set(dataKey(userId, type), data);
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('data set error', e);
      res.status(500).json({ error: 'No se han podido guardar los datos.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
};
