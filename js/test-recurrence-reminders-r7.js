/**
 * ORGANIZATOR — Tests de R-7 (integración de recordatorios con
 * ocurrencias recurrentes de tareas)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html los bloques de los que depende R-7:
 *  - UTILIDADES DE FECHA + dowOfDate/getWeekMonday
 *  - SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA
 *    R-1: sanitizeRecurrence; R-2: isDateInRecurrence/
 *    getNextRecurrenceDate; R-3: getTaskOccurrenceId/getTaskOccurrences
 *    y compañía; R-4: getEventOccurrences y compañía)
 *  - CRUD (addTask/updateTask/deleteTask/toggleTask/
 *    completeTaskOccurrence/uncompleteTaskOccurrence/addEvent/
 *    updateEvent/deleteEvent) — incluye la Fase R-3 de completar
 *    ocurrencias, que vive dentro del mismo bloque CRUD
 *  - Todo el bloque RECORDATORIOS (Fases 1 a 5) + CATEGORÍAS DE EVENTOS
 *    + RECURRENCIA — integración con vistas (R-6), que quedan
 *    intercalados entre las fases de recordatorios en organizator.html
 *    — se extraen juntos porque es el mismo tramo contiguo del
 *    archivo. Dentro de este tramo está también el bloque nuevo de
 *    esta fase: RECORDATORIOS — ocurrencias recurrentes de tareas
 *    (Fase R-7): occurrenceReminderTargetDateTime,
 *    pendingReminderForTaskOccurrence,
 *    currentReminderMinutesForTaskOccurrence,
 *    syncReminderForTaskOccurrence, cancelReminderForTaskOccurrence,
 *    cancelRemindersForTaskAndOccurrences, y el pequeño ajuste en
 *    reminderNotificationBody/resolveTaskIdFromReminderTargetId.
 *
 * R-7 NO reimplementa nada de calculateReminderAt/reminderTargetDateTime/
 * syncReminderForTarget/getDueReminders/triggerDueReminders (Fases 1-5):
 * esta suite lo confirma llamando a esos mismos helpers, no a copias.
 *
 * Uso:  node js/test-recurrence-reminders-r7.js
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
// Bloque real de saneamiento + recurrencia R-1/R-2/R-3/R-4 (incluye
// getTaskOccurrenceId/getTaskOccurrences, R-3, que reutiliza R-7 para
// la identidad de la ocurrencia).
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
// deleteEvent). deleteTask llama a cancelRemindersForTaskAndOccurrences
// (definida más abajo, en el bloque de recordatorios) — al ser function
// declarations quedan hoisted, así que el orden de carga no importa
// mientras ambos bloques se carguen antes de llamar a deleteTask.
// ---------------------------------------------------------------------
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS',
  'bloque CRUD'
);

// ---------------------------------------------------------------------
// Todo el tramo de RECORDATORIOS (Fases 1 a 5), con CATEGORÍAS DE
// EVENTOS y RECURRENCIA — integración con vistas (R-6) intercalados en
// medio (mismo tramo contiguo de organizator.html) — incluye el bloque
// nuevo de esta fase: RECORDATORIOS — ocurrencias recurrentes de
// tareas (Fase R-7).
// ---------------------------------------------------------------------
const remindersSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fases 1-5, incluye R-7) + CATEGORÍAS DE EVENTOS + RECURRENCIA vistas (R-6)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    async get(key) { return map.has(key) ? { key, value: map.get(key), shared: false } : null; },
    async set(key, value) { map.set(key, value); return { key, value, shared: false }; },
  };
}

function makeSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
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
     function renderCurrentView(){ /* no-op: fuera de alcance de R-7 (UI de render) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-7 */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(remindersSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fases 1-5 + R-7 + categorías + vistas R-6)' });
  vm.runInContext(
    `this.sanitizeRecurrence = sanitizeRecurrence;
     this.getTaskOccurrenceId = getTaskOccurrenceId;
     this.getTaskOccurrences = getTaskOccurrences;
     this.addTask = addTask;
     this.updateTask = updateTask;
     this.deleteTask = deleteTask;
     this.addReminder = addReminder;
     this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget;
     this.updateReminder = updateReminder;
     this.cancelReminder = cancelReminder;
     this.calculateReminderAt = calculateReminderAt;
     this.createReminderForTarget = createReminderForTarget;
     this.reminderTargetDateTime = reminderTargetDateTime;
     this.pendingReminderForTarget = pendingReminderForTarget;
     this.currentReminderMinutes = currentReminderMinutes;
     this.syncReminderForTarget = syncReminderForTarget;
     this.cancelRemindersForTarget = cancelRemindersForTarget;
     this.getDueReminders = getDueReminders;
     this.triggerDueReminders = triggerDueReminders;
     this.reminderNotificationBody = reminderNotificationBody;
     this.resolveTaskIdFromReminderTargetId = resolveTaskIdFromReminderTargetId;
     this.occurrenceReminderTargetDateTime = occurrenceReminderTargetDateTime;
     this.pendingReminderForTaskOccurrence = pendingReminderForTaskOccurrence;
     this.currentReminderMinutesForTaskOccurrence = currentReminderMinutesForTaskOccurrence;
     this.syncReminderForTaskOccurrence = syncReminderForTaskOccurrence;
     this.cancelReminderForTaskOccurrence = cancelReminderForTaskOccurrence;
     this.cancelRemindersForTaskAndOccurrences = cancelRemindersForTaskAndOccurrences;
     this.state = state;`,
    sandbox, { filename: 'expose-recurrence-reminders-R7' }
  );
  return sandbox;
}

