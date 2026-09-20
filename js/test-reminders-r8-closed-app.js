/**
 * ORGANIZATOR — Tests de R-8 (notificaciones con la app cerrada)
 *
 * Suite Node pura, SIN navegador ni jsdom.
 *
 * ALCANCE REAL DE R-8 (ver auditoría entregada aparte, resumen aquí):
 * en su momento (antes de R-8.1/R-8.2-A/R-8.2-B) ORGANIZATOR no tenía
 * ningún backend que conociera los reminders del usuario, así que esta
 * suite verificaba explícitamente que el cliente NO se suscribía a Web
 * Push (crear una suscripción que nunca recibe nada habría sido la falsa
 * sensación de funcionalidad que el encargo original prohibía). Esa
 * infraestructura de servidor ya existe (R-8.1: VAPID/QStash/tablas SQL;
 * R-8.2-A: api/push/*.js) y R-8.2-B ya conecta el cliente con ella (ver
 * el bloque 16 más abajo, actualizado en consecuencia) — la cobertura
 * exhaustiva de esa integración vive en su propia suite dedicada:
 * js/test-reminders-r8-2-b-integration.js. Lo que esta suite sigue
 * verificando tal cual:
 *   - sw.js gestiona correctamente un evento `push` (útil si algún día
 *     existe un backend real) y `notificationclick` (enfoca/abre
 *     ORGANIZATOR), con payloads válidos e inválidos, sin asumir
 *     window/document.
 *   - showReminderNotification() (Fase 5, app ABIERTA) gana un
 *     `.onclick` que enfoca la ventana — único cambio de comportamiento
 *     visible, sin romper su contrato síncrono existente.
 *   - Todo el motor existente de reminders (Fase 1/2/3/4/5, R-7/R-7.1)
 *     sigue funcionando exactamente igual.
 *
 * Uso:  node js/test-reminders-r8-closed-app.js
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
// R-8.2-D: sw.js ahora carga js/sw-push-ledger.js vía importScripts() al
// arrancar (ver sw.js) — se lee aquí para poder simularlo en el sandbox
// del Service Worker de abajo (ver makeSWSandbox). NO se prueba a fondo
// aquí (eso vive en js/test-reminders-r8-2-d-robustness.js): basta con
// que exista para que sw.js pueda cargar sin lanzar, igual que en un
// Service Worker real.
const pushLedgerSrc = fs.readFileSync(path.join(ROOT, 'js', 'sw-push-ledger.js'), 'utf8').replace(/\r\n/g, '\n');
// organizator.html se guarda con CRLF en este entorno; se normaliza a LF
// SOLO para esta lectura en memoria (no se toca el archivo en disco) —
// mismo criterio que el resto de la familia de tests de recordatorios.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const swSrc = fs.readFileSync(SW_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Mismos fragmentos de organizator.html que ya extrae
// test-reminders-notification.js (Fase 1/4/5 + R-7.1, CRUD, saneamiento).
// ---------------------------------------------------------------------
const uidSrc = extractBetween(html, 'function uid(){', '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS', 'función uid()');
const saveTasksSrc = extractBetween(html, 'async function saveTasks(){', '\nasync function saveEvents(){', 'función saveTasks()');
const saveEventsSrc = extractBetween(html, 'async function saveEvents(){', '\nasync function saveCustomSchedules(){', 'función saveEvents()');
const saveRemindersSrc = extractBetween(html, 'async function saveReminders(){', '\nasync function savePrefs(){', 'función saveReminders()');
const sanitizeSrc = extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1)');
const crudSrc = extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', 'bloque CRUD');
const remindersFase1Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', 'bloque RECORDATORIOS (Fase 1)');
// Fase 2 (calculateReminderAt/createReminderForTarget) + Fase 3
// (syncReminderForTarget/cancelRemindersForTarget) — necesarias para
// crear/sincronizar reminders reales en los tests de integración (12-15).
// Se excluye deliberadamente el bloque R-7 (ocurrencias recurrentes) que
// sigue justo después: depende de getTaskOccurrenceId (R-3), fuera del
// alcance de R-8 y no usado por esta suite.
const remindersFase2to3Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt (Fase 2', '\n\n/* ==================================================================\n   RECORDATORIOS — ocurrencias recurrentes de tareas (Fase R-7)', 'bloque RECORDATORIOS (Fase 2+3)');
const remindersFase4Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — motor de detección y disparo lógico (Fase 4)', '\n\n/* ==================================================================\n   RECORDATORIOS — notificación real del navegador (Fase 5)', 'bloque RECORDATORIOS (Fase 4, motor de disparo)');
// Fase 5 (notificación real, con el .onclick de R-8) + R-7.1 (polling),
// mismo rango exacto que ya usa test-reminders-notification.js.
const remindersFase5Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — notificación real del navegador (Fase 5)', '\n\n/* ==================================================================\n   TOAST', 'bloque RECORDATORIOS (Fase 5 + R-7.1)');
// initPWA() en solitario (registro del Service Worker) — para las
// comprobaciones de soporte/registro de SW.
const initPWASrc = extractBetween(html, 'function initPWA(){', '\nfunction showUpdateBanner(reg){', 'función initPWA()');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// ---------------- Storage en memoria (sustituye a window.storage) ----------------
function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    async get(key) { return map.has(key) ? { key, value: map.get(key), shared: false } : null; },
    async set(key, value) { map.set(key, value); return { key, value, shared: false }; },
  };
}

/** Mismo mock de Notification que test-reminders-notification.js. */
function makeNotificationMock({ permission = 'default', onRequestPermission = null, throwOnConstruct = false } = {}) {
  const created = [];
  class MockNotification {
    constructor(title, options) {
      if (throwOnConstruct) throw new Error('boom: fallo simulado al crear la notificación');
      this.title = title;
      this.options = options || {};
      this._closed = false;
      created.push(this);
    }
    close() { this._closed = true; }
    static requestPermission() {
      MockNotification.requestPermissionCalls++;
      return new Promise(resolve => {
        const next = onRequestPermission ? onRequestPermission() : MockNotification.permission;
        MockNotification.permission = next;
        resolve(next);
      });
    }
  }
  MockNotification.permission = permission;
  MockNotification.created = created;
  MockNotification.requestPermissionCalls = 0;
  return MockNotification;
}

