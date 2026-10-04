/**
 * ORGANIZATOR — Tests de SYNC paso 3 (GET/PUT /api/data + lib/user-data.js)
 *
 * Suite Node pura, SIN red ni base de datos real. Mismo patrón que
 * test-push-infrastructure.js: api/data.js y lib/*.js se `require()`an TAL
 * CUAL están en disco y solo se sustituye db.getSql() por un Postgres
 * falso en memoria que reconoce las consultas EXACTAS del módulo (si una
 * consulta cambia de forma, el fake lanza y el test falla con un error
 * claro en vez de dar un falso positivo). La sesión es real: cookie + JWT
 * firmados con lib/session.js.
 *
 * El fake imita lo que importa de Postgres/Neon:
 *  - `rev` se devuelve como string (BIGINT llega así del driver).
 *  - El valor llega como texto JSON y se "castea" (::jsonb) — se comprueba
 *    que el endpoint NUNCA manda un array JS crudo como parámetro (el
 *    driver de Neon lo convertiría en un array de Postgres, no en JSON).
 *  - INSERT ... ON CONFLICT DO NOTHING y UPDATE ... WHERE rev = baseRev
 *    son atómicos (se aplican o no, sin estados intermedios).
 *
 * Uso:  node js/test-sync-api.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const path = require('path');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');

process.env.JWT_SECRET = 'test-jwt-secret-not-real';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------
// Postgres falso para user_data
// ---------------------------------------------------------------------
function makeFakeDb() {
  const rows = new Map(); // `${userId}|${key}` -> { user_id, key, value, rev (string), updated_at }
  const queries = [];     // { text, strings, values }
  let clock = Date.UTC(2026, 8, 27, 10, 0, 0);
  const now = () => new Date(clock += 1000);
  const id = (u, k) => `${u}|${k}`;

  /** El parámetro JSON debe ser texto seguido literalmente de ::jsonb. */
  function jsonParam(strings, values, index) {
    const v = values[index];
    if (typeof v !== 'string') throw new Error(`Fake DB: el valor JSON debe llegar como string, llegó ${Array.isArray(v) ? 'array' : typeof v}`);
    if (!strings[index + 1].startsWith('::jsonb')) throw new Error('Fake DB: falta el cast ::jsonb tras el valor');
    return JSON.parse(v);
  }

  /** Exige que el trozo de SQL justo ANTES del parámetro `index` termine
   * con `pattern` (p.ej. "WHERE user_id = "): así, si alguien quita el
   * filtro por usuario de una consulta, el fake falla con un mensaje claro
   * en vez de "adivinar" el user_id por posición. */
  function expectBefore(strings, index, pattern, label) {
    if (!pattern.test(strings[index])) throw new Error(`Fake DB: ${label} — falta ${pattern} antes del parámetro ${index}`);
  }

  async function sql(strings, ...values) {
    const text = strings.join('¶');
    queries.push({ text, strings: [...strings], values });

    if (text.includes('SELECT key, value, rev, updated_at FROM user_data')) {
      expectBefore(strings, 0, /WHERE user_id = $/, 'SELECT de todas las claves sin filtro por usuario');
      if (values.length !== 1) throw new Error('Fake DB: SELECT de todas las claves con parámetros inesperados');
      const [userId] = values;
      return [...rows.values()].filter(r => r.user_id === userId)
        .map(r => ({ key: r.key, value: structuredClone(r.value), rev: r.rev, updated_at: r.updated_at }));
    }

    if (text.includes('INSERT INTO user_data')) {
      expectBefore(strings, 0, /INSERT INTO user_data \(user_id, key, value, rev, updated_at\)\s+VALUES \($/, 'INSERT sin user_id como primera columna');
      if (!/ON CONFLICT \(user_id, key\) DO NOTHING/.test(text)) throw new Error('Fake DB: INSERT sin ON CONFLICT (user_id, key) DO NOTHING');
      const [userId, key] = values;
      const value = jsonParam(strings, values, 2);
      if (rows.has(id(userId, key))) return []; // ON CONFLICT DO NOTHING
      const row = { user_id: userId, key, value, rev: '1', updated_at: now() };
      rows.set(id(userId, key), row);
      return [{ rev: row.rev, updated_at: row.updated_at }];
    }

    if (text.includes('UPDATE user_data SET value')) {
      expectBefore(strings, 1, /WHERE user_id = $/, 'UPDATE sin filtro por usuario');
      expectBefore(strings, 2, /^ AND key = $/, 'UPDATE sin filtro por clave');
      expectBefore(strings, 3, /^ AND rev = $/, 'UPDATE sin comprobar el rev (sobrescribiría a ciegas)');
      const value = jsonParam(strings, values, 0);
      const [, userId, key, baseRev] = values;
      const row = rows.get(id(userId, key));
      if (!row || Number(row.rev) !== baseRev) return [];
      row.value = value;
      row.rev = String(Number(row.rev) + 1);
      row.updated_at = now();
      return [{ rev: row.rev, updated_at: row.updated_at }];
    }

    if (text.includes('SELECT value, rev, updated_at FROM user_data')) {
      expectBefore(strings, 0, /WHERE user_id = $/, 'SELECT de conflicto sin filtro por usuario');
      expectBefore(strings, 1, /^ AND key = $/, 'SELECT de conflicto sin filtro por clave');
      const [userId, key] = values;
      const row = rows.get(id(userId, key));
      return row ? [{ value: structuredClone(row.value), rev: row.rev, updated_at: row.updated_at }] : [];
    }

    throw new Error(`Fake DB: consulta no reconocida en test-sync-api.js: ${text}`);
  }

  return { sql, rows, queries };
}

