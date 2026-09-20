/**
 * ORGANIZATOR — Tests de R-8.2-B (integración de Web Push con el motor
 * de reminders existente)
 *
 * Suite Node pura, SIN navegador ni jsdom, SIN red real: `fetch`,
 * `navigator.serviceWorker`/`PushManager` y `Notification` se sustituyen
 * por mocks en memoria, cargados en un sandbox de `vm` junto con el
 * código REAL extraído de organizator.html (nunca una reimplementación) —
 * mismo patrón que el resto de la familia de tests de recordatorios
 * (test-reminders-model.js, test-recurrence-reminders-r7.js,
 * test-reminders-r8-closed-app.js).
 *
 * ALCANCE: esta suite verifica el comportamiento REAL de los helpers de
 * ORGANIZATOR (subscribeToPushNotifications, scheduleReminderPush,
 * cancelReminderPush, y su conexión con createReminderForTarget/
 * syncReminderForTarget/cancelReminder/deleteTask/deleteEvent), no solo
 * que exista cierto texto en el HTML. NO prueba la infraestructura de
 * servidor (api/push/*.js, QStash, VAPID) — eso ya lo cubre
 * test-push-infrastructure.js (R-8.2-A) — ni la reconciliación entre
 * reminder local triggered y push ya entregado con la app abierta a la
 * vez: eso es R-8.2-C, deliberadamente fuera de esta fase.
 *
 * Uso:  node js/test-reminders-r8-2-b-integration.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// organizator.html se guarda con CRLF en este checkout; se normaliza a
// LF SOLO para esta lectura en memoria (no se toca el archivo en disco)
// — mismo criterio que el resto de la suite de recordatorios.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Mismos fragmentos reales que ya usa test-recurrence-reminders-r7.js:
// utilidades de fecha + recurrencia (R-1 a R-4) + CRUD + TODO el tramo
// RECORDATORIOS (Fases 1-5, R-7, categorías, vistas R-6, y — al ser el
// mismo tramo contiguo — el nuevo bloque de Web Push de R-8.2-B).
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
// Fase 1 a TOAST: incluye Fases 1-5, R-7 (ocurrencias recurrentes),
// CATEGORÍAS DE EVENTOS, RECURRENCIA — vistas (R-6), y el bloque nuevo
// RECORDATORIOS — integración con Web Push (R-8.2-B) — todo el mismo
// tramo contiguo de organizator.html, igual que ya extrae
// test-recurrence-reminders-r7.js.
const remindersSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fases 1-5 + R-7 + Web Push R-8.2-B) + CATEGORÍAS DE EVENTOS + RECURRENCIA vistas (R-6)'
);
// startApp()/init(): para las comprobaciones estructurales de "nunca se
// suscribe sola al arrancar" (mismo criterio que la sección 6 de
// test-reminders-r8-closed-app.js).
const startAppSrc = extractBetween(html, 'async function startApp(){', '\n(async function init(){', 'startApp()');
const initSrc = extractBetween(html, '(async function init(){', '\n})();', 'init()');

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

/** Mismo mock de Notification que el resto de la suite de recordatorios. */
function makeNotificationMock({ permission = 'default' } = {}) {
  class MockNotification {
    constructor(title, options) { this.title = title; this.options = options || {}; }
    close() {}
    static requestPermission() {
      MockNotification.requestPermissionCalls++;
      return Promise.resolve(MockNotification.permission);
    }
  }
  MockNotification.permission = permission;
  MockNotification.requestPermissionCalls = 0;
  return MockNotification;
}

/** Mock de PushManager (registration.pushManager): getSubscription()/
 * subscribe() en memoria. Si `existingSubscription` se pasa, simula un
 * navegador YA suscrito (getSubscription() la devuelve directamente,
 * sin necesidad de llamar a subscribe()). subscribeCalls registra cada
 * llamada real a subscribe() (para comprobar que nunca se duplica). */
