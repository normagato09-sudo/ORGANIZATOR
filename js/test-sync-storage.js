/**
 * ORGANIZATOR — Tests de SYNC paso 5 (js/sync-storage.js)
 *
 * Suite Node pura, de extremo a extremo SIN red real:
 *
 *   SyncStorage (código real)
 *     -> fetch falso que llama DIRECTAMENTE al handler real de api/data.js
 *        (con la cookie de sesión real del "dispositivo")
 *     -> lib/user-data.js real
 *     -> Postgres falso en memoria (mismas consultas que test-sync-api.js)
 *
 * Cada "dispositivo" tiene su propio IndexedDB falso (mínimo, pero con
 * transacciones de verdad: todo o nada, valores clonados), su cookie de
 * sesión y un interruptor de "sin conexión". Los temporizadores (debounce,
 * reintentos) son falsos y se avanzan a mano, así que nada depende del
 * reloj real.
 *
 * Uso:  node js/test-sync-storage.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret-not-real';

const SyncStorage = require('./sync-storage.js');
const { deepEqual } = require('./sync-merge.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
const tick = () => new Promise(r => setImmediate(r));

// ---------------------------------------------------------------------
// Postgres falso (mismas consultas exactas que lib/user-data.js)
// ---------------------------------------------------------------------
function makeFakeDb() {
  const rows = new Map();
  let clock = Date.UTC(2026, 8, 27, 12, 0, 0);
  const now = () => new Date(clock += 1000);
  const id = (u, k) => `${u}|${k}`;
  async function sql(strings, ...values) {
    const text = strings.join('¶');
    if (text.includes('SELECT key, value, rev, updated_at FROM user_data')) {
      return [...rows.values()].filter(r => r.user_id === values[0]).map(r => ({ key: r.key, value: structuredClone(r.value), rev: r.rev, updated_at: r.updated_at }));
    }
    if (text.includes('INSERT INTO user_data')) {
      const [userId, key, json] = values;
      if (rows.has(id(userId, key))) return [];
      const row = { user_id: userId, key, value: JSON.parse(json), rev: '1', updated_at: now() };
      rows.set(id(userId, key), row);
      return [{ rev: row.rev, updated_at: row.updated_at }];
    }
    if (text.includes('UPDATE user_data SET value')) {
      const [json, userId, key, baseRev] = values;
      const row = rows.get(id(userId, key));
      if (!row || Number(row.rev) !== baseRev) return [];
      row.value = JSON.parse(json); row.rev = String(Number(row.rev) + 1); row.updated_at = now();
      return [{ rev: row.rev, updated_at: row.updated_at }];
    }
    if (text.includes('SELECT value, rev, updated_at FROM user_data')) {
      const row = rows.get(id(values[0], values[1]));
      return row ? [{ value: structuredClone(row.value), rev: row.rev, updated_at: row.updated_at }] : [];
    }
    throw new Error('Fake DB: consulta no reconocida: ' + text);
  }
  return { sql, rows, valueOf: (u, k) => { const r = rows.get(id(u, k)); return r ? structuredClone(r.value) : undefined; } };
}

const fakeDb = makeFakeDb();
const db = require(path.join(ROOT, 'lib', 'db.js'));
db.getSql = () => fakeDb.sql;
const dataHandler = require(path.join(ROOT, 'api', 'data.js'));
const session = require(path.join(ROOT, 'lib', 'session.js'));

// ---------------------------------------------------------------------
// IndexedDB falso (lo justo que usa sync-storage.js, con transacciones)
// ---------------------------------------------------------------------
function makeFakeIndexedDB() {
  const databases = new Map(); // nombre -> Map(storeName -> Map(key -> value))
  const later = (fn) => setImmediate(fn);
  function makeRequest() { return { result: undefined, error: null, onsuccess: null, onerror: null }; }
  function openDb(name) {
    const stores = databases.get(name);
    let closed = false;
    return {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore(n) { stores.set(n, new Map()); },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new Error('InvalidStateError: la base de datos está cerrada');
        const list = Array.isArray(names) ? names : [names];
        // Copia de trabajo: los cambios solo se aplican si la transacción termina bien.
        const working = new Map(list.map(n => [n, new Map(stores.get(n))]));
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        let pending = 0;
        const finish = () => later(() => {
          if (pending !== 0) return;
          if (mode === 'readwrite') for (const [n, m] of working) stores.set(n, m);
          if (tx.oncomplete) tx.oncomplete();
        });
        tx.objectStore = (n) => {
          const m = working.get(n);
          if (!m) throw new Error('NotFoundError: ' + n);
          const op = (fn) => { const req = makeRequest(); pending++; later(() => { req.result = fn(); pending--; if (req.onsuccess) req.onsuccess(); finish(); }); return req; };
          return {
            put: (value, key) => op(() => { m.set(key, structuredClone(value)); return key; }),
            delete: (key) => op(() => { m.delete(key); }),
            get: (key) => op(() => structuredClone(m.get(key))),
            getAll: () => op(() => [...m.values()].map(v => structuredClone(v))),
            getAllKeys: () => op(() => [...m.keys()]),
          };
        };
        later(() => { if (pending === 0) finish(); });
        return tx;
      },
    };
  }
  return {
    databases,
    open(name) {
      const req = makeRequest();
      later(() => {
        const isNew = !databases.has(name);
        if (isNew) databases.set(name, new Map());
        req.result = openDb(name);
        if (isNew && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    deleteDatabase(name) {
      const req = makeRequest();
      later(() => { databases.delete(name); if (req.onsuccess) req.onsuccess(); });
      return req;
    },
  };
}

// ---------------------------------------------------------------------
// Temporizadores falsos
// ---------------------------------------------------------------------
function makeTimers() {
  let seq = 0;
  const queue = new Map();
  return {
    setTimeout(fn, ms) { const i = ++seq; queue.set(i, { fn, ms }); return i; },
    clearTimeout(i) { queue.delete(i); },
    pending() { return [...queue.values()].map(t => t.ms); },
    /** Ejecuta los temporizadores pendientes con retardo <= maxMs. */
    async run(maxMs = Infinity) {
      const due = [...queue.entries()].filter(([, t]) => t.ms <= maxMs);
      for (const [i, t] of due) { queue.delete(i); t.fn(); }
      for (let k = 0; k < 30; k++) await tick();
    },
  };
}

