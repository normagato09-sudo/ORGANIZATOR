/**
 * ORGANIZATOR — Tests de SYNC paso 7 (migración de los datos de antes de las cuentas)
 *
 * Mismo arnés que test-sync-account-switch.js: cada "carga de página" es
 * un sandbox `vm` nuevo con el código REAL de organizator.html (bloques
 * ALMACENAMIENTO y AUTENTICACIÓN + INICIALIZACIÓN, que incluye la
 * migración) + js/sync-merge.js + js/sync-storage.js, contra el handler
 * real de api/data.js sobre un Postgres falso. El "dispositivo" (IndexedDB,
 * localStorage, cookie) persiste entre cargas.
 *
 * La base antigua 'organizator-storage' se rellena igual que la dejaba
 * storage-polyfill.js (almacén 'kv', claves 'user:<clave>', valores JSON
 * en texto). El aviso al usuario se "pulsa" leyendo los botones del HTML
 * que genera el propio código real.
 *
 * Uso:  node js/test-sync-legacy-migration.js
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
const SyncStorageNode = require('./sync-storage.js');

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
const authBlockSrc = extractBetween(html, `${HDR}AUTENTICACIÓN`, '\n</script>', 'bloque AUTENTICACIÓN + INICIALIZACIÓN');
const startAppSrc = extractBetween(html, 'async function startApp(){', '\n(async function init(){', 'startApp()');
const escSrc = extractBetween(html, 'function esc(s){', '\n}\n', 'esc()') + '\n}\n';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function settle() { for (let i = 0; i < 4; i++) { for (let k = 0; k < 60; k++) await new Promise(r => setImmediate(r)); await sleep(25); } }

// ---------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------
function makeFakeDb() {
  const rows = new Map();
  const id = (u, k) => `${u}|${k}`;
  const db = { failWrites: false };
  db.sql = async (strings, ...values) => {
    const text = strings.join('¶');
    if (text.includes('SELECT key, value, rev, updated_at FROM user_data')) return [...rows.values()].filter(r => r.user_id === values[0]).map(r => ({ key: r.key, value: structuredClone(r.value), rev: r.rev, updated_at: new Date() }));
    if ((text.includes('INSERT INTO user_data') || text.includes('UPDATE user_data SET value')) && db.failWrites) throw new Error('fallo simulado de la base de datos');
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
  };
  db.valueOf = (u, k) => { const r = rows.get(id(u, k)); return r ? structuredClone(r.value) : undefined; };
  db.seed = (u, k, value) => rows.set(id(u, k), { user_id: u, key: k, value: structuredClone(value), rev: '1' });
  return db;
}
const fakeDb = makeFakeDb();
require(path.join(ROOT, 'lib', 'db.js')).getSql = () => fakeDb.sql;
const dataHandler = require(path.join(ROOT, 'api', 'data.js'));
const session = require(path.join(ROOT, 'lib', 'session.js'));

let nextUserId = 10;
function makeUser(name) {
  const id = nextUserId++;
  return { id, email: `${name}${id}@example.com`, name, password: 'secreta' };
}

// ---------------------------------------------------------------------
// IndexedDB falso (con creación abortable, como el real)
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
  const idb = {
    databases,
    blockDeletes: false,
    open(name) {
      const req = makeRequest();
      later(() => {
        const isNew = !databases.has(name);
        if (isNew) {
          let aborted = false;
          databases.set(name, new Map());
          req.result = openDb(name);
          req.transaction = { abort() { aborted = true; } };
          if (req.onupgradeneeded) req.onupgradeneeded();
          if (aborted) { databases.delete(name); req.error = new Error('AbortError'); if (req.onerror) req.onerror(); return; }
        } else {
          req.result = openDb(name);
        }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    deleteDatabase(name) {
      const req = makeRequest();
      later(() => {
        if (idb.blockDeletes) { if (req.onblocked) req.onblocked(); return; }
        databases.delete(name);
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
  return idb;
}

/** Rellena la base antigua como la dejaba storage-polyfill.js. */
function seedLegacy(idb, values) {
  const kv = new Map();
  for (const [k, v] of Object.entries(values)) kv.set('user:' + k, typeof v === 'string' ? v : JSON.stringify(v));
  idb.databases.set('organizator-storage', new Map([['kv', kv]]));
}
const hasLegacy = (device) => device.idb.databases.has('organizator-storage');

