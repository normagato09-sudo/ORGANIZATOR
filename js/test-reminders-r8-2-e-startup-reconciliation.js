/**
 * ORGANIZATOR — Tests de R-8.2-E (reconciliación silenciosa de la
 * suscripción Web Push al arrancar la app)
 *
 * Suite Node pura, SIN navegador ni jsdom, SIN red real: `fetch`,
 * `navigator.serviceWorker`/`PushManager` y `Notification` se sustituyen
 * por mocks en memoria, cargados en un sandbox de `vm` junto con el
 * código REAL extraído de organizator.html (nunca una reimplementación) —
 * mismo patrón que test-reminders-r8-2-b-integration.js y
 * test-reminders-r8-closed-app.js.
 *
 * CONTEXTO (diagnóstico R-8.2, 3ª prueba real): el usuario ya había
 * concedido el permiso de notificaciones y el navegador ya tenía una
 * PushSubscription activa, pero el POST /api/push/subscribe de aquel
 * momento falló en el servidor (las tablas de Web Push aún no
 * existían) y nunca se reintentó. Resultado: push_subscriptions se
 * quedó vacía, y send-due.js nunca llegaba a intentar web-push. Esta
 * suite cubre reconcilePushSubscriptionOnStartup(), el helper que
 * arregla ese caso reintentando el registro en segundo plano al
 * arrancar, SIN pedir permiso y SIN duplicar la lógica de
 * subscribeToPushNotifications() (Fase R-8.2-B, ya cubierta en detalle
 * por su propia suite — aquí solo se prueba CUÁNDO se decide llamarla).
 *
 * Uso:  node js/test-reminders-r8-2-e-startup-reconciliation.js
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
// Mismos fragmentos reales que ya usa test-reminders-r8-2-b-integration.js.
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
// Incluye Fases 1-5, R-7, Web Push R-8.2-B (subscribeToPushNotifications)
// y R-8.2-E (reconcilePushSubscriptionOnStartup, justo después de esa).
const remindersSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fases 1-5 + R-7 + Web Push R-8.2-B/E) + CATEGORÍAS DE EVENTOS + RECURRENCIA vistas (R-6)'
);
// startApp()/init(): para las comprobaciones estructurales de "cuándo
// se dispara la reconciliación" (mismo criterio que
// test-reminders-r8-2-b-integration.js y test-reminders-r8-closed-app.js).
const startAppSrc = extractBetween(html, 'async function startApp(){', '\n(async function init(){', 'startApp()');
const initSrc = extractBetween(html, '(async function init(){', '\n})();', 'init()');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

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

/** Mock de `fetch` para los endpoints /api/push/* que llama el cliente.
 * Registra cada llamada (url, method, body ya parseado) en `.calls`. */
function makeFetchMock(behavior = {}) {
  const calls = [];
  const defaults = { vapid: 'ok', subscribe: 'ok' };
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
    return { ok: false, status: 404, json: async () => ({ error: 'ruta no mockeada: ' + url }) };
  }
  fetchMock.calls = calls;
  return fetchMock;
}

/** Sandbox completo: código real de organizator.html sobre mocks en
 * memoria de Notification/PushManager/fetch/navigator.serviceWorker.
 * Cualquier opción omitida simula que esa API NO existe en el
 * navegador (mismo criterio que "sin soporte" en el resto de la
 * suite). `notificationOpts: null` simula que Notification no existe
 * en absoluto; `notificationOpts: undefined` (por defecto) NO instala
 * ninguna Notification — hay que pasar explícitamente el permiso
 * deseado en cada test para no depender de un valor por defecto. */
