// api/export.js
//
// Genera una copia descargable (JSON) de los datos del planner del usuario
// que tiene la sesión activa: tareas, hábitos, objetivos y exámenes.
//
// El userId sale SIEMPRE de requireAuth (cookie de sesión firmada), igual
// que en api/data.js. Nunca se acepta un userId por query/body, así que es
// imposible pedir el backup de otra cuenta. No se modifica ni se borra
// nada: es una lectura pura de Redis.

const { kv } = require('../lib/kv');
const { requireAuth } = require('../lib/auth');

function dataKey(userId, type) {
  return 'data:' + userId + ':' + type;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const userId = await requireAuth(req, res);
  if (!userId) return; // requireAuth ya respondió 401

  try {
    const plannerData = await kv.get(dataKey(userId, 'planner'));

    const backup = {
      exportadoEl: new Date().toISOString(),
      app: 'ORGANIZATOR',
      datos: plannerData || { tareas: [], habitos: [], objetivos: [], examenes: [] },
    };

    const fecha = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `organizator-backup-${fecha}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (e) {
    console.error('export error', e);
    res.status(500).json({ error: 'No se ha podido generar la exportación.' });
  }
};