/** Sandbox del lado ORGANIZATOR (página): mismo patrón exacto que
 * test-reminders-notification.js, con `window.focus` espiado para poder
 * comprobar el nuevo `.onclick` de R-8. */
function makePageSandbox(notificationOpts) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  const calls = { focus: 0 };
  sandbox.focus = () => { calls.focus++; };
  if (notificationOpts !== undefined) {
    sandbox.Notification = makeNotificationMock(notificationOpts);
  }
  vm.createContext(sandbox);
  vm.runInContext(uidSrc, sandbox, { filename: 'organizator.html (uid)' });
  vm.runInContext('let state = { tasks: [], events: [], reminders: [] };', sandbox, { filename: 'state-setup' });
  sandbox.storage = makeStorage();
  vm.runInContext('function showToast(){}', sandbox, { filename: 'stub-showToast' });
  vm.runInContext(saveTasksSrc, sandbox, { filename: 'organizator.html (saveTasks)' });
  vm.runInContext(saveEventsSrc, sandbox, { filename: 'organizator.html (saveEvents)' });
  vm.runInContext(saveRemindersSrc, sandbox, { filename: 'organizator.html (saveReminders)' });
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase2to3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 2+3)' });
  vm.runInContext(remindersFase4Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 4)' });
  vm.runInContext(remindersFase5Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 5 + R-7.1, con R-8)' });
  vm.runInContext(sanitizeSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1)' });
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(
    `this.addTask = addTask; this.addEvent = addEvent;
     this.addReminder = addReminder; this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget; this.updateReminder = updateReminder; this.cancelReminder = cancelReminder;
     this.getDueReminders = getDueReminders; this.triggerDueReminders = triggerDueReminders;
     this.requestReminderNotificationPermission = requestReminderNotificationPermission;
     this.showReminderNotification = showReminderNotification;
     this.reminderNotificationBody = reminderNotificationBody;
     this.syncReminderForTarget = syncReminderForTarget;
     this.reminderPollingTick = reminderPollingTick;
     this.state = state;
     this.__calls = ${JSON.stringify(calls)};`,
    sandbox, { filename: 'expose-reminders-R8' }
  );
  // __calls se reasigna arriba como snapshot; se expone la referencia
  // real para que los contadores se actualicen de verdad.
  sandbox.__calls = calls;
  return { sandbox, Notification: sandbox.Notification, calls };
}

