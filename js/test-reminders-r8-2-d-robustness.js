/**
 * ORGANIZATOR — Tests de R-8.2-D (robustez del sistema de notificaciones
 * Web Push)
 *
 * Suite Node pura, SIN navegador ni jsdom, SIN red real: extrae el
 * código REAL de organizator.html (fecha + recurrencia + CRUD +
 * RECORDATORIOS Fases 1-5/R-7/Web Push R-8.2-B/reconciliación
 * R-8.2-C/robustez R-8.2-D + deleteAllData) y de sw.js/js/sw-push-ledger.js
 * COMPLETOS, y los ejecuta en sandboxes de `vm` separados — página(s) y
 * Service Worker(s) son realms distintos que en un navegador real solo
 * comparten el IndexedDB del propio origen (nunca `window`/`state`
 * directamente): esta suite simula EXACTAMENTE eso con un IndexedDB falso
 * en memoria, compartido por referencia entre los sandboxes que
 * corresponda en cada escenario (igual que "misma app, mismo origen" en
 * un navegador real), y con sandboxes de Service Worker FRESCOS cuando un
 * test simula que se reinició.
 *
 * ALCANCE: cubre el límite real que dejó documentado R-8.2-C — un push
 * que llega con ORGANIZATOR completamente cerrado y que el usuario
 * reabre más tarde — y el resto de robustez pedida (duplicados,
 * reintentos de QStash, Service Worker reiniciado, varias pestañas,
 * carreras, suscripciones inválidas, cancelaciones, import/borrado de
 * datos, limpieza del ledger). NO reimplementa la cobertura ya existente
 * de R-8.1/R-8.2-A (js/test-push-infrastructure.js) ni de R-8.2-B/C (sus
 * propias suites): donde ya hay cobertura profunda de algo que R-8.2-D
 * NO toca, aquí solo se hace una comprobación de regresión ligera
 * (estructural) y se indica dónde vive la cobertura completa.
 *
 * Uso:  node js/test-reminders-r8-2-d-robustness.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
const SW_PATH = path.join(ROOT, 'sw.js');
const LEDGER_PATH = path.join(ROOT, 'js', 'sw-push-ledger.js');
const SEND_DUE_PATH = path.join(ROOT, 'api', 'push', 'send-due.js');
const CANCEL_REMINDER_PATH = path.join(ROOT, 'api', 'push', 'cancel-reminder.js');

// organizator.html se guarda con CRLF en este checkout; se normaliza a
// LF SOLO para esta lectura en memoria (no se toca el archivo en disco).
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const swSrc = fs.readFileSync(SW_PATH, 'utf8').replace(/\r\n/g, '\n');
const pushLedgerSrc = fs.readFileSync(LEDGER_PATH, 'utf8').replace(/\r\n/g, '\n');
const sendDueSrc = fs.readFileSync(SEND_DUE_PATH, 'utf8');
const cancelReminderSrc = fs.readFileSync(CANCEL_REMINDER_PATH, 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Mismos fragmentos reales que test-reminders-r8-2-c-reconciliation.js,
// más deleteAllData() (nuevo para esta suite, ver punto 20/21).
// ---------------------------------------------------------------------
const dateUtilsSrc = extractBetween(
  html,
  '/* ==================================================================\n   UTILIDADES DE FECHA',
  '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS',
  'bloque UTILIDADES DE FECHA'
);
const weekHelpersSrc = extractBetween(html, 'function dowOfDate(dateStr){', '\nfunction weekGoForward(){', 'helpers dowOfDate/getWeekMonday');
const recurrenceSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1/R-2/R-3/R-4)'
);
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS',
  'bloque CRUD'
);
const remindersSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fases 1-5 + R-7 + Web Push R-8.2-B + reconciliación R-8.2-C + robustez R-8.2-D)'
);
const deleteAllDataSrc = extractBetween(
  html,
  'async function deleteAllData(){',
  '\n\n/* ==================================================================\n   IA — ASISTENTE PERSONAL',
  'función deleteAllData()'
);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// =======================================================================
// IndexedDB falso en memoria: suficiente para exactamente las
// operaciones que usa js/sw-push-ledger.js (get/add/clear/openCursor +
// oncomplete/onerror de la transacción) — NO es un motor IndexedDB
// genérico. Simula async real vía microtasks (Promise.resolve().then),
// y modela el ConstraintError de IDBObjectStore.add() cuando la clave ya
// existe (la base del "quien llega primero, gana" atómico del ledger).
// Un mismo objeto de este tipo, compartido por referencia entre varios
// sandboxes (página(s) + Service Worker(s)), simula el MISMO IndexedDB
// de origen que comparten página y Service Worker en un navegador real.
// =======================================================================
function makeFakeIndexedDB() {
  const databases = new Map(); // name -> { stores: Map(storeName -> Map(key,val)) }

  function makeDBHandle(record) {
    return {
      objectStoreNames: { contains: (storeName) => record.stores.has(storeName) },
      createObjectStore(storeName) {
        record.stores.set(storeName, new Map());
        return {};
      },
      transaction(storeNames) {
        const map0 = record.stores.get(Array.isArray(storeNames) ? storeNames[0] : storeNames);
        let pending = 0;
        let completed = false;
        const tx = { oncomplete: null, onerror: null };
        function maybeComplete() {
          if (pending === 0 && !completed) {
            completed = true;
            if (tx.oncomplete) tx.oncomplete({ target: tx });
          }
        }
        tx.objectStore = () => ({
          get(key) {
            const req = { onsuccess: null, onerror: null, result: undefined };
            pending++;
            Promise.resolve().then(() => {
              req.result = map0.has(key) ? map0.get(key) : undefined;
              pending--;
              if (req.onsuccess) req.onsuccess({ target: req });
              maybeComplete();
            });
            return req;
          },
          add(value, key) {
            const req = { onsuccess: null, onerror: null, result: undefined, error: null };
            pending++;
            Promise.resolve().then(() => {
              if (map0.has(key)) {
                const err = new Error('Key already exists in the object store.');
                err.name = 'ConstraintError';
                req.error = err;
                const ev = { target: req, preventDefault() {} };
                if (req.onerror) req.onerror(ev);
                pending--;
                maybeComplete();
                return;
              }
              map0.set(key, value);
              req.result = key;
              pending--;
              if (req.onsuccess) req.onsuccess({ target: req });
              maybeComplete();
            });
            return req;
          },
          clear() {
            const req = { onsuccess: null, onerror: null, result: undefined };
            pending++;
            Promise.resolve().then(() => {
              map0.clear();
              pending--;
              if (req.onsuccess) req.onsuccess({ target: req });
              maybeComplete();
            });
            return req;
          },
          openCursor() {
            const req = { onsuccess: null, onerror: null, result: undefined };
            pending++;
            const keys = Array.from(map0.keys());
            let idx = 0;
            function step() {
              while (idx < keys.length && !map0.has(keys[idx])) idx++; // saltar claves ya borradas en esta misma pasada
              if (idx >= keys.length) {
                req.result = null;
                pending--;
                if (req.onsuccess) req.onsuccess({ target: req });
                maybeComplete();
                return;
              }
              const key = keys[idx];
              const cursor = {
                value: map0.get(key),
                key,
                delete() { map0.delete(key); },
                continue() { idx++; Promise.resolve().then(step); },
              };
              req.result = cursor;
              if (req.onsuccess) req.onsuccess({ target: req });
            }
            Promise.resolve().then(step);
            return req;
          },
        });
        return tx;
      },
    };
  }

  return {
    open(name) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
      Promise.resolve().then(() => {
        let record = databases.get(name);
        const isNew = !record;
        if (!record) { record = { stores: new Map() }; databases.set(name, record); }
        const handle = makeDBHandle(record);
        req.result = handle;
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    _dump(name, storeName) {
      const record = databases.get(name);
      if (!record) return {};
      const store = record.stores.get(storeName);
      if (!store) return {};
      return Object.fromEntries(store.entries());
    },
    /** Escritura DIRECTA (sin pasar por markDelivered(), que sanea
     * `when` y nunca persistiría un valor no numérico) — solo para
     * sembrar deliberadamente una marca corrupta y ejercitar así la
     * limpieza defensiva de pruneDelivered() (ver punto 13 del encargo:
     * "no debe crecer indefinidamente"/limpieza determinista). */
    _setRaw(name, storeName, key, value) {
      let record = databases.get(name);
      if (!record) { record = { stores: new Map() }; databases.set(name, record); }
      if (!record.stores.has(storeName)) record.stores.set(storeName, new Map());
      record.stores.get(storeName).set(key, value);
    },
  };
}