function makePushManagerMock({ existingSubscription = null, subscribeShouldThrow = false } = {}) {
  let subscription = existingSubscription;
  const subscribeCalls = [];
  return {
    async getSubscription() { return subscription; },
    async subscribe(opts) {
      subscribeCalls.push(opts);
      if (subscribeShouldThrow) throw new Error('boom: subscribe() falló');
      subscription = {
        endpoint: 'https://push.example.com/ep-' + (subscribeCalls.length),
        keys: { p256dh: 'mock-p256dh-key', auth: 'mock-auth-secret' },
        toJSON() { return { endpoint: this.endpoint, keys: this.keys }; },
      };
      return subscription;
    },
    _subscribeCalls: subscribeCalls,
    _current: () => subscription,
  };
}

/** Mock de `fetch` para los 4 endpoints /api/push/* que llama el
 * cliente. Registra cada llamada (url, method, body ya parseado) en
 * `.calls`, para poder comprobar exactamente qué se envió — nunca
 * asume el resultado, lo mide. `behavior` decide, por endpoint, si
 * responde ok, HTTP no-ok, o lanza (red caída/offline). */
function makeFetchMock(behavior = {}) {
  const calls = [];
  const defaults = { vapid: 'ok', subscribe: 'ok', schedule: 'ok', cancel: 'ok' };
  const b = Object.assign({}, defaults, behavior);
  async function fetchMock(url, opts = {}) {
    const method = opts.method || 'GET';
    const body = (opts.body !== undefined) ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method, body });
    const respond = (key, okJson) => {
      const mode = b[key];
      if (mode === 'network-fail') throw new TypeError('Failed to fetch (offline simulado)');
      if (mode === 'http-error') return { ok: false, status: 500, json: async () => ({ error: 'mock 500' }) };
      return { ok: true, status: 200, json: async () => okJson };
    };
    if (url === '/api/push/vapid-public-key') return respond('vapid', { publicKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' });
    if (url === '/api/push/subscribe') return respond('subscribe', { ok: true });
    if (url === '/api/push/schedule-reminder') return respond('schedule', { ok: true, pushReminderId: 1 });
    if (url === '/api/push/cancel-reminder') return respond('cancel', { ok: true });
    return { ok: false, status: 404, json: async () => ({ error: 'ruta no mockeada: ' + url }) };
  }
  fetchMock.calls = calls;
  return fetchMock;
}

/** Sandbox completo: código real de organizator.html (fecha + recurrencia
 * + CRUD + recordatorios/Web Push) sobre mocks en memoria de
 * Notification/PushManager/fetch/navigator.serviceWorker. Cualquier
 * opción omitida simula que esa API NO existe en el navegador (mismo
 * criterio que "sin soporte" en el resto de la suite). */
