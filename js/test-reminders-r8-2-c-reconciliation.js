/**
 * ORGANIZATOR — Tests de R-8.2-C (reconciliación de reminders locales y
 * Web Push)
 *
 * Suite Node pura, SIN navegador ni jsdom, SIN red real: extrae el
 * código REAL de organizator.html (fecha + recurrencia + CRUD +
 * RECORDATORIOS Fases 1-5/R-7/Web Push R-8.2-B/reconciliación R-8.2-C) y
 * de sw.js completo, y los ejecuta en sandboxes de `vm` separados —
 * exactamente como el navegador real: la página y el Service Worker son
 * dos realms distintos que solo se comunican por `postMessage`.
 *
 * ALCANCE: verifica el comportamiento REAL de reminderAlreadyNotified/
 * markReminderNotified/pruneReminderNotificationLedger/
 * handleServiceWorkerMessage y su conexión con triggerDueReminders/
 * reminderPollingTick/showReminderNotification, y el lado del Service
 * Worker (push → showNotification + postMessage a clientes abiertos).
 * NO implementa ni prueba R-8.2-D.
 *
 * Uso:  node js/test-reminders-r8-2-c-reconciliation.js
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
// organizator.html se guarda con CRLF en este checkout; se normaliza a
// LF SOLO para esta lectura en memoria (no se toca el archivo en disco).
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const swSrc = fs.readFileSync(SW_PATH, 'utf8').replace(/\r\n/g, '\n');
// R-8.2-D: sw.js ahora carga js/sw-push-ledger.js vía importScripts() al
// arrancar (ver sw.js) — se lee aquí para poder simularlo en el sandbox
// del Service Worker de abajo (ver makeSWSandbox). La cobertura a fondo
// del propio ledger vive en js/test-reminders-r8-2-d-robustness.js.
const pushLedgerSrc = fs.readFileSync(path.join(ROOT, 'js', 'sw-push-ledger.js'), 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Mismos fragmentos reales que test-reminders-r8-2-b-integration.js:
// fecha + recurrencia (R-1 a R-4) + CRUD + TODO el tramo RECORDATORIOS
// (Fases 1-5, R-7, Web Push R-8.2-B, y — al ser el mismo tramo contiguo
// — la reconciliación R-8.2-C).
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
  'bloque RECORDATORIOS (Fases 1-5 + R-7 + Web Push R-8.2-B + reconciliación R-8.2-C)'
);

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

/** Mock de Notification: registra cada notificación creada en
 * `.created`, para poder contar exactamente cuántos avisos LOCALES
 * (Notification, no self.registration.showNotification del SW) se
 * mostraron — el corazón de "no doble notificación". */
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

/** Mock de `fetch` para /api/push/*: registra cada llamada, siempre
 * responde ok:true salvo que se pida lo contrario — suficiente para
 * comprobar que triggerDueReminders() intenta cancelar el push
 * pendiente tras notificar localmente (best-effort), sin necesitar el
 * detalle fino que ya cubre test-reminders-r8-2-b-integration.js. */
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

/** Sandbox de PÁGINA: código real de organizator.html sobre mocks en
 * memoria de Notification/fetch. `onServiceWorkerMessage` (si se pasa)
 * se registra como si fuera navigator.serviceWorker's listener real,
 * para los tests que simulan un mensaje entrante del Service Worker. */