// ---------------------------------------------------------------------
// "Dispositivo": IndexedDB propio + fetch con la cookie de SU sesión
// ---------------------------------------------------------------------
function cookieFor(userId) {
  return `${session.SESSION_COOKIE}=${encodeURIComponent(session.signSession({ sub: userId }, process.env.JWT_SECRET))}`;
}

function makeDevice(label) {
  const device = {
    label,
    idb: makeFakeIndexedDB(),
    online: true,
    userId: null,
    requests: [],
    gate: null,            // promesa opcional para "retener" las peticiones
    forceStatus: null,     // p.ej. 500 para simular un fallo del servidor
    async fetch(url, init) {
      if (!device.online) throw new TypeError('Failed to fetch');
      const entry = { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, keepalive: !!init.keepalive };
      device.requests.push(entry);
      if (device.gate) await device.gate;
      if (device.forceStatus) {
        const status = device.forceStatus;
        return { ok: false, status, json: async () => ({ error: 'fallo simulado' }) };
      }
      const req = { method: init.method, headers: device.userId ? { cookie: cookieFor(device.userId) } : {}, body: init.body, query: {} };
      const res = { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; }, setHeader() {} };
      await dataHandler(req, res);
      const status = res._status, json = res._json;
      return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(json) };
    },
  };
  return device;
}

/** Crea el almacén de `userId` en `device` (como si abriera la app). */
async function openApp(device, userId, extra) {
  device.userId = userId;
  const timers = makeTimers();
  const events = { remote: [], status: [], unauthorized: 0 };
  const store = SyncStorage.createStore(Object.assign({
    userId,
    fetch: (u, i) => device.fetch(u, i),
    indexedDB: device.idb,
    timers,
    debounceMs: 1000,
    onRemoteChange: (keys) => events.remote.push(keys),
    onStatusChange: (s) => events.status.push(s),
    onUnauthorized: () => { events.unauthorized++; },
  }, extra || {}));
  await store.ready;
  return { store, timers, events, storage: store.storage };
}

