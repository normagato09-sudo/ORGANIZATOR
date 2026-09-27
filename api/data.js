/**
 * ORGANIZATOR — Datos de la app de la cuenta actual (SYNC, paso 3)
 *
 * GET /api/data
 *   → 200 { items: { [key]: { value, rev, updatedAt } } }
 *   → 401/500 { error: string }
 *
 * PUT /api/data   body: { items: [{ key, value, baseRev }] }
 *   → 200 { results: { [key]: { ok: true, rev, updatedAt } } }
 *   → 409 { results: { ... } }  si ALGUNA clave entró en conflicto: esas
 *          claves traen { ok: false, conflict: true, value, rev, updatedAt }
 *          con lo que hay ahora en el servidor (las demás sí se guardaron)
 *   → 400/401/405/413/500 { error: string }
 *
 * Autenticado con la MISMA cookie de sesión que api/auth/* y api/push/*
 * (lib/auth.js). El usuario SIEMPRE sale de la sesión — nunca del body ni
 * de la URL —, así que nadie puede leer ni escribir los datos de otra
 * cuenta. Solo se aceptan las claves de la lista blanca de
 * lib/user-data.js.
 *
 * Concurrencia: cada clave lleva un contador `rev`. El cliente manda el
 * `rev` que conocía (baseRev, 0 si la clave nunca se guardó) y la
 * escritura solo se aplica si el servidor sigue en ese mismo `rev`. Si
 * otro dispositivo escribió antes, no se sobrescribe nada: se responde con
 * el valor actual para que el cliente fusione y reintente (ver
 * lib/user-data.js#writeItem).
 *
 * Único archivo para GET y PUT a propósito: plan Hobby de Vercel, máximo
 * 12 funciones por despliegue (esta es la número 12).
 */

const db = require('../lib/db');
const auth = require('../lib/auth');
const userData = require('../lib/user-data');

module.exports = async function handler(req, res) {
  // Nunca se debe cachear (ni en el navegador ni en ningún intermediario):
  // depende por completo de la sesión.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método no permitido. Usa GET o PUT.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  const userId = auth.getAuthenticatedUserId(req, jwtSecret);
  if (!userId) {
    return res.status(401).json({ error: 'No has iniciado sesión.' });
  }

  let validated = null;
  if (req.method === 'PUT') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    validated = userData.validateWriteBody(body);
    if (!validated.ok) {
      return res.status(validated.status).json({ error: validated.error });
    }
  }

  let sql;
  try {
    sql = db.getSql();
  } catch (err) {
    console.error('[api/data] Error de configuración de la base de datos:', err);
    return res.status(500).json({ error: 'La base de datos no está configurada todavía.' });
  }

  if (req.method === 'GET') {
    try {
      const items = await userData.readAll(sql, userId);
      return res.status(200).json({ items });
    } catch (err) {
      console.error('[api/data] Error al leer los datos:', err);
      return res.status(500).json({ error: 'No se pudieron cargar tus datos. Inténtalo de nuevo.' });
    }
  }

  try {
    const results = {};
    let anyConflict = false;
    for (const item of validated.items) {
      const result = await userData.writeItem(sql, userId, item);
      results[item.key] = result;
      if (!result.ok) anyConflict = true;
    }
    return res.status(anyConflict ? 409 : 200).json({ results });
  } catch (err) {
    console.error('[api/data] Error al guardar los datos:', err);
    return res.status(500).json({ error: 'No se pudieron guardar tus datos. Inténtalo de nuevo.' });
  }
};