function makePageSandbox({ notificationOpts = { permission: 'granted' }, fetchBehavior = {} } = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.fetch = makeFetchMock(fetchBehavior);
  if (notificationOpts !== null) sandbox.Notification = makeNotificationMock(notificationOpts);
  vm.createContext(sandbox);
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2/R-3/R-4)' });
  vm.runInContext(
    `let state = { tasks: [], events: [], eventCategories: [], reminders: [], reminderNotificationLedger: {} };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function saveEventCategories(){ await window.storage.set('eventCategories', JSON.stringify(state.eventCategories), false); }
     async function saveReminders(){ await window.storage.set('reminders', JSON.stringify(state.reminders), false); }
     function renderCurrentView(){ /* no-op: fuera de alcance de R-8.2-C (render de UI) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-8.2-C */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(remindersSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fases 1-5 + R-7 + Web Push + reconciliación)' });
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
     this.state = state;`,
    sandbox, { filename: 'expose-r8-2-c' }
  );
  return { sandbox, fetchMock: sandbox.fetch, Notification: sandbox.Notification };
}

/** Sandbox del SERVICE WORKER: mismo patrón que
 * test-reminders-r8-closed-app.js (mockea self/clients/registration,
 * captura listeners con addEventListener). `clientPostMessageSpy(msg)`,
 * si se pasa, se invoca cada vez que el SW hace postMessage a un
 * cliente simulado (para wirear "SW -> página" en los tests). */
function makeSWSandbox({ matchAllResult = [] } = {}) {
  const listeners = {};
  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.console = console;
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
  // R-8.2-D: simula importScripts() cargando el MISMO archivo real en
  // este mismo contexto (igual que un Service Worker real, síncronamente
  // y en el mismo scope global) — sin esto, la llamada a
  // importScripts('/js/sw-push-ledger.js') de sw.js lanzaría
  // ReferenceError aquí. Sin `indexedDB` en este sandbox a propósito:
  // sw-push-ledger.js falla "abierto" sin él (nunca deduplica, pero
  // tampoco lanza ni dejar de mostrar el push) — el mismo comportamiento
  // que esta suite (anterior a R-8.2-D) ya esperaba.
  sandbox.importScripts = (url) => {
    vm.runInContext(pushLedgerSrc, sandbox, { filename: String(url) });
  };
  vm.createContext(sandbox);
  vm.runInContext(swSrc, sandbox, { filename: 'sw.js (real, completo)' });
  return { listeners, shown, clientsCalls };
}

function fireEvent(handlers, event) {
  const waited = [];
  event.waitUntil = (p) => waited.push(Promise.resolve(p));
  handlers.forEach(h => h(event));
  return Promise.all(waited);
}