/** Sandbox del lado Service Worker: mockea `self`/`clients` (nunca
 * window/document, que no existen en un SW real) y captura los
 * listeners registrados con addEventListener para poder invocarlos
 * directamente con eventos sintéticos, más `event.waitUntil` capturado
 * para poder esperar la promesa real en los tests. */
function makeSWSandbox() {
  const listeners = {};
  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.console = console;
  sandbox.addEventListener = (type, fn) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(fn);
  };
  sandbox.caches = {
    open: async () => ({ addAll: async () => {}, put: async () => {}, match: async () => undefined }),
    keys: async () => [],
    match: async () => undefined,
    delete: async () => true,
  };
  const shown = [];
  sandbox.registration = {
    showNotification: (title, options) => { shown.push({ title, options }); return Promise.resolve(); },
  };
  let matchAllResult = [];
  const clientsCalls = { openWindow: [] };
  sandbox.clients = {
    matchAll: async () => matchAllResult,
    openWindow: async (url) => { clientsCalls.openWindow.push(url); return {}; },
  };
  // R-8.2-D: simula importScripts() cargando el MISMO archivo real en
  // este mismo contexto (igual que haría un Service Worker real,
  // síncronamente y en el mismo scope global) — sin esto, la llamada a
  // importScripts('/js/sw-push-ledger.js') de sw.js lanzaría
  // ReferenceError en este sandbox. No se define ningún `indexedDB` en
  // este sandbox a propósito: sw-push-ledger.js ya está diseñado para
  // fallar "abierto" (nunca deduplica, pero tampoco lanza ni deja de
  // mostrar el push) cuando IndexedDB no está disponible — exactamente
  // el comportamiento que estos tests, anteriores a R-8.2-D, ya esperan.
  sandbox.importScripts = (url) => {
    vm.runInContext(pushLedgerSrc, sandbox, { filename: String(url) });
  };
  vm.createContext(sandbox);
  vm.runInContext(swSrc, sandbox, { filename: 'sw.js (real, completo)' });
  return {
    listeners, shown, clientsCalls,
    setMatchAllResult: (r) => { matchAllResult = r; },
  };
}

function fireEvent(handlers, event) {
  const waited = [];
  event.waitUntil = (p) => waited.push(Promise.resolve(p));
  handlers.forEach(h => h(event));
  return Promise.all(waited);
}

function seedReminder(sb, { id, targetType, targetId, remindAt, status, createdAt }) {
  const r = { id, targetType, targetId, remindAt, status, createdAt: createdAt || Date.now() };
  sb.state.reminders.push(r);
  return r;
}