function makePageSandbox({
  notificationOpts = { permission: 'granted' },
  isSecureContext = true,
  hasServiceWorker = true,
  hasPushManagerGlobal = true,
  serviceWorkerReadyFails = false,
  pushManagerOpts = {},
  fetchBehavior = {},
} = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.isSecureContext = isSecureContext;
  sandbox.atob = (str) => Buffer.from(str, 'base64').toString('binary');
  if (hasPushManagerGlobal) sandbox.PushManager = function PushManager() {};
  // notificationOpts === null simula un navegador SIN Notification API
  // en absoluto (typeof Notification === 'undefined'); un objeto (o el
  // default) instala el mock.
  if (notificationOpts !== null) sandbox.Notification = makeNotificationMock(notificationOpts);
  const fetchMock = makeFetchMock(fetchBehavior);
  sandbox.fetch = fetchMock;
  const pushManagerMock = makePushManagerMock(pushManagerOpts);
  if (hasServiceWorker) {
    sandbox.navigator = {
      serviceWorker: {
        ready: serviceWorkerReadyFails
          ? Promise.reject(new Error('Service Worker nunca quedó listo'))
          : Promise.resolve({ pushManager: pushManagerMock }),
      },
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2/R-3/R-4)' });
  vm.runInContext(
    `let state = { tasks: [], events: [], eventCategories: [], reminders: [] };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function saveEventCategories(){ await window.storage.set('eventCategories', JSON.stringify(state.eventCategories), false); }
     async function saveReminders(){ await window.storage.set('reminders', JSON.stringify(state.reminders), false); }
     function renderCurrentView(){ /* no-op: fuera de alcance de R-8.2-B (render de UI) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-8.2-B */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(remindersSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fases 1-5 + R-7 + Web Push R-8.2-B)' });
  vm.runInContext(
    `this.getTaskOccurrenceId = getTaskOccurrenceId;
     this.addTask = addTask; this.deleteTask = deleteTask;
     this.addEvent = addEvent; this.deleteEvent = deleteEvent;
     this.addReminder = addReminder; this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget;
     this.updateReminder = updateReminder; this.cancelReminder = cancelReminder;
     this.calculateReminderAt = calculateReminderAt;
     this.createReminderForTarget = createReminderForTarget;
     this.syncReminderForTarget = syncReminderForTarget;
     this.cancelRemindersForTarget = cancelRemindersForTarget;
     this.syncReminderForTaskOccurrence = syncReminderForTaskOccurrence;
     this.cancelReminderForTaskOccurrence = cancelReminderForTaskOccurrence;
     this.getDueReminders = getDueReminders; this.triggerDueReminders = triggerDueReminders;
     this.reminderNotificationBody = reminderNotificationBody;
     this.urlBase64ToUint8Array = urlBase64ToUint8Array;
     this.subscribeToPushNotifications = subscribeToPushNotifications;
     this.scheduleReminderPush = scheduleReminderPush;
     this.cancelReminderPush = cancelReminderPush;
     this.state = state;`,
    sandbox, { filename: 'expose-r8-2-b' }
  );
  return { sandbox, fetchMock, pushManagerMock };
}

(async () => {
  const NOW = new Date('2026-09-20T20:00:00.000Z');

  // =====================================================================
  section('1) subscribeToPushNotifications() con permiso concedido — crea y registra la suscripción');
  // =====================================================================
  {
    const { sandbox, fetchMock, pushManagerMock } = makePageSandbox({ notificationOpts: { permission: 'granted' } });
    const result = await sandbox.subscribeToPushNotifications();
    check('1a. devuelve { ok:true }', result && result.ok === true);
    check('1b. llama a pushManager.subscribe() exactamente una vez (no había suscripción previa)', pushManagerMock._subscribeCalls.length === 1);
    // instanceof Uint8Array no sirve aquí: applicationServerKey se crea
    // DENTRO del sandbox de vm (otro realm), así que su constructor
    // Uint8Array no es el mismo objeto que el de este proceso — se
    // comprueba por el tag interno en vez de por identidad de realm.
    check('1c. subscribe() se llama con userVisibleOnly:true y applicationServerKey (Uint8Array)', pushManagerMock._subscribeCalls[0].userVisibleOnly === true && Object.prototype.toString.call(pushManagerMock._subscribeCalls[0].applicationServerKey) === '[object Uint8Array]');
    const subscribeCall = fetchMock.calls.find(c => c.url === '/api/push/subscribe');
    check('1d. POST /api/push/subscribe se llama con la suscripción real', !!subscribeCall && subscribeCall.method === 'POST');
    check('1e. el body enviado tiene endpoint + keys.p256dh + keys.auth', subscribeCall.body.endpoint === pushManagerMock._current().endpoint && subscribeCall.body.keys.p256dh === 'mock-p256dh-key' && subscribeCall.body.keys.auth === 'mock-auth-secret');
    check('1f. primero se pide la clave pública a /api/push/vapid-public-key', fetchMock.calls.some(c => c.url === '/api/push/vapid-public-key' && c.method === 'GET'));
  }

  // =====================================================================
  section('2) permiso denied → nunca se suscribe');
  // =====================================================================
  {
    const { sandbox, fetchMock, pushManagerMock } = makePageSandbox({ notificationOpts: { permission: 'denied' } });
    const result = await sandbox.subscribeToPushNotifications();
    check('2a. devuelve { ok:false, reason:"permission-not-granted" }', result.ok === false && result.reason === 'permission-not-granted');
    check('2b. nunca llama a pushManager.subscribe()', pushManagerMock._subscribeCalls.length === 0);
    check('2c. nunca llama a ningún endpoint /api/push/*', fetchMock.calls.length === 0);
  }

  // =====================================================================
  section('3) permiso default → no se pide permiso automáticamente desde subscribeToPushNotifications()');
  // =====================================================================
  {
    const { sandbox, fetchMock } = makePageSandbox({ notificationOpts: { permission: 'default' } });
    const result = await sandbox.subscribeToPushNotifications();
    check('3a. devuelve { ok:false, reason:"permission-not-granted" } (nunca fuerza el permiso)', result.ok === false && result.reason === 'permission-not-granted');
    check('3b. Notification.requestPermission() NUNCA se llama desde aquí (solo requestReminderNotificationPermission lo hace, tras acción explícita)', sandbox.Notification.requestPermissionCalls === 0);
    check('3c. no se llama a ningún endpoint de push', fetchMock.calls.length === 0);
    // Estructural: subscribeToPushNotifications tampoco se invoca nunca
    // desde el arranque de la app (mismo criterio que
    // requestReminderNotificationPermission, sección 6 de
    // test-reminders-r8-closed-app.js).
    check('3d. startApp() no llama a subscribeToPushNotifications', !/subscribeToPushNotifications/.test(startAppSrc));
    check('3e. init() (arranque) tampoco la llama', !/subscribeToPushNotifications/.test(initSrc));
  }

  // =====================================================================
  section('4) API de Push no disponible en el navegador → nunca rompe');
  // =====================================================================
  {
    const cases = [
      { label: 'sin Notification', opts: { notificationOpts: null } },
      { label: 'sin navigator.serviceWorker', opts: { hasServiceWorker: false } },
      { label: 'sin PushManager global', opts: { hasPushManagerGlobal: false } },
      { label: 'contexto no seguro (isSecureContext=false)', opts: { isSecureContext: false } },
      { label: 'Service Worker nunca queda listo (navigator.serviceWorker.ready rechaza)', opts: { serviceWorkerReadyFails: true } },
      { label: 'no se puede obtener la clave pública (vapid-public-key falla)', opts: { fetchBehavior: { vapid: 'http-error' } } },
    ];
    for (const c of cases) {
      const { sandbox } = makePageSandbox(c.opts);
      let threw = false, result;
      try { result = await sandbox.subscribeToPushNotifications(); } catch (e) { threw = true; }
      check(`4. "${c.label}" no lanza y devuelve { ok:false, reason }`, !threw && result && result.ok === false && typeof result.reason === 'string');
    }
  }

  // =====================================================================
  section('5-6) Suscripción existente se reutiliza; una nueva SÍ llama a /api/push/subscribe');
  // =====================================================================
  {
    const existing = { endpoint: 'https://push.example.com/ya-existia', keys: { p256dh: 'p1', auth: 'a1' }, toJSON() { return { endpoint: this.endpoint, keys: this.keys }; } };
    const { sandbox, fetchMock, pushManagerMock } = makePageSandbox({ pushManagerOpts: { existingSubscription: existing } });
    const result = await sandbox.subscribeToPushNotifications();
    check('5a. reutiliza la suscripción existente (ok:true)', result.ok === true);
    check('5b. NUNCA llama a pushManager.subscribe() si ya había una suscripción', pushManagerMock._subscribeCalls.length === 0);
    check('5c. NUNCA pide la clave pública si no hace falta crear una suscripción nueva', !fetchMock.calls.some(c => c.url === '/api/push/vapid-public-key'));
    check('6. igualmente registra la suscripción (reutilizada) en /api/push/subscribe', fetchMock.calls.some(c => c.url === '/api/push/subscribe' && c.body.endpoint === 'https://push.example.com/ya-existia'));
  }

  // =====================================================================
  section('7-9) createReminderForTarget(): crea local, sincroniza con push, mismo reminderId');
  // =====================================================================
  {
    const { sandbox, fetchMock } = makePageSandbox();
    await sandbox.addEvent({ id: 'e1', title: 'Reunión de equipo', date: '2026-09-20', startTime: '20:30' });
    const reminder = await sandbox.createReminderForTarget('event', 'e1', '2026-09-20T20:30:00', 30);
    check('7. createReminderForTarget() crea el reminder local aunque el backend responda bien (no null, pending)', !!reminder && reminder.status === 'pending');
    check('7b. el reminder local queda en state.reminders', sandbox.state.reminders.some(r => r.id === reminder.id));
    const scheduleCall = fetchMock.calls.find(c => c.url === '/api/push/schedule-reminder');
    check('8. createReminderForTarget() intenta programar el push (POST /api/push/schedule-reminder)', !!scheduleCall && scheduleCall.method === 'POST');
    check('9. el reminderId enviado es EXACTAMENTE el id del reminder local', scheduleCall.body.reminderId === reminder.id);
    check('9b. remindAt enviado coincide con el del reminder local', scheduleCall.body.remindAt === reminder.remindAt);
    check('9c. title/body reconstruidos de forma segura a partir del target actual', scheduleCall.body.title === 'ORGANIZATOR' && scheduleCall.body.body === 'Evento: Reunión de equipo');
  }

  // =====================================================================
  section('7-bis) createReminderForTarget(): el reminder local sobrevive aunque el backend falle');
  // =====================================================================
  {
    for (const fetchBehavior of [{ schedule: 'network-fail' }, { schedule: 'http-error' }]) {
      const { sandbox } = makePageSandbox({ fetchBehavior });
      await sandbox.addTask({ id: 't1', title: 'Entregar informe', dueDate: '2026-09-20', dueTime: '18:00' });
      let threw = false;
      const reminder = await (async () => { try { return await sandbox.createReminderForTarget('task', 't1', '2026-09-20T18:00:00', 10); } catch (e) { threw = true; return null; } })();
      check(`7c. backend con "${fetchBehavior.schedule}" — createReminderForTarget() no lanza`, !threw);
      check(`7d. backend con "${fetchBehavior.schedule}" — el reminder local se crea igualmente (pending)`, !!reminder && reminder.status === 'pending');
      check(`7e. backend con "${fetchBehavior.schedule}" — el reminder sigue en state.reminders`, sandbox.state.reminders.some(r => r.id === reminder.id));
    }
  }

  // =====================================================================
  section('10) syncReminderForTarget(): reprograma el MISMO reminderId al cambiar remindAt');
  // =====================================================================
  {
    const { sandbox, fetchMock } = makePageSandbox();
    await sandbox.addEvent({ id: 'e2', title: 'Cita médica', date: '2026-09-25', startTime: '10:00' });
    const first = await sandbox.syncReminderForTarget('event', 'e2', '2026-09-25T10:00:00', 15);
    const second = await sandbox.syncReminderForTarget('event', 'e2', '2026-09-25T10:00:00', 30); // el usuario cambia la anticipación
    check('10a. sigue siendo el MISMO reminder local (mismo id, sin duplicar)', first.id === second.id);
    const scheduleCalls = fetchMock.calls.filter(c => c.url === '/api/push/schedule-reminder');
    check('10b. se llama dos veces a schedule-reminder (creación + reprogramación)', scheduleCalls.length === 2);
    check('10c. AMBAS llamadas usan el mismo reminderId (nunca un segundo reminder server-side)', scheduleCalls[0].body.reminderId === first.id && scheduleCalls[1].body.reminderId === second.id);
    check('10d. la segunda llamada lleva el remindAt actualizado', scheduleCalls[1].body.remindAt === second.remindAt && scheduleCalls[1].body.remindAt !== scheduleCalls[0].body.remindAt);
  }

  // =====================================================================
  section('11-12) cancelReminder(): intenta cancelar server-side, best-effort');
  // =====================================================================
  {
    const { sandbox, fetchMock } = makePageSandbox();
    await sandbox.addTask({ id: 't2', title: 'Pagar factura', dueDate: '2026-09-20', dueTime: '09:00' });
    const reminder = await sandbox.createReminderForTarget('task', 't2', '2026-09-20T09:00:00', 5);
    const cancelled = await sandbox.cancelReminder(reminder.id);
    check('11a. cancelReminder() sigue devolviendo el reminder cancelado localmente', cancelled.status === 'cancelled');
    const cancelCall = fetchMock.calls.find(c => c.url === '/api/push/cancel-reminder');
    check('11b. intenta cancelar server-side (POST /api/push/cancel-reminder)', !!cancelCall && cancelCall.method === 'POST');
    check('11c. envía el mismo reminderId', cancelCall.body.reminderId === reminder.id);

    // Fallo de cancelación server-side: el estado local NO se ve afectado.
    for (const fetchBehavior of [{ cancel: 'network-fail' }, { cancel: 'http-error' }]) {
      const sb2 = makePageSandbox({ fetchBehavior });
      await sb2.sandbox.addTask({ id: 't3', title: 'Otra tarea', dueDate: '2026-09-20', dueTime: '09:00' });
      const r2 = await sb2.sandbox.createReminderForTarget('task', 't3', '2026-09-20T09:00:00', 5);
      let threw = false;
      let result2;
      try { result2 = await sb2.sandbox.cancelReminder(r2.id); } catch (e) { threw = true; }
      check(`12a. fallo de cancelación ("${fetchBehavior.cancel}") no lanza`, !threw);
      check(`12b. fallo de cancelación ("${fetchBehavior.cancel}") — el reminder local queda cancelled igualmente`, result2 && result2.status === 'cancelled');
    }
  }

  // =====================================================================
  section('13) Borrar tarea/evento conserva la cancelación local y respeta la cascada existente');
  // =====================================================================
  {
    const { sandbox, fetchMock } = makePageSandbox();
    await sandbox.addEvent({ id: 'e3', title: 'Evento a borrar', date: '2026-09-22', startTime: '12:00' });
    const reminder = await sandbox.createReminderForTarget('event', 'e3', '2026-09-22T12:00:00', 10);
    await sandbox.deleteEvent('e3');
    check('13a. borrar el evento cancela su reminder local (cascada existente, sin cambiarla)', sandbox.getReminderById(reminder.id).status === 'cancelled');
    check('13b. la cascada también intenta cancelar el equivalente server-side (vía cancelReminder, sin duplicar lógica)', fetchMock.calls.some(c => c.url === '/api/push/cancel-reminder' && c.body.reminderId === reminder.id));
    check('13c. no se crea ningún reminder nuevo al borrar', sandbox.getRemindersForTarget('event', 'e3').length === 1);

    // Mismo criterio para deleteTask (usa cancelRemindersForTaskAndOccurrences).
    const { sandbox: sb2, fetchMock: fm2 } = makePageSandbox();
    await sb2.addTask({ id: 't4', title: 'Tarea a borrar', dueDate: '2026-09-22', dueTime: '09:00' });
    const rt = await sb2.createReminderForTarget('task', 't4', '2026-09-22T09:00:00', 5);
    await sb2.deleteTask('t4');
    check('13d. borrar la tarea cancela su reminder local', sb2.getReminderById(rt.id).status === 'cancelled');
    check('13e. y también intenta cancelarlo server-side', fm2.calls.some(c => c.url === '/api/push/cancel-reminder' && c.body.reminderId === rt.id));
  }

  // =====================================================================
  section('14) Reminders de ocurrencias recurrentes: mantienen su targetId compuesto, y el backend recibe el reminderId (no el targetId)');
  // =====================================================================
  {
    const { sandbox, fetchMock } = makePageSandbox();
    await sandbox.addTask({
      id: 'trec', title: 'Ducharse', dueDate: '2026-09-18', dueTime: '07:30',
      recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null },
    });
    const occDate = '2026-09-21';
    const reminder = await sandbox.syncReminderForTaskOccurrence('trec', occDate, 15);
    const expectedTargetId = sandbox.getTaskOccurrenceId('trec', occDate);
    check('14a. el targetId local sigue siendo el compuesto "taskId::fecha" (R-7, sin tocar)', reminder.targetId === expectedTargetId && expectedTargetId.includes('::'));
    const scheduleCall = fetchMock.calls.find(c => c.url === '/api/push/schedule-reminder');
    check('14b. el backend recibe el reminderId real del reminder (uid), NO el targetId compuesto', scheduleCall.body.reminderId === reminder.id && scheduleCall.body.reminderId !== reminder.targetId);

    await sandbox.cancelReminderForTaskOccurrence('trec', occDate);
    const cancelCall = fetchMock.calls.find(c => c.url === '/api/push/cancel-reminder');
    check('14c. cancelar la ocurrencia también cancela su equivalente server-side con el mismo reminderId', !!cancelCall && cancelCall.body.reminderId === reminder.id);
    check('14d. no se introdujo una segunda convención de ids (sigue siendo uid() normal)', typeof reminder.id === 'string' && !reminder.id.includes('::'));
  }

  // =====================================================================
  section('15-16) Nunca se envían tasks/events completos ni claves privadas');
  // =====================================================================
  {
    const { sandbox, fetchMock } = makePageSandbox();
    await sandbox.addEvent({ id: 'e4', title: 'Evento con datos', date: '2026-09-23', startTime: '11:00', notes: 'información privada del evento', location: 'Oficina' });
    const reminder = await sandbox.createReminderForTarget('event', 'e4', '2026-09-23T11:00:00', 10);
    await sandbox.cancelReminder(reminder.id);
    const scheduleCall = fetchMock.calls.find(c => c.url === '/api/push/schedule-reminder');
    const cancelCall = fetchMock.calls.find(c => c.url === '/api/push/cancel-reminder');
    check('15a. el payload de schedule-reminder SOLO tiene reminderId/remindAt/title/body', Object.keys(scheduleCall.body).sort().join(',') === 'body,remindAt,reminderId,title');
    check('15b. el payload de cancel-reminder SOLO tiene reminderId', Object.keys(cancelCall.body).sort().join(',') === 'reminderId');
    check('15c. ningún campo del evento (notes/location/id) viaja fuera de esos 4 campos', !JSON.stringify(scheduleCall.body).includes('información privada') && !JSON.stringify(scheduleCall.body).includes('Oficina'));

    await sandbox.subscribeToPushNotifications();
    const subscribeCall = fetchMock.calls.find(c => c.url === '/api/push/subscribe');
    check('16a. el payload de subscribe SOLO tiene endpoint/keys (p256dh/auth públicos)', Object.keys(subscribeCall.body).sort().join(',') === 'endpoint,keys' && Object.keys(subscribeCall.body.keys).sort().join(',') === 'auth,p256dh');
    check('16b. no aparece ninguna "private key" en ningún body enviado', !fetchMock.calls.some(c => JSON.stringify(c.body || {}).toLowerCase().includes('private')));
    check('16c. no hay ninguna clave privada de push embebida en organizator.html (fuente real)', !/private[_-]?key/i.test(html));
  }

  // =====================================================================
  section('17) No se duplican suscripciones innecesariamente');
  // =====================================================================
  {
    const { sandbox, pushManagerMock } = makePageSandbox();
    await sandbox.subscribeToPushNotifications();
    await sandbox.subscribeToPushNotifications();
    await sandbox.subscribeToPushNotifications();
    check('17. tres llamadas seguidas solo crean UNA suscripción real (las siguientes reutilizan)', pushManagerMock._subscribeCalls.length === 1);
  }

  // =====================================================================
  section('18) Comportamiento offline: nada de esto bloquea crear/editar/cancelar el reminder local');
  // =====================================================================
  {
    const fetchBehavior = { vapid: 'network-fail', subscribe: 'network-fail', schedule: 'network-fail', cancel: 'network-fail' };
    const { sandbox } = makePageSandbox({ fetchBehavior });
    await sandbox.addEvent({ id: 'e5', title: 'Evento offline', date: '2026-09-24', startTime: '09:00' });
    let threw = false;
    const reminder = await (async () => { try { return await sandbox.createReminderForTarget('event', 'e5', '2026-09-24T09:00:00', 15); } catch (e) { threw = true; return null; } })();
    check('18a. crear un reminder offline no lanza', !threw);
    check('18b. el reminder se crea localmente igualmente', !!reminder && reminder.status === 'pending');
    const synced = await sandbox.syncReminderForTarget('event', 'e5', '2026-09-24T09:00:00', 30);
    check('18c. reprogramar offline no lanza y actualiza el reminder local', synced.id === reminder.id);
    const cancelled = await sandbox.cancelReminder(reminder.id);
    check('18d. cancelar offline no lanza y el reminder local queda cancelled', cancelled.status === 'cancelled');
    const subResult = await sandbox.subscribeToPushNotifications();
    check('18e. suscribirse offline no lanza (resuelve ok:false)', subResult.ok === false);
  }

  // =====================================================================
  section('19) Errores HTTP (los endpoints responden pero con error) no rompen el flujo local');
  // =====================================================================
  {
    const fetchBehavior = { vapid: 'http-error', subscribe: 'http-error', schedule: 'http-error', cancel: 'http-error' };
    const { sandbox } = makePageSandbox({ fetchBehavior });
    await sandbox.addTask({ id: 't5', title: 'Tarea con error HTTP', dueDate: '2026-09-24', dueTime: '09:00' });
    const reminder = await sandbox.createReminderForTarget('task', 't5', '2026-09-24T09:00:00', 10);
    check('19a. HTTP 500 al programar no impide crear el reminder local', !!reminder && reminder.status === 'pending');
    const cancelled = await sandbox.cancelReminder(reminder.id);
    check('19b. HTTP 500 al cancelar no impide cancelar el reminder local', cancelled.status === 'cancelled');
    const subResult = await sandbox.subscribeToPushNotifications();
    check('19c. HTTP 500 al pedir la clave pública resuelve ok:false sin lanzar', subResult.ok === false);
  }

  // =====================================================================
  section('20) Regresión: el motor de reminders existente (Fases 1-5, R-7) sigue exactamente igual');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox();
    await sandbox.addEvent({ id: 'e6', title: 'Evento regresión', date: '2026-09-20', startTime: '19:59' });
    const reminder = await sandbox.syncReminderForTarget('event', 'e6', '2026-09-20T19:59:00', 0);
    check('20a. nace en pending (sin cambios de modelo)', reminder.status === 'pending');
    const triggered = await sandbox.triggerDueReminders(NOW);
    check('20b. triggerDueReminders() sigue detectando y disparando el vencido', triggered.length === 1 && triggered[0].id === reminder.id);
    check('20c. el reminder queda "triggered" en state (mismos 3 estados: pending/triggered/cancelled)', sandbox.getReminderById(reminder.id).status === 'triggered');
    check('20d. el id del reminder no cambió en ningún momento del ciclo', reminder.id === triggered[0].id);

    // No duplicados: cambiar la anticipación reutiliza el mismo reminder.
    await sandbox.addEvent({ id: 'e7', title: 'Sin duplicar', date: '2026-09-25', startTime: '10:00' });
    const first = await sandbox.syncReminderForTarget('event', 'e7', '2026-09-25T10:00:00', 15);
    const second = await sandbox.syncReminderForTarget('event', 'e7', '2026-09-25T10:00:00', 30);
    check('20e. sigue sin duplicar reminders por target', first.id === second.id && sandbox.getRemindersForTarget('event', 'e7').length === 1);
  }

  // =====================================================================
  section('node --check de organizator.html (código extraído de esta suite) y del <script> principal');
  // =====================================================================
  {
    const combined = [dateUtilsSrc, weekHelpersSrc, recurrenceSrc, crudSrc, remindersSrc].join('\n\n');
    const tmpPath = path.join(__dirname, `.organizator-r8-2-b-check-${process.pid}.tmp.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('C1. node --check del código extraído (recurrencia + CRUD + recordatorios + Web Push) pasa', true);
    } catch (e) {
      check('C1. node --check del código extraído (recurrencia + CRUD + recordatorios + Web Push) pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }

    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath2 = path.join(__dirname, `.organizator-r8-2-b-full-check-${process.pid}.tmp.js`);
    fs.writeFileSync(tmpPath2, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath2], { stdio: 'pipe' });
      check('C2. node --check del <script> principal de organizator.html pasa', true);
    } catch (e) {
      check('C2. node --check del <script> principal de organizator.html pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath2);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
