/**
 * ORGANIZATOR — Tests de SYNC paso 6 (arranque, login, logout y cambio de cuenta)
 *
 * Cada "carga de página" es un sandbox `vm` NUEVO que ejecuta el código
 * REAL de organizator.html (bloque ALMACENAMIENTO y bloque AUTENTICACIÓN +
 * INICIALIZACIÓN, incluido init(), que arranca solo al cargarse igual que
 * en el navegador) junto con js/sync-merge.js y js/sync-storage.js reales.
 * Lo que persiste entre cargas es el "dispositivo": su IndexedDB (falso),
 * su localStorage (falso) y su cookie de sesión. El servidor es el handler
 * real de api/data.js sobre un Postgres falso; /api/auth/* y
 * /api/push/unsubscribe se simulan con lo mínimo (cookie por dispositivo).
 *
 * Escenario principal: dos hermanos comparten un móvil.
 *
 * Uso:  node js/test-sync-account-switch.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret-not-real';

const html = fs.readFileSync(path.join(ROOT, 'organizator.html'), 'utf8').replace(/\r\n/g, '\n');
const syncMergeSrc = fs.readFileSync(path.join(__dirname, 'sync-merge.js'), 'utf8');
const syncStorageSrc = fs.readFileSync(path.join(__dirname, 'sync-storage.js'), 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}
const HDR = '/* ==================================================================\n   ';
const defaultsSrc = extractBetween(html, 'function defaultPrefs(){', `\n\n${HDR}ESTADO`, 'defaultPrefs/defaultIA');
const storageBlockSrc = extractBetween(html, 'async function loadState(){', `\n\n${HDR}CRUD`, 'bloque ALMACENAMIENTO');
const ledgerSaveSrc = extractBetween(html, 'async function saveReminderNotificationLedger(){', '\n\n', 'saveReminderNotificationLedger');
const authBlockSrc = extractBetween(html, `${HDR}AUTENTICACIÓN`, '\n</script>', 'bloque AUTENTICACIÓN + INICIALIZACIÓN');
const startAppSrc = extractBetween(html, 'async function startApp(){', '\n(async function init(){', 'startApp()');
// Paso 8: bloque real de Exportar / Importar / Borrar datos (incluye el saneamiento de importación).
const dataIOSrc = extractBetween(html, '/* ---------- Exportar / Importar / Borrar datos ---------- */', `\n\n${HDR}IA — ASISTENTE PERSONAL`, 'bloque Exportar/Importar/Borrar');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function settle() { for (let i = 0; i < 4; i++) { for (let k = 0; k < 60; k++) await new Promise(r => setImmediate(r)); await sleep(25); } }

// ---------------------------------------------------------------------
// Servidor: Postgres falso + handler real de api/data.js
// ---------------------------------------------------------------------
function makeFakeDb() {
  const rows = new Map();
  const id = (u, k) => `${u}|${k}`;
  async function sql(strings, ...values) {
    const text = strings.join('¶');
    if (text.includes('SELECT key, value, rev, updated_at FROM user_data')) return [...rows.values()].filter(r => r.user_id === values[0]).map(r => ({ key: r.key, value: structuredClone(r.value), rev: r.rev, updated_at: new Date() }));
    if (text.includes('INSERT INTO user_data')) {
      const [u, k, json] = values;
      if (rows.has(id(u, k))) return [];
      rows.set(id(u, k), { user_id: u, key: k, value: JSON.parse(json), rev: '1' });
      return [{ rev: '1', updated_at: new Date() }];
    }
    if (text.includes('UPDATE user_data SET value')) {
      const [json, u, k, baseRev] = values;
      const row = rows.get(id(u, k));
      if (!row || Number(row.rev) !== baseRev) return [];
      row.value = JSON.parse(json); row.rev = String(Number(row.rev) + 1);
      return [{ rev: row.rev, updated_at: new Date() }];
    }
    if (text.includes('SELECT value, rev, updated_at FROM user_data')) {
      const row = rows.get(id(values[0], values[1]));
      return row ? [{ value: structuredClone(row.value), rev: row.rev, updated_at: new Date() }] : [];
    }
    throw new Error('Fake DB: consulta no reconocida: ' + text);
  }
  return { sql, valueOf: (u, k) => { const r = rows.get(id(u, k)); return r ? structuredClone(r.value) : undefined; } };
}
const fakeDb = makeFakeDb();
require(path.join(ROOT, 'lib', 'db.js')).getSql = () => fakeDb.sql;
const dataHandler = require(path.join(ROOT, 'api', 'data.js'));
const session = require(path.join(ROOT, 'lib', 'session.js'));