// ---------------------------------------------------------------------
// Dispositivo y carga de página
// ---------------------------------------------------------------------
function makeDevice() {
  const device = { idb: makeFakeIndexedDB(), localStorage: new Map(), cookieUserId: null, online: true, log: [], users: new Map() };
  device.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    device.log.push(`${method} ${url}`);
    if (!device.online) throw new TypeError('Failed to fetch');
    const json = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(obj) });
    const me = () => device.users.get(device.cookieUserId);
    if (url === '/api/auth/me') return me() ? json(200, { user: { id: me().id, email: me().email, name: me().name } }) : json(401, { error: 'No has iniciado sesión.' });
    if (url === '/api/auth/logout') { device.cookieUserId = null; return json(200, { ok: true }); }
    if (url === '/api/push/unsubscribe') return json(200, { ok: true });
    if (url === '/api/data') {
      const req = { method, headers: device.cookieUserId ? { cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(session.signSession({ sub: device.cookieUserId }, process.env.JWT_SECRET))}` } : {}, body: init.body, query: {} };
      const res = { _s: 200, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; }, setHeader() {} };
      const origError = console.error; console.error = () => {};
      try { await dataHandler(req, res); } finally { console.error = origError; }
      return json(res._s, res._j);
    }
    return json(404, {});
  };
  device.signIn = (user) => { device.users.set(user.id, user); device.cookieUserId = user.id; };
  return device;
}

function makeElement(id) {
  const classes = new Set(id === 'auth-screen' ? ['hidden'] : []);
  const listeners = {};
  const el = {
    id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle() {} },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    fire: async (t, e) => { for (const f of [...(listeners[t] || [])]) await f(e || { preventDefault() {}, target: el }); },
  };
  return el;
}

async function loadPage(device) {
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
  const page = { reloads: 0, toasts: [], calls: [], downloads: [], dialogs: 0, elements: el };
  const modalBox = el('modal-box');
  let buttons = [];
  let buttonsFor = null;
  modalBox.querySelectorAll = (sel) => {
    if (sel !== '[data-choice]') return [];
    // Mismos elementos mientras no cambie el HTML (como en un DOM real).
    if (buttonsFor === modalBox.innerHTML) return buttons;
    buttonsFor = modalBox.innerHTML;
    buttons = [...modalBox.innerHTML.matchAll(/<button[^>]*data-choice="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map(m => {
      const b = makeElement('btn-' + m[1]);
      b.dataset.choice = m[1];
      b.label = m[2].trim();
      return b;
    });
    return buttons;
  };
  const sb = {
    console, structuredClone, TextEncoder, Blob,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 20)),
    clearTimeout,
    indexedDB: device.idb,
    fetch: device.fetch,
    localStorage: {
      getItem: (k) => (device.localStorage.has(k) ? device.localStorage.get(k) : null),
      setItem: (k, v) => device.localStorage.set(k, String(v)),
      removeItem: (k) => device.localStorage.delete(k),
    },
    location: { reload: () => { page.reloads++; } },
    confirm: () => true,
    navigator: {},
    URL: { createObjectURL: (blob) => { page.lastBlob = blob; return 'blob:backup'; }, revokeObjectURL() {} },
    addEventListener() {}, removeEventListener() {},
    document: {
      getElementById: el, visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
      body: { appendChild() {} },
      createElement: () => {
        const a = { href: '', download: '', remove() {} };
        a.click = () => {
          const blob = page.lastBlob;
          device.log.push(`DOWNLOAD ${a.download}`);
          page.downloads.push({ name: a.download, blob });
          if (page.onDownload) page.onDownload();
        };
        return a;
      },
    },
    __page: page,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(`
    let state = { tasks: [], events: [], customSchedules: [], eventCategories: [], reminders: [], reminderNotificationLedger: {}, prefs: {}, ia: {} };
    const APP_NAME = 'ORGANIZATOR';
    const APP_VERSION = 'test';
    const cal = {};
    const overlay = document.getElementById('modal-overlay');
    const modalBox = document.getElementById('modal-box');
    function closeModal(){ overlay.classList.remove('open'); modalBox.innerHTML = ''; }
    function todayStr(){ return '2026-09-27'; }
    function showToast(m){ __page.toasts.push(m); }
    function renderCurrentView(){}
    function initIA(){ __page.calls.push('initIA'); }
    function initSettingsDataIO(){}
    function initPWA(){}
    function startReminderPolling(){}
    function reconcilePushSubscriptionOnStartup(){}
    function showView(){}
  `, sb, { filename: 'stubs' });
  vm.runInContext(escSrc, sb, { filename: 'organizator.html (esc)' });
  vm.runInContext(defaultsSrc, sb, { filename: 'organizator.html (defaultPrefs/defaultIA)' });
  vm.runInContext(syncMergeSrc, sb, { filename: 'js/sync-merge.js' });
  vm.runInContext(syncStorageSrc, sb, { filename: 'js/sync-storage.js' });
  vm.runInContext(storageBlockSrc, sb, { filename: 'organizator.html (ALMACENAMIENTO)' });
  vm.runInContext(authBlockSrc + `
    this.__app = { get state(){ return state; }, saveTasks, logout };`, sb, { filename: 'organizator.html (AUTENTICACIÓN + INICIALIZACIÓN)' });
  await settle();
  page.sb = sb;
  page.app = sb.__app;
  page.dialogOpen = () => el('modal-overlay').classList.contains('open') && /Datos guardados en este dispositivo/.test(modalBox.innerHTML);
  page.dialogText = () => modalBox.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  page.choices = () => { modalBox.querySelectorAll('[data-choice]'); return buttons.map(b => b.dataset.choice); };
  page.labels = () => { modalBox.querySelectorAll('[data-choice]'); return buttons.map(b => b.label); };
  page.choose = async (choice) => {
    modalBox.querySelectorAll('[data-choice]');
    const b = buttons.find(x => x.dataset.choice === choice);
    if (!b) throw new Error('No hay botón ' + choice);
    b.fire('click');
    await settle();
  };
  page.clickOutside = async () => { el('modal-overlay').fire('click', { target: el('modal-overlay') }); await settle(); };
  page.store = () => sb.SyncStorage.current();
  page.appStarted = () => page.calls.includes('initIA');
  // Cerrar la página: su almacén deja de sincronizar en segundo plano.
  page.close = async () => { await sb.SyncStorage.deactivate(); await settle(); };
  return page;
}

const LEGACY = {
  tasks: [{ id: 't1', title: 'Examen de mates' }, { id: 't2', title: 'Comprar pan' }, { id: 't3', title: 'Llamar a mamá' }],
  events: [{ id: 'e1', title: 'Dentista', date: '2026-10-01' }],
  reminders: [{ id: 'r1', targetId: 't1', status: 'pending' }],
  customSchedules: [],
  eventCategories: [{ id: 'c1', name: 'Clases' }],
  settingsPrefs: { defaultHome: 'calendario', showCompletedTasks: false },
  settingsIA: { enabled: false },
  reminderNotificationLedger: { r0: 1727000000000 },
};
const ids = (list) => (list || []).map(x => x.id).sort();

(async () => {
  // =====================================================================
  section('A) Funciones de bajo nivel (js/sync-storage.js)');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    check('A1. sin base antigua -> null', (await SyncStorageNode.legacy.readLegacyData(idb)) === null);
    check('A2. comprobarlo NO crea una base antigua vacía', !idb.databases.has('organizator-storage'));
    seedLegacy(idb, { ...LEGACY, events: '{roto', foo: [1], tasks: LEGACY.tasks });
    const data = await SyncStorageNode.legacy.readLegacyData(idb);
    check('A3. lee las claves sincronizadas y el registro local', !!data && ids(data.values.tasks).join() === 't1,t2,t3' && !!data.values.reminderNotificationLedger);
    check('A4. ignora valores corruptos y claves desconocidas', !('events' in data.values) && !('foo' in data.values));
    const s = SyncStorageNode.legacy.summarizeData(LEGACY);
    check('A5. recuento y ejemplos para el aviso', s.total === 6 && s.counts.tasks === 3 && s.sampleTitles.join('|') === 'Examen de mates|Comprar pan|Llamar a mamá');
    const account = { tasks: [{ id: 't1', title: 'Examen de mates (editado en la cuenta)' }, { id: 'a1', title: 'De la cuenta' }], settingsPrefs: { defaultHome: 'inicio' } };
    const combined = SyncStorageNode.legacy.buildMigratedValues(LEGACY, account, 'combine');
    check('A6. combinar: unión por id, sin duplicados', ids(combined.tasks).join() === 'a1,t1,t2,t3');
    check('A7. combinar: a igualdad de id se queda la versión de la cuenta', combined.tasks.find(t => t.id === 't1').title === 'Examen de mates (editado en la cuenta)');
    check('A8. combinar: en ajustes manda la cuenta; los antiguos solo rellenan', combined.settingsPrefs.defaultHome === 'inicio' && combined.settingsPrefs.showCompletedTasks === false);
    const uploaded = SyncStorageNode.legacy.buildMigratedValues(LEGACY, { settingsPrefs: { defaultHome: 'inicio' } }, 'upload');
    check('A9. subir (cuenta vacía): en ajustes mandan los antiguos', uploaded.settingsPrefs.defaultHome === 'calendario');
    check('A10. nunca incluye el registro local de avisos (no se sube)', !('reminderNotificationLedger' in combined));
    const del = await SyncStorageNode.legacy.deleteLegacyData(idb);
    check('A11. borrar la base antigua', del.deleted === true && !idb.databases.has('organizator-storage'));
  }

  // =====================================================================
  section('B) Cuenta vacía + "Subir a mi cuenta"');
  // =====================================================================
  {
    const phone = makeDevice();
    const sis = makeUser('hermana');
    seedLegacy(phone.idb, LEGACY);
    phone.signIn(sis);
    const page = await loadPage(phone);
    check('B1. al entrar aparece el aviso', page.dialogOpen());
    const text = page.dialogText();
    check('B2. dice qué hay: "3 tareas, 1 evento, 1 recordatorio y 1 categoría de eventos"', text.includes('3 tareas, 1 evento, 1 recordatorio y 1 categoría de eventos'));
    check('B3. muestra ejemplos para reconocerlos', text.includes('«Examen de mates»'));
    check('B4. dice que la cuenta está vacía y avisa de la copia de seguridad', text.includes('todavía está vacía') && /copia de seguridad/.test(text));
    check('B5. botones: Subir a mi cuenta / No son míos / Ahora no', page.labels().join(' | ') === 'Subir a mi cuenta | No son míos | Ahora no');
    check('B6. mientras decide, la app espera (no carga datos todavía)', !page.appStarted());

    await page.choose('upload');
    const firstPut = phone.log.findIndex(l => l === 'PUT /api/data');
    const download = phone.log.findIndex(l => l.startsWith('DOWNLOAD'));
    check('B7. se descarga la copia de seguridad ANTES de subir nada', download !== -1 && firstPut !== -1 && download < firstPut);
    check('B8. la copia se llama organizator-backup-datos-antiguos-<fecha>.json', page.downloads[0].name === 'organizator-backup-datos-antiguos-2026-09-27.json');
    const backup = JSON.parse(await page.downloads[0].blob.text());
    check('B9. la copia tiene el formato de "Exportar" (se puede reimportar)', backup.app === 'ORGANIZATOR' && ids(backup.data.tasks).join() === 't1,t2,t3' && backup.data.prefs.defaultHome === 'calendario');
    check('B10. los datos llegan a SU cuenta', ids(fakeDb.valueOf(sis.id, 'tasks')).join() === 't1,t2,t3' && ids(fakeDb.valueOf(sis.id, 'events')).join() === 'e1' && fakeDb.valueOf(sis.id, 'settingsPrefs').defaultHome === 'calendario');
    check('B11. el registro local de avisos NO se sube, pero pasa a su caché', fakeDb.valueOf(sis.id, 'reminderNotificationLedger') === undefined);
    check('B12. con la subida confirmada se borra la base antigua', !hasLegacy(phone));
    check('B13. y la marca de migración queda limpia', !phone.localStorage.has('organizator:legacyMigration'));
    check('B14. la app arranca mostrando esos datos', page.appStarted() && ids(page.app.state.tasks).join() === 't1,t2,t3');
    check('B15. avisa de que ya está hecho', page.toasts.some(t => /ya están en tu cuenta/.test(t)));
    const reloaded = await loadPage(phone);
    check('B16. al volver a abrir no vuelve a preguntar', !reloaded.dialogOpen() && reloaded.appStarted());
  }

  // =====================================================================
  section('C) La base antigua NO se borra si el servidor no confirma');
  // =====================================================================
  {
    const phone = makeDevice();
    const sis = makeUser('hermana');
    seedLegacy(phone.idb, LEGACY);
    phone.signIn(sis);
    let page = await loadPage(phone);
    page.onDownload = () => { phone.online = false; }; // se va la conexión justo al elegir
    await page.choose('upload');
    check('C1. sin conexión: la base antigua se conserva', hasLegacy(phone));
    check('C2. los datos quedan en su caché, pendientes de subir', page.store().hasPendingChanges() && ids(page.app.state.tasks).join() === 't1,t2,t3');
    check('C3. quedan reservados para su cuenta', JSON.parse(phone.localStorage.get('organizator:legacyMigration')).claimedBy === String(sis.id));
    check('C4. se le avisa de que se subirán al volver la conexión', page.toasts.some(t => /en cuanto haya conexión/.test(t)));

    phone.online = true;
    page = await loadPage(phone);
    check('C5. al reabrir con conexión NO vuelve a preguntar...', !page.dialogOpen());
    check('C6. ...sube lo pendiente y, confirmado, borra la base antigua', ids(fakeDb.valueOf(sis.id, 'tasks')).join() === 't1,t2,t3' && !hasLegacy(phone) && !phone.localStorage.has('organizator:legacyMigration'));

    // El servidor falla (500) al subir: tampoco se borra.
    const phone2 = makeDevice();
    const user2 = makeUser('otra');
    seedLegacy(phone2.idb, LEGACY);
    phone2.signIn(user2);
    const p2 = await loadPage(phone2);
    fakeDb.failWrites = true;
    await p2.choose('upload');
    fakeDb.failWrites = false;
    check('C7. error del servidor al subir: la base antigua se conserva', hasLegacy(phone2) && fakeDb.valueOf(user2.id, 'tasks') === undefined);

    // Borrado bloqueado por otra pestaña: se reintenta en la siguiente apertura.
    const phone3 = makeDevice();
    const user3 = makeUser('tercera');
    seedLegacy(phone3.idb, LEGACY);
    phone3.signIn(user3);
    phone3.idb.blockDeletes = true;
    const p3 = await loadPage(phone3);
    await p3.choose('upload');
    check('C8. subida hecha pero borrado bloqueado: la base se conserva y sigue reservada', hasLegacy(phone3) && JSON.parse(phone3.localStorage.get('organizator:legacyMigration')).claimedBy === String(user3.id));
    phone3.idb.blockDeletes = false;
    const p3b = await loadPage(phone3);
    check('C9. en la siguiente apertura se borra sin volver a preguntar', !p3b.dialogOpen() && !hasLegacy(phone3));
  }

  // =====================================================================
  section('D) La cuenta ya tiene datos');
  // =====================================================================
  {
    const phone = makeDevice();
    const sis = makeUser('hermana');
    fakeDb.seed(sis.id, 'tasks', [{ id: 't1', title: 'Examen de mates (versión de la cuenta)' }, { id: 'pc1', title: 'Creada en el PC' }]);
    fakeDb.seed(sis.id, 'settingsPrefs', { defaultHome: 'inicio' });
    seedLegacy(phone.idb, LEGACY);
    phone.signIn(sis);
    let page = await loadPage(phone);
    const text = page.dialogText();
    check('D1. el aviso dice que la cuenta ya tiene datos', text.includes('ya tiene datos: 2 tareas'));
    check('D2. botones: Combinar / Usar solo los de mi cuenta / No son míos / Ahora no', page.labels().join(' | ') === 'Combinar con mi cuenta | Usar solo los de mi cuenta | No son míos | Ahora no');
    await page.choose('combine');
    const tasks = fakeDb.valueOf(sis.id, 'tasks');
    check('D3. combinar: están todas, sin duplicados', ids(tasks).join() === 'pc1,t1,t2,t3');
    check('D4. el elemento repetido conserva la versión de la cuenta', tasks.find(t => t.id === 't1').title === 'Examen de mates (versión de la cuenta)');
    check('D5. ajustes: manda la cuenta', fakeDb.valueOf(sis.id, 'settingsPrefs').defaultHome === 'inicio');
    check('D6. copia descargada y base antigua borrada tras confirmar', page.downloads.length === 1 && !hasLegacy(phone));

    const phone2 = makeDevice();
    const bro = makeUser('hermana2');
    fakeDb.seed(bro.id, 'tasks', [{ id: 'x1', title: 'Solo de la cuenta' }]);
    seedLegacy(phone2.idb, LEGACY);
    phone2.signIn(bro);
    page = await loadPage(phone2);
    await page.choose('discard');
    check('D7. "Usar solo los de mi cuenta": se descarga la copia...', page.downloads.length === 1);
    check('D8. ...la cuenta no cambia...', ids(fakeDb.valueOf(bro.id, 'tasks')).join() === 'x1' && fakeDb.valueOf(bro.id, 'events') === undefined);
    check('D9. ...y se quita la base antigua de este dispositivo', !hasLegacy(phone2));
  }

  // =====================================================================
  section('E) "No son míos" y "Ahora no" en un móvil compartido');
  // =====================================================================
  {
    const phone = makeDevice();
    const bro = makeUser('hermano');
    const sis = makeUser('hermana');
    seedLegacy(phone.idb, LEGACY);

    phone.signIn(bro);
    let page = await loadPage(phone);
    await page.choose('later');
    check('E1. "Ahora no": no se sube ni se borra nada, y no se descarga copia', hasLegacy(phone) && fakeDb.valueOf(bro.id, 'tasks') === undefined && page.downloads.length === 0);
    check('E2. la app arranca con la cuenta vacía', page.appStarted() && page.app.state.tasks.length === 0);
    page = await loadPage(phone);
    check('E3. la próxima vez vuelve a preguntar', page.dialogOpen());
    await page.clickOutside();
    check('E4. cerrar el aviso pulsando fuera = "Ahora no"', hasLegacy(phone) && page.appStarted() && fakeDb.valueOf(bro.id, 'tasks') === undefined);
    page = await loadPage(phone);
    await page.choose('notMine');
    check('E5. "No son míos": NO se borra nada (son de otra persona)', hasLegacy(phone) && fakeDb.valueOf(bro.id, 'tasks') === undefined && page.downloads.length === 0);
    page = await loadPage(phone);
    check('E6. a él ya no se le vuelve a preguntar', !page.dialogOpen() && page.appStarted());
    await page.app.logout();
    await settle();

    phone.signIn(sis);
    page = await loadPage(phone);
    check('E7. a la hermana SÍ se le pregunta', page.dialogOpen());
    await page.choose('upload');
    check('E8. los sube a SU cuenta; la del hermano sigue vacía', ids(fakeDb.valueOf(sis.id, 'tasks')).join() === 't1,t2,t3' && fakeDb.valueOf(bro.id, 'tasks') === undefined);
    check('E9. la base antigua ya no está', !hasLegacy(phone));
  }

  // =====================================================================
  section('F) Reservados por una cuenta: no se ofrecen a otra');
  // =====================================================================
  {
    const phone = makeDevice();
    const sis = makeUser('hermana');
    const bro = makeUser('hermano');
    seedLegacy(phone.idb, LEGACY);
    phone.signIn(sis);
    let page = await loadPage(phone);
    page.onDownload = () => { phone.online = false; };
    await page.choose('upload');
    check('F1. (subida pendiente, sin conexión)', hasLegacy(phone) && page.store().hasPendingChanges());
    await page.close();

    // Otra cuenta entra (con conexión) antes de que ella termine.
    phone.online = true;
    phone.cookieUserId = null;
    phone.signIn(bro);
    page = await loadPage(phone);
    check('F2. al hermano no se le ofrecen los datos que ella ya reservó', !page.dialogOpen() && page.appStarted());
    check('F3. y no se borran', hasLegacy(phone));
    await page.close();

    // Ella cierra sesión sin conexión aceptando perder lo pendiente.
    phone.cookieUserId = null;
    phone.signIn(sis);
    phone.localStorage.set('organizator:lastUser', JSON.stringify({ id: sis.id, email: sis.email, name: sis.name }));
    phone.online = false;
    page = await loadPage(phone);
    check('F3b. (ella abre sin conexión, con su subida aún pendiente)', page.store().userId === sis.id && page.store().hasPendingChanges());
    await page.app.logout();
    await settle();
    const marker = phone.localStorage.get('organizator:legacyMigration');
    check('F4. si al cerrar sesión se pierde la subida pendiente, la reserva se libera', !marker || !JSON.parse(marker).claimedBy);
    check('F5. y los datos antiguos siguen en el dispositivo (nunca se borran sin subirse)', hasLegacy(phone));
    phone.online = true;
    phone.localStorage.delete('organizator:logoutPending');
    phone.signIn(sis);
    page = await loadPage(phone);
    check('F6. al volver a entrar se le vuelven a ofrecer', page.dialogOpen());
  }

  // =====================================================================
  section('G) Cuándo NO se pregunta');
  // =====================================================================
  {
    const noLegacy = makeDevice();
    noLegacy.signIn(makeUser('sin'));
    const p1 = await loadPage(noLegacy);
    check('G1. sin base antigua: no hay aviso y no se crea ninguna base antigua', !p1.dialogOpen() && p1.appStarted() && !hasLegacy(noLegacy));

    const onlySettings = makeDevice();
    seedLegacy(onlySettings.idb, { tasks: [], events: [], settingsPrefs: { defaultHome: 'calendario' } });
    onlySettings.signIn(makeUser('ajustes'));
    const p2 = await loadPage(onlySettings);
    check('G2. base antigua sin tareas/eventos (solo ajustes o listas vacías): no se pregunta', !p2.dialogOpen() && p2.appStarted());

    const offline = makeDevice();
    const u = makeUser('offline');
    seedLegacy(offline.idb, LEGACY);
    offline.signIn(u);
    await loadPage(offline);           // primera vez con red: aparece el aviso...
    offline.localStorage.set('organizator:lastUser', JSON.stringify({ id: u.id, email: u.email }));
    offline.online = false;
    const p3 = await loadPage(offline);
    check('G3. sin conexión no se pregunta (no se sabe qué tiene la cuenta)', !p3.dialogOpen() && p3.appStarted() && hasLegacy(offline));
  }

  // =====================================================================
  section('H) Orden en startApp');
  // =====================================================================
  {
    const a = startAppSrc.indexOf('activateAccountStorage()');
    const m = startAppSrc.indexOf('maybeMigrateLegacyData()');
    const l = startAppSrc.indexOf('loadState()');
    check('H1. primero el almacén de la cuenta, luego la migración, luego loadState', a !== -1 && m > a && l > m);
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
