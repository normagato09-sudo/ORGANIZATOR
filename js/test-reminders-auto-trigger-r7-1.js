/**
 * ORGANIZATOR — Tests de R-7.1 (disparo automático de recordatorios
 * mientras la app está abierta)
 *
 * Diagnóstico que motivó esta fase: triggerDueReminders() (Fase 4) y
 * showReminderNotification() (Fase 5) ya funcionaban correctamente
 * cuando se llamaban (ver test-reminders-trigger.js/
 * test-reminders-notification.js), pero nada en organizator.html las
 * llamaba nunca fuera de sus propios tests — no había ningún
 * setInterval/setTimeout/visibilitychange/focus que ejecutara
 * triggerDueReminders() de forma periódica. Por eso el recordatorio se
 * creaba bien pero nunca se disparaba.
 *
 * Esta suite prueba el mecanismo real añadido (startReminderPolling/
 * stopReminderPolling/reminderPollingTick, bloque "RECORDATORIOS —
 * disparo automático..., Fase R-7.1") extrayéndolo literalmente de
 * organizator.html y ejecutándolo en un sandbox Node con setInterval/
 * clearInterval REALES (no simulados): así se prueba el código de
 * producción tal cual, sin reimplementar su lógica. reminderPollingTick
 * delega TODO en triggerDueReminders() (Fase 4, sin tocar) — esta
 * suite lo confirma espiando esa función real, no una copia.
 *
 * Uso:  node js/test-reminders-auto-trigger-r7-1.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// organizator.html se guarda con CRLF; se normaliza a LF solo para esta
// lectura (no se toca el archivo en disco) porque los marcadores de
// extractBetween de abajo usan '\n'.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// UTILIDADES DE FECHA + dowOfDate/getWeekMonday.
// ---------------------------------------------------------------------
const dateUtilsSrc = extractBetween(
  html,
  '/* ==================================================================\n   UTILIDADES DE FECHA',
  '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS',
  'bloque UTILIDADES DE FECHA'
);
const weekHelpersSrc = extractBetween(
  html,
  'function dowOfDate(dateStr){',
  '\nfunction weekGoForward(){',
  'helpers dowOfDate/getWeekMonday'
);

// ---------------------------------------------------------------------
// Bloque real de saneamiento + recurrencia R-1/R-2/R-3/R-4.
// ---------------------------------------------------------------------
const recurrenceSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1/R-2/R-3/R-4)'
);

// ---------------------------------------------------------------------
// Bloque real de CRUD (addTask/updateTask/deleteTask/toggleTask/
// completeTaskOccurrence/uncompleteTaskOccurrence/addEvent/updateEvent/
// deleteEvent).
// ---------------------------------------------------------------------
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS',
  'bloque CRUD'
);

// ---------------------------------------------------------------------
// Todo el tramo de RECORDATORIOS (Fases 1 a 5 + R-7 + R-7.1), con
// CATEGORÍAS DE EVENTOS y RECURRENCIA — integración con vistas (R-6)
// intercalados en medio (mismo tramo contiguo de organizator.html).
// Incluye el bloque nuevo de esta fase: RECORDATORIOS — disparo
// automático mientras la app está abierta (Fase R-7.1):
// startReminderPolling/stopReminderPolling/reminderPollingTick.
// ---------------------------------------------------------------------
const remindersSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fases 1-5, incluye R-7 y R-7.1) + CATEGORÍAS DE EVENTOS + RECURRENCIA vistas (R-6)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    async get(key) { return map.has(key) ? { key, value: map.get(key), shared: false } : null; },
    async set(key, value) { map.set(key, value); return { key, value, shared: false }; },
  };
}

/** Construye un sandbox con el código real de organizator.html.
 * `withNotification` (opcional) inyecta un `Notification` global
 * mínimo — mismo patrón que usaría un navegador con permiso concedido —
 * para poder probar la ruta completa hasta showReminderNotification()
 * sin reimplementar esa función. setInterval/clearInterval son los
 * REALES de Node (no una simulación): el polling se prueba con timers
 * de verdad, a propósito, para no dar por buena una versión falseada
 * del mecanismo. */