const USERS = {
  'hermana@example.com': { id: 1, email: 'hermana@example.com', name: 'Norma', password: 'secreta1' },
  'hermano@example.com': { id: 2, email: 'hermano@example.com', name: 'Hermano', password: 'secreta2' },
};
const userById = (uid) => Object.values(USERS).find(u => u.id === uid);

// ---------------------------------------------------------------------
// IndexedDB falso (mismo que test-sync-storage.js)
// ---------------------------------------------------------------------
function makeFakeIndexedDB() {
  const databases = new Map();
  const later = (fn) => setImmediate(fn);
  const makeRequest = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });
  function openDb(name) {
    const stores = databases.get(name);
    return {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore(n) { stores.set(n, new Map()); },
      close() {},
      transaction(names, mode) {
        const list = Array.isArray(names) ? names : [names];
        const working = new Map(list.map(n => [n, new Map(stores.get(n))]));
        const tx = { oncomplete: null, onerror: null, onabort: null };
        let pending = 0;
        const finish = () => later(() => {
          if (pending !== 0) return;
          if (mode === 'readwrite' && databases.get(name) === stores) for (const [n, m] of working) stores.set(n, m);
          if (tx.oncomplete) tx.oncomplete();
        });
        tx.objectStore = (n) => {
          const m = working.get(n);
          const op = (fn) => { const req = makeRequest(); pending++; later(() => { req.result = fn(); pending--; if (req.onsuccess) req.onsuccess(); finish(); }); return req; };
          return {
            put: (v, k) => op(() => { m.set(k, structuredClone(v)); }),
            delete: (k) => op(() => { m.delete(k); }),
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
// Dispositivo (persiste entre cargas de página)
// ---------------------------------------------------------------------
function makeDevice() {
  const device = {
    idb: makeFakeIndexedDB(),
    localStorage: new Map(),
    cookieUserId: null,       // de quién es la cookie de sesión de este navegador
    online: true,
    log: [],                  // peticiones: 'GET /api/data', 'POST /api/auth/logout'...
    pushSubscription: null,   // { endpoint, unsubscribed }
    ledgerClears: 0,
  };
  device.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    device.log.push(`${method} ${url}`);
    if (!device.online) throw new TypeError('Failed to fetch');
    const json = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(obj) });
    if (url === '/api/auth/me') {
      const u = device.cookieUserId && userById(device.cookieUserId);
      return u ? json(200, { user: { id: u.id, email: u.email, name: u.name } }) : json(401, { error: 'No has iniciado sesión.' });
    }
    if (url === '/api/auth/login') {
      const body = JSON.parse(init.body);
      const u = USERS[body.email];
      if (!u || u.password !== body.password) return json(401, { error: 'Email o contraseña incorrectos.' });
      device.cookieUserId = u.id;
      return json(200, { user: { id: u.id, email: u.email, name: u.name } });
    }
    if (url === '/api/auth/logout') { device.cookieUserId = null; return json(200, { ok: true }); }
    if (url === '/api/push/unsubscribe') {
      device.unsubscribeRequest = { endpoint: JSON.parse(init.body).endpoint, withSessionOf: device.cookieUserId };
      return json(200, { ok: true });
    }
    if (url === '/api/data') {
      const req = { method, headers: device.cookieUserId ? { cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(session.signSession({ sub: device.cookieUserId }, process.env.JWT_SECRET))}` } : {}, body: init.body, query: {} };
      const res = { _s: 200, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; }, setHeader() {} };
      await dataHandler(req, res);
      return json(res._s, res._j);
    }
    return json(404, { error: 'no simulado: ' + url });
  };
  return device;
}

// ---------------------------------------------------------------------
// Carga de página: sandbox nuevo con el código real
// ---------------------------------------------------------------------
function makeElement(id) {
  const classes = new Set(id === 'auth-screen' ? ['hidden'] : []);
  const listeners = {};
  return {
    id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : on ? classes.add(c) : classes.delete(c)) },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    fire: async (t, e) => { for (const f of (listeners[t] || [])) await f(e || { preventDefault() {} }); },
  };
}

async function loadPage(device, { withSyncStorage = true, legacyStorage = null, confirmAnswer = true } = {}) {
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
  const page = { reloads: 0, toasts: [], confirms: [], calls: [], downloads: [], elements: el };
  const sb = {
    console,
    structuredClone,
    TextEncoder,
    Blob,
    URL: { createObjectURL: (b) => { page.lastBlob = b; return 'blob:x'; }, revokeObjectURL() {} },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 20)), // el tiempo "corre" rápido
    clearTimeout,
    indexedDB: device.idb,
    fetch: device.fetch,
    localStorage: {
      getItem: (k) => (device.localStorage.has(k) ? device.localStorage.get(k) : null),
      setItem: (k, v) => device.localStorage.set(k, String(v)),
      removeItem: (k) => device.localStorage.delete(k),
    },
    location: { reload: () => { page.reloads++; } },
    confirm: (msg) => { page.confirms.push(msg); return confirmAnswer; },
    navigator: {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => (device.pushSubscription && !device.pushSubscription.unsubscribed
              ? { endpoint: device.pushSubscription.endpoint, unsubscribe: async () => { device.pushSubscription.unsubscribed = true; return true; } }
              : null),
          },
        }),
      },
    },
    SWPushLedger: { clearAll: async () => { device.ledgerClears++; } },
    addEventListener() {}, removeEventListener() {},
    document: {
      getElementById: el, visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
      body: { appendChild() {} },
      createElement: () => ({ remove() {}, click() { page.downloads.push(page.lastBlob); } }),
    },
    __page: page,
  };
  sb.window = sb; sb.self = sb;
  if (legacyStorage) sb.storage = legacyStorage;
  vm.createContext(sb);
  vm.runInContext(`
    let state = { tasks: [], events: [], customSchedules: [], eventCategories: [], reminders: [], reminderNotificationLedger: {}, prefs: {}, ia: {} };
    const cal = {};
    const APP_NAME = 'ORGANIZATOR';
    const APP_VERSION = 'test';
    const overlay = document.getElementById('modal-overlay');
    function todayStr(){ return '2026-09-27'; }
    function showToast(m){ __page.toasts.push(m); }
    function renderCurrentView(){ __page.calls.push('render'); }
    function initIA(){ __page.calls.push('initIA'); }
    function initPWA(){}
    function startReminderPolling(){}
    function reconcilePushSubscriptionOnStartup(){ __page.calls.push('reconcilePush'); }
    function showView(v){ __page.calls.push('showView:' + v); }
  `, sb, { filename: 'stubs' });
  vm.runInContext(defaultsSrc, sb, { filename: 'organizator.html (defaultPrefs/defaultIA)' });
  if (withSyncStorage) {
    vm.runInContext(syncMergeSrc, sb, { filename: 'js/sync-merge.js' });
    vm.runInContext(syncStorageSrc, sb, { filename: 'js/sync-storage.js' });
  }
  vm.runInContext(storageBlockSrc + '\n' + ledgerSaveSrc, sb, { filename: 'organizator.html (ALMACENAMIENTO)' });
  vm.runInContext(dataIOSrc, sb, { filename: 'organizator.html (Exportar/Importar/Borrar)' });
  vm.runInContext(authBlockSrc + `
    this.__app = {
      get state(){ return state; },
      get currentUser(){ return currentUser; },
      saveTasks, saveEvents, saveReminderNotificationLedger, logout, handleRemoteDataChange,
      exportData, deleteAllData, syncStatusText, syncNow,
    };`, sb, { filename: 'organizator.html (AUTENTICACIÓN + INICIALIZACIÓN)' });
  await settle();
  const app = sb.__app;
  page.sb = sb;
  page.app = app;
  page.authVisible = () => !el('auth-screen').classList.contains('hidden');
  page.appVisible = () => el('app').style.display !== 'none';
  page.login = async (email, password) => {
    el('login-email').value = email;
    el('login-password').value = password;
    await el('login-form').fire('submit');
    await settle();
  };
  page.addTask = async (id, title) => {
    app.state.tasks = [...app.state.tasks, { id, title, done: false }];
    await app.saveTasks();
  };
  page.store = () => sb.SyncStorage && sb.SyncStorage.current();
  return page;
}

const SIS = USERS['hermana@example.com'];
const BRO = USERS['hermano@example.com'];
const taskIds = (page) => page.app.state.tasks.map(t => t.id).sort();

(async () => {
  const phone = makeDevice();
  phone.pushSubscription = { endpoint: 'https://push.example/phone-1', unsubscribed: false };

  // =====================================================================
  section('A) Primer uso: la hermana inicia sesión y crea tareas');
  // =====================================================================
  let page = await loadPage(phone);
  check('A1. sin sesión se muestra el login y la app no arranca', page.authVisible() && !page.calls.includes('initIA'));
  await page.login(SIS.email, SIS.password);
  check('A2. tras el login arranca la app', !page.authVisible() && page.calls.includes('initIA'));
  check('A3. window.storage es el almacén de SU cuenta', page.store() && page.store().userId === SIS.id && page.sb.storage === page.store().storage);
  check('A4. se guarda el último usuario (sin token)', JSON.parse(phone.localStorage.get('organizator:lastUser')).id === SIS.id && !/token|password/i.test(phone.localStorage.get('organizator:lastUser')));
  await page.addTask('s1', 'Examen de mates');
  await page.addTask('s2', 'Tarea de física');
  await page.app.saveReminderNotificationLedger();
  await page.store().flush();
  check('A5. sus tareas llegan a SU cuenta en el servidor', JSON.stringify(fakeDb.valueOf(SIS.id, 'tasks').map(t => t.id)) === '["s1","s2"]');
  check('A6. startApp activa el almacén de la cuenta ANTES de leer ningún dato',
    startAppSrc.indexOf('activateAccountStorage()') !== -1 && startAppSrc.indexOf('activateAccountStorage()') < startAppSrc.indexOf('loadState()'));

  // =====================================================================
  section('B) La hermana cierra sesión');
  // =====================================================================
  const logBefore = phone.log.length;
  await page.app.logout();
  await settle();
  const logoutLog = phone.log.slice(logBefore);
  check('B1. no pregunta nada (no había cambios sin subir)', page.confirms.length === 0);
  check('B2. da de baja el push de este móvil EN SU cuenta (antes de cerrar la sesión)', phone.unsubscribeRequest && phone.unsubscribeRequest.endpoint === 'https://push.example/phone-1' && phone.unsubscribeRequest.withSessionOf === SIS.id);
  check('B3. y también en el navegador', phone.pushSubscription.unsubscribed === true);
  check('B4. /api/push/unsubscribe va antes que /api/auth/logout', logoutLog.indexOf('POST /api/push/unsubscribe') < logoutLog.indexOf('POST /api/auth/logout'));
  check('B5. se reinicia el registro de avisos push del Service Worker', phone.ledgerClears === 1);
  check('B6. se borra la caché local de SU cuenta', !phone.idb.databases.has('organizator-data-u1'));
  check('B7. se olvida el último usuario', !phone.localStorage.has('organizator:lastUser'));
  check('B8. se cierra la sesión en el servidor y se recarga la página', phone.cookieUserId === null && page.reloads === 1);

  // =====================================================================
  section('C) El hermano entra en el mismo móvil');
  // =====================================================================
  page = await loadPage(phone);
  check('C1. tras recargar se pide login (no se entra solo en la cuenta anterior)', page.authVisible() && !page.calls.includes('initIA'));
  await page.login(BRO.email, BRO.password);
  check('C2. el hermano NO ve ninguna tarea de la hermana', page.app.state.tasks.length === 0);
  check('C3. su window.storage no tiene nada de ella', (await page.sb.storage.get('tasks')) === null && (await page.sb.storage.get('reminderNotificationLedger')) === null);
  await page.addTask('b1', 'Entrenamiento');
  await page.store().flush();
  check('C4. lo que crea él va a SU cuenta y no toca la de ella', JSON.stringify(fakeDb.valueOf(BRO.id, 'tasks').map(t => t.id)) === '["b1"]' && fakeDb.valueOf(SIS.id, 'tasks').length === 2);
  await page.app.logout();
  await settle();

  // =====================================================================
  section('D) La hermana vuelve a entrar: sus datos vuelven desde la cuenta');
  // =====================================================================
  page = await loadPage(phone);
  await page.login(SIS.email, SIS.password);
  check('D1. recupera sus tareas (descargadas del servidor, la caché se había borrado)', JSON.stringify(taskIds(page)) === '["s1","s2"]');
  check('D2. y no ve la del hermano', !taskIds(page).includes('b1'));

  // =====================================================================
  section('E) Otro dispositivo de la hermana');
  // =====================================================================
  const pc = makeDevice();
  let pcPage = await loadPage(pc);
  await pcPage.login(SIS.email, SIS.password);
  check('E1. en un dispositivo nuevo aparecen sus datos al iniciar sesión', JSON.stringify(taskIds(pcPage)) === '["s1","s2"]');

  // =====================================================================
  section('F) Cambio llegado de otro dispositivo con un formulario abierto');
  // =====================================================================
  await pcPage.addTask('pc1', 'Desde el PC');
  await pcPage.store().flush();
  page.elements('modal-overlay').classList.add('open');
  await page.store().sync();
  await settle();
  check('F1. con un formulario abierto NO se cambian los datos en pantalla', !taskIds(page).includes('pc1'));
  page.elements('modal-overlay').classList.remove('open');
  await settle();
  check('F2. al cerrarlo se aplican los cambios y se repinta', taskIds(page).includes('pc1') && page.calls.includes('render'));

  // =====================================================================
  section('G) Sin conexión');
  // =====================================================================
  phone.online = false;
  page = await loadPage(phone);
  check('G1. sin conexión, abre con el último usuario y su caché', !page.authVisible() && page.app.currentUser.id === SIS.id && taskIds(page).includes('s1') && taskIds(page).includes('pc1'));
  await page.addTask('off1', 'Sin conexión');
  check('G2. se puede seguir trabajando (queda pendiente)', page.store().hasPendingChanges());
  phone.online = true;
  await page.store().sync();
  check('G3. al volver la red se sube', fakeDb.valueOf(SIS.id, 'tasks').some(t => t.id === 'off1'));

  const newDevice = makeDevice();
  newDevice.online = false;
  const fresh = await loadPage(newDevice);
  check('G4. sin conexión y sin usuario previo en el dispositivo: login (no se inventa sesión)', fresh.authVisible() && !fresh.calls.includes('initIA'));

  // =====================================================================
  section('H) Cerrar sesión sin conexión y con cambios sin subir');
  // =====================================================================
  phone.online = false;
  page = await loadPage(phone, { confirmAnswer: false });
  await page.addTask('pend1', 'Pendiente');
  await page.app.logout();
  await settle();
  check('H1. avisa de que hay cambios sin subir', page.confirms.length === 1 && /sin subir|no se han podido subir/.test(page.confirms[0]));
  check('H2. si cancela, NO se cierra sesión ni se borra nada', page.reloads === 0 && phone.idb.databases.has('organizator-data-u1') && page.store() && page.store().hasPendingChanges());

  page = await loadPage(phone, { confirmAnswer: true });
  await page.app.logout();
  await settle();
  check('H3. si acepta, se borra la caché de su cuenta aunque no haya red', !phone.idb.databases.has('organizator-data-u1') && page.reloads === 1);
  check('H4. la cookie no se pudo borrar (sin red): queda marcado el cierre pendiente', phone.cookieUserId === SIS.id && phone.localStorage.get('organizator:logoutPending') === '1');
  phone.online = true;
  page = await loadPage(phone);
  check('H5. al volver la red NO entra sola en su cuenta: termina de cerrar sesión y pide login', page.authVisible() && phone.cookieUserId === null && !phone.localStorage.has('organizator:logoutPending'));
  check('H6. el cambio que se descartó al cerrar sesión no llegó al servidor', !fakeDb.valueOf(SIS.id, 'tasks').some(t => t.id === 'pend1'));

  // =====================================================================
  section('I) Sesión caducada mientras se usa la app');
  // =====================================================================
  await page.login(SIS.email, SIS.password);
  check('I0. vuelve a entrar', !page.authVisible() && page.app.currentUser.id === SIS.id);
  phone.cookieUserId = null; // la cookie deja de valer (caducó)
  await page.addTask('exp1', 'Con la sesión caducada');
  await page.store().flush();
  await settle();
  check('I1. se vuelve a la pantalla de login con un aviso', page.authVisible() && /caducado/.test(page.elements('auth-error').textContent));
  check('I2. el cambio sigue guardado en su caché, pendiente de subir', page.store().hasPendingChanges() && phone.idb.databases.has('organizator-data-u1'));
  await page.login(SIS.email, SIS.password);
  check('I3. al volver a iniciar sesión se recarga la página (arranque limpio)', page.reloads === 1);
  page = await loadPage(phone);
  await page.store().flush();
  check('I4. y tras recargar, el cambio pendiente se sube', fakeDb.valueOf(SIS.id, 'tasks').some(t => t.id === 'exp1'));

  // =====================================================================
  section('J) Sin la capa de sincronización no se usa el almacén antiguo compartido');
  // =====================================================================
  const legacy = {
    async get(key) { return key === 'tasks' ? { key, value: JSON.stringify([{ id: 'legacy', title: 'Dato del almacén antiguo' }]), shared: false } : null; },
    async set() {},
  };
  const broken = makeDevice();
  broken.cookieUserId = BRO.id;
  const brokenPage = await loadPage(broken, { withSyncStorage: false, legacyStorage: legacy });
  check('J1. no se cargan datos del almacén antiguo (compartido entre cuentas)', brokenPage.app.state.tasks.length === 0);
  check('J2. se avisa al usuario y la app no sigue arrancando', brokenPage.toasts.some(t => /no se pudieron cargar/i.test(t)) && !brokenPage.calls.includes('initIA'));

  // =====================================================================
  section('K) Ajustes: estado, exportar, importar y borrar actúan sobre la cuenta actual (paso 8)');
  // =====================================================================
  {
    const idsOf = (list) => (list || []).map(t => t.id).sort().join(',');
    const tablet = makeDevice();
    tablet.cookieUserId = SIS.id;
    const tp = await loadPage(tablet);
    check('K1. tras sincronizar, Ajustes dice "Todo guardado en tu cuenta"', /Todo guardado en tu cuenta · última vez a las \d\d:\d\d/.test(tp.app.syncStatusText()));
    tablet.online = false;
    await tp.addTask('k-off', 'Hecha sin conexión');
    await tp.store().flush();
    check('K2. sin conexión, lo indica', /Sin conexión/.test(tp.app.syncStatusText()));
    tablet.online = true;
    const getsBefore = tablet.log.filter(l => l === 'GET /api/data').length;
    await tp.app.syncNow();
    check('K3. "Sincronizar ahora" descarga y sube lo pendiente', tablet.log.filter(l => l === 'GET /api/data').length === getsBefore + 1 && fakeDb.valueOf(SIS.id, 'tasks').some(t => t.id === 'k-off') && /Todo guardado/.test(tp.app.syncStatusText()));

    // Exportar
    const broDevice = makeDevice();
    broDevice.cookieUserId = BRO.id;
    const bp = await loadPage(broDevice);
    bp.app.exportData();
    const exported = JSON.parse(await bp.downloads[0].text());
    check('K4. exportar contiene SOLO los datos de la cuenta actual', idsOf(exported.data.tasks) === 'b1');

    // Importar (con conexión)
    const brotherBefore = JSON.stringify(fakeDb.valueOf(BRO.id, 'tasks'));
    const importFile = (data) => ({ target: { files: [{ text: async () => JSON.stringify({ app: 'ORGANIZATOR', data }) }] } });
    const confirmsBefore = tp.confirms.length;
    await tp.elements('import-file-input').fire('change', importFile({ tasks: [{ id: 'imp1', title: 'Importada' }], events: [], prefs: { defaultHome: 'calendario' } }));
    await settle();
    check('K5. la confirmación de importar avisa de que afecta a todos sus dispositivos', /todos tus dispositivos/.test(tp.confirms[confirmsBefore] || ''));
    check('K6. importar reemplaza los datos de SU cuenta en el servidor al momento', idsOf(fakeDb.valueOf(SIS.id, 'tasks')) === 'imp1' && fakeDb.valueOf(SIS.id, 'settingsPrefs').defaultHome === 'calendario');
    check('K7. y no toca la cuenta del hermano', JSON.stringify(fakeDb.valueOf(BRO.id, 'tasks')) === brotherBefore);
    check('K8. aviso normal (subido)', tp.toasts[tp.toasts.length - 1] === 'Datos importados correctamente');
    await pcPage.store().sync();
    await settle();
    check('K9. su otro dispositivo recibe lo importado', idsOf(pcPage.app.state.tasks) === 'imp1');

    // Importar sin conexión
    tablet.online = false;
    await tp.elements('import-file-input').fire('change', importFile({ tasks: [{ id: 'imp2', title: 'Importada sin red' }] }));
    await settle();
    check('K10. importar sin conexión avisa de que se subirá al volver la red', /al volver la conexión/.test(tp.toasts[tp.toasts.length - 1]));
    check('K11. ...y el servidor todavía no lo tiene', idsOf(fakeDb.valueOf(SIS.id, 'tasks')) === 'imp1');
    tablet.online = true;
    await tp.store().sync();
    check('K12. al volver la conexión se sube', idsOf(fakeDb.valueOf(SIS.id, 'tasks')) === 'imp2');

    // Borrar todos los datos
    const confirmsBeforeDelete = tp.confirms.length;
    await tp.app.deleteAllData();
    await settle();
    check('K13. la confirmación de borrar avisa de que es en TODOS sus dispositivos', /TODOS tus dispositivos/.test(tp.confirms[confirmsBeforeDelete] || ''));
    check('K14. borrar todo vacía SU cuenta en el servidor', idsOf(fakeDb.valueOf(SIS.id, 'tasks')) === '' && fakeDb.valueOf(SIS.id, 'settingsPrefs').defaultHome === 'inicio');
    check('K15. y no toca la cuenta del hermano', JSON.stringify(fakeDb.valueOf(BRO.id, 'tasks')) === brotherBefore);
    check('K16. aviso normal (subido)', tp.toasts[tp.toasts.length - 1] === 'Todos los datos se han borrado');
    await pcPage.store().sync();
    await settle();
    check('K17. su otro dispositivo también queda vacío', pcPage.app.state.tasks.length === 0);

    tablet.online = false;
    await tp.addTask('late', 'x');
    await tp.app.deleteAllData();
    await settle();
    check('K18. borrar sin conexión avisa de que se aplicará a la cuenta al volver la red', /al volver la conexión/.test(tp.toasts[tp.toasts.length - 1]));
    tablet.online = true;
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
