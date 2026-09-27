/**
 * ORGANIZATOR — Datos de la app por usuario (SYNC, paso 3)
 *
 * Validación y consultas de la tabla `user_data` (sql/004_user_data.sql),
 * separadas del endpoint (api/data.js) para poder probarlas sin HTTP y
 * para que api/ siga teniendo un único archivo nuevo (plan Hobby de
 * Vercel: máximo 12 funciones por despliegue, y cada archivo de api/ es
 * una función — lib/ no cuenta).
 *
 * SEGURIDAD: todas las consultas de este módulo reciben el `userId` como
 * parámetro explícito y lo usan en el WHERE/INSERT. El endpoint SIEMPRE
 * lo obtiene de la cookie de sesión (lib/auth.js), nunca del body — así
 * que un usuario no tiene forma de leer ni escribir filas de otro.
 *
 * Valores: el cliente envía el JSON ya parseado (un array para las listas,
 * un objeto para los ajustes). Se guarda con `JSON.stringify(value)` +
 * cast `::jsonb` a propósito: el driver de Neon (@neondatabase/serverless
 * 0.10) convierte un array JS en un literal de array de Postgres
 * ('{...}'), no en JSON — pasarlo tal cual rompería 'tasks', 'events'...
 */

// Claves sincronizadas entre dispositivos y la forma de su valor. Debe
// coincidir con el CHECK de sql/004_user_data.sql. 'reminderNotificationLedger'
// queda fuera a propósito: es un registro local de cada dispositivo.
const KEY_SHAPES = {
  tasks: 'array',
  events: 'array',
  customSchedules: 'array',
  eventCategories: 'array',
  reminders: 'array',
  settingsPrefs: 'object',
  settingsIA: 'object',
};
const ALLOWED_KEYS = Object.keys(KEY_SHAPES);

// Tamaño máximo del JSON de UNA clave. Holgado para años de uso normal y
// muy por debajo del límite de 4.5 MB por petición de Vercel.
const MAX_VALUE_BYTES = 2 * 1024 * 1024;

function isAllowedKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(KEY_SHAPES, key);
}

function hasExpectedShape(key, value) {
  if (KEY_SHAPES[key] === 'array') return Array.isArray(value);
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Valida el body de un PUT: { items: [{ key, value, baseRev }] }. Nunca
 * lanza. Devuelve { ok: true, items: [{ key, json, baseRev }] } con el
 * JSON ya serializado, o { ok: false, status, error } con el primer
 * problema encontrado — si CUALQUIER elemento es inválido no se escribe
 * nada (todo o nada en la validación). */
function validateWriteBody(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
    return { ok: false, status: 400, error: 'Falta el campo "items" (lista de claves a guardar).' };
  }
  if (body.items.length === 0 || body.items.length > ALLOWED_KEYS.length) {
    return { ok: false, status: 400, error: `"items" debe tener entre 1 y ${ALLOWED_KEYS.length} elementos.` };
  }
  const seen = new Set();
  const items = [];
  for (const item of body.items) {
    if (!item || typeof item !== 'object') {
      return { ok: false, status: 400, error: 'Cada elemento de "items" debe ser un objeto { key, value, baseRev }.' };
    }
    const { key, value, baseRev } = item;
    if (!isAllowedKey(key)) {
      return { ok: false, status: 400, error: `Clave no permitida: ${JSON.stringify(key)}.` };
    }
    if (seen.has(key)) {
      return { ok: false, status: 400, error: `La clave "${key}" aparece repetida.` };
    }
    seen.add(key);
    if (!Number.isSafeInteger(baseRev) || baseRev < 0) {
      return { ok: false, status: 400, error: `"baseRev" de "${key}" debe ser un entero >= 0.` };
    }
    if (!hasExpectedShape(key, value)) {
      return { ok: false, status: 400, error: `El valor de "${key}" debe ser ${KEY_SHAPES[key] === 'array' ? 'una lista' : 'un objeto'}.` };
    }
    let json;
    try {
      json = JSON.stringify(value);
    } catch (err) {
      return { ok: false, status: 400, error: `El valor de "${key}" no se puede serializar como JSON.` };
    }
    // Postgres rechaza \u0000 dentro de JSONB: mejor un 400 claro que un 500.
    if (json.includes('\\u0000')) {
      return { ok: false, status: 400, error: `El valor de "${key}" contiene caracteres no válidos.` };
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_VALUE_BYTES) {
      return { ok: false, status: 413, error: `El valor de "${key}" es demasiado grande para guardarse.` };
    }
    items.push({ key, json, baseRev });
  }
  return { ok: true, items };
}

function toIso(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Todas las claves guardadas del usuario:
 * { [key]: { value, rev, updatedAt } }. `rev` llega de Postgres como
 * string (BIGINT) y se devuelve como número. */
async function readAll(sql, userId) {
  const rows = await sql`
    SELECT key, value, rev, updated_at FROM user_data
    WHERE user_id = ${userId}
  `;
  const items = {};
  for (const row of rows) {
    if (!isAllowedKey(row.key)) continue;
    items[row.key] = { value: row.value, rev: Number(row.rev), updatedAt: toIso(row.updated_at) };
  }
  return items;
}

/** Escritura condicional de UNA clave (optimistic concurrency):
 *  - baseRev 0 → solo se crea si la fila NO existe todavía.
 *  - baseRev N → solo se actualiza si la fila sigue en rev N.
 * Ambas son una única sentencia atómica en Postgres: si otro dispositivo
 * escribió antes, no se pisa nada y se devuelve el valor actual del
 * servidor para que el cliente lo fusione.
 * Devuelve { ok: true, rev, updatedAt } o
 * { ok: false, conflict: true, value, rev, updatedAt } (value null / rev 0
 * si la clave no existe en el servidor). */
async function writeItem(sql, userId, { key, json, baseRev }) {
  let rows;
  if (baseRev === 0) {
    rows = await sql`
      INSERT INTO user_data (user_id, key, value, rev, updated_at)
      VALUES (${userId}, ${key}, ${json}::jsonb, 1, now())
      ON CONFLICT (user_id, key) DO NOTHING
      RETURNING rev, updated_at
    `;
  } else {
    rows = await sql`
      UPDATE user_data SET value = ${json}::jsonb, rev = rev + 1, updated_at = now()
      WHERE user_id = ${userId} AND key = ${key} AND rev = ${baseRev}
      RETURNING rev, updated_at
    `;
  }
  if (rows.length > 0) {
    return { ok: true, rev: Number(rows[0].rev), updatedAt: toIso(rows[0].updated_at) };
  }

  const current = await sql`
    SELECT value, rev, updated_at FROM user_data
    WHERE user_id = ${userId} AND key = ${key}
  `;
  const row = current[0];
  return {
    ok: false,
    conflict: true,
    value: row ? row.value : null,
    rev: row ? Number(row.rev) : 0,
    updatedAt: row ? toIso(row.updated_at) : null,
  };
}

module.exports = {
  ALLOWED_KEYS,
  MAX_VALUE_BYTES,
  isAllowedKey,
  validateWriteBody,
  readAll,
  writeItem,
};