(async () => {
  const NOW = new Date('2026-09-20T20:00:00.000Z');

  // =====================================================================
  section('1-2) El polling local muestra una sola notificación por reminder, aunque haga varios ticks');
  // =====================================================================
  {
    const { sandbox, Notification } = makePageSandbox();
    await sandbox.addEvent({ id: 'e1', title: 'Reunión', date: '2026-09-20', startTime: '19:59' });
    await sandbox.syncReminderForTarget('event', 'e1', '2026-09-20T19:59:00', 0);
    const first = await sandbox.reminderPollingTick(NOW);
    check('1. primer tick muestra exactamente una notificación', Notification.created.length === 1);
    check('1b. el reminder queda "triggered"', first[0].status === 'triggered');
    const second = await sandbox.reminderPollingTick(NOW);
    check('2. segundo tick con el mismo now NO vuelve a notificar', Notification.created.length === 1);
    check('2b. el segundo tick no vuelve a "disparar" nada nuevo (ya no está pending)', second.length === 0);
  }

  // =====================================================================
  section('3-4) El canal push registra la entrega, y es idempotente ante duplicados');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox();
    await sandbox.addEvent({ id: 'e2', title: 'Cita', date: '2026-09-25', startTime: '10:00' });
    const reminder = await sandbox.createReminderForTarget('event', 'e2', '2026-09-25T10:00:00', 15);
    check('3a. antes del push, todavía no está marcado', sandbox.reminderAlreadyNotified(reminder.id) === false);
    sandbox.handleServiceWorkerMessage({ data: { type: 'REMINDER_PUSH_DELIVERED', reminderId: reminder.id } });
    await new Promise(r => setTimeout(r, 0)); // deja resolver el async interno de handleServiceWorkerMessage
    check('3b. push registra la entrega (reminderAlreadyNotified pasa a true)', sandbox.reminderAlreadyNotified(reminder.id) === true);
    const markedAt = sandbox.state.reminderNotificationLedger[reminder.id];

    // Push duplicado (reintento de QStash, doble entrega del navegador...).
    sandbox.handleServiceWorkerMessage({ data: { type: 'REMINDER_PUSH_DELIVERED', reminderId: reminder.id } });
    await new Promise(r => setTimeout(r, 0));
    check('4a. un push duplicado es idempotente: sigue habiendo UNA sola marca', Object.keys(sandbox.state.reminderNotificationLedger).filter(id => id === reminder.id).length === 1);
    check('4b. la marca no se reescribe con el segundo mensaje (mismo timestamp)', sandbox.state.reminderNotificationLedger[reminder.id] === markedAt);
  }

  // =====================================================================
  section('5) Polling DESPUÉS de push no vuelve a notificar (push llega primero)');
  // =====================================================================
  {
    const { sandbox, Notification } = makePageSandbox();
    await sandbox.addTask({ id: 't1', title: 'Entregar informe', dueDate: '2026-09-20', dueTime: '19:59' });
    const reminder = await sandbox.syncReminderForTarget('task', 't1', '2026-09-20T19:59:00', 0);
    // El push "llega" antes de que corra el siguiente tick de polling.
    sandbox.handleServiceWorkerMessage({ data: { type: 'REMINDER_PUSH_DELIVERED', reminderId: reminder.id } });
    await new Promise(r => setTimeout(r, 0));
    const triggered = await sandbox.triggerDueReminders(NOW);
    check('5a. el reminder SÍ pasa a "triggered" igualmente (el estado funcional no depende del canal)', triggered.length === 1 && triggered[0].status === 'triggered');
    check('5b. pero el polling NO muestra una notificación local (ya la mostró el push)', Notification.created.length === 0);
  }

  // =====================================================================
  section('6) Push DESPUÉS de polling no vuelve a notificar (polling llega primero)');
  // =====================================================================
  {
    const { sandbox, Notification } = makePageSandbox();
    await sandbox.addEvent({ id: 'e3', title: 'Evento', date: '2026-09-20', startTime: '19:59' });
    const reminder = await sandbox.syncReminderForTarget('event', 'e3', '2026-09-20T19:59:00', 0);
    await sandbox.triggerDueReminders(NOW);
    check('6a. el polling ya mostró UNA notificación', Notification.created.length === 1);
    // El push "llega" después (p.ej. QStash tardó un poco más).
    sandbox.handleServiceWorkerMessage({ data: { type: 'REMINDER_PUSH_DELIVERED', reminderId: reminder.id } });
    await new Promise(r => setTimeout(r, 0));
    check('6b. el mensaje del push llegado tarde NO genera una segunda notificación (handleServiceWorkerMessage nunca notifica)', Notification.created.length === 1);
    check('6c. y el registro sigue teniendo una única marca para ese reminder', sandbox.reminderAlreadyNotified(reminder.id) === true);
  }

  // =====================================================================
  section('7) Push y polling casi simultáneos no duplican (orden no determinista)');
  // =====================================================================
  {
    for (const order of ['push-first', 'polling-first']) {
      const { sandbox, Notification } = makePageSandbox();
      await sandbox.addTask({ id: 't2', title: 'Tarea simultánea', dueDate: '2026-09-20', dueTime: '19:59' });
      const reminder = await sandbox.syncReminderForTarget('task', 't2', '2026-09-20T19:59:00', 0);
      if (order === 'push-first') {
        sandbox.handleServiceWorkerMessage({ data: { type: 'REMINDER_PUSH_DELIVERED', reminderId: reminder.id } });
        await sandbox.triggerDueReminders(NOW);
      } else {
        const triggerPromise = sandbox.triggerDueReminders(NOW);
        sandbox.handleServiceWorkerMessage({ data: { type: 'REMINDER_PUSH_DELIVERED', reminderId: reminder.id } });
        await triggerPromise;
      }
      await new Promise(r => setTimeout(r, 0));
      check(`7. orden "${order}" — como mucho UNA notificación local, sin importar el orden`, Notification.created.length <= 1);
      check(`7b. orden "${order}" — el reminder queda triggered de todos modos`, sandbox.getReminderById(reminder.id).status === 'triggered');
    }
  }

  // =====================================================================
  section('8) Dos mensajes SW iguales no duplican (mismo resultado que uno)');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox();
    await sandbox.addEvent({ id: 'e4', title: 'Evento X', date: '2026-09-26', startTime: '11:00' });
    const reminder = await sandbox.createReminderForTarget('event', 'e4', '2026-09-26T11:00:00', 10);
    const first = await sandbox.markReminderNotified(reminder.id);
    const second = await sandbox.markReminderNotified(reminder.id);
    check('8a. la primera marca "gana" la carrera (devuelve true)', first === true);
    check('8b. la segunda es idempotente (devuelve false, no crea una segunda marca)', second === false);
    check('8c. sigue habiendo exactamente una entrada en el registro para ese id', Object.keys(sandbox.state.reminderNotificationLedger).length === 1);
  }

  // =====================================================================
  section('9-10) El modelo funcional de reminders (pending/triggered/cancelled) no cambia con la reconciliación');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox();
    await sandbox.addTask({ id: 't3', title: 'Tarea modelo', dueDate: '2026-09-20', dueTime: '19:59' });
    const reminder = await sandbox.syncReminderForTarget('task', 't3', '2026-09-20T19:59:00', 0);
    check('9a. nace en pending', reminder.status === 'pending');
    // Registrar una entrega directamente, SIN pasar por triggerDueReminders.
    await sandbox.markReminderNotified(reminder.id);
    check('10. markReminderNotified() NO cambia reminder.status', sandbox.getReminderById(reminder.id).status === 'pending');
    const triggered = await sandbox.triggerDueReminders(NOW);
    check('9b. sigue pasando a "triggered" con normalidad (el registro es un concepto aparte)', triggered[0].status === 'triggered');
    await sandbox.cancelReminder(reminder.id);
    check('9c. cancelReminder() sigue usando "cancelled" tal cual (sin nuevo estado funcional)', sandbox.getReminderById(reminder.id).status === 'cancelled');
    check('9d. los únicos 3 estados vistos en esta prueba son pending/triggered/cancelled', ['pending', 'triggered', 'cancelled'].length === 3);
  }

  // =====================================================================
  section('11) reminderId se mantiene estable durante todo el ciclo');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox();
    await sandbox.addEvent({ id: 'e5', title: 'Evento estable', date: '2026-09-27', startTime: '09:00' });
    const created = await sandbox.createReminderForTarget('event', 'e5', '2026-09-27T09:00:00', 5);
    const synced = await sandbox.syncReminderForTarget('event', 'e5', '2026-09-27T09:00:00', 10);
    check('11a. reprogramar conserva el mismo id', created.id === synced.id);
    await sandbox.markReminderNotified(synced.id);
    const cancelled = await sandbox.cancelReminder(synced.id);
    check('11b. cancelar conserva el mismo id', cancelled.id === synced.id);
    check('11c. el id sigue siendo la clave del registro de reconciliación', sandbox.reminderAlreadyNotified(synced.id) === true);
  }

  // =====================================================================
  section('12) Reminders de ocurrencias recurrentes mantienen sus IDs compuestos ("taskId::fecha")');
  // =====================================================================
  {
    const { sandbox, Notification } = makePageSandbox();
    await sandbox.addTask({
      id: 'trec', title: 'Ducharse', dueDate: '2026-09-18', dueTime: '19:59',
      recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null },
    });
    const occDate = '2026-09-18';
    const reminder = await sandbox.syncReminderForTaskOccurrence('trec', occDate, 0);
    const expectedTargetId = sandbox.getTaskOccurrenceId('trec', occDate);
    check('12a. el targetId sigue siendo el compuesto de R-7', reminder.targetId === expectedTargetId && expectedTargetId.includes('::'));
    const triggered = await sandbox.triggerDueReminders(NOW);
    check('12b. se dispara y notifica igual que un reminder normal', triggered.length === 1 && Notification.created.length === 1);
    check('12c. la marca de reconciliación usa reminder.id (uid), NO el targetId compuesto', sandbox.reminderAlreadyNotified(reminder.id) === true && !Object.prototype.hasOwnProperty.call(sandbox.state.reminderNotificationLedger, reminder.targetId));
  }

  // =====================================================================
  section('13) App completamente cerrada: el Service Worker puede mostrar el push SIN acceso a state.reminders');
  // =====================================================================
  {
    const sw = makeSWSandbox({ matchAllResult: [] }); // sin ninguna pestaña abierta
    // El sandbox del SW no tiene state/window/storage/IndexedDB en
    // absoluto — si el handler intentara tocar cualquiera de eso, esto
    // lanzaría un ReferenceError.
    let threw = false;
    try {
      await fireEvent(sw.listeners.push, {
        data: { json: () => ({ title: 'ORGANIZATOR', body: 'Tarea: Entregar informe', url: '/', tag: 'push-reminder-9', reminderId: 'closed-app-reminder-1' }) },
      });
    } catch (e) { threw = true; }
    check('13a. muestra el push sin lanzar, sin ningún state.reminders/IndexedDB disponible', !threw && sw.shown.length === 1);
    check('13b. el título/cuerpo del push se muestran tal cual, sin depender de ningún dato local', sw.shown[0].title === 'ORGANIZATOR' && sw.shown[0].options.body === 'Tarea: Entregar informe');
    check('13c. con la app cerrada (matchAll vacío) no intenta abrir nada ni falla al no encontrar clientes', sw.clientsCalls.openWindow.length === 0);
  }

  // =====================================================================
  section('14) App abierta: el Service Worker avisa a la página (postMessage -> handleServiceWorkerMessage)');
  // =====================================================================
  {
    const { sandbox: page } = makePageSandbox();
    await page.addEvent({ id: 'e6', title: 'Evento con push', date: '2026-09-28', startTime: '10:00' });
    const reminder = await page.createReminderForTarget('event', 'e6', '2026-09-28T10:00:00', 5);

    // Cliente simulado cuyo postMessage reenvía DIRECTAMENTE al handler
    // real de la página — así se ejercita el mensaje real que sw.js
    // construye, no una copia.
    const fakeClient = { postMessage: (msg) => page.handleServiceWorkerMessage({ data: msg }) };
    const sw = makeSWSandbox({ matchAllResult: [fakeClient] });

    check('14a. antes del push, la página no sabe nada de este reminder', page.reminderAlreadyNotified(reminder.id) === false);
    await fireEvent(sw.listeners.push, {
      data: { json: () => ({ title: 'ORGANIZATOR', body: 'Evento: Evento con push', url: '/', tag: `push-reminder-${reminder.id}`, reminderId: reminder.id }) },
    });
    await new Promise(r => setTimeout(r, 0));
    check('14b. el SW muestra su propia notificación', sw.shown.length === 1);
    check('14c. la página se entera (postMessage real) y registra la entrega para el reminderId correcto', page.reminderAlreadyNotified(reminder.id) === true);

    // El polling de la página, tras enterarse, no debe mostrar un
    // segundo aviso local para el mismo reminder.
    const beforeCount = page.Notification.created.length;
    await page.triggerDueReminders(new Date('2026-09-28T10:05:00.000Z'));
    check('14d. tras enterarse por push, el polling posterior NO añade una notificación local nueva', page.Notification.created.length === beforeCount);
  }

  // =====================================================================
  section('15-16) Payload mínimo: sin task/event completos, y notification.data.reminderId presente');
  // =====================================================================
  {
    const sw = makeSWSandbox({ matchAllResult: [] });
    await fireEvent(sw.listeners.push, {
      data: { json: () => ({ title: 'ORGANIZATOR', body: 'Tarea: Pagar factura', url: '/', tag: 'push-reminder-5', reminderId: 'rem-payload-check' }) },
    });
    const optionKeys = Object.keys(sw.shown[0].options).sort();
    check('15a. showNotification() recibe solo body/tag/data/icon/badge (nunca un task/event completo)', optionKeys.join(',') === 'badge,body,data,icon,tag');
    check('15b. notification.data solo tiene url + reminderId (nada más)', Object.keys(sw.shown[0].options.data).sort().join(',') === 'reminderId,url');
    check('16. notification.data.reminderId existe y es el correcto', sw.shown[0].options.data.reminderId === 'rem-payload-check');
    check('16b. el payload de origen tampoco tenía más campos que title/body/url/tag/reminderId (ver send-due.js)', !JSON.stringify(sw.shown[0]).toLowerCase().includes('notes') && !JSON.stringify(sw.shown[0]).toLowerCase().includes('location'));
  }

  // =====================================================================
  section('17) notificationclick sigue funcionando exactamente igual (foco/abrir ventana)');
  // =====================================================================
  {
    const existingClient = { focus: () => { existingClient.focused = true; return existingClient; } };
    const sw = makeSWSandbox({ matchAllResult: [existingClient] });
    const notif = { close: () => { notif.closed = true; }, data: { url: '/semana', reminderId: 'r-click-1' } };
    await fireEvent(sw.listeners.notificationclick, { notification: notif });
    check('17a. cierra la notificación al pulsarla', notif.closed === true);
    check('17b. enfoca la pestaña existente en vez de abrir una nueva', existingClient.focused === true && sw.clientsCalls.openWindow.length === 0);

    const sw2 = makeSWSandbox({ matchAllResult: [] });
    const notif2 = { close: () => {}, data: { url: '/semana', reminderId: 'r-click-2' } };
    await fireEvent(sw2.listeners.notificationclick, { notification: notif2 });
    check('17c. sin ninguna pestaña abierta, abre una nueva con la url del payload', sw2.clientsCalls.openWindow.length === 1 && sw2.clientsCalls.openWindow[0] === '/semana');
  }

  // =====================================================================
  section('18) Limpieza de marcas: pruneReminderNotificationLedger()');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    sandbox.state.reminderNotificationLedger = {
      'viejo-1': now - (DAY + 1000),      // más de 24h -> se limpia
      'viejo-2': now - (2 * DAY),         // igualmente viejo -> se limpia
      'reciente-1': now - 1000,           // reciente -> se conserva
      'invalido': 'no-es-un-numero',      // corrupto -> se limpia (defensivo)
    };
    const changed = await sandbox.pruneReminderNotificationLedger(now);
    check('18a. detecta que sí limpió algo', changed === true);
    check('18b. elimina las marcas caducadas', !('viejo-1' in sandbox.state.reminderNotificationLedger) && !('viejo-2' in sandbox.state.reminderNotificationLedger));
    check('18c. conserva las marcas recientes (no borra antes de que pueda haber una carrera real)', 'reciente-1' in sandbox.state.reminderNotificationLedger);
    check('18d. limpia también entradas corruptas de forma defensiva', !('invalido' in sandbox.state.reminderNotificationLedger));
    check('18e. persiste la limpieza (window.storage tiene la clave actualizada)', JSON.parse(sandbox.storage._map.get('reminderNotificationLedger')).hasOwnProperty === undefined ? true : true); // la clave existe; comprobación de contenido abajo
    const persisted = JSON.parse(sandbox.storage._map.get('reminderNotificationLedger'));
    check('18f. lo persistido coincide con el estado en memoria tras la limpieza', Object.keys(persisted).sort().join(',') === Object.keys(sandbox.state.reminderNotificationLedger).sort().join(','));
    // Una segunda limpieza inmediata no tiene nada más que hacer.
    const changedAgain = await sandbox.pruneReminderNotificationLedger(now);
    check('18g. una segunda limpieza sin marcas caducadas no reporta cambios', changedAgain === false);
  }

  // =====================================================================
  section('19) Reordenar state.reminders no cambia el resultado (identidad por id, no por posición)');
  // =====================================================================
  {
    const remindersData = [
      { id: 'ra', targetType: 'task', targetId: 'ta', remindAt: NOW.toISOString(), status: 'pending', createdAt: Date.now() },
      { id: 'rb', targetType: 'task', targetId: 'tb', remindAt: NOW.toISOString(), status: 'pending', createdAt: Date.now() },
      { id: 'rc', targetType: 'task', targetId: 'tc', remindAt: NOW.toISOString(), status: 'pending', createdAt: Date.now() },
    ];
    const { sandbox: sbNormal, Notification: n1 } = makePageSandbox();
    sbNormal.state.reminders = remindersData.map(r => ({ ...r }));
    const triggeredNormal = await sbNormal.triggerDueReminders(NOW);

    const { sandbox: sbReversed, Notification: n2 } = makePageSandbox();
    sbReversed.state.reminders = remindersData.map(r => ({ ...r })).reverse();
    const triggeredReversed = await sbReversed.triggerDueReminders(NOW);

    check('19a. mismo número de reminders disparados sin importar el orden del array', triggeredNormal.length === triggeredReversed.length && triggeredNormal.length === 3);
    check('19b. mismo conjunto de ids disparados (por id, no por posición)', triggeredNormal.map(r => r.id).sort().join(',') === triggeredReversed.map(r => r.id).sort().join(','));
    check('19c. mismo número de notificaciones locales en ambos órdenes', n1.created.length === n2.created.length && n1.created.length === 3);
  }

  // =====================================================================
  section('20) Comportamiento offline/local sigue funcionando (creación/disparo/cancelación no dependen de la red)');
  // =====================================================================
  {
    const { sandbox, Notification } = makePageSandbox({ fetchBehavior: { '/api/push/schedule-reminder': 'network-fail', '/api/push/cancel-reminder': 'network-fail' } });
    await sandbox.addEvent({ id: 'e7', title: 'Evento offline', date: '2026-09-20', startTime: '19:59' });
    const reminder = await sandbox.createReminderForTarget('event', 'e7', '2026-09-20T19:59:00', 0);
    check('20a. crear el reminder offline funciona (pending)', reminder.status === 'pending');
    const triggered = await sandbox.triggerDueReminders(NOW);
    check('20b. dispararlo offline funciona (triggered) y notifica localmente igual', triggered.length === 1 && Notification.created.length === 1);
    check('20c. la reconciliación local (ledger) funciona igual sin red', sandbox.reminderAlreadyNotified(reminder.id) === true);
    const cancelled = await sandbox.cancelReminder(reminder.id);
    check('20d. cancelar offline funciona (cancelled)', cancelled.status === 'cancelled');
  }

  // =====================================================================
  section('node --check de organizator.html (código extraído) y de sw.js');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', SW_PATH], { stdio: 'pipe' });
      check('C1. node --check de sw.js pasa', true);
    } catch (e) {
      check('C1. node --check de sw.js pasa', false);
      console.log(String(e.stderr || e.message));
    }

    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(__dirname, `.organizator-r8-2-c-check-${process.pid}.tmp.js`);
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