function makePageSandbox({
  notificationOpts = { permission: 'default' },
  hasServiceWorker = true,
  hasPushManagerGlobal = true,
  serviceWorkerReadyFails = false,
  pushManagerOpts = {},
  fetchBehavior = {},
} = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.isSecureContext = true;
  sandbox.atob = (str) => Buffer.from(str, 'base64').toString('binary');
  if (hasPushManagerGlobal) sandbox.PushManager = function PushManager() {};
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
     function renderCurrentView(){ /* no-op: fuera de alcance */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = {
    _map: new Map(),
    async get(key) { return this._map.has(key) ? { key, value: this._map.get(key), shared: false } : null; },
    async set(key, value) { this._map.set(key, value); return { key, value, shared: false }; },
  };
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(remindersSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fases 1-5 + R-7 + Web Push R-8.2-B/E)' });
  vm.runInContext(
    `this.addEvent = addEvent; this.addTask = addTask;
     this.subscribeToPushNotifications = subscribeToPushNotifications;
     this.reconcilePushSubscriptionOnStartup = reconcilePushSubscriptionOnStartup;
     this.state = state;`,
    sandbox, { filename: 'expose-r8-2-e' }
  );
  return { sandbox, fetchMock, pushManagerMock };
}

(async () => {
  // =====================================================================
  section('0) Localización de los puntos relevantes en organizator.html');
  // =====================================================================
  {
    check('0a. reconcilePushSubscriptionOnStartup() existe y reutiliza subscribeToPushNotifications() (sin reimplementar la suscripción)', /async function reconcilePushSubscriptionOnStartup\(\)\{[\s\S]*?await subscribeToPushNotifications\(\)/.test(remindersSrc));
    check('0b. reconcilePushSubscriptionOnStartup() nunca llama a Notification.requestPermission ni a requestReminderNotificationPermission', (() => {
      const m = remindersSrc.match(/async function reconcilePushSubscriptionOnStartup\(\)\{[\s\S]*?\n\}/);
      return !!m && !/requestPermission/.test(m[0]);
    })());
    check('0c. startApp() llama a reconcilePushSubscriptionOnStartup()', /reconcilePushSubscriptionOnStartup\(\)/.test(startAppSrc));
    check('0d. startApp() la llama SIN await (fire-and-forget, nunca bloquea el arranque)', !/await\s+reconcilePushSubscriptionOnStartup/.test(startAppSrc));
    check('0e. init() no la llama por su cuenta (pasa siempre por startApp(), sin duplicar el punto de entrada)', !/reconcilePushSubscriptionOnStartup/.test(initSrc));
  }

  // =====================================================================
  section('1) permiso granted + PushSubscription local existente → registra esa suscripción en el backend');
  // =====================================================================
  {
    const existing = { endpoint: 'https://push.example.com/ya-existia-startup', keys: { p256dh: 'p1', auth: 'a1' }, toJSON() { return { endpoint: this.endpoint, keys: this.keys }; } };
    const { sandbox, fetchMock, pushManagerMock } = makePageSandbox({
      notificationOpts: { permission: 'granted' },
      pushManagerOpts: { existingSubscription: existing },
    });
    await sandbox.reconcilePushSubscriptionOnStartup();
    check('1a. llama a POST /api/push/subscribe con la suscripción existente', fetchMock.calls.some(c => c.url === '/api/push/subscribe' && c.method === 'POST' && c.body.endpoint === existing.endpoint));
    check('1b. NUNCA llama a pushManager.subscribe() (ya había una suscripción local — no crea una segunda)', pushManagerMock._subscribeCalls.length === 0);
  }

  // =====================================================================
  section('2) permiso granted + SIN suscripción local → usa la ruta existente (pushManager.subscribe) para crearla');
  // =====================================================================
  {
    const { sandbox, fetchMock, pushManagerMock } = makePageSandbox({ notificationOpts: { permission: 'granted' } });
    await sandbox.reconcilePushSubscriptionOnStartup();
    check('2a. crea la suscripción del navegador vía pushManager.subscribe() exactamente una vez', pushManagerMock._subscribeCalls.length === 1);
    check('2b. y la registra en el backend (POST /api/push/subscribe)', fetchMock.calls.some(c => c.url === '/api/push/subscribe' && c.method === 'POST' && c.body.endpoint === pushManagerMock._current().endpoint));
  }

  // =====================================================================
  section('3) permiso default → no intenta suscribirse silenciosamente');
  // =====================================================================
  {
    const { sandbox, fetchMock, pushManagerMock } = makePageSandbox({ notificationOpts: { permission: 'default' } });
    await sandbox.reconcilePushSubscriptionOnStartup();
    check('3a. no llama a ningún endpoint /api/push/*', fetchMock.calls.length === 0);
    check('3b. no llama a pushManager.subscribe()', pushManagerMock._subscribeCalls.length === 0);
    check('3c. Notification.requestPermission() NUNCA se llama (la reconciliación no pide permiso)', sandbox.Notification.requestPermissionCalls === 0);
  }

  // =====================================================================
  section('4) permiso denied → no intenta suscribirse');
  // =====================================================================
  {
    const { sandbox, fetchMock, pushManagerMock } = makePageSandbox({ notificationOpts: { permission: 'denied' } });
    await sandbox.reconcilePushSubscriptionOnStartup();
    check('4a. no llama a ningún endpoint /api/push/*', fetchMock.calls.length === 0);
    check('4b. no llama a pushManager.subscribe()', pushManagerMock._subscribeCalls.length === 0);
    check('4c. Notification.requestPermission() NUNCA se llama', sandbox.Notification.requestPermissionCalls === 0);
  }

  // =====================================================================
  section('5) navegador sin Notification/ServiceWorker/PushManager → nunca intenta nada, nunca lanza');
  // =====================================================================
  {
    const cases = [
      { label: 'sin Notification', opts: { notificationOpts: null } },
      { label: 'sin navigator.serviceWorker', opts: { notificationOpts: { permission: 'granted' }, hasServiceWorker: false } },
      { label: 'sin PushManager global', opts: { notificationOpts: { permission: 'granted' }, hasPushManagerGlobal: false } },
    ];
    for (const c of cases) {
      const { sandbox, fetchMock } = makePageSandbox(c.opts);
      let threw = false;
      try { await sandbox.reconcilePushSubscriptionOnStartup(); } catch (e) { threw = true; }
      check(`5. "${c.label}" no lanza y no llama a ningún endpoint de push`, !threw && fetchMock.calls.length === 0);
    }
  }

  // =====================================================================
  section('6) Fallo de reconciliación (red caída / HTTP 500 / Service Worker nunca listo) — nunca bloquea ni lanza');
  // =====================================================================
  {
    const cases = [
      { label: 'red caída en /api/push/subscribe', opts: { notificationOpts: { permission: 'granted' }, fetchBehavior: { subscribe: 'network-fail' } } },
      { label: 'HTTP 500 en /api/push/subscribe', opts: { notificationOpts: { permission: 'granted' }, fetchBehavior: { subscribe: 'http-error' } } },
      { label: 'HTTP 500 pidiendo la clave pública', opts: { notificationOpts: { permission: 'granted' }, fetchBehavior: { vapid: 'http-error' } } },
      { label: 'Service Worker nunca queda listo', opts: { notificationOpts: { permission: 'granted' }, serviceWorkerReadyFails: true } },
      { label: 'pushManager.subscribe() lanza', opts: { notificationOpts: { permission: 'granted' }, pushManagerOpts: { subscribeShouldThrow: true } } },
    ];
    for (const c of cases) {
      const { sandbox } = makePageSandbox(c.opts);
      let threw = false, result;
      try { result = await sandbox.reconcilePushSubscriptionOnStartup(); } catch (e) { threw = true; }
      check(`6. "${c.label}" — reconcilePushSubscriptionOnStartup() no lanza (best-effort)`, !threw);
      check(`6b. "${c.label}" — no devuelve un error visible (resuelve undefined, nada que mostrar al usuario)`, result === undefined);
    }
  }

  // =====================================================================
  section('7) No crea una segunda suscripción local innecesariamente (llamadas repetidas al arrancar)');
  // =====================================================================
  {
    const { sandbox, pushManagerMock } = makePageSandbox({ notificationOpts: { permission: 'granted' } });
    await sandbox.reconcilePushSubscriptionOnStartup();
    await sandbox.reconcilePushSubscriptionOnStartup();
    await sandbox.reconcilePushSubscriptionOnStartup();
    check('7. tres reconciliaciones seguidas solo crean UNA suscripción real de navegador', pushManagerMock._subscribeCalls.length === 1);
  }

  // =====================================================================
  section('8) No altera los reminders locales existentes');
  // =====================================================================
  {
    const { sandbox } = makePageSandbox({ notificationOpts: { permission: 'granted' } });
    await sandbox.addEvent({ id: 'ev1', title: 'Evento sin tocar', date: '2026-09-25', startTime: '10:00' });
    const before = JSON.stringify(sandbox.state.reminders);
    const beforeTasks = JSON.stringify(sandbox.state.tasks);
    const beforeEvents = JSON.stringify(sandbox.state.events);
    await sandbox.reconcilePushSubscriptionOnStartup();
    check('8a. state.reminders no cambia', JSON.stringify(sandbox.state.reminders) === before);
    check('8b. state.tasks no cambia', JSON.stringify(sandbox.state.tasks) === beforeTasks);
    check('8c. state.events no cambia', JSON.stringify(sandbox.state.events) === beforeEvents);
  }

  // =====================================================================
  section('node --check de organizator.html (código extraído de esta suite) y del <script> principal');
  // =====================================================================
  {
    const combined = [dateUtilsSrc, weekHelpersSrc, recurrenceSrc, crudSrc, remindersSrc].join('\n\n');
    const tmpPath = path.join(__dirname, `.organizator-r8-2-e-check-${process.pid}.tmp.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('C1. node --check del código extraído (recurrencia + CRUD + recordatorios + Web Push R-8.2-B/E) pasa', true);
    } catch (e) {
      check('C1. node --check del código extraído (recurrencia + CRUD + recordatorios + Web Push R-8.2-B/E) pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }

    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath2 = path.join(__dirname, `.organizator-r8-2-e-full-check-${process.pid}.tmp.js`);
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