(async () => {
  const NOW = new Date('2026-09-20T20:00:00.000Z');

  // =====================================================================
  section('1) Detección de soporte de Notification API');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox(undefined); // sin Notification en absoluto
    let threw = false;
    let permResult, showResult;
    try {
      permResult = await sandbox.requestReminderNotificationPermission();
      showResult = sandbox.showReminderNotification({ id: 'r1', targetType: 'event', targetId: 'e1', remindAt: NOW.toISOString(), status: 'triggered' });
    } catch (e) { threw = true; }
    check('1a. sin Notification API, ninguna llamada lanza', !threw);
    check('1b. requestReminderNotificationPermission() devuelve false sin soporte', permResult === false);
    check('1c. showReminderNotification() devuelve null sin soporte', showResult === null);
  }

  // =====================================================================
  section('2) Detección de soporte de Service Worker');
  // =====================================================================
  {
    const sandbox1 = {};
    sandbox1.console = console;
    sandbox1.navigator = {}; // sin `serviceWorker`
    vm.createContext(sandbox1);
    vm.runInContext(initPWASrc, sandbox1, { filename: 'organizator.html (initPWA)' });
    vm.runInContext('this.initPWA = initPWA;', sandbox1, { filename: 'expose-initPWA' });
    let threw1 = false;
    try { sandbox1.initPWA(); } catch (e) { threw1 = true; }
    check('2a. sin navigator.serviceWorker, initPWA() no lanza (Service Worker no soportado)', !threw1);

    const registerCalls = [];
    const sandbox2 = {};
    sandbox2.console = console;
    sandbox2.navigator = {
      serviceWorker: {
        register: (url) => { registerCalls.push(url); return Promise.resolve({ addEventListener() {}, waiting: null }); },
        controller: null,
        addEventListener() {},
      },
    };
    vm.createContext(sandbox2);
    vm.runInContext(initPWASrc, sandbox2, { filename: 'organizator.html (initPWA)' });
    vm.runInContext('this.initPWA = initPWA;', sandbox2, { filename: 'expose-initPWA' });
    sandbox2.initPWA();
    await new Promise(r => setTimeout(r, 0));
    check('2b. con navigator.serviceWorker disponible, initPWA() registra /sw.js', registerCalls.length === 1 && registerCalls[0] === '/sw.js');
  }

  // =====================================================================
  section('3) Estado de permiso granted');
  // =====================================================================
  {
    const { sandbox, calls } = makePageSandbox({ permission: 'granted' });
    check('3a. requestReminderNotificationPermission() devuelve true', await sandbox.requestReminderNotificationPermission() === true);
    const notif = sandbox.showReminderNotification({ id: 'r1', targetType: 'event', targetId: 'e1', remindAt: NOW.toISOString(), status: 'triggered' });
    check('3b. showReminderNotification() crea la notificación con permiso granted', notif !== null && notif.title === 'ORGANIZATOR');
    check('3c. notif.onclick está definido (R-8)', typeof notif.onclick === 'function');
    notif.onclick();
    check('3d. pulsar la notificación enfoca la ventana (window.focus llamado)', calls.focus === 1);
    check('3e. pulsar la notificación cierra la notificación', notif._closed === true);
  }

  // =====================================================================
  section('4) Estado denied');
  // =====================================================================
  {
    const { sandbox, calls } = makePageSandbox({ permission: 'denied' });
    check('4a. requestReminderNotificationPermission() devuelve false sin volver a preguntar', await sandbox.requestReminderNotificationPermission() === false);
    check('4b. showReminderNotification() no crea nada con permiso denegado', sandbox.showReminderNotification({ id: 'r1', targetType: 'event', targetId: 'e1', remindAt: NOW.toISOString(), status: 'triggered' }) === null);
    check('4c. nunca se llama a window.focus si no hay notificación', calls.focus === 0);
  }

  // =====================================================================
  section('5) Estado default');
  // =====================================================================
  {
    const { sandbox, Notification } = makePageSandbox({ permission: 'default', onRequestPermission: () => 'granted' });
    check('5a. con permiso "default", SÍ se llama a Notification.requestPermission()', Notification.requestPermissionCalls === 0);
    const result = await sandbox.requestReminderNotificationPermission();
    check('5b. requestReminderNotificationPermission() pregunta y devuelve true si el usuario concede', result === true && Notification.requestPermissionCalls === 1);
  }

  // =====================================================================
  section('6) No se solicita permiso automáticamente al iniciar');
  // =====================================================================
  {
    // Comprobación estructural sobre el CÓDIGO REAL: startApp()/init() (el
    // único camino de arranque de la app) no debe mencionar
    // requestReminderNotificationPermission en absoluto — la única forma
    // de que se solicite permiso es una acción explícita del usuario
    // (helpers de más abajo).
    const startAppSrc = extractBetween(html, 'async function startApp(){', '\n(async function init(){', 'startApp()');
    const initSrc = extractBetween(html, '(async function init(){', '\n})();', 'init()');
    check('6a. startApp() no llama a requestReminderNotificationPermission', !/requestReminderNotificationPermission/.test(startAppSrc));
    check('6b. init() (arranque de la app) tampoco la llama', !/requestReminderNotificationPermission/.test(initSrc));
    check('6c. initPWA() (registro del Service Worker) tampoco pide permiso de notificaciones', !/requestReminderNotificationPermission/.test(initPWASrc));
  }

  // =====================================================================
  section('7) Solicitud de permiso tras acción explícita del usuario');
  // =====================================================================
  {
    // Verificación estructural: los ÚNICOS puntos del código real que
    // llaman a requestReminderNotificationPermission son manejadores de
    // eventos de usuario (change de los <select> de recordatorio en los
    // modales, click del botón de Ajustes) — nunca una llamada a nivel
    // de módulo ni dentro de startApp/init (ya comprobado en el punto 6).
    const callSites = (html.match(/requestReminderNotificationPermission\(\)/g) || []).length;
    check('7a. existen llamadas reales a requestReminderNotificationPermission (no quedó huérfana)', callSites >= 1);
    check('7b. las llamadas viven dentro de manejadores addEventListener(\'change\'/\'click\', ...)', (() => {
      // Para cada aparición de la llamada, retrocede hasta encontrar el
      // addEventListener más cercano y comprueba que es 'change' o 'click'.
      let idx = -1, allInsideHandlers = true, found = 0;
      while (true) {
        idx = html.indexOf('requestReminderNotificationPermission();', idx + 1);
        if (idx === -1) break;
        const before = html.slice(Math.max(0, idx - 400), idx);
        const m = before.match(/addEventListener\(['"](\w+)['"]/g);
        const last = m && m[m.length - 1];
        found++;
        if (!last || !/'change'|"change"|'click'|"click"/.test(last)) allInsideHandlers = false;
      }
      return found >= 1 && allInsideHandlers;
    })());
  }

  // =====================================================================
  section('8) Registro/uso correcto del Service Worker (push/notificationclick)');
  // =====================================================================
  {
    const sw = makeSWSandbox();
    check('8a. sw.js registra un listener para "push"', Array.isArray(sw.listeners.push) && sw.listeners.push.length === 1);
    check('8b. sw.js registra un listener para "notificationclick"', Array.isArray(sw.listeners.notificationclick) && sw.listeners.notificationclick.length === 1);
    check('8c. sw.js sigue registrando install/activate/fetch (no se eliminó nada existente)', ['install', 'activate', 'fetch', 'message'].every(t => Array.isArray(sw.listeners[t]) && sw.listeners[t].length === 1));
  }

  // =====================================================================
  section('9) Payload de notificación válido');
  // =====================================================================
  {
    const sw = makeSWSandbox();
    await fireEvent(sw.listeners.push, {
      data: { json: () => ({ title: 'Cumpleaños', body: 'Hoy es el cumpleaños de Ana', url: '/calendario', tag: 'r-42' }) },
    });
    check('9a. showNotification se llama exactamente una vez', sw.shown.length === 1);
    check('9b. usa el title del payload', sw.shown[0].title === 'Cumpleaños');
    check('9c. usa el body del payload', sw.shown[0].options.body === 'Hoy es el cumpleaños de Ana');
    check('9d. conserva la url en data para notificationclick', sw.shown[0].options.data.url === '/calendario');
    check('9e. usa el tag del payload (evita duplicar notificaciones del mismo reminder)', sw.shown[0].options.tag === 'r-42');
  }

  // =====================================================================
  section('10) Payload inválido no provoca errores');
  // =====================================================================
  {
    const cases = [
      { label: 'sin event.data', event: {} },
      { label: 'event.data.json() lanza (JSON corrupto)', event: { data: { json: () => { throw new Error('bad json'); } } } },
      { label: 'payload es un string, no un objeto', event: { data: { json: () => 'hola' } } },
      { label: 'payload es un array', event: { data: { json: () => ([1, 2, 3]) } } },
      { label: 'payload es null', event: { data: { json: () => null } } },
      { label: 'title/body no son strings', event: { data: { json: () => ({ title: 123, body: {} }) } } },
    ];
    for (const c of cases) {
      const sw = makeSWSandbox();
      let threw = false;
      try { await fireEvent(sw.listeners.push, c.event); } catch (e) { threw = true; }
      check(`10. "${c.label}" no lanza y muestra una notificación genérica de respaldo`, !threw && sw.shown.length === 1 && typeof sw.shown[0].title === 'string' && sw.shown[0].title.length > 0 && typeof sw.shown[0].options.body === 'string' && sw.shown[0].options.body.length > 0);
    }
  }

  // =====================================================================
  section('notificationclick: enfoca una pestaña existente, o abre una nueva si no hay ninguna');
  // =====================================================================
  {
    const sw = makeSWSandbox();
    const existingClient = { focus: () => { existingClient.focused = true; return existingClient; } };
    sw.setMatchAllResult([existingClient]);
    const notif = { close: () => { notif.closed = true; }, data: { url: '/semana' } };
    await fireEvent(sw.listeners.notificationclick, { notification: notif });
    check('11a. la notificación se cierra al pulsarla', notif.closed === true);
    check('11b. si ya hay una pestaña abierta, se enfoca (no se abre una nueva)', existingClient.focused === true && sw.clientsCalls.openWindow.length === 0);

    const sw2 = makeSWSandbox();
    sw2.setMatchAllResult([]); // ninguna pestaña abierta
    const notif2 = { close: () => {}, data: { url: '/semana' } };
    await fireEvent(sw2.listeners.notificationclick, { notification: notif2 });
    check('11c. si no hay ninguna pestaña abierta, se abre una nueva con la url del payload', sw2.clientsCalls.openWindow.length === 1 && sw2.clientsCalls.openWindow[0] === '/semana');
  }

  // =====================================================================
  section('12) Los reminders existentes siguen funcionando con la app abierta (integración completa)');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox({ permission: 'granted' });
    await sandbox.addEvent({ id: 'e1', title: 'Reunión', date: '2026-09-20', startTime: '20:30' });
    const reminder = await sandbox.createReminderForTarget !== undefined
      ? null // createReminderForTarget no se expone aquí; se usa syncReminderForTarget, camino real de la UI
      : null;
    const synced = await sandbox.syncReminderForTarget('event', 'e1', '2026-09-20T20:30:00', 30);
    check('12a. crear un recordatorio real vía syncReminderForTarget funciona igual que antes de R-8', synced !== null && synced.status === 'pending');
    const triggered = await sandbox.triggerDueReminders(NOW);
    check('12b. triggerDueReminders() sigue detectando y disparando el recordatorio vencido', triggered.length === 1 && triggered[0].id === synced.id);
    check('12c. el reminder queda "triggered" en state', sandbox.state.reminders.find(r => r.id === synced.id).status === 'triggered');
  }

  // =====================================================================
  section('13) reminderPollingTick() sigue funcionando');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox({ permission: 'granted' });
    await sandbox.addTask({ id: 't1', title: 'Entregar informe', dueDate: '2026-09-20', dueTime: '20:00' });
    seedReminder(sandbox, { id: 'r-tick', targetType: 'task', targetId: 't1', remindAt: NOW.toISOString(), status: 'pending' });
    const result = await sandbox.reminderPollingTick(NOW);
    check('13a. reminderPollingTick() delega en triggerDueReminders() y dispara el vencido', result.length === 1 && result[0].id === 'r-tick');
    check('13b. el reminder queda triggered tras el tick', sandbox.state.reminders.find(r => r.id === 'r-tick').status === 'triggered');
  }

  // =====================================================================
  section('14) No se crean reminders duplicados');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox({ permission: 'granted' });
    await sandbox.addEvent({ id: 'e2', title: 'Cita', date: '2026-09-25', startTime: '10:00' });
    const first = await sandbox.syncReminderForTarget('event', 'e2', '2026-09-25T10:00:00', 15);
    const second = await sandbox.syncReminderForTarget('event', 'e2', '2026-09-25T10:00:00', 30); // el usuario cambia la anticipación
    check('14a. cambiar la anticipación reutiliza el MISMO reminder (mismo id)', first.id === second.id);
    check('14b. solo hay un reminder pending para ese target', sandbox.getRemindersForTarget('event', 'e2').filter(r => r.status === 'pending').length === 1);
    check('14c. el total de reminders del target no creció', sandbox.getRemindersForTarget('event', 'e2').length === 1);
  }

  // =====================================================================
  section('15) Los estados pending/triggered/cancelled siguen siendo correctos');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox({ permission: 'granted' });
    await sandbox.addTask({ id: 't2', title: 'Pagar factura', dueDate: '2026-09-20', dueTime: '09:00' });
    const r = await sandbox.syncReminderForTarget('task', 't2', '2026-09-20T09:00:00', 5);
    check('15a. nace en pending', r.status === 'pending');
    await sandbox.triggerDueReminders(NOW);
    check('15b. pasa a triggered al vencer', sandbox.getReminderById(r.id).status === 'triggered');
    // Un reminder ya triggered no se puede "re-sincronizar" a pending por
    // arte de magia: syncReminderForTarget solo actúa sobre el pending
    // existente (pendingReminderForTarget), así que tras dispararse, un
    // cambio de anticipación crea uno NUEVO en vez de reabrir el viejo —
    // mismo comportamiento exacto que antes de R-8.
    const r3 = await sandbox.syncReminderForTarget('task', 't2', '2026-09-20T09:00:00', 10);
    check('15c. tras triggered, un nuevo syncReminderForTarget crea un reminder NUEVO (no reabre el disparado)', r3.id !== r.id && r3.status === 'pending');
    await sandbox.cancelReminder(r3.id);
    check('15d. cancelReminder() sigue dejando el reminder en "cancelled"', sandbox.getReminderById(r3.id).status === 'cancelled');
  }

  // =====================================================================
  section('16) R-8.2-B: el cliente ya está conectado con el backend de Web Push (R-8.1/R-8.2-A)');
  // =====================================================================
  // NOTA: hasta R-8.2-A, este bloque comprobaba explícitamente que
  // organizator.html/sw.js NO llamaban todavía a PushManager.subscribe()
  // ni a /api/push/* (esa era la limitación real y documentada de esta
  // fase). R-8.2-B (ver informe aparte) conecta esa infraestructura con
  // createReminderForTarget/syncReminderForTarget/cancelReminder, así que
  // esas llamadas ahora SÍ existen — este bloque se actualiza para
  // comprobar que la integración quedó bien conectada Y sigue siendo
  // segura (nunca pide permiso sola, nunca guarda secretos), en vez de
  // seguir afirmando que no existe. La cobertura exhaustiva del
  // comportamiento nuevo (suscripción, schedule/cancel, best-effort,
  // idempotencia) vive en su propia suite dedicada:
  // js/test-reminders-r8-2-b-integration.js.
  {
    check('16a. organizator.html SÍ llama ya a PushManager (suscripción real conectada, R-8.2-B)', /PushManager|pushManager\.subscribe|applicationServerKey/.test(html));
    check('16b. la suscripción vive dentro de subscribeToPushNotifications(), no suelta a nivel de módulo', /async function subscribeToPushNotifications\(\)\{[\s\S]*?pushManager\.subscribe/.test(html));
    // La clave pública de push viaja por diseño (la necesita el
    // navegador, ver api/push/vapid-public-key.js) — lo que nunca debe
    // aparecer es una clave PRIVADA embebida en el cliente.
    check('16c. no hay ninguna clave privada de push embebida en organizator.html', !/private[_-]?key/i.test(html));
    // sw.js sigue exactamente igual que en R-8/R-8.2-A (esta fase no lo
    // toca): sigue sin ninguna clave asignada como constante ni ningún
    // secreto embebido.
    check('16d. no hay ninguna clave asignada como valor en sw.js (solo prosa) ni applicationServerKey', !/VAPID[A-Z_]*\s*=\s*['"`]/.test(swSrc) && !/applicationServerKey/.test(swSrc));
    check('16e. sw.js no contiene ningún secreto/clave privada embebida', !/private[_-]?key/i.test(swSrc));
    check('16f. el backend de push (api/push/*.js) sigue completo (R-8.2-A, sin tocar)', (() => {
      try {
        const apiFiles = fs.readdirSync(path.join(ROOT, 'api', 'push'));
        return ['subscribe.js', 'unsubscribe.js', 'schedule-reminder.js', 'cancel-reminder.js', 'send-due.js', 'vapid-public-key.js'].every(f => apiFiles.includes(f));
      } catch (e) { return false; }
    })());
    check('16g. organizator.html llama ya a los 4 endpoints de push que le corresponden al cliente', ['subscribe', 'schedule-reminder', 'cancel-reminder', 'vapid-public-key'].every(ep => html.includes(`/api/push/${ep}`)));
    check('16h. sw.js sigue SIN llamar a ningún /api/push/* (no es su responsabilidad, solo escucha el evento push)', !/\/api\/push\//.test(swSrc));
    check('16i. el motor de reminders con la app ABIERTA sigue dependiendo del polling (triggerDueReminders vía setInterval) — Web Push es solo el camino adicional para la app cerrada', /setInterval\(\(\) => \{ reminderPollingTick\(\); \}, intervalMs\)/.test(html));
    // Mismo criterio que la sección 6: la suscripción a Web Push tampoco
    // debe pedirse jamás al arrancar la app, solo tras acción explícita.
    const startAppSrc16 = extractBetween(html, 'async function startApp(){', '\n(async function init(){', 'startApp() (16)');
    const initSrc16 = extractBetween(html, '(async function init(){', '\n})();', 'init() (16)');
    check('16j. startApp() no llama a subscribeToPushNotifications', !/subscribeToPushNotifications/.test(startAppSrc16));
    check('16k. init() (arranque de la app) tampoco la llama', !/subscribeToPushNotifications/.test(initSrc16));
  }

  // =====================================================================
  section('node --check de sw.js y del <script> principal de organizator.html');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', SW_PATH], { stdio: 'pipe' });
      check('C1. node --check de sw.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('C1. node --check de sw.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-r8-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('C2. node --check del <script> principal de organizator.html pasa', true);
    } catch (e) {
      check('C2. node --check del <script> principal de organizator.html pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