/** Mock de Notification: registra cada notificación LOCAL creada (nunca
 * las del Service Worker, que van por self.registration.showNotification
 * — ver makeSWSandbox). */
function makeNotificationMock({ permission = 'granted' } = {}) {
  const created = [];
  class MockNotification {
    constructor(title, options) { this.title = title; this.options = options || {}; created.push(this); }
    close() {}
    static requestPermission() { return Promise.resolve(MockNotification.permission); }
  }
  MockNotification.permission = permission;
  MockNotification.created = created;
  return MockNotification;
}

function makeFetchMock(behavior = {}) {
  const calls = [];
  async function fetchMock(url, opts = {}) {
    const method = opts.method || 'GET';
    const body = (opts.body !== undefined) ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method, body });
    if (behavior[url] === 'network-fail') throw new TypeError('Failed to fetch (offline simulado)');
    if (behavior[url] === 'http-error') return { ok: false, status: 500, json: async () => ({ error: 'mock 500' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, pushReminderId: 1 }) };
  }
  fetchMock.calls = calls;
  return fetchMock;
}

function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    async get(key) { return map.has(key) ? { key, value: map.get(key), shared: false } : null; },
    async set(key, value) { map.set(key, value); return { key, value, shared: false }; },
  };
}

/** Sandbox de PÁGINA: código real de organizator.html (RECORDATORIOS +
 * deleteAllData) sobre mocks en memoria. `indexedDBInstance`, si se
 * pasa, es el MISMO objeto (por referencia) que puede estar usando un
 * sandbox de Service Worker — así ambos "ven" el mismo ledger
 * persistente, igual que en un navegador real (mismo origen). Si no se
 * pasa ninguno, `self.indexedDB` queda sin definir — exactamente el
 * mismo caso "sin Service Worker/sin soporte" que ya cubren las suites
 * de R-8.2-C. */
