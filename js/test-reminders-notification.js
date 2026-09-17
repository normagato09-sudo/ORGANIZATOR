/**
 * ORGANIZATOR — Tests de la Fase 5 de Recordatorios (notificación real del
 * navegador, sobre el motor de disparo de la Fase 4)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html uid(), saveTasks()/saveEvents()/saveReminders(), el
 * bloque CRUD (addTask/addEvent, para poder dar título real a los targets
 * de los tests H/I/L), el bloque RECORDATORIOS de la Fase 1, el de la Fase
 * 4 (getDueReminders/triggerDueReminders) y el nuevo bloque de la Fase 5
 * (requestReminderNotificationPermission/showReminderNotification/
 * reminderNotificationBody), y los ejecuta en un sandbox con un
 * window.storage en memoria y un mock de `Notification` — mismo patrón que
 * el resto de la suite de recordatorios (test-reminders-model.js,
 * test-reminders-calculate.js, test-reminders-ui.js, test-reminders-trigger.js).
 *
 * Uso:  node js/test-reminders-notification.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// organizator.html se guarda con CRLF en este checkout; se normaliza a LF
// SOLO para esta lectura en memoria (no se toca el archivo en disco).
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Fragmentos reales de organizator.html.
// ---------------------------------------------------------------------
const uidSrc = extractBetween(
  html,
  'function uid(){',
  '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS',
  'función uid()'
);
const saveTasksSrc = extractBetween(html, 'async function saveTasks(){', '\nasync function saveEvents(){', 'función saveTasks()');
const saveEventsSrc = extractBetween(html, 'async function saveEvents(){', '\nasync function saveCustomSchedules(){', 'función saveEvents()');
const saveRemindersSrc = extractBetween(html, 'async function saveReminders(){', '\nasync function savePrefs(){', 'función saveReminders()');
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  'bloque CRUD'
);
const remindersFase1Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  'bloque RECORDATORIOS (Fase 1)'
);
const remindersFase4Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — motor de detección y disparo lógico (Fase 4)',
  '\n\n/* ==================================================================\n   RECORDATORIOS — notificación real del navegador (Fase 5)',
  'bloque RECORDATORIOS (Fase 4, motor de disparo)'
);
const remindersFase5Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — notificación real del navegador (Fase 5)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fase 5, notificación real)'
);

// ---------------- Utilidades de test ----------------
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
    async get(key) {
      if (!map.has(key)) return null;
      return { key, value: map.get(key), shared: false };
    },
    async set(key, value) {
      map.set(key, value);
      return { key, value, shared: false };
    },
  };
}

/** Mock mínimo de la Notification API del navegador.
 *  - permission: valor inicial de Notification.permission ('default' |
 *    'granted' | 'denied').
 *  - onRequestPermission: función que decide a qué valor pasa el permiso
 *    cuando se llama a requestPermission() (simula la elección del
 *    usuario en el diálogo real). Si no se da, requestPermission()
 *    resuelve al valor actual sin cambiarlo.
 *  - throwOnConstruct: si es true, `new Notification(...)` lanza (simula
 *    un fallo real al crear la notificación).
 * Expone MockNotification.created (array de instancias creadas) y
 * MockNotification.requestPermissionCalls (nº de veces que se llamó a
 * requestPermission()), para poder comprobar comportamiento sin acoplarse
 * a implementación interna. */