const A = 101, B = 202, CA = 111, CB = 222, KA = 131, KB = 232;
const tasksOf = async (storage) => { const r = await storage.get('tasks'); return r ? JSON.parse(r.value) : null; };
const T = (id, title) => ({ id, title, done: false });

(async () => {
  // =====================================================================
  section('A) Misma interfaz que window.storage (storage-polyfill.js)');
  // =====================================================================
  {
    const phone = makeDevice('móvil');
    const { storage } = await openApp(phone, A);
    check('A1. get de una clave que no existe -> null', (await storage.get('tasks', false)) === null);
    const setRes = await storage.set('tasks', '[]', false);
    check('A2. set devuelve { key, value, shared }', deepEqual(setRes, { key: 'tasks', value: '[]', shared: false }));
    check('A3. get devuelve { key, value, shared } con el string tal cual', deepEqual(await storage.get('tasks', false), { key: 'tasks', value: '[]', shared: false }));
    await storage.set('settingsPrefs', '{"defaultHome":"inicio"}');
    const listed = await storage.list();
    check('A4. list devuelve las claves guardadas', deepEqual(listed.keys.sort(), ['settingsPrefs', 'tasks']) && listed.shared === false);
    await storage.set('tasks', '"compartido"', true);
    check('A5. shared=true es un espacio aparte (como el polyfill)', (await storage.get('tasks', true)).value === '"compartido"' && (await storage.get('tasks', false)).value === '[]');
    const del = await storage.delete('tasks', true);
    check('A6. delete devuelve { key, deleted: true, shared }', deepEqual(del, { key: 'tasks', deleted: true, shared: true }) && (await storage.get('tasks', true)) === null);
  }

  // =====================================================================
  section('B) Subida y descarga básicas');
  // =====================================================================
  {
    const phone = makeDevice('móvil');
    const app = await openApp(phone, A);
    await app.storage.set('tasks', JSON.stringify([T('t1', 'Comprar pan')]));
    check('B1. tras set, la clave queda pendiente y todavía no se ha enviado nada', app.store.hasPendingChanges() && phone.requests.length === 0);
    check('B2. estado "pending"', app.store.getStatus().status === 'pending');
    await app.timers.run(1000);
    check('B3. tras el debounce se sube al servidor de la cuenta A', deepEqual(fakeDb.valueOf(A, 'tasks'), [T('t1', 'Comprar pan')]));
    check('B4. estado "synced" y sin pendientes', app.store.getStatus().status === 'synced' && !app.store.hasPendingChanges());
    check('B5. el valor viaja parseado (lista), no como string JSON', Array.isArray(phone.requests[0].body.items[0].value));

    const pc = makeDevice('PC');
    const pcApp = await openApp(pc, A);
    check('B6. otro dispositivo, antes de sincronizar, está vacío', (await tasksOf(pcApp.storage)) === null);
    const r = await pcApp.store.sync();
    check('B7. al sincronizar descarga los datos de la cuenta', r.ok && deepEqual(await tasksOf(pcApp.storage), [T('t1', 'Comprar pan')]));
    check('B8. avisa a la app de qué claves cambiaron (para recargar el estado)', deepEqual(pcApp.events.remote, [['tasks']]));
    const again = await pcApp.store.sync();
    check('B9. sincronizar otra vez sin cambios no avisa de nada', again.ok && pcApp.events.remote.length === 1);
  }

  // =====================================================================
  section('C) Aislamiento entre cuentas en el MISMO dispositivo');
  // =====================================================================
  {
    const phone = makeDevice('móvil compartido');
    const appA = await openApp(phone, CA);
    await appA.storage.set('tasks', JSON.stringify([T('secreto', 'Tarea privada de A')]));
    await appA.storage.set('reminderNotificationLedger', '{"r1":1}');
    await appA.store.flush();
    await appA.store.deactivate();

    const appB = await openApp(phone, CB);
    check('C1. B en el mismo móvil no ve las tareas de A en la caché', (await appB.storage.get('tasks')) === null);
    check('C2. ni el registro local de avisos de A', (await appB.storage.get('reminderNotificationLedger')) === null);
    check('C3. list() de B está vacío', (await appB.storage.list()).keys.length === 0);
    await appB.store.sync();
    check('C4. tras sincronizar, B sigue sin ver nada de A (el servidor le da SUS datos)', (await appB.storage.get('tasks')) === null);
    await appB.storage.set('tasks', JSON.stringify([T('b1', 'Tarea de B')]));
    await appB.store.flush();
    check('C5. lo que guarda B va a la cuenta B y no toca la de A', deepEqual(fakeDb.valueOf(CB, 'tasks'), [T('b1', 'Tarea de B')]) && fakeDb.valueOf(CA, 'tasks')[0].id === 'secreto');
    check('C6. cada cuenta tiene su propia base IndexedDB', phone.idb.databases.has(SyncStorage.dbNameForUser(CA)) && phone.idb.databases.has(SyncStorage.dbNameForUser(CB)));

    await appB.store.destroy();
    check('C7. destroy() (cerrar sesión) borra SOLO la base de B', !phone.idb.databases.has(SyncStorage.dbNameForUser(CB)) && phone.idb.databases.has(SyncStorage.dbNameForUser(CA)));
    let threw = false;
    try { await appB.storage.set('tasks', '[]'); } catch (e) { threw = true; }
    check('C8. tras cerrar sesión, el almacén de B ya no acepta escrituras', threw);

    const appA2 = await openApp(phone, CA);
    check('C9. A vuelve a entrar: su caché sigue ahí', (await tasksOf(appA2.storage))[0].id === 'secreto');
  }

  // =====================================================================
  section('D) Sin conexión');
  // =====================================================================
  {
    const phone = makeDevice('móvil');
    const app = await openApp(phone, A);
    await app.store.sync();
    phone.online = false;
    await app.storage.set('tasks', JSON.stringify([T('off1', 'Hecha sin conexión')]));
    check('D1. sin conexión, set funciona y el valor se lee al momento', (await tasksOf(app.storage))[0].id === 'off1');
    const flushed = await app.store.flush();
    check('D2. flush sin conexión -> false, sigue pendiente', flushed === false && app.store.hasPendingChanges());
    check('D3. estado "offline" y un reintento programado', app.store.getStatus().status === 'offline' && app.timers.pending().some(ms => ms >= 5000));

    // Se cierra la app sin conexión y se vuelve a abrir.
    await app.store.deactivate();
    const reopened = await openApp(phone, A);
    check('D4. al reabrir sin conexión, los datos siguen en la caché', (await tasksOf(reopened.storage))[0].id === 'off1');
    check('D5. y la marca de pendiente también (sobrevive a cerrar la app)', reopened.store.hasPendingChanges());
    const offlineSync = await reopened.store.sync();
    check('D6. sincronizar sin conexión no lanza: devuelve offline', offlineSync.ok === false && offlineSync.offline === true);

    phone.online = true;
    await reopened.store.sync();
    check('D7. al volver la conexión se sube lo pendiente', fakeDb.valueOf(A, 'tasks')[0].id === 'off1' && !reopened.store.hasPendingChanges());
    check('D8. el reintento programado se cancela al sincronizar bien', reopened.timers.pending().every(ms => ms !== 5000));
  }

  // =====================================================================
  section('E) Conflictos entre dos dispositivos de la misma cuenta');
  // =====================================================================
  {
    const user = 303;
    const phone = makeDevice('móvil');
    const pc = makeDevice('PC');
    const phoneApp = await openApp(phone, user);
    await phoneApp.storage.set('tasks', JSON.stringify([T('a', 'Común')]));
    await phoneApp.store.flush();
    const pcApp = await openApp(pc, user);
    await pcApp.store.sync();

    // El PC añade una tarea y la sube; el móvil, sin conexión, añade otra.
    await pcApp.storage.set('tasks', JSON.stringify([T('a', 'Común'), T('p1', 'Desde el PC')]));
    await pcApp.store.flush();
    phone.online = false;
    await phoneApp.storage.set('tasks', JSON.stringify([T('a', 'Común'), T('m1', 'Desde el móvil')]));
    await phoneApp.store.flush();
    phone.online = true;
    await phoneApp.store.sync();
    const server = fakeDb.valueOf(user, 'tasks').map(t => t.id).sort();
    check('E1. al volver la conexión, el servidor tiene las DOS tareas nuevas', deepEqual(server, ['a', 'm1', 'p1']));
    check('E2. el móvil tiene las dos en su caché', deepEqual((await tasksOf(phoneApp.storage)).map(t => t.id).sort(), ['a', 'm1', 'p1']));
    check('E3. se avisó a la app del móvil para recargar', phoneApp.events.remote.some(keys => keys.includes('tasks')));
    await pcApp.store.sync();
    check('E4. el PC, al sincronizar, también las tiene', deepEqual((await tasksOf(pcApp.storage)).map(t => t.id).sort(), ['a', 'm1', 'p1']));

    // Conflicto detectado al SUBIR (sin descargar antes): 409 -> fusión -> reintento.
    await pcApp.storage.set('tasks', JSON.stringify([...(await tasksOf(pcApp.storage)), T('p2', 'PC otra vez')]));
    await pcApp.store.flush();
    await phoneApp.storage.set('tasks', JSON.stringify([...(await tasksOf(phoneApp.storage)), T('m2', 'Móvil otra vez')]));
    const before = phone.requests.length;
    await phoneApp.store.flush();
    const puts = phone.requests.slice(before).filter(r => r.method === 'PUT').length;
    check('E5. subida con rev desfasado: conflicto, fusión y segunda subida', puts === 2);
    check('E6. no se pierde nada de ninguno de los dos', deepEqual(fakeDb.valueOf(user, 'tasks').map(t => t.id).sort(), ['a', 'm1', 'm2', 'p1', 'p2']));

    // Borrado en un lado + edición en el otro.
    await pcApp.store.sync();
    await pcApp.storage.set('tasks', JSON.stringify((await tasksOf(pcApp.storage)).filter(t => t.id !== 'm1')));
    await pcApp.store.flush();
    await phoneApp.storage.set('tasks', JSON.stringify((await tasksOf(phoneApp.storage)).map(t => t.id === 'a' ? { ...t, done: true } : t)));
    await phoneApp.store.flush();
    const final = fakeDb.valueOf(user, 'tasks');
    check('E7. el borrado del PC se respeta y la edición del móvil también', !final.some(t => t.id === 'm1') && final.find(t => t.id === 'a').done === true);
  }

  // =====================================================================
  section('F) El registro local de avisos NUNCA sale del dispositivo');
  // =====================================================================
  {
    const phone = makeDevice('móvil');
    const app = await openApp(phone, 404);
    await app.storage.set('reminderNotificationLedger', '{"r1":1727430000000}');
    await app.storage.set('tasks', '[]');
    check('F1. guardar el registro no lo marca como pendiente de subir', deepEqual(app.store.getStatus().pendingKeys, ['tasks']));
    await app.store.flush();
    await app.store.sync();
    const sentKeys = phone.requests.filter(r => r.body).flatMap(r => r.body.items.map(i => i.key));
    check('F2. ninguna petición incluye reminderNotificationLedger', !sentKeys.includes('reminderNotificationLedger') && sentKeys.includes('tasks'));
    check('F3. el servidor nunca lo recibe', fakeDb.valueOf(404, 'reminderNotificationLedger') === undefined);
    await app.store.deactivate();
    const reopened = await openApp(phone, 404);
    check('F4. sigue guardado en la caché local tras reabrir', (await reopened.storage.get('reminderNotificationLedger')).value === '{"r1":1727430000000}');
  }

  // =====================================================================
  section('G) Debounce y escrituras durante una subida');
  // =====================================================================
  {
    const phone = makeDevice('móvil');
    const app = await openApp(phone, 505);
    for (let i = 1; i <= 5; i++) await app.storage.set('tasks', JSON.stringify([T('t', 'versión ' + i)]));
    check('G1. cinco cambios seguidos: un único temporizador de debounce', app.timers.pending().filter(ms => ms === 1000).length === 1);
    await app.timers.run(1000);
    const puts = phone.requests.filter(r => r.method === 'PUT');
    check('G2. ...y una única subida, con el último valor', puts.length === 1 && puts[0].body.items[0].value[0].title === 'versión 5');

    // Una escritura mientras la subida anterior está en vuelo.
    let release;
    phone.gate = new Promise(r => { release = r; });
    await app.storage.set('tasks', JSON.stringify([T('t', 'A')]));
    const flushing = app.store.flush();
    await tick();
    await app.storage.set('tasks', JSON.stringify([T('t', 'B (durante la subida)')]));
    phone.gate = null;
    release();
    await flushing;
    await app.store.flush();
    check('G3. un cambio hecho durante una subida no se pierde: acaba en el servidor', fakeDb.valueOf(505, 'tasks')[0].title === 'B (durante la subida)');
    check('G4. y al final no queda nada pendiente', !app.store.hasPendingChanges());
  }

  // =====================================================================
  section('H) Errores del servidor y sesión caducada');
  // =====================================================================
  {
    const phone = makeDevice('móvil');
    const app = await openApp(phone, 606);
    await app.storage.set('tasks', '[]');
    phone.forceStatus = 500;
    await app.store.flush();
    check('H1. error 500: estado "error", sigue pendiente y hay reintento programado', app.store.getStatus().status === 'error' && app.store.hasPendingChanges() && app.timers.pending().length > 0);
    phone.forceStatus = null;
    await app.timers.run();
    check('H2. el reintento programado sube lo pendiente cuando el servidor se recupera', !app.store.hasPendingChanges() && app.store.getStatus().status === 'synced');

    const other = makeDevice('otro');
    const expired = await openApp(other, 707);
    other.userId = null; // la cookie ya no vale
    await expired.storage.set('tasks', '[]');
    await expired.store.flush();
    check('H3. 401: estado "unauthorized" y se avisa a la app (para volver al login)', expired.store.getStatus().status === 'unauthorized' && expired.events.unauthorized === 1);
    check('H4. 401: no se programan reintentos automáticos', expired.timers.pending().every(ms => ms === 1000));
    check('H5. 401: los datos locales NO se pierden', expired.store.hasPendingChanges() && (await expired.storage.get('tasks')).value === '[]');
  }

  // =====================================================================
  section('I) Cierre de la página (keepalive) y recuperación');
  // =====================================================================
  {
    const phone = makeDevice('móvil');
    const app = await openApp(phone, 808);
    await app.store.sync();
    await app.storage.set('tasks', JSON.stringify([T('k1', 'Guardada justo antes de cerrar')]));
    const sent = app.store.flushKeepalive();
    await tick(); await tick();
    const ka = phone.requests.find(r => r.keepalive);
    check('I1. al cerrar la página se envía la subida con keepalive', sent === true && !!ka && ka.method === 'PUT');
    check('I2. llega al servidor', fakeDb.valueOf(808, 'tasks')[0].id === 'k1');
    await app.store.deactivate();
    const reopened = await openApp(phone, 808);
    check('I3. al reabrir, la caché aún la marca como pendiente (no se esperó respuesta)', reopened.store.hasPendingChanges());
    const before = phone.requests.length;
    await reopened.store.sync();
    check('I4. la descarga ve que el servidor ya la tiene y limpia la marca SIN volver a subir', !reopened.store.hasPendingChanges() && phone.requests.slice(before).every(r => r.method === 'GET'));
    const big = JSON.stringify([T('x', 'y'.repeat(70 * 1024))]);
    await reopened.storage.set('tasks', big);
    check('I5. si lo pendiente supera el límite de keepalive (64 KB), no se intenta', reopened.store.flushKeepalive() === false);
  }

  // =====================================================================
  section('J) Casos límite');
  // =====================================================================
  {
    // El servidor no tiene una clave que creíamos subida -> se vuelve a subir.
    const phone = makeDevice('móvil');
    const app = await openApp(phone, 909);
    await app.storage.set('events', JSON.stringify([{ id: 'e1', title: 'Evento' }]));
    await app.store.flush();
    fakeDb.rows.delete('909|events');
    await app.store.sync();
    check('J1. clave desaparecida del servidor: se vuelve a subir lo local (no se da por perdida)', deepEqual(fakeDb.valueOf(909, 'events'), [{ id: 'e1', title: 'Evento' }]));

    // Varias claves grandes: se reparten en varias peticiones bajo el límite de Vercel.
    const bigApp = await openApp(makeDevice('grande'), 910);
    const bigDevice = makeDevice('grande2');
    const big2 = await openApp(bigDevice, 911);
    const chunk = (n) => JSON.stringify([{ id: 'big' + n, title: 'x'.repeat(1900 * 1024) }]);
    await big2.storage.set('tasks', chunk(1));
    await big2.storage.set('events', chunk(2));
    await big2.store.flush();
    const bigPuts = bigDevice.requests.filter(r => r.method === 'PUT');
    check('J2. dos claves de ~1.9 MB: dos peticiones, cada una bajo 4.5 MB', bigPuts.length === 2 && bigPuts.every(p => Buffer.byteLength(JSON.stringify(p.body)) < 4.5 * 1024 * 1024));
    check('J3. ambas llegan al servidor', !!fakeDb.valueOf(911, 'tasks') && !!fakeDb.valueOf(911, 'events'));
    await bigApp.store.deactivate();

    // Sin IndexedDB: funciona en memoria.
    const noIdb = SyncStorage.createStore({ userId: 912, fetch: makeDevice('sin-idb').fetch, timers: makeTimers() });
    await noIdb.ready;
    await noIdb.storage.set('settingsIA', '{"enabled":false}');
    check('J4. sin IndexedDB: funciona en memoria (y lo indica en el estado)', (await noIdb.storage.get('settingsIA')).value === '{"enabled":false}' && noIdb.getStatus().persistent === false);

    let threw = false;
    try { SyncStorage.createStore({ fetch: () => {} }); } catch (e) { threw = true; }
    check('J5. crear un almacén sin userId lanza (nunca una caché "sin dueño")', threw);

    const serverKeys = require(path.join(ROOT, 'lib', 'user-data.js')).ALLOWED_KEYS;
    check('J6. las claves que sincroniza el cliente son exactamente la lista blanca del servidor', deepEqual([...SyncStorage.SYNCED_KEYS].sort(), [...serverKeys].sort()));
  }

  // =====================================================================
  section('K) activate(): sustituye window.storage y engancha los eventos');
  // =====================================================================
  {
    const device = makeDevice('navegador');
    const listeners = {};
    const docListeners = {};
    const win = {
      indexedDB: device.idb,
      fetch: (u, i) => device.fetch(u, i),
      storage: { polyfill: true },
      addEventListener: (t, f) => { listeners[t] = f; },
      removeEventListener: (t) => { delete listeners[t]; },
      document: { visibilityState: 'visible', addEventListener: (t, f) => { docListeners[t] = f; }, removeEventListener: (t) => { delete docListeners[t]; } },
    };
    device.userId = KA;
    const storeA = await SyncStorage.activate({ id: KA }, { window: win, timers: makeTimers() });
    check('K1. window.storage pasa a ser el almacén del usuario', win.storage === storeA.storage);
    check('K2. hace la primera descarga al activarse', device.requests.some(r => r.method === 'GET'));
    check('K3. engancha online, pagehide y visibilitychange', !!listeners.online && !!listeners.pagehide && !!docListeners.visibilitychange);
    const gets = device.requests.filter(r => r.method === 'GET').length;
    listeners.online();
    await tick(); await tick(); await tick();
    check('K4. el evento "online" lanza una sincronización', device.requests.filter(r => r.method === 'GET').length === gets + 1);

    await storeA.storage.set('tasks', JSON.stringify([T('ka', 'Privada de KA')]));
    await storeA.flush();
    device.userId = KB;
    const storeB = await SyncStorage.activate({ id: KB }, { window: win, timers: makeTimers() });
    check('K5. activar otro usuario sustituye window.storage por el suyo', win.storage === storeB.storage && win.storage !== storeA.storage);
    check('K6. y B no ve los datos de A', (await win.storage.get('tasks')) === null);
    check('K7. SyncStorage.current() es el de B', SyncStorage.current() === storeB);
    await SyncStorage.deactivate();
    check('K8. deactivate() quita los eventos', !listeners.online && !docListeners.visibilitychange);
    await SyncStorage.deleteUserCache(KB, device.idb);
    check('K9. deleteUserCache borra la base de un usuario sin tenerla activa', !device.idb.databases.has(SyncStorage.dbNameForUser(KB)));
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