function makePageSandbox({ notificationOpts = { permission: 'granted' }, fetchBehavior = {}, indexedDBInstance } = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox; // en un navegador real, `self` dentro de una página es un alias de `window` — necesario para que window.SWPushLedger === self.SWPushLedger
  sandbox.console = console;
  sandbox.confirm = () => true;
  sandbox.fetch = makeFetchMock(fetchBehavior);
  if (indexedDBInstance) sandbox.indexedDB = indexedDBInstance;
  if (notificationOpts !== null) sandbox.Notification = makeNotificationMock(notificationOpts);
  vm.createContext(sandbox);
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2/R-3/R-4)' });
  // js/sw-push-ledger.js real: se carga ANTES del resto, igual que en
  // organizator.html real (<script src="/js/sw-push-ledger.js"> antes
  // del <script> principal) — define self.SWPushLedger (=== window.SWPushLedger).
  vm.runInContext(pushLedgerSrc, sandbox, { filename: 'js/sw-push-ledger.js (real, compartido con sw.js)' });
  vm.runInContext(
    `let state = { tasks: [], events: [], customSchedules: [], eventCategories: [], reminders: [], reminderNotificationLedger: {}, prefs: {}, ia: {} };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     function defaultPrefs(){ return { defaultHome: 'inicio' }; }
     function defaultIA(){ return { enabled: true }; }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function saveCustomSchedules(){ await window.storage.set('customSchedules', JSON.stringify(state.customSchedules), false); }
     async function saveEventCategories(){ await window.storage.set('eventCategories', JSON.stringify(state.eventCategories), false); }
     async function saveReminders(){ await window.storage.set('reminders', JSON.stringify(state.reminders), false); }
     async function savePrefs(){ await window.storage.set('settingsPrefs', JSON.stringify(state.prefs), false); }
     async function saveIA(){ await window.storage.set('settingsIA', JSON.stringify(state.ia), false); }
     function renderCurrentView(){ /* no-op: fuera de alcance de R-8.2-D (render de UI) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-8.2-D */ }
     function showToast(){ /* no-op */ }
     function showView(){ /* no-op */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(remindersSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fases 1-5 + R-7 + Web Push + reconciliación + robustez R-8.2-D)' });
  vm.runInContext(deleteAllDataSrc, sandbox, { filename: 'organizator.html (deleteAllData)' });
  vm.runInContext(
    `this.getTaskOccurrenceId = getTaskOccurrenceId;
     this.addTask = addTask; this.addEvent = addEvent;
     this.addReminder = addReminder; this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget;
     this.updateReminder = updateReminder; this.cancelReminder = cancelReminder;
     this.createReminderForTarget = createReminderForTarget;
     this.syncReminderForTarget = syncReminderForTarget;
     this.syncReminderForTaskOccurrence = syncReminderForTaskOccurrence;
     this.getDueReminders = getDueReminders; this.triggerDueReminders = triggerDueReminders;
     this.reminderPollingTick = reminderPollingTick;
     this.showReminderNotification = showReminderNotification;
     this.reminderAlreadyNotified = reminderAlreadyNotified;
     this.markReminderNotified = markReminderNotified;
     this.pruneReminderNotificationLedger = pruneReminderNotificationLedger;
     this.handleServiceWorkerMessage = handleServiceWorkerMessage;
     this.deleteAllData = deleteAllData;
     this.state = state;`,
    sandbox, { filename: 'expose-r8-2-d' }
  );
  return { sandbox, fetchMock: sandbox.fetch, Notification: sandbox.Notification };
}

/** Sandbox del SERVICE WORKER: sw.js REAL y COMPLETO (incluida su propia
 * llamada real a importScripts('/js/sw-push-ledger.js'), simulada aquí
 * cargando el MISMO archivo real en este mismo contexto — igual patrón
 * que ya adoptaron test-reminders-r8-closed-app.js y
 * test-reminders-r8-2-c-reconciliation.js tras R-8.2-D). `indexedDBInstance`
 * funciona igual que en makePageSandbox: compartirlo entre varios
 * sandboxes simula "mismo origen". Crear un sandbox NUEVO reutilizando
 * el MISMO `indexedDBInstance` simula que el Service Worker se reinició
 * (pierde todo su estado en memoria — aquí no hay ninguno relevante,
 * ver doc de sw.js — pero el ledger persistente en IndexedDB sobrevive). */
function makeSWSandbox({ matchAllResult = [], indexedDBInstance } = {}) {
  const listeners = {};
  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.console = console;
  if (indexedDBInstance) sandbox.indexedDB = indexedDBInstance;
  sandbox.addEventListener = (type, fn) => { listeners[type] = listeners[type] || []; listeners[type].push(fn); };
  sandbox.caches = {
    open: async () => ({ addAll: async () => {}, put: async () => {}, match: async () => undefined }),
    keys: async () => [], match: async () => undefined, delete: async () => true,
  };
  const shown = [];
  sandbox.registration = { showNotification: (title, options) => { shown.push({ title, options }); return Promise.resolve(); } };
  const clientsCalls = { openWindow: [] };
  sandbox.clients = {
    matchAll: async () => matchAllResult,
    openWindow: async (url) => { clientsCalls.openWindow.push(url); return {}; },
  };
  sandbox.importScripts = (url) => {
    vm.runInContext(pushLedgerSrc, sandbox, { filename: String(url) });
  };
  vm.createContext(sandbox);
  vm.runInContext(swSrc, sandbox, { filename: 'sw.js (real, completo)' });
  return { sandbox, listeners, shown, clientsCalls };
}

/** Quita comentarios de bloque y de línea de una fuente JS, para las
 * comprobaciones estructurales del punto 27: sw.js y js/sw-push-ledger.js
 * MENCIONAN deliberadamente "state.reminders"/"window.storage" en su
 * propia documentación (para explicar justo que NUNCA los tocan) — sin
 * esto, buscar esas cadenas literales daría un falso negativo. Suficiente
 * para el estilo de comentarios de este repo (// y /* *\/), no un parser
 * JS completo. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function fireEvent(handlers, event) {
  const waited = [];
  event.waitUntil = (p) => waited.push(Promise.resolve(p));
  handlers.forEach(h => h(event));
  return Promise.all(waited);
}

function makePushEvent(payloadObj) {
  return { data: { json: () => payloadObj } };
}

(async () => {
  const NOW = new Date('2026-09-20T20:00:00.000Z');
  const NOW_MS = NOW.getTime();

  // =====================================================================
  section('1/4) Push nuevo con la app COMPLETAMENTE cerrada: una notificación, registrada de forma persistente');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb }); // sin ninguna pestaña abierta
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Tarea: Entregar informe', url: '/', tag: 'push-reminder-1', reminderId: 'closed-1' }));
    check('1a. el Service Worker muestra exactamente una notificación', sw.shown.length === 1);
    check('1b. no intenta abrir/enfocar nada (no había pestañas)', sw.clientsCalls.openWindow.length === 0);

    // 4) La marca queda registrada de forma PERSISTENTE (IndexedDB), no
    // solo "en memoria" de este sandbox del Service Worker.
    const persisted = idb._dump('organizator-push-ledger', 'delivered');
    check('4a. el reminderId queda persistido en el ledger del Service Worker (IndexedDB real)', Object.prototype.hasOwnProperty.call(persisted, 'closed-1'));
    check('4b. la marca persistida es un timestamp numérico', typeof persisted['closed-1'] === 'number');

    // Una página (nueva, distinta sandbox) que comparta el MISMO
    // IndexedDB de origen puede consultarlo (solo lectura) sin que haga
    // falta ninguna pestaña haya estado abierta cuando llegó el push.
    const { sandbox: page } = makePageSandbox({ indexedDBInstance: idb });
    const hasDelivered = await page.SWPushLedger.hasDelivered('closed-1');
    check('4c. la página puede consultar (hasDelivered) la marca dejada por el Service Worker sin haber estado abierta', hasDelivered === true);
  }

  // =====================================================================
  section('2/11) Push duplicado (reintento de QStash) en la MISMA instancia del Service Worker: una sola notificación');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    const payload = { title: 'ORGANIZATOR', body: 'Evento: Reunión', url: '/', tag: 'push-reminder-2', reminderId: 'dup-1' };
    await fireEvent(sw.listeners.push, makePushEvent(payload));
    await fireEvent(sw.listeners.push, makePushEvent(payload)); // QStash reintenta el MISMO mensaje
    await fireEvent(sw.listeners.push, makePushEvent(payload)); // y una tercera vez, por si acaso
    check('2/11a. tres entregas del mismo push (reintentos de QStash) -> UNA sola notificación nativa', sw.shown.length === 1);
    check('2/11b. el ledger persistido tiene una única marca para ese reminderId', Object.keys(idb._dump('organizator-push-ledger', 'delivered')).length === 1);
  }

  // =====================================================================
  section('3/11) Service Worker REINICIADO entre dos entregas del mismo push: no duplica');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const payload = { title: 'ORGANIZATOR', body: 'Tarea: Pagar factura', url: '/', tag: 'push-reminder-3', reminderId: 'restart-1' };

    const sw1 = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw1.listeners.push, makePushEvent(payload));
    check('3a. primera entrega (antes de reiniciar) muestra una notificación', sw1.shown.length === 1);

    // "Reinicio" del Service Worker: sandbox COMPLETAMENTE nuevo (pierde
    // cualquier estado en memoria), reutilizando el MISMO IndexedDB de
    // origen (lo único que sobrevive a un reinicio real).
    const sw2 = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw2.listeners.push, makePushEvent(payload)); // reintento de QStash llegado TRAS el reinicio
    check('3b. la segunda entrega (tras "reiniciar" el Service Worker) NO muestra una segunda notificación', sw2.shown.length === 0);
    check('3c. el ledger sigue teniendo una única marca para ese reminderId', Object.keys(idb._dump('organizator-push-ledger', 'delivered')).length === 1);
  }

  // =====================================================================
  section('5/6) Página reabierta (reminder aún pending localmente): el polling NO duplica el aviso ya mostrado por push, ni recién reabierta ni horas después');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    // El push llegó con la app cerrada (sin pestañas) ANTES de que
    // existiera ningún sandbox de página.
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Evento: Dentista', url: '/', tag: 'push-reminder-5', reminderId: 'reopen-1' }));
    check('5-pre. el Service Worker mostró el push mientras la app estaba cerrada', sw.shown.length === 1);

    // El usuario reabre ORGANIZATOR: nace una página nueva que carga el
    // MISMO reminder desde su propio window.storage, todavía 'pending'
    // (el Service Worker NUNCA toca state.reminders/reminder.status).
    const { sandbox: page, Notification } = makePageSandbox({ indexedDBInstance: idb });
    await page.addEvent({ id: 'e-reopen', title: 'Dentista', date: '2026-09-20', startTime: '19:59' });
    const reminder = await page.syncReminderForTarget('event', 'e-reopen', '2026-09-20T19:59:00', 0);
    // Fuerza el mismo id que el que "recibió" el push (createReminderForTarget/syncReminderForTarget generan uno propio con uid()).
    reminder.id = 'reopen-1';
    page.state.reminders[0].id = 'reopen-1';

    const triggered = await page.triggerDueReminders(NOW);
    check('5a. el reminder SÍ pasa a "triggered" al reabrir (el modelo funcional avanza igual)', triggered.length === 1 && triggered[0].status === 'triggered');
    check('5b. el polling NO muestra una notificación local (ya avisó el push mientras la app estaba cerrada)', Notification.created.length === 0);
    check('5c. la página registra la entrega en SU PROPIO ledger tras reconciliar (futuros ticks no vuelven a consultar el Service Worker para este id)', page.reminderAlreadyNotified('reopen-1') === true);

    // 6) Reapertura HORAS después (mismo escenario, pero simulando que
    // el usuario tardó en volver a abrir la app): sigue sin duplicar,
    // dentro del TTL de 7 días del ledger del Service Worker (ver
    // js/sw-push-ledger.js).
    const idb2 = makeFakeIndexedDB();
    const sw2 = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb2 });
    await fireEvent(sw2.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Evento: Revisión', url: '/', tag: 'push-reminder-6', reminderId: 'reopen-hours-1' }));
    const sixHoursLater = new Date(NOW_MS + 6 * 60 * 60 * 1000);
    const { sandbox: page2, Notification: Notification2 } = makePageSandbox({ indexedDBInstance: idb2 });
    await page2.addTask({ id: 't-reopen-hours', title: 'Revisión', dueDate: '2026-09-20', dueTime: '19:59' });
    const reminder2 = await page2.syncReminderForTarget('task', 't-reopen-hours', '2026-09-20T19:59:00', 0);
    reminder2.id = 'reopen-hours-1';
    page2.state.reminders[0].id = 'reopen-hours-1';
    const triggered2 = await page2.triggerDueReminders(sixHoursLater);
    check('6a. reapertura 6 horas después: el reminder pasa a "triggered"', triggered2.length === 1 && triggered2[0].status === 'triggered');
    check('6b. reapertura 6 horas después: sigue sin duplicar el aviso local', Notification2.created.length === 0);
  }

  // =====================================================================
  section('7/8) Múltiples pestañas abiertas cuando llega el push: ninguna duplica, ni entre sí ni tras reconciliar');
  // =====================================================================
  for (const numTabs of [2, 3]) {
    const idb = makeFakeIndexedDB();
    const reminderId = `multi-tab-${numTabs}`;
    const pages = [];
    for (let i = 0; i < numTabs; i++) {
      const { sandbox: page, Notification } = makePageSandbox({ indexedDBInstance: idb });
      await page.addEvent({ id: `e-tab-${numTabs}-${i}`, title: 'Evento compartido', date: '2026-09-20', startTime: '19:59' });
      const reminder = await page.syncReminderForTarget('event', `e-tab-${numTabs}-${i}`, '2026-09-20T19:59:00', 0);
      reminder.id = reminderId;
      page.state.reminders[0].id = reminderId;
      pages.push({ page, Notification });
    }
    // Cada "pestaña" reenvía el postMessage real del Service Worker a su
    // propio handleServiceWorkerMessage — igual que clients.matchAll()
    // devolviendo varias ventanas reales.
    const fakeClients = pages.map(({ page }) => ({ postMessage: (msg) => page.handleServiceWorkerMessage({ data: msg }) }));
    const sw = makeSWSandbox({ matchAllResult: fakeClients, indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Evento: Evento compartido', url: '/', tag: `push-${reminderId}`, reminderId }));
    await new Promise(r => setTimeout(r, 0));
    check(`7/8a. (${numTabs} pestañas) el Service Worker muestra UNA sola notificación nativa`, sw.shown.length === 1);
    for (let i = 0; i < numTabs; i++) {
      check(`7/8b. (${numTabs} pestañas) pestaña #${i + 1} se entera vía postMessage (su propio ledger lo sabe)`, pages[i].page.reminderAlreadyNotified(reminderId) === true);
    }
    // Tras enterarse, el polling de NINGUNA pestaña debe mostrar un
    // aviso local para el mismo reminder.
    for (let i = 0; i < numTabs; i++) {
      await pages[i].page.triggerDueReminders(NOW);
      check(`7/8c. (${numTabs} pestañas) el polling de la pestaña #${i + 1} no añade una notificación local`, pages[i].Notification.created.length === 0);
    }
  }

  // =====================================================================
  section('9/10) Carreras push↔polling (app abierta), ahora con el ledger persistente en juego: como mucho una notificación local por canal');
  // =====================================================================
  for (const order of ['push-first', 'polling-first']) {
    const idb = makeFakeIndexedDB();
    const reminderId = `race-${order}`;
    const { sandbox: page, Notification } = makePageSandbox({ indexedDBInstance: idb });
    await page.addTask({ id: `t-race-${order}`, title: 'Tarea en carrera', dueDate: '2026-09-20', dueTime: '19:59' });
    const reminder = await page.syncReminderForTarget('task', `t-race-${order}`, '2026-09-20T19:59:00', 0);
    reminder.id = reminderId;
    page.state.reminders[0].id = reminderId;

    const fakeClient = { postMessage: (msg) => page.handleServiceWorkerMessage({ data: msg }) };
    const sw = makeSWSandbox({ matchAllResult: [fakeClient], indexedDBInstance: idb });

    if (order === 'push-first') {
      await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Tarea en carrera', url: '/', tag: `push-${reminderId}`, reminderId }));
      await page.triggerDueReminders(NOW);
    } else {
      const triggerPromise = page.triggerDueReminders(NOW);
      await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Tarea en carrera', url: '/', tag: `push-${reminderId}`, reminderId }));
      await triggerPromise;
    }
    await new Promise(r => setTimeout(r, 0));
    check(`9/10a. orden "${order}" — como mucho UNA notificación local`, Notification.created.length <= 1);
    check(`9/10b. orden "${order}" — como mucho UNA notificación nativa del Service Worker`, sw.shown.length <= 1);
    check(`9/10c. orden "${order}" — el reminder queda "triggered" de todos modos`, page.getReminderById(reminderId).status === 'triggered');
  }

  // =====================================================================
  section('12/13/14) Payload sin reminderId, con reminderId inválido, o vacío: siempre notifica, nunca lanza, nunca deduplica');
  // =====================================================================
  {
    const cases = [
      { label: 'sin campo reminderId', payload: { title: 'ORGANIZATOR', body: 'Aviso', url: '/', tag: 'no-id' } },
      { label: 'reminderId numérico (inválido)', payload: { title: 'ORGANIZATOR', body: 'Aviso', url: '/', tag: 'bad-id-1', reminderId: 12345 } },
      { label: 'reminderId objeto (inválido)', payload: { title: 'ORGANIZATOR', body: 'Aviso', url: '/', tag: 'bad-id-2', reminderId: { x: 1 } } },
      { label: 'reminderId vacío', payload: { title: 'ORGANIZATOR', body: 'Aviso', url: '/', tag: 'empty-id', reminderId: '' } },
    ];
    for (const c of cases) {
      const idb = makeFakeIndexedDB();
      const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
      let threw = false;
      try {
        await fireEvent(sw.listeners.push, makePushEvent(c.payload));
        await fireEvent(sw.listeners.push, makePushEvent(c.payload)); // "reintento" — sin id válido, no hay nada que deduplicar
      } catch (e) { threw = true; }
      check(`12/13/14. "${c.label}" — nunca lanza`, !threw);
      check(`12/13/14. "${c.label}" — se muestra SIEMPRE (sin reminderId válido no se puede deduplicar, así que nunca se silencia)`, sw.shown.length === 2);
      check(`12/13/14. "${c.label}" — notification.data.reminderId queda vacío ('')`, sw.shown[0].options.data.reminderId === '');
      check(`12/13/14. "${c.label}" — el ledger persistente sigue vacío (nada válido que registrar)`, Object.keys(idb._dump('organizator-push-ledger', 'delivered')).length === 0);
    }
  }

  // =====================================================================
  section('15/16/17) Suscripciones inválidas (404/410/error de red): revisión estructural de api/push/send-due.js (cobertura funcional profunda en test-push-infrastructure.js, sin tocar)');
  // =====================================================================
  {
    // R-8.2-D no modifica api/push/*.js (ver el propio encargo, punto 9):
    // esta suite solo verifica que la lógica defensiva ya existente
    // sigue en su sitio, como regresión — la cobertura funcional
    // completa (con una base de datos falsa real) vive en
    // js/test-push-infrastructure.js (H/I, ejecutada aparte).
    check('15. send-due.js sigue distinguiendo 404/410 para limpiar la suscripción caducada', /statusCode === 404 \|\| statusCode === 410/.test(sendDueSrc));
    check('15b. send-due.js sigue borrando la suscripción caducada (no solo la ignora)', /DELETE FROM push_subscriptions WHERE id = \$\{sub\.id\}/.test(sendDueSrc));
    check('16. un error que NO sea 404/410 (p.ej. red/500) NO borra la suscripción, solo se registra', /console\.error\('\[api\/push\/send-due\] Fallo enviando push a una suscripción:'/.test(sendDueSrc));
    check('17. el envío a cada suscripción sigue dentro de un try/catch por suscripción (un fallo no aborta el resto del envío)', /for \(const sub of subscriptions\) \{\s*try \{/.test(sendDueSrc));
    check('17b. el reclamo del reminder (UPDATE ... WHERE status = \'pending\') sigue siendo la única operación idempotente que decide si se envía', /WHERE status = 'pending'/.test(sendDueSrc));
  }

  // =====================================================================
  section('18/19) Cancelación antes del push, y cancelación + reintento: nunca un aviso local inesperado, y el servidor sigue sin reenviar tras cancelar');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const { sandbox: page, Notification } = makePageSandbox({ indexedDBInstance: idb, fetchBehavior: {} });
    await page.addEvent({ id: 'e-cancel', title: 'Evento a cancelar', date: '2026-09-25', startTime: '10:00' });
    const reminder = await page.createReminderForTarget('event', 'e-cancel', '2026-09-25T10:00:00', 10);
    const cancelled = await page.cancelReminder(reminder.id);
    check('18a. cancelar localmente deja el reminder en "cancelled" (contrato existente de R-8.2-A/B, sin cambios)', cancelled.status === 'cancelled');

    // Aunque llegue un push tardío para ese MISMO reminderId (p.ej. la
    // cancelación no llegó a tiempo al servidor, o QStash ya lo había
    // despachado) el Service Worker lo muestra igual (es deliberadamente
    // "tonto", ver sw.js) — pero el modelo LOCAL nunca lo trata como
    // pendiente: getDueReminders() ya lo excluye por status, así que
    // triggerDueReminders() JAMÁS vuelve a considerarlo, se sepa o no
    // del push.
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Evento a cancelar', url: '/', tag: `push-${reminder.id}`, reminderId: reminder.id }));
    check('18b. el push tardío SÍ puede llegar a mostrarse (limitación conocida y documentada: el Service Worker no conoce cancelaciones, ver sw.js)', sw.shown.length === 1);

    const due = page.getDueReminders(new Date('2026-09-25T10:05:00.000Z'));
    check('18c. pero el reminder cancelado JAMÁS vuelve a aparecer como "debido" (getDueReminders lo excluye por status, con o sin push)', due.every(r => r.id !== reminder.id));
    const triggeredAfterCancel = await page.triggerDueReminders(new Date('2026-09-25T10:05:00.000Z'));
    check('18d. triggerDueReminders() nunca vuelve a notificar localmente un reminder ya cancelado', triggeredAfterCancel.every(r => r.id !== reminder.id) && Notification.created.length === 0);

    // 19) Cancelación + reintento server-side: revisión estructural de
    // que cancel-reminder.js/send-due.js siguen usando el mismo reclamo
    // atómico (WHERE status = 'pending') que hace que un reintento de
    // QStash tras la cancelación no encuentre nada que enviar.
    check('19a. cancel-reminder.js solo cancela si la fila seguía "pending" (idempotente, no reenvía nada)', /row\.status !== 'pending'/.test(cancelReminderSrc));
    check('19b. cancel-reminder.js marca la fila como "cancelled" en la base de datos', /UPDATE push_reminders SET status = 'cancelled'/.test(cancelReminderSrc));
    check('19c. send-due.js (quien procesa el reintento de QStash) solo envía si la fila SIGUE "pending" — una cancelada nunca se reenvía', /UPDATE push_reminders SET status = 'triggered'[\s\S]{0,80}WHERE id = \$\{pushReminderId\} AND status = 'pending'/.test(sendDueSrc));
  }

  // =====================================================================
  section('20/21) Import de datos y borrado total: la reconciliación no debe "contaminar" el conjunto nuevo de reminders');
  // =====================================================================
  {
    // 20) Estructural: importData() vive dentro de un manejador de evento
    // DOM (fileInput.addEventListener('change', ...)) difícil de invocar
    // de forma aislada sin un <input type="file"> real — se verifica el
    // código FUENTE real en vez de reimplementarlo o simularlo.
    const importBlockStart = html.indexOf("const ok = confirm('Vas a reemplazar TODOS los datos actuales de ORGANIZATOR");
    check('20a. se encuentra el bloque real de importData() en organizator.html', importBlockStart !== -1);
    const importBlock = html.slice(importBlockStart, importBlockStart + 3000);
    check('20b. importData() reinicia state.reminderNotificationLedger (ya existía en R-8.2-C, sin romperlo)', /state\.reminderNotificationLedger = \{\};/.test(importBlock));
    check('20c. importData() (R-8.2-D) también reinicia el ledger PERSISTENTE del Service Worker tras importar', /self\.SWPushLedger[\s\S]{0,80}clearAll/.test(importBlock));

    // 21) Funcional: deleteAllData() SÍ es una función standalone
    // invocable directamente — se prueba de verdad.
    const idb = makeFakeIndexedDB();
    const { sandbox: page } = makePageSandbox({ indexedDBInstance: idb });
    await page.addEvent({ id: 'e-before-wipe', title: 'Se va a borrar', date: '2026-09-20', startTime: '19:59' });
    const reminder = await page.syncReminderForTarget('event', 'e-before-wipe', '2026-09-20T19:59:00', 0);
    await page.markReminderNotified(reminder.id);
    await page.SWPushLedger.markDelivered('wipe-test-1', NOW_MS);
    check('21-pre. antes de borrar, el ledger persistente SÍ tiene una marca', Object.keys(idb._dump('organizator-push-ledger', 'delivered')).length === 1);

    await page.deleteAllData();
    check('21a. deleteAllData() vacía state.reminders', page.state.reminders.length === 0);
    check('21b. deleteAllData() vacía el ledger de la página (R-8.2-C, sin cambios)', Object.keys(page.state.reminderNotificationLedger).length === 0);
    check('21c. deleteAllData() (R-8.2-D) también vacía el ledger PERSISTENTE del Service Worker', Object.keys(idb._dump('organizator-push-ledger', 'delivered')).length === 0);

    // Tras el borrado, un reminderId NUEVO que por casualidad coincidiera
    // con uno viejo no debe arrastrar ninguna marca previa.
    const stillHas = await page.SWPushLedger.hasDelivered('wipe-test-1');
    check('21d. una consulta posterior al mismo reminderId ya no encuentra ninguna marca (no hay contaminación entre conjuntos)', stillHas === false);
  }

  // =====================================================================
  section('22/23) Limpieza determinista del ledger persistente, y comportamiento tras reiniciar el Service Worker después de limpiar');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    // Timestamp EXPLÍCITO pasado a pruneDelivered() en todo este bloque
    // (nunca Date.now() interno en las aserciones, pedido explícitamente
    // en el encargo) — pero anclado al tiempo REAL actual (a diferencia
    // de un epoch arbitrario) para que sea coherente con la limpieza
    // OPORTUNISTA que el propio sw.js dispara en cada evento 'push' (esa
    // sí usa Date.now() real, a propósito — ver sw.js) cuando, más abajo,
    // esta misma prueba dispara pushes reales de verdad.
    const base = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const { sandbox: page } = makePageSandbox({ indexedDBInstance: idb });
    await page.SWPushLedger.markDelivered('viejo-1', base - (8 * DAY)); // más de 7 días -> se limpia
    await page.SWPushLedger.markDelivered('viejo-2', base - (10 * DAY)); // igualmente viejo -> se limpia
    await page.SWPushLedger.markDelivered('reciente-1', base - (2 * DAY)); // dentro del TTL -> se conserva
    // Escritura DIRECTA (bypass de markDelivered, que sanea `when` y
    // NUNCA persistiría un valor no numérico) para poder ejercitar de
    // verdad la limpieza defensiva de valores corruptos.
    idb._setRaw('organizator-push-ledger', 'delivered', 'corrupto-1', 'no-es-un-numero');

    const removed = await page.SWPushLedger.pruneDelivered(base, 7 * DAY);
    check('22a. pruneDelivered() con un timestamp EXPLÍCITO elimina exactamente las marcas caducadas/corruptas', removed === 3);
    const afterPrune = idb._dump('organizator-push-ledger', 'delivered');
    check('22b. las marcas caducadas ya no existen', !('viejo-1' in afterPrune) && !('viejo-2' in afterPrune) && !('corrupto-1' in afterPrune));
    check('22c. la marca reciente se conserva (no se borra antes de que pueda haber una carrera real)', 'reciente-1' in afterPrune);
    const removedAgain = await page.SWPushLedger.pruneDelivered(base, 7 * DAY);
    check('22d. una segunda limpieza inmediata no tiene nada más que hacer', removedAgain === 0);

    // 23) Tras la limpieza, el Service Worker se "reinicia" (sandbox
    // nuevo, mismo IndexedDB) y recibe un push para un reminderId que
    // YA se había limpiado del ledger (viejo-1): al haber sido podado
    // por antigüedad, se trata como si fuera nuevo — comportamiento
    // ACEPTADO y documentado (ver sw.js: el TTL acota el crecimiento a
    // costa de, en el caso extremo de reaperturas MUY tardías, permitir
    // un aviso adicional).
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Aviso', url: '/', tag: 'push-viejo-1', reminderId: 'viejo-1' }));
    check('23a. tras limpiar, un push para un reminderId ya podado SÍ puede volver a mostrarse (comportamiento aceptado del TTL, no un bug)', sw.shown.length === 1);
    // Pero un reminderId que seguía vigente en el ledger (reciente-1)
    // TODAVÍA se deduplica correctamente tras el reinicio.
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Aviso', url: '/', tag: 'push-reciente-1', reminderId: 'reciente-1' }));
    check('23b. un reminderId que seguía vigente en el ledger SIGUE deduplicándose tras reiniciar el Service Worker', sw.shown.length === 1);
  }

  // =====================================================================
  section('24/25) notification.data.reminderId presente, y notificationclick sin cambios');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Tarea: Pagar factura', url: '/', tag: 'push-click-1', reminderId: 'click-1' }));
    check('24a. notification.data.reminderId existe y es el correcto', sw.shown[0].options.data.reminderId === 'click-1');
    check('24b. notification.data.url se conserva', sw.shown[0].options.data.url === '/');

    const existingClient = { focus: () => { existingClient.focused = true; return existingClient; } };
    const sw2 = makeSWSandbox({ matchAllResult: [existingClient], indexedDBInstance: idb });
    const notif = { close: () => { notif.closed = true; }, data: { url: '/semana', reminderId: 'click-1' } };
    await fireEvent(sw2.listeners.notificationclick, { notification: notif });
    check('25a. notificationclick cierra la notificación', notif.closed === true);
    check('25b. notificationclick enfoca una pestaña existente en vez de abrir una nueva', existingClient.focused === true && sw2.clientsCalls.openWindow.length === 0);

    const sw3 = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    const notif2 = { close: () => {}, data: { url: '/semana', reminderId: 'click-2' } };
    await fireEvent(sw3.listeners.notificationclick, { notification: notif2 });
    check('25c. sin ninguna pestaña abierta, notificationclick abre una nueva con la url del payload', sw3.clientsCalls.openWindow.length === 1 && sw3.clientsCalls.openWindow[0] === '/semana');
  }

  // =====================================================================
  section('26) reminder.status permanece SIEMPRE dentro de pending/triggered/cancelled, incluso a través de todo el flujo cerrado -> reabierto');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Evento: Estado', url: '/', tag: 'push-status-1', reminderId: 'status-1' }));

    const { sandbox: page } = makePageSandbox({ indexedDBInstance: idb });
    await page.addEvent({ id: 'e-status', title: 'Estado', date: '2026-09-20', startTime: '19:59' });
    const reminder = await page.syncReminderForTarget('event', 'e-status', '2026-09-20T19:59:00', 0);
    reminder.id = 'status-1';
    page.state.reminders[0].id = 'status-1';
    check('26a. nace en "pending"', page.getReminderById('status-1').status === 'pending');
    await page.triggerDueReminders(NOW);
    check('26b. tras reconciliar (push ya lo había mostrado) pasa a "triggered", nunca a un estado inventado', page.getReminderById('status-1').status === 'triggered');

    const ALLOWED_STATUSES = ['pending', 'triggered', 'cancelled'];
    check('26c. ningún estado usado en esta suite introduce algo distinto de pending/triggered/cancelled', ALLOWED_STATUSES.includes(page.getReminderById('status-1').status));
    check('26d. el código fuente de RECORDATORIOS no introduce estados nuevos como notified/delivered/sent/push_triggered', !/status\s*:\s*['"](notified|delivered|sent|push_triggered)['"]/.test(remindersSrc));
  }

  // =====================================================================
  section('27) sw.js NUNCA accede a state.reminders (ni a ningún otro dato de la página) — verificación estructural sobre el código REAL');
  // =====================================================================
  {
    // Se comprueba sobre el código SIN comentarios: sw.js y
    // js/sw-push-ledger.js mencionan deliberadamente estas cadenas en su
    // propia documentación (para explicar justo que NUNCA las tocan) —
    // ver stripComments() arriba.
    const swCode = stripComments(swSrc);
    const ledgerCode = stripComments(pushLedgerSrc);
    check('27a. sw.js no contiene código real que referencie "state.reminders"', !swCode.includes('state.reminders'));
    check('27b. sw.js no contiene código real que referencie "state.reminderNotificationLedger"', !swCode.includes('state.reminderNotificationLedger'));
    check('27c. sw.js no abre window.storage/organizator-storage (el polyfill de la página) en código real', !swCode.includes('window.storage') && !swCode.includes('organizator-storage'));
    check('27d. sw.js SÍ usa su propio ledger separado, con su propio nombre de base de datos', swSrc.includes("importScripts('/js/sw-push-ledger.js')"));
    check('27e. js/sw-push-ledger.js usa una base de datos IndexedDB PROPIA, distinta de la de window.storage, en código real', ledgerCode.includes("'organizator-push-ledger'") && !ledgerCode.includes("'organizator-storage'"));
  }

  // =====================================================================
  section('28) Reminders de ocurrencias recurrentes conservan sus IDs compuestos ("taskId::fecha") a través de todo el flujo cerrado -> reabierto');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const { sandbox: page, Notification } = makePageSandbox({ indexedDBInstance: idb });
    await page.addTask({
      id: 'trec-r8-2-d', title: 'Ducharse', dueDate: '2026-09-18', dueTime: '19:59',
      recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null },
    });
    const occDate = '2026-09-18';
    const reminder = await page.syncReminderForTaskOccurrence('trec-r8-2-d', occDate, 0);
    const expectedTargetId = page.getTaskOccurrenceId('trec-r8-2-d', occDate);
    check('28a. el targetId sigue siendo el compuesto de R-7 ("taskId::fecha")', reminder.targetId === expectedTargetId && expectedTargetId.includes('::'));

    // El push "llega" con la app cerrada, usando el MISMO reminder.id
    // (uid, nunca el targetId compuesto).
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Tarea: Ducharse', url: '/', tag: `push-${reminder.id}`, reminderId: reminder.id }));

    const triggered = await page.triggerDueReminders(new Date('2026-09-18T20:00:00.000Z'));
    check('28b. se dispara y reconcilia igual que un reminder normal (sin notificación local duplicada)', triggered.length === 1 && Notification.created.length === 0);
    check('28c. el targetId compuesto sigue intacto tras todo el flujo', page.getReminderById(reminder.id).targetId === expectedTargetId);
    check('28d. la marca de reconciliación (tanto la de la página como la consulta al ledger persistente) usa reminder.id, NUNCA el targetId compuesto', page.reminderAlreadyNotified(reminder.id) === true && !Object.prototype.hasOwnProperty.call(page.state.reminderNotificationLedger, reminder.targetId));
  }

  // =====================================================================
  section('29) Reordenar state.reminders no cambia el resultado de la reconciliación (identidad por id, no por posición)');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const sw = makeSWSandbox({ matchAllResult: [], indexedDBInstance: idb });
    await fireEvent(sw.listeners.push, makePushEvent({ title: 'ORGANIZATOR', body: 'Aviso', url: '/', tag: 'push-rb', reminderId: 'rb' }));

    const remindersData = [
      { id: 'ra', targetType: 'task', targetId: 'ta', remindAt: NOW.toISOString(), status: 'pending', createdAt: Date.now() },
      { id: 'rb', targetType: 'task', targetId: 'tb', remindAt: NOW.toISOString(), status: 'pending', createdAt: Date.now() }, // este ya lo mostró el push
      { id: 'rc', targetType: 'task', targetId: 'tc', remindAt: NOW.toISOString(), status: 'pending', createdAt: Date.now() },
    ];
    const { sandbox: pageNormal, Notification: n1 } = makePageSandbox({ indexedDBInstance: idb });
    pageNormal.state.reminders = remindersData.map(r => ({ ...r }));
    const triggeredNormal = await pageNormal.triggerDueReminders(NOW);

    const { sandbox: pageReversed, Notification: n2 } = makePageSandbox({ indexedDBInstance: idb });
    pageReversed.state.reminders = remindersData.map(r => ({ ...r })).reverse();
    const triggeredReversed = await pageReversed.triggerDueReminders(NOW);

    check('29a. mismo número de reminders disparados sin importar el orden del array', triggeredNormal.length === triggeredReversed.length && triggeredNormal.length === 3);
    check('29b. mismo conjunto de ids disparados (por id, no por posición)', triggeredNormal.map(r => r.id).sort().join(',') === triggeredReversed.map(r => r.id).sort().join(','));
    check('29c. en AMBOS órdenes, "rb" (ya avisado por push) no genera notificación local, y los otros dos sí', n1.created.length === 2 && n2.created.length === 2);
  }

  // =====================================================================
  section('30) Idempotencia de TODAS las operaciones de reconciliación del ledger persistente (markDelivered/hasDelivered/pruneDelivered/clearAll)');
  // =====================================================================
  {
    const idb = makeFakeIndexedDB();
    const { sandbox: page } = makePageSandbox({ indexedDBInstance: idb });
    const ledger = page.SWPushLedger;

    const first = await ledger.markDelivered('idem-1', 111);
    const second = await ledger.markDelivered('idem-1', 222); // mismo id, timestamp distinto -> NO debe reescribir
    check('30a. markDelivered() la primera vez devuelve true (marca creada)', first === true);
    check('30b. markDelivered() la segunda vez devuelve false (ya existía, no la reescribe)', second === false);
    check('30c. el timestamp persistido sigue siendo el de la PRIMERA llamada ("quien llega primero, gana")', idb._dump('organizator-push-ledger', 'delivered')['idem-1'] === 111);

    check('30d. hasDelivered() es puramente de lectura: llamarlo varias veces no cambia el resultado', (await ledger.hasDelivered('idem-1')) === true && (await ledger.hasDelivered('idem-1')) === true);
    check('30e. hasDelivered() de un id nunca visto es false, de forma estable', (await ledger.hasDelivered('nunca-visto')) === false && (await ledger.hasDelivered('nunca-visto')) === false);

    // markDelivered() concurrente (dos llamadas "a la vez", sin await
    // entre medias) para el MISMO id: solo una debe "ganar".
    const [c1, c2] = await Promise.all([ledger.markDelivered('idem-concurrente', 1), ledger.markDelivered('idem-concurrente', 2)]);
    check('30f. dos markDelivered() concurrentes para el mismo id: exactamente uno gana (true) y el otro pierde (false)', (c1 === true && c2 === false) || (c1 === false && c2 === true));

    const pruned1 = await ledger.pruneDelivered(1_000_000, 0); // ttl=0 -> se limpia todo lo que no sea "ahora mismo"
    const pruned2 = await ledger.pruneDelivered(1_000_000, 0); // repetirlo no debe fallar ni "limpiar de más"
    check('30g. pruneDelivered() limpia algo la primera vez', pruned1 >= 1);
    check('30h. repetir pruneDelivered() con los mismos argumentos es idempotente (ya no queda nada que limpiar)', pruned2 === 0);

    const clear1 = await ledger.clearAll();
    const clear2 = await ledger.clearAll(); // repetirlo sobre un ledger ya vacío no debe fallar
    check('30i. clearAll() se completa correctamente', clear1 === true);
    check('30j. repetir clearAll() sobre un ledger ya vacío también se completa correctamente (idempotente)', clear2 === true);
    check('30k. tras clearAll(), hasDelivered() de cualquier id anterior vuelve a ser false', (await ledger.hasDelivered('idem-1')) === false);

    // Robustez de entrada: valores no-string/vacíos nunca lanzan.
    let threwInvalid = false;
    try {
      await ledger.hasDelivered(null);
      await ledger.hasDelivered(undefined);
      await ledger.hasDelivered(123);
      await ledger.markDelivered('', 1);
      await ledger.markDelivered(null, 1);
    } catch (e) { threwInvalid = true; }
    check('30l. hasDelivered()/markDelivered() con entradas inválidas (null/undefined/número/vacío) nunca lanzan', !threwInvalid);
  }

  // =====================================================================
  section('node --check de organizator.html (código extraído), sw.js y js/sw-push-ledger.js');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', SW_PATH], { stdio: 'pipe' });
      check('C1. node --check de sw.js pasa', true);
    } catch (e) {
      check('C1. node --check de sw.js pasa', false);
      console.log(String(e.stderr || e.message));
    }

    try {
      execFileSync(process.execPath, ['--check', LEDGER_PATH], { stdio: 'pipe' });
      check('C2. node --check de js/sw-push-ledger.js pasa', true);
    } catch (e) {
      check('C2. node --check de js/sw-push-ledger.js pasa', false);
      console.log(String(e.stderr || e.message));
    }

    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(__dirname, `.organizator-r8-2-d-check-${process.pid}.tmp.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('C3. node --check del <script> principal de organizator.html pasa', true);
    } catch (e) {
      check('C3. node --check del <script> principal de organizator.html pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