// ---------------------------------------------------------------------
// Helpers HTTP (mismo estilo que test-push-infrastructure.js)
// ---------------------------------------------------------------------
const session = require(path.join(ROOT, 'lib', 'session.js'));

function cookieFor(userId) {
  const token = session.signSession({ sub: userId, email: `user${userId}@example.com` }, process.env.JWT_SECRET);
  return `${session.SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function makeReq({ method = 'GET', cookie, body, query } = {}) {
  return { method, headers: cookie ? { cookie } : {}, body, query: query || {} };
}

function makeRes() {
  const res = {
    _status: null, _json: null, _headers: {},
    status(code) { res._status = code; return res; },
    json(obj) { res._json = obj; return res; },
    setHeader(k, v) { res._headers[k] = v; },
  };
  return res;
}

/** Carga api/data.js desde cero con un fake DB nuevo. */
function freshEndpoint(fakeDb) {
  Object.keys(require.cache).forEach((p) => {
    if (p.includes(`${path.sep}lib${path.sep}`) || p.endsWith(`${path.sep}api${path.sep}data.js`)) delete require.cache[p];
  });
  const db = require(path.join(ROOT, 'lib', 'db.js'));
  db.getSql = () => fakeDb.sql;
  return require(path.join(ROOT, 'api', 'data.js'));
}

async function call(handler, opts) {
  const res = makeRes();
  await handler(makeReq(opts), res);
  return res;
}

const A = 1, B = 2;
const TASKS_A = [{ id: 't1', title: 'Comprar pan', done: false }, { id: 't2', title: 'Llamar al médico', done: true }];
const PREFS_A = { defaultHome: 'calendario', showCompletedTasks: false };

(async () => {
  // =====================================================================
  section('A) Autenticación, métodos y cabeceras');
  // =====================================================================
  {
    const fakeDb = makeFakeDb();
    const handler = freshEndpoint(fakeDb);

    const noCookie = await call(handler, { method: 'GET' });
    check('A1. GET sin cookie -> 401', noCookie._status === 401);
    const noCookiePut = await call(handler, { method: 'PUT', body: { items: [{ key: 'tasks', value: [], baseRev: 0 }] } });
    check('A2. PUT sin cookie -> 401 y no escribe nada', noCookiePut._status === 401 && fakeDb.rows.size === 0);

    const garbage = await call(handler, { method: 'GET', cookie: `${session.SESSION_COOKIE}=no-es-un-jwt` });
    check('A3. token corrupto -> 401', garbage._status === 401);
    const expired = jwt.sign({ sub: A }, process.env.JWT_SECRET, { expiresIn: '-10s' });
    const expiredRes = await call(handler, { method: 'GET', cookie: `${session.SESSION_COOKIE}=${expired}` });
    check('A4. token caducado -> 401', expiredRes._status === 401);
    const forged = jwt.sign({ sub: A }, 'otro-secreto');
    const forgedRes = await call(handler, { method: 'GET', cookie: `${session.SESSION_COOKIE}=${forged}` });
    check('A5. token firmado con otro secreto -> 401', forgedRes._status === 401);

    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const r = await call(handler, { method, cookie: cookieFor(A) });
      check(`A6. ${method} -> 405 con Allow: GET, PUT`, r._status === 405 && r._headers.Allow === 'GET, PUT');
    }

    const ok = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('A7. Cache-Control: no-store en 200, 401 y 405', ok._headers['Cache-Control'] === 'no-store' && noCookie._headers['Cache-Control'] === 'no-store');
    check('A8. las peticiones rechazadas no tocaron la base de datos', fakeDb.queries.length === 1);
  }

  // =====================================================================
  section('B) Guardar y leer (camino feliz)');
  // =====================================================================
  {
    const fakeDb = makeFakeDb();
    const handler = freshEndpoint(fakeDb);

    const empty = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('B1. cuenta sin datos -> 200 { items: {} }', empty._status === 200 && same(empty._json, { items: {} }));

    const put = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [
      { key: 'tasks', value: TASKS_A, baseRev: 0 },
      { key: 'settingsPrefs', value: PREFS_A, baseRev: 0 },
    ] } });
    check('B2. primera subida (baseRev 0) -> 200 y rev 1 en cada clave', put._status === 200 && put._json.results.tasks.ok === true && put._json.results.tasks.rev === 1 && put._json.results.settingsPrefs.rev === 1);
    check('B3. rev se devuelve como número (Postgres lo manda como string)', typeof put._json.results.tasks.rev === 'number');
    check('B4. updatedAt en formato ISO', /^\d{4}-\d{2}-\d{2}T/.test(put._json.results.tasks.updatedAt));

    const inserts = fakeDb.queries.filter(q => q.text.includes('INSERT INTO user_data'));
    check('B5. el valor viaja como texto JSON + ::jsonb (nunca un array JS crudo)', inserts.length === 2 && inserts.every(q => typeof q.values[2] === 'string' && q.strings[3].startsWith('::jsonb')));

    const got = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('B6. GET devuelve exactamente lo guardado', same(got._json.items.tasks.value, TASKS_A) && same(got._json.items.settingsPrefs.value, PREFS_A));
    check('B7. GET incluye rev numérico por clave', got._json.items.tasks.rev === 1 && got._json.items.settingsPrefs.rev === 1);

    const updated = [...TASKS_A, { id: 't3', title: 'Nueva' }];
    const put2 = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: updated, baseRev: 1 }] } });
    check('B8. actualizar con el rev correcto -> 200 y rev 2', put2._status === 200 && put2._json.results.tasks.rev === 2);
    const got2 = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('B9. el valor nuevo queda guardado; la otra clave no cambia', same(got2._json.items.tasks.value, updated) && got2._json.items.settingsPrefs.rev === 1);

    const emptied = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: [], baseRev: 2 }] } });
    const got3 = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('B10. se puede guardar una lista vacía (p.ej. "Borrar todos los datos")', emptied._status === 200 && same(got3._json.items.tasks.value, []));

    const asString = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: JSON.stringify({ items: [{ key: 'settingsIA', value: { enabled: false }, baseRev: 0 }] }) });
    check('B11. body como string JSON también se acepta', asString._status === 200 && asString._json.results.settingsIA.rev === 1);

    const all = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [
      { key: 'events', value: [], baseRev: 0 }, { key: 'customSchedules', value: [], baseRev: 0 },
      { key: 'eventCategories', value: [], baseRev: 0 }, { key: 'reminders', value: [], baseRev: 0 },
    ] } });
    check('B12. se aceptan las 7 claves sincronizadas', all._status === 200 && Object.keys(all._json.results).length === 4);

    const study = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [
      { key: 'subjects', value: [{ id: 's1', name: 'Mates', color: '#3366ff' }], baseRev: 0 },
      { key: 'exams', value: [{ id: 'e1', subjectId: 's1', type: 'examen', title: 'Parcial', date: '2026-10-20' }], baseRev: 0 },
      { key: 'studySessions', value: [], baseRev: 0 },
    ] } });
    const gotStudy = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('B13. se aceptan subjects, exams y studySessions (app de exámenes)', study._status === 200 && Object.keys(study._json.results).length === 3
      && gotStudy._json.items.exams.value[0].id === 'e1' && same(gotStudy._json.items.studySessions.value, []));
  }

  // =====================================================================
  section('C) Conflictos (dos dispositivos de la misma cuenta)');
  // =====================================================================
  {
    const fakeDb = makeFakeDb();
    const handler = freshEndpoint(fakeDb);
    await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: TASKS_A, baseRev: 0 }] } });

    // Móvil y PC parten ambos de rev 1.
    const fromPhone = [...TASKS_A, { id: 'm1', title: 'Desde el móvil' }];
    const fromPc = [...TASKS_A, { id: 'p1', title: 'Desde el PC' }];
    const phone = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: fromPhone, baseRev: 1 }] } });
    const pc = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: fromPc, baseRev: 1 }] } });
    check('C1. el primero en escribir gana -> 200 rev 2', phone._status === 200 && phone._json.results.tasks.rev === 2);
    check('C2. el segundo con rev desfasado -> 409 conflict', pc._status === 409 && pc._json.results.tasks.ok === false && pc._json.results.tasks.conflict === true);
    check('C3. el 409 trae el valor y rev ACTUALES del servidor para fusionar', same(pc._json.results.tasks.value, fromPhone) && pc._json.results.tasks.rev === 2);
    const afterConflict = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('C4. el conflicto NO sobrescribió nada', same(afterConflict._json.items.tasks.value, fromPhone));

    const retry = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: [...fromPhone, { id: 'p1', title: 'Desde el PC' }], baseRev: 2 }] } });
    check('C5. reintento con el rev nuevo (tras fusionar) -> 200 rev 3', retry._status === 200 && retry._json.results.tasks.rev === 3);

    const createAgain = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: [], baseRev: 0 }] } });
    check('C6. baseRev 0 sobre una clave que ya existe -> 409 (nunca se pisa en la "primera subida")', createAgain._status === 409 && createAgain._json.results.tasks.rev === 3);

    const missing = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'events', value: [], baseRev: 5 }] } });
    check('C7. baseRev > 0 sobre una clave que no existe -> 409 con value null y rev 0', missing._status === 409 && missing._json.results.events.value === null && missing._json.results.events.rev === 0);

    const mixed = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [
      { key: 'settingsPrefs', value: PREFS_A, baseRev: 0 },
      { key: 'tasks', value: [], baseRev: 1 },
    ] } });
    check('C8. petición mixta -> 409; la clave sin conflicto SÍ se guarda', mixed._status === 409 && mixed._json.results.settingsPrefs.ok === true && mixed._json.results.tasks.conflict === true);

    // Carrera de verdad: dos PUT simultáneos con el mismo baseRev.
    const [r1, r2] = await Promise.all([
      call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: [{ id: 'x' }], baseRev: 3 }] } }),
      call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: [{ id: 'y' }], baseRev: 3 }] } }),
    ]);
    check('C9. dos escrituras simultáneas con el mismo baseRev: exactamente una gana', [r1._status, r2._status].sort().join() === '200,409');
  }

  // =====================================================================
  section('D) Aislamiento entre cuentas');
  // =====================================================================
  {
    const fakeDb = makeFakeDb();
    const handler = freshEndpoint(fakeDb);
    await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [
      { key: 'tasks', value: TASKS_A, baseRev: 0 }, { key: 'settingsPrefs', value: PREFS_A, baseRev: 0 },
    ] } });

    const bGet = await call(handler, { method: 'GET', cookie: cookieFor(B) });
    check('D1. B no ve NADA de A', bGet._status === 200 && same(bGet._json.items, {}));

    const bGetForced = await call(handler, { method: 'GET', cookie: cookieFor(B), query: { userId: String(A), user_id: String(A) } });
    check('D2. B no ve datos de A ni pasando ?userId=1 en la URL', same(bGetForced._json.items, {}));

    const bSteal = await call(handler, { method: 'PUT', cookie: cookieFor(B), body: { items: [{ key: 'tasks', value: [], baseRev: 1 }] } });
    check('D3. B intentando sobrescribir "tasks" con rev 1 -> conflicto...', bSteal._status === 409);
    check('D4. ...y la respuesta de conflicto NO filtra el valor de A (value null, rev 0)', bSteal._json.results.tasks.value === null && bSteal._json.results.tasks.rev === 0);

    const bForcedBody = await call(handler, { method: 'PUT', cookie: cookieFor(B), body: { userId: A, user_id: A, items: [{ key: 'tasks', value: [{ id: 'b1', title: 'De B' }], baseRev: 0, userId: A }] } });
    check('D5. B enviando userId/user_id de A en el body: se ignora, crea SU propia fila', bForcedBody._status === 200 && fakeDb.rows.has(`${B}|tasks`));

    const aGet = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('D6. los datos de A siguen intactos', same(aGet._json.items.tasks.value, TASKS_A) && aGet._json.items.tasks.rev === 1);
    const bGet2 = await call(handler, { method: 'GET', cookie: cookieFor(B) });
    check('D7. B solo ve lo suyo', same(Object.keys(bGet2._json.items), ['tasks']) && bGet2._json.items.tasks.value[0].id === 'b1');

    // Auditoría: TODA consulta a user_data usa como user_id el de la cookie
    // de la petición que la originó (se recorre el registro completo).
    fakeDb.queries.length = 0;
    await call(handler, { method: 'GET', cookie: cookieFor(B) });
    await call(handler, { method: 'PUT', cookie: cookieFor(B), body: { items: [{ key: 'tasks', value: [], baseRev: 99 }, { key: 'events', value: [], baseRev: 0 }] } });
    const userIdOf = (q) => {
      if (q.text.includes('UPDATE user_data')) return q.values[1];
      return q.values[0];
    };
    check('D8. todas las consultas de B filtran por user_id = B (nunca otro)', fakeDb.queries.length >= 4 && fakeDb.queries.every(q => userIdOf(q) === B));
    check('D9. todas las consultas llevan user_id en su WHERE/INSERT', fakeDb.queries.every(q => /user_id/.test(q.text)));
  }

  // =====================================================================
  section('E) Validación (nada se escribe si algo es inválido)');
  // =====================================================================
  {
    const fakeDb = makeFakeDb();
    const handler = freshEndpoint(fakeDb);
    const bad = async (label, body, expectedStatus = 400) => {
      const before = fakeDb.queries.length;
      const r = await call(handler, { method: 'PUT', cookie: cookieFor(A), body });
      check(`${label} -> ${expectedStatus} sin tocar la base de datos`, r._status === expectedStatus && typeof r._json.error === 'string' && fakeDb.queries.length === before);
    };
    await bad('E1. sin body', undefined);
    await bad('E2. JSON inválido como string', '{no es json');
    await bad('E3. sin "items"', { tasks: [] });
    await bad('E4. "items" vacío', { items: [] });
    await bad('E5. más de 10 elementos', { items: Array.from({ length: 11 }, () => ({ key: 'tasks', value: [], baseRev: 0 })) });
    await bad('E6. clave repetida', { items: [{ key: 'tasks', value: [], baseRev: 0 }, { key: 'tasks', value: [], baseRev: 0 }] });
    await bad('E7. reminderNotificationLedger (local por dispositivo, nunca se sube)', { items: [{ key: 'reminderNotificationLedger', value: {}, baseRev: 0 }] });
    await bad('E8. clave inventada', { items: [{ key: 'passwords', value: [], baseRev: 0 }] });
    await bad('E9. clave "__proto__"', { items: [{ key: '__proto__', value: {}, baseRev: 0 }] });
    await bad('E10. clave "constructor"', { items: [{ key: 'constructor', value: {}, baseRev: 0 }] });
    await bad('E10b. "exams" que no es una lista', { items: [{ key: 'exams', value: { id: 'e1' }, baseRev: 0 }] });
    await bad('E11. tasks que no es lista', { items: [{ key: 'tasks', value: { a: 1 }, baseRev: 0 }] });
    await bad('E12. settingsPrefs que es lista', { items: [{ key: 'settingsPrefs', value: [], baseRev: 0 }] });
    await bad('E13. value null', { items: [{ key: 'settingsIA', value: null, baseRev: 0 }] });
    await bad('E14. value como string JSON (debe llegar ya parseado)', { items: [{ key: 'tasks', value: '[]', baseRev: 0 }] });
    await bad('E15. baseRev ausente', { items: [{ key: 'tasks', value: [] }] });
    await bad('E16. baseRev negativo', { items: [{ key: 'tasks', value: [], baseRev: -1 }] });
    await bad('E17. baseRev decimal', { items: [{ key: 'tasks', value: [], baseRev: 1.5 }] });
    await bad('E18. baseRev como string', { items: [{ key: 'tasks', value: [], baseRev: '1' }] });
    await bad('E19. un elemento válido + uno inválido (todo o nada)', { items: [{ key: 'tasks', value: [], baseRev: 0 }, { key: 'nope', value: [], baseRev: 0 }] });
    await bad('E20. texto con \\u0000 (Postgres lo rechaza en JSONB)', { items: [{ key: 'tasks', value: [{ id: 'z', title: 'a\u0000b' }], baseRev: 0 }] });
    const big = [{ id: 'big', title: 'x'.repeat(2 * 1024 * 1024) }];
    await bad('E21. valor de más de 2 MB', { items: [{ key: 'tasks', value: big, baseRev: 0 }] }, 413);
    check('E22. tras todos los rechazos no existe ninguna fila', fakeDb.rows.size === 0);
  }

  // =====================================================================
  section('F) Errores del servidor');
  // =====================================================================
  {
    const fakeDb = makeFakeDb();
    const handler = freshEndpoint(fakeDb);
    const db = require(path.join(ROOT, 'lib', 'db.js'));
    const origError = console.error;
    console.error = () => {}; // los endpoints registran el error; aquí solo interesa la respuesta

    db.getSql = () => { throw new Error('Falta DATABASE_URL'); };
    const noDb = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    check('F1. DATABASE_URL sin configurar -> 500 con mensaje genérico', noDb._status === 500 && !/DATABASE_URL/.test(noDb._json.error));

    db.getSql = () => async () => { throw new Error('connection reset: host=secret.neon.tech'); };
    const getFail = await call(handler, { method: 'GET', cookie: cookieFor(A) });
    const putFail = await call(handler, { method: 'PUT', cookie: cookieFor(A), body: { items: [{ key: 'tasks', value: [], baseRev: 0 }] } });
    check('F2. fallo de BD en GET -> 500 sin filtrar detalles internos', getFail._status === 500 && !/neon|connection/.test(getFail._json.error));
    check('F3. fallo de BD en PUT -> 500 sin filtrar detalles internos', putFail._status === 500 && !/neon|connection/.test(putFail._json.error));

    console.error = origError;
  }

  // =====================================================================
  section('G) lib/user-data.js coincide con el CHECK de la tabla (último sql/*.sql que lo define)');
  // =====================================================================
  {
    const fs = require('fs');
    const userData = require(path.join(ROOT, 'lib', 'user-data.js'));
    // El CHECK vigente es el del archivo de sql/ más reciente que lo define
    // (004 lo crea, 005 lo amplía con las claves de la app de exámenes).
    const sqlFiles = fs.readdirSync(path.join(ROOT, 'sql')).filter(f => f.endsWith('.sql')).sort();
    const checkBlocks = sqlFiles.map(f => {
      const text = fs.readFileSync(path.join(ROOT, 'sql', f), 'utf8');
      return (text.match(/CHECK \(key IN \(([\s\S]*?)\)\)/) || [])[1];
    }).filter(Boolean);
    const checkBlock = checkBlocks[checkBlocks.length - 1] || '';
    const sqlKeys = [...checkBlock.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
    check('G0. sql/005_study_keys.sql define el CHECK vigente', sqlFiles.includes('005_study_keys.sql') && checkBlocks.length >= 2);
    check('G1. la lista blanca de lib/user-data.js es la misma que el CHECK de la tabla', same(sqlKeys, [...userData.ALLOWED_KEYS].sort()));
    check('G2. reminderNotificationLedger no está en ninguna de las dos', !sqlKeys.includes('reminderNotificationLedger') && !userData.isAllowedKey('reminderNotificationLedger'));
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