// Tarea recurrente base reutilizable: diaria cada 3 días desde el
// 18/09/2026 (mismo ejemplo que R-3/R-6), con dueTime como hora
// "genérica" de respaldo.
function makeRecurringTaskData(overrides = {}) {
  return {
    title: 'Ducharse',
    dueDate: '2026-09-18',
    dueTime: '07:30',
    recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null },
    ...overrides,
  };
}

(async () => {

  // =====================================================================
  section('1) Tarea recurrente con ocurrencia concreta');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const occ = sb.getTaskOccurrences(task, '2026-09-18', '2026-09-24');
    check('1. la tarea genera ocurrencias (18/09, 21/09, 24/09)', occ.length === 3);
    const reminder = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    check('1. se puede crear un recordatorio para una ocurrencia concreta (21/09)', reminder !== null && reminder.status === 'pending');
    check('1. el recordatorio es de tipo task', reminder.targetType === 'task');
  }

  // =====================================================================
  section('2) Identidad estable taskId + occurrenceDate');
  // =====================================================================
  {
    const sb = makeSandbox();
    const id1 = sb.getTaskOccurrenceId('abc', '2026-09-21');
    check('2. el id compuesto sigue el formato "taskId::occurrenceDate"', id1 === 'abc::2026-09-21');
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const reminder = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    check('2. el targetId del recordatorio usa esa misma convención', reminder.targetId === sb.getTaskOccurrenceId(task.id, '2026-09-21'));
    check('2. no depende de la posición en ningún array (es una cadena determinista)', typeof reminder.targetId === 'string' && reminder.targetId.includes('::'));
  }

  // =====================================================================
  section('3) Dos ocurrencias distintas → dos targetIds distintos');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const r1 = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    const r2 = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    check('3. targetIds distintos para fechas distintas', r1.targetId !== r2.targetId);
    check('3. ambos recordatorios existen como entradas separadas en state.reminders', sb.state.reminders.length === 2);
  }

  // =====================================================================
  section('4) Misma ocurrencia → mismo targetId');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const r1 = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    const r2 = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 15);
    check('4. mismo targetId al volver a sincronizar la misma ocurrencia', r1.targetId === r2.targetId);
    check('4. es literalmente el mismo recordatorio (mismo id), no uno nuevo', r1.id === r2.id);
  }

  // =====================================================================
  section('5) Recordatorio de una ocurrencia no afecta a otra');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    const pendingOther = sb.pendingReminderForTaskOccurrence(task.id, '2026-09-21');
    check('5. la ocurrencia del 21/09 sigue sin recordatorio', pendingOther === null);
    const pendingSet = sb.pendingReminderForTaskOccurrence(task.id, '2026-09-18');
    check('5. la ocurrencia del 18/09 sí lo tiene', pendingSet !== null);
  }

  // =====================================================================
  section('6) Recordatorio de tarea no recurrente sigue funcionando');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Comprar pan', dueDate: '2026-09-20', dueTime: '09:00' });
    const task = sb.state.tasks[0];
    // Mismo camino de siempre (Fase 3), sin pasar por ningún helper de R-7.
    const targetDateTime = sb.reminderTargetDateTime(task.dueDate, task.dueTime);
    const reminder = await sb.syncReminderForTarget('task', task.id, targetDateTime, 10);
    check('6. el flujo existente de tarea no recurrente sigue creando el recordatorio', reminder !== null && reminder.targetId === task.id);
    check('6. su targetId es el id de la tarea a secas (sin "::")', !reminder.targetId.includes('::'));
  }

  // =====================================================================
  section('7) Cálculo con hora de la ocurrencia (scheduledStart)');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    let task = sb.state.tasks[0];
    // Simula que Scheduler colocó esta tarea recurrente justo el 21/09 a las 08:00.
    await sb.updateTask(task.id, { scheduledDate: '2026-09-21', scheduledStart: '08:00', scheduledEnd: '08:15' });
    task = sb.state.tasks[0];
    const dt = sb.occurrenceReminderTargetDateTime(task, '2026-09-21');
    check('7. usa scheduledStart cuando scheduledDate coincide con la ocurrencia', dt === '2026-09-21T08:00:00');
    // Otra ocurrencia de la MISMA tarea, en OTRA fecha: scheduledStart no le pertenece.
    const dtOther = sb.occurrenceReminderTargetDateTime(task, '2026-09-24');
    check('7b. scheduledStart NO se reutiliza para otra fecha (cae a dueTime)', dtOther === '2026-09-24T07:30:00');
  }

  // =====================================================================
  section('8) Cálculo con dueTime');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const dt = sb.occurrenceReminderTargetDateTime(task, '2026-09-18');
    check('8. sin scheduledStart, usa dueTime de la tarea', dt === '2026-09-18T07:30:00');
  }

  // =====================================================================
  section('9) Ausencia de hora → comportamiento seguro');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData({ dueTime: '' }));
    const task = sb.state.tasks[0];
    const dt = sb.occurrenceReminderTargetDateTime(task, '2026-09-18');
    check('9. sin scheduledStart ni dueTime, no inventa ninguna hora (null)', dt === null);
    const reminder = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    check('9. no se crea ningún recordatorio temporalmente imposible', reminder === null);
    check('9. state.reminders sigue vacío', sb.state.reminders.length === 0);
  }

  // =====================================================================
  section('10) Creación de recordatorio para una ocurrencia');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const reminder = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    check('10. el recordatorio se guarda en state.reminders', sb.state.reminders.some(r => r.id === reminder.id));
    check('10. remindAt = 21/09 07:30 menos 10 minutos', reminder.remindAt === sb.calculateReminderAt('2026-09-21T07:30:00', 10));
    check('10. status inicial pending', reminder.status === 'pending');
  }

  // =====================================================================
  section('11) No duplicación de recordatorio pendiente');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 15);
    const forThatOccurrence = sb.getRemindersForTarget('task', sb.getTaskOccurrenceId(task.id, '2026-09-21'));
    check('11. sigue habiendo un único recordatorio para esa ocurrencia, no tres', forThatOccurrence.length === 1);
  }

  // =====================================================================
  section('12) Sincronización cambia el existente');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const first = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    // updateReminder muta el objeto in-place (mismo patrón que
    // updateTask/updateEvent): first y second acaban siendo la MISMA
    // referencia, así que el remindAt "antes" se guarda aparte antes de
    // volver a sincronizar (si no, comparar first.remindAt después
    // compararía el valor ya mutado contra sí mismo).
    const firstRemindAt = first.remindAt;
    const second = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 30);
    check('12. mismo id de recordatorio (se reutiliza, no se crea otro)', first.id === second.id);
    check('12. remindAt cambia a la nueva anticipación', second.remindAt === sb.calculateReminderAt('2026-09-21T07:30:00', 30) && second.remindAt !== firstRemindAt);
  }

  // =====================================================================
  section('13) Cancelación solo afecta a esa ocurrencia');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 10);
    await sb.cancelReminderForTaskOccurrence(task.id, '2026-09-18');
    check('13. la ocurrencia del 18/09 queda sin recordatorio pendiente', sb.pendingReminderForTaskOccurrence(task.id, '2026-09-18') === null);
    check('13. la ocurrencia del 21/09 sigue con su recordatorio pending', sb.pendingReminderForTaskOccurrence(task.id, '2026-09-21') !== null);
    const cancelled = sb.getRemindersForTarget('task', sb.getTaskOccurrenceId(task.id, '2026-09-18'))[0];
    check('13. el recordatorio cancelado no se borró, solo cambió de estado', cancelled && cancelled.status === 'cancelled');
  }

  // =====================================================================
  section('14) Trigger funciona para recordatorio de ocurrencia');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const reminder = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    const past = new Date(new Date(reminder.remindAt).getTime() + 1000); // 1s después de remindAt
    const due = sb.getDueReminders(past);
    check('14. getDueReminders detecta el recordatorio de la ocurrencia como vencido', due.some(r => r.id === reminder.id));
  }

  // =====================================================================
  section('15) Estado pasa a triggered');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const reminder = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    const past = new Date(new Date(reminder.remindAt).getTime() + 1000);
    const triggered = await sb.triggerDueReminders(past);
    check('15. triggerDueReminders devuelve el recordatorio disparado', triggered.some(r => r.id === reminder.id));
    check('15. su status pasa a triggered', sb.getReminderById(reminder.id).status === 'triggered');
    check('15. una segunda pasada con el mismo `now` no vuelve a dispararlo (idempotente)', (await sb.triggerDueReminders(past)).length === 0);
    // El texto de notificación resuelve el título de la tarea BASE a
    // partir del targetId compuesto (ver resolveTaskIdFromReminderTargetId).
    check('15b. reminderNotificationBody resuelve el título real de la tarea pese al targetId compuesto', sb.reminderNotificationBody(sb.getReminderById(reminder.id)) === 'Tarea: Ducharse');
  }

  // =====================================================================
  section('16) Generar muchas ocurrencias no aumenta state.tasks');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData({ recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-01-01', endDate: null } }));
    const task = sb.state.tasks[0];
    const before = sb.state.tasks.length;
    const occ = sb.getTaskOccurrences(task, '2026-01-01', '2026-12-31'); // 365 ocurrencias
    check('16. se generan muchas ocurrencias (>300)', occ.length > 300);
    check('16. state.tasks no crece ni una unidad', sb.state.tasks.length === before);
  }

  // =====================================================================
  section('17) Generar ocurrencias no crea recordatorios automáticamente');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    sb.getTaskOccurrences(task, '2026-09-01', '2026-12-31');
    check('17. generar ocurrencias no crea ningún recordatorio', sb.state.reminders.length === 0);
  }

  // =====================================================================
  section('18) Dos fechas recurrentes pueden tener recordatorios independientes');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    const r1 = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    const r2 = await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 60);
    check('18. remindAt independiente para cada ocurrencia', r1.remindAt !== r2.remindAt);
    await sb.cancelReminderForTaskOccurrence(task.id, '2026-09-18');
    check('18. cancelar una no cancela la otra', sb.getReminderById(r1.id).status === 'cancelled' && sb.getReminderById(r2.id).status === 'pending');
  }

  // =====================================================================
  section('19) Persistencia conserva los recordatorios');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask(makeRecurringTaskData());
    const task = sb.state.tasks[0];
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-18', 10);
    await sb.syncReminderForTaskOccurrence(task.id, '2026-09-21', 30);
    // "Exportar/reimportar": mismo criterio que el resto de la suite —
    // JSON.stringify + JSON.parse simula guardar y volver a leer.
    const roundTripped = JSON.parse(JSON.stringify(sb.state.reminders));
    check('19. los dos recordatorios de ocurrencia sobreviven al round-trip', roundTripped.length === 2);
    check('19. conservan su targetId compuesto tal cual', roundTripped.every(r => r.targetId.includes('::')));
    check('19. conservan remindAt/status', roundTripped.every(r => r.status === 'pending' && typeof r.remindAt === 'string'));

    // Bonus: borrar la tarea base cancela también los recordatorios de
    // sus ocurrencias (cancelRemindersForTaskAndOccurrences), no solo el
    // de la tarea base — evita huérfanos.
    await sb.deleteTask(task.id);
    const afterDelete = sb.state.reminders.filter(r => r.targetType === 'task' && (r.targetId === task.id || r.targetId.startsWith(`${task.id}::`)));
    check('19b. borrar la tarea base cancela los recordatorios de TODAS sus ocurrencias (sin huérfanos)', afterDelete.every(r => r.status === 'cancelled'));
  }

  // =====================================================================
  section('20) node --check sobre el <script> principal de organizator.html');
  // =====================================================================
  {
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-recurrence-reminders-r7-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('20. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
    } catch (e) {
      check('20. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