function makeNotificationMock({ permission = 'default', onRequestPermission = null, throwOnConstruct = false } = {}) {
  const created = [];
  class MockNotification {
    constructor(title, options) {
      if (throwOnConstruct) throw new Error('boom: fallo simulado al crear la notificación');
      this.title = title;
      this.options = options || {};
      created.push(this);
    }
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

/** Crea un sandbox con state.{tasks,events,reminders} vacíos y, si se
 * pasa `notificationOpts`, instala un mock de Notification (si se omite,
 * Notification queda sin definir, simulando un navegador/entorno sin
 * soporte). Devuelve { sandbox helpers..., Notification }. */
function makeSandbox(notificationOpts) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  if (notificationOpts !== undefined) {
    sandbox.Notification = makeNotificationMock(notificationOpts);
  }
  vm.runInContext(uidSrc, sandbox, { filename: 'organizator.html (uid)' });
  vm.runInContext('let state = { tasks: [], events: [], reminders: [] };', sandbox, { filename: 'state-setup' });
  sandbox.storage = makeStorage();
  vm.runInContext('function showToast(){}', sandbox, { filename: 'stub-showToast' });
  vm.runInContext(saveTasksSrc, sandbox, { filename: 'organizator.html (saveTasks)' });
  vm.runInContext(saveEventsSrc, sandbox, { filename: 'organizator.html (saveEvents)' });
  vm.runInContext(saveRemindersSrc, sandbox, { filename: 'organizator.html (saveReminders)' });
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase4Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 4)' });
  vm.runInContext(remindersFase5Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 5)' });
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(
    `this.addTask = addTask; this.addEvent = addEvent;
     this.addReminder = addReminder; this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget; this.updateReminder = updateReminder;
     this.getDueReminders = getDueReminders; this.triggerDueReminders = triggerDueReminders;
     this.requestReminderNotificationPermission = requestReminderNotificationPermission;
     this.showReminderNotification = showReminderNotification;
     this.reminderNotificationBody = reminderNotificationBody;
     this.state = state;`,
    sandbox, { filename: 'expose-reminders-notification' }
  );
  return { sandbox, Notification: sandbox.Notification };
}

/** Inserta un reminder directamente en state.reminders (mismo helper que
 * ya usa test-reminders-trigger.js), para fijar remindAt/status a mano y
 * construir escenarios "vencido" de forma determinista. */
function seedReminder(sb, { id, targetType, targetId, remindAt, status, createdAt }) {
  const r = { id, targetType, targetId, remindAt, status, createdAt: createdAt || Date.now() };
  sb.state.reminders.push(r);
  return r;
}