function makeSandbox({ withNotification = false } = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  const notificationCalls = [];
  if (withNotification) {
    function MockNotification(title, options) {
      notificationCalls.push({ title, options });
      this.title = title;
      this.options = options;
    }
    MockNotification.permission = 'granted';
    sandbox.Notification = MockNotification;
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
     function renderCurrentView(){ /* no-op: fuera de alcance de R-7.1 */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-7.1 */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(remindersSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fases 1-5 + R-7 + R-7.1 + categorías + vistas R-6)' });
  vm.runInContext(
    `this.addTask = addTask;
     this.getTaskOccurrenceId = getTaskOccurrenceId;
     this.addReminder = addReminder;
     this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget;
     this.calculateReminderAt = calculateReminderAt;
     this.createReminderForTarget = createReminderForTarget;
     this.syncReminderForTaskOccurrence = syncReminderForTaskOccurrence;
     this.getDueReminders = getDueReminders;
     this.triggerDueReminders = triggerDueReminders;
     this.showReminderNotification = showReminderNotification;
     this.reminderPollingTick = reminderPollingTick;
     this.startReminderPolling = startReminderPolling;
     this.stopReminderPolling = stopReminderPolling;
     this.getReminderPollingIntervalId = () => reminderPollingIntervalId;
     this.state = state;`,
    sandbox, { filename: 'expose-reminders-auto-trigger-R7-1' }
  );
  sandbox.__notificationCalls = notificationCalls;
  return sandbox;
}

(async () => {

  // =====================================================================
  section('1) El mecanismo de polling se puede iniciar');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('1. antes de arrancar no hay ningún intervalo activo', sb.getReminderPollingIntervalId() === null);
    const id = sb.startReminderPolling(50);
    check('1. startReminderPolling devuelve un id de intervalo', id !== null && id !== undefined);
    check('1. reminderPollingIntervalId queda registrado', sb.getReminderPollingIntervalId() === id);
    sb.stopReminderPolling();
  }

  // =====================================================================
  section('2) No se crean dos intervalos al inicializarlo dos veces');
  // =====================================================================
  {
    const sb = makeSandbox();
    const id1 = sb.startReminderPolling(50);
    const id2 = sb.startReminderPolling(50); // simula startApp() llamado dos veces
    check('2. la segunda llamada devuelve el MISMO id (no crea un segundo intervalo)', id1 === id2);

    // Confirmación empírica: contar ticks reales durante una ventana de
    // tiempo. Con un único intervalo de 50ms, ~170ms deberían dar 2-3
    // ticks; si hubiera dos intervalos duplicados, el doble.
    let tickCount = 0;
    sb.triggerDueReminders = async () => { tickCount++; return []; };
    await wait(170);
    sb.stopReminderPolling();
    check('2b. el número de ticks reales es coherente con UN solo intervalo (no el doble)', tickCount >= 2 && tickCount <= 4);
  }

  // =====================================================================
  section('3) El callback acaba llamando a triggerDueReminders');
  // =====================================================================
  {
    const sb = makeSandbox();
    let calls = 0;
    const realTriggerDueReminders = sb.triggerDueReminders;
    sb.triggerDueReminders = (...args) => { calls++; return realTriggerDueReminders(...args); };
    sb.startReminderPolling(30);
    await wait(100);
    sb.stopReminderPolling();
    check('3. triggerDueReminders() se llamó al menos una vez durante el polling', calls >= 1);
  }

  // =====================================================================
  section('4) El mecanismo se puede detener/limpiar');
  // =====================================================================
  {
    const sb = makeSandbox();
    let calls = 0;
    sb.triggerDueReminders = async () => { calls++; return []; };
    sb.startReminderPolling(30);
    await wait(80);
    const callsBeforeStop = calls;
    check('4. hubo al menos un tick antes de detenerlo', callsBeforeStop >= 1);
    sb.stopReminderPolling();
    check('4. reminderPollingIntervalId vuelve a null tras detenerlo', sb.getReminderPollingIntervalId() === null);
    await wait(100);
    check('4. no se producen más ticks después de detenerlo', calls === callsBeforeStop);
    // Puede volver a arrancarse después de detenido (nuevo id, no el mismo objeto).
    const idAfterRestart = sb.startReminderPolling(30);
    check('4b. se puede reiniciar después de detenido', idAfterRestart !== null);
    sb.stopReminderPolling();
  }

  // =====================================================================
  section('5) No modifica state.reminders por sí mismo (solo a través de triggerDueReminders)');
  // =====================================================================
  {
    const sb = makeSandbox();
    sb.state.reminders.push({ id: 'r1', targetType: 'task', targetId: 'abc', remindAt: new Date(Date.now() - 1000).toISOString(), status: 'pending', createdAt: Date.now() });
    const snapshotBefore = JSON.stringify(sb.state.reminders);
    // triggerDueReminders sustituido por un no-op que NO toca state: si
    // reminderPollingTick tocara state.reminders por su cuenta (en vez
    // de delegar), este snapshot cambiaría igualmente.
    sb.triggerDueReminders = async () => { return []; };
    sb.startReminderPolling(30);
    await wait(80);
    sb.stopReminderPolling();
    check('5. state.reminders no cambia si triggerDueReminders no lo cambia (el polling no lo toca por su cuenta)', JSON.stringify(sb.state.reminders) === snapshotBefore);
  }

  // =====================================================================
  section('6) No crea reminders nuevos');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', dueTime: '07:30' });
    const task = sb.state.tasks[0];
    await sb.createReminderForTarget('task', task.id, new Date(Date.now() - 1000).toISOString(), 0); // ya vencido
    const before = sb.state.reminders.length;
    check('6. hay un recordatorio pendiente antes de arrancar el polling', before === 1 && sb.state.reminders[0].status === 'pending');
    sb.startReminderPolling(30); // usa el triggerDueReminders REAL
    await wait(80);
    sb.stopReminderPolling();
    check('6. el polling no añade ningún recordatorio nuevo', sb.state.reminders.length === before);
    check('6. el recordatorio existente sí pasó a triggered (se disparó, no se duplicó)', sb.state.reminders[0].status === 'triggered');
  }

  // =====================================================================
  section('7) reminderPollingTick delega en triggerDueReminders (sin duplicar su lógica)');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', dueTime: '07:30', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const task = sb.state.tasks[0];
    // Recordatorio de una OCURRENCIA (R-7): targetId "taskId::fecha".
    const reminder = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    check('7pre. el recordatorio de la ocurrencia se creó correctamente', reminder !== null);
    // Se fuerza remindAt al pasado para que esté vencido sin esperar.
    const past = new Date(Date.now() - 1000).toISOString();
    sb.state.reminders.find(r => r.id === reminder.id).remindAt = past;
    const result = await sb.reminderPollingTick(new Date());
    check('7. reminderPollingTick devuelve lo mismo que triggerDueReminders (mismo reminder disparado)', result.some(r => r.id === reminder.id));
    check('7. el targetId de ocurrencia (taskId::fecha) se conserva intacto tras dispararse', sb.getReminderById(reminder.id).targetId === sb.getTaskOccurrenceId(task.id, '2026-09-21'));
    check('7. reminderPollingTick no reimplementa el cálculo: solo delega (fuente contiene "triggerDueReminders")', sb.reminderPollingTick.toString().includes('triggerDueReminders'));
  }

  // =====================================================================
  section('8) Ruta completa de notificación: permiso concedido → reminder vencido → showReminderNotification() → triggered');
  // =====================================================================
  {
    const sb = makeSandbox({ withNotification: true });
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', dueTime: '07:30' });
    const task = sb.state.tasks[0];
    const reminder = await sb.createReminderForTarget('task', task.id, new Date(Date.now() - 1000).toISOString(), 0);
    check('8. permiso de notificación concedido en este entorno de prueba', sb.Notification.permission === 'granted');
    check('8. el recordatorio empieza pending', sb.getReminderById(reminder.id).status === 'pending');
    const triggered = await sb.triggerDueReminders(new Date());
    check('8. triggerDueReminders dispara el recordatorio vencido', triggered.some(r => r.id === reminder.id));
    check('8. el recordatorio pasa a triggered', sb.getReminderById(reminder.id).status === 'triggered');
    check('8. showReminderNotification() llegó a construir una Notification real (mock)', sb.__notificationCalls.length === 1);
    check('8. el cuerpo de la notificación menciona la tarea', sb.__notificationCalls[0].options.body.includes('Ducharse'));

    // Lo mismo, pero pasando por el mecanismo de polling completo (no
    // solo triggerDueReminders a mano), para probar el camino real
    // extremo a extremo: reminder vencido -> setInterval -> tick ->
    // triggerDueReminders -> showReminderNotification -> Notification real.
    const reminder2 = await sb.createReminderForTarget('task', task.id, new Date(Date.now() - 1000).toISOString(), 0);
    sb.startReminderPolling(30);
    await wait(80);
    sb.stopReminderPolling();
    check('8b. de extremo a extremo (polling real) el segundo recordatorio también se dispara', sb.getReminderById(reminder2.id).status === 'triggered');
    check('8b. y también genera su propia notificación', sb.__notificationCalls.length === 2);
  }

  // =====================================================================
  section('9) node --check sobre el <script> principal de organizator.html');
  // =====================================================================
  {
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-reminders-auto-trigger-r7-1-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('9. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
    } catch (e) {
      check('9. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