(async () => {
  const NOW = new Date('2026-09-20T20:00:00.000Z');

  // =====================================================================
  section('A) Notification API inexistente → ninguna llamada lanza error');
  // =====================================================================
  {
    const { sandbox } = makeSandbox(undefined); // sin Notification en absoluto
    let threw = false;
    let permResult, showResult;
    try {
      permResult = await sandbox.requestReminderNotificationPermission();
      showResult = sandbox.showReminderNotification({ id: 'r1', targetType: 'event', targetId: 'e1', remindAt: NOW.toISOString(), status: 'triggered' });
    } catch (e) { threw = true; }
    check('A. ninguna llamada lanza excepción cuando Notification no existe', !threw);
    check('A. requestReminderNotificationPermission() devuelve false', permResult === false);
    check('A. showReminderNotification() devuelve null', showResult === null);
  }

  // =====================================================================
  section('B) permiso "granted" → requestReminderNotificationPermission() devuelve true');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'granted' });
    const result = await sandbox.requestReminderNotificationPermission();
    check('B. devuelve true cuando el permiso ya está "granted"', result === true);
    check('B. no hizo falta llamar a requestPermission() (ya estaba concedido)', Notification.requestPermissionCalls === 0);
  }

  // =====================================================================
  section('C) permiso "denied" → devuelve false SIN solicitar permiso');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'denied' });
    const result = await sandbox.requestReminderNotificationPermission();
    check('C. devuelve false cuando el permiso está "denied"', result === false);
    check('C. NO llama a requestPermission() (ya está denegado, no tiene sentido volver a preguntar)', Notification.requestPermissionCalls === 0);
  }

  // =====================================================================
  section('D) permiso "default" + el usuario concede → devuelve true');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'default', onRequestPermission: () => 'granted' });
    const result = await sandbox.requestReminderNotificationPermission();
    check('D. devuelve true cuando el usuario concede el permiso', result === true);
    check('D. sí llamó a requestPermission() (permiso estaba "default")', Notification.requestPermissionCalls === 1);
  }

  // =====================================================================
  section('E) permiso "default" + el usuario rechaza → devuelve false');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'default', onRequestPermission: () => 'denied' });
    const result = await sandbox.requestReminderNotificationPermission();
    check('E. devuelve false cuando el usuario rechaza el permiso', result === false);
    check('E. sí llamó a requestPermission()', Notification.requestPermissionCalls === 1);
  }

  // =====================================================================
  section('F) showReminderNotification() con Notification API inexistente → null');
  // =====================================================================
  {
    const { sandbox } = makeSandbox(undefined);
    const result = sandbox.showReminderNotification({ id: 'r2', targetType: 'task', targetId: 't1', remindAt: NOW.toISOString(), status: 'triggered' });
    check('F. devuelve null sin lanzar', result === null);
  }

  // =====================================================================
  section('G) permiso NO concedido → showReminderNotification() devuelve null');
  // =====================================================================
  {
    const { sandbox: sbDenied } = makeSandbox({ permission: 'denied' });
    check('G. con permiso "denied" devuelve null', sbDenied.showReminderNotification({ id: 'r3', targetType: 'event', targetId: 'e2', remindAt: NOW.toISOString(), status: 'triggered' }) === null);

    const { sandbox: sbDefault } = makeSandbox({ permission: 'default' });
    check('G. con permiso "default" (no concedido todavía) también devuelve null', sbDefault.showReminderNotification({ id: 'r4', targetType: 'event', targetId: 'e3', remindAt: NOW.toISOString(), status: 'triggered' }) === null);
  }

  // =====================================================================
  section('H) reminder de tipo "event" → notificación con información del evento');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'granted' });
    await sandbox.addEvent({ id: 'evH', title: 'Reunión de equipo', date: '2026-09-20', allDay: false, startTime: '20:00' });
    const reminder = { id: 'rH', targetType: 'event', targetId: 'evH', remindAt: NOW.toISOString(), status: 'triggered' };
    const notif = sandbox.showReminderNotification(reminder);
    check('H. se crea una notificación (no null)', !!notif);
    check('H. título de la notificación es "ORGANIZATOR"', notif.title === 'ORGANIZATOR');
    check('H. el cuerpo identifica que es un evento', /Evento/.test(notif.options.body));
    check('H. el cuerpo incluye el título real del evento', notif.options.body.includes('Reunión de equipo'));
    check('H. queda registrada en Notification.created', Notification.created.includes(notif));
  }

  // =====================================================================
  section('I) reminder de tipo "task" → notificación con información de la tarea');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'granted' });
    await sandbox.addTask({ id: 'tkI', title: 'Entregar informe', dueDate: '2026-09-20', dueTime: '20:00' });
    const reminder = { id: 'rI', targetType: 'task', targetId: 'tkI', remindAt: NOW.toISOString(), status: 'triggered' };
    const notif = sandbox.showReminderNotification(reminder);
    check('I. se crea una notificación (no null)', !!notif);
    check('I. título de la notificación es "ORGANIZATOR"', notif.title === 'ORGANIZATOR');
    check('I. el cuerpo identifica que es una tarea', /Tarea/.test(notif.options.body));
    check('I. el cuerpo incluye el título real de la tarea', notif.options.body.includes('Entregar informe'));
    check('I. queda registrada en Notification.created', Notification.created.includes(notif));
  }

  // =====================================================================
  section('J) showReminderNotification() no modifica el reminder');
  // =====================================================================
  {
    const { sandbox } = makeSandbox({ permission: 'granted' });
    await sandbox.addEvent({ id: 'evJ', title: 'Cita médica', date: '2026-09-20', allDay: false, startTime: '20:00' });
    const reminder = { id: 'rJ', targetType: 'event', targetId: 'evJ', remindAt: NOW.toISOString(), status: 'triggered' };
    const snapshotBefore = JSON.stringify(reminder);
    sandbox.showReminderNotification(reminder);
    check('J. el objeto reminder queda exactamente igual (misma serialización)', JSON.stringify(reminder) === snapshotBefore);
  }

  // =====================================================================
  section('K) triggerDueReminders() marca el reminder como "triggered" aunque Notification API no exista');
  // =====================================================================
  {
    const { sandbox } = makeSandbox(undefined); // sin Notification
    await sandbox.addReminder({ targetType: 'event', targetId: 'evK', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    let threw = false;
    let triggered;
    try { triggered = await sandbox.triggerDueReminders(NOW); } catch (e) { threw = true; }
    check('K. triggerDueReminders() no lanza sin Notification API', !threw);
    check('K. el reminder pasa a "triggered" igualmente', Array.isArray(triggered) && triggered.length === 1 && triggered[0].status === 'triggered');
    check('K. state.reminders refleja el cambio', sandbox.state.reminders[0].status === 'triggered');
  }

  // =====================================================================
  section('L) triggerDueReminders() intenta mostrar la notificación cuando el permiso está concedido');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'granted' });
    await sandbox.addEvent({ id: 'evL', title: 'Evento con recordatorio', date: '2026-09-20', allDay: false, startTime: '20:00' });
    await sandbox.addReminder({ targetType: 'event', targetId: 'evL', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const triggered = await sandbox.triggerDueReminders(NOW);
    check('L. el reminder se dispara', triggered.length === 1);
    check('L. se creó exactamente 1 notificación', Notification.created.length === 1);
    check('L. la notificación incluye el título del evento', Notification.created[0].options.body.includes('Evento con recordatorio'));
  }

  // =====================================================================
  section('M) un error al crear una notificación no impide procesar los siguientes reminders');
  // =====================================================================
  {
    const { sandbox } = makeSandbox({ permission: 'granted', throwOnConstruct: true });
    await sandbox.addReminder({ targetType: 'event', targetId: 'evM1', remindAt: '2026-09-20T18:00:00.000Z', status: 'pending' });
    await sandbox.addReminder({ targetType: 'task', targetId: 'tkM2', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    let threw = false;
    let triggered;
    try { triggered = await sandbox.triggerDueReminders(NOW); } catch (e) { threw = true; }
    check('M. triggerDueReminders() no lanza aunque new Notification() falle siempre', !threw);
    check('M. AMBOS reminders quedan "triggered" pese al fallo al notificar', triggered.length === 2 && triggered.every(r => r.status === 'triggered'));
    check('M. state.reminders confirma que ninguno se quedó a medias', sandbox.state.reminders.every(r => r.status === 'triggered'));
  }

  // =====================================================================
  section('N) ejecutar triggerDueReminders() dos veces no crea una segunda notificación para el mismo reminder');
  // =====================================================================
  {
    const { sandbox, Notification } = makeSandbox({ permission: 'granted' });
    await sandbox.addReminder({ targetType: 'task', targetId: 'tkN', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const first = await sandbox.triggerDueReminders(NOW);
    const second = await sandbox.triggerDueReminders(NOW);
    check('N. la primera pasada dispara 1 reminder y crea 1 notificación', first.length === 1 && Notification.created.length === 1);
    check('N. la segunda pasada con el mismo now no dispara nada nuevo', second.length === 0);
    check('N. sigue habiendo exactamente 1 notificación creada en total (no se duplicó)', Notification.created.length === 1);
  }

  // =====================================================================
  section('O) no se modifican id/targetType/targetId/remindAt al disparar y notificar');
  // =====================================================================
  {
    const { sandbox } = makeSandbox({ permission: 'granted' });
    const original = await sandbox.addReminder({ targetType: 'task', targetId: 'tkO', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const originalId = original.id;
    const originalTargetType = original.targetType;
    const originalTargetId = original.targetId;
    const originalRemindAt = original.remindAt;
    const [triggered] = await sandbox.triggerDueReminders(NOW);
    check('O. conserva id', triggered.id === originalId);
    check('O. conserva targetType', triggered.targetType === originalTargetType);
    check('O. conserva targetId', triggered.targetId === originalTargetId);
    check('O. conserva remindAt', triggered.remindAt === originalRemindAt);
  }

  // =====================================================================
  section('P) node --check del código extraído de organizator.html (Fase 5)');
  // =====================================================================
  {
    const combined = `${uidSrc}\n\nlet state = { tasks: [], events: [], reminders: [] };\nconst window = { storage: { async set(){ return {}; } } };\nfunction showToast(){}\n\n${saveRemindersSrc}\n\n${remindersFase1Src}\n\n${remindersFase4Src}\n\n${remindersFase5Src}\n`;
    const tmpPath = path.join(os.tmpdir(), `organizator-reminders-notification-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('P. node --check del código extraído (Fase 5: notificación real) pasa', true);
    } catch (e) {
      check('P. node --check del código extraído (Fase 5: notificación real) pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
