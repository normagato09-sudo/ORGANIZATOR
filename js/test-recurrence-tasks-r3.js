/**
 * ORGANIZATOR — Tests de R-3 (integración de recurrencia con TAREAS)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html los bloques de los que depende R-3:
 *  - UTILIDADES DE FECHA (pad, parseYMD, dowOfDate, addDays, getWeekMonday)
 *  - SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA
 *    R-1: sanitizeRecurrence; R-2: isDateInRecurrence/getNextRecurrenceDate;
 *    y R-3: getTaskOccurrenceId/isTaskOccurrenceCompleted/
 *    buildTaskOccurrence/getTaskOccurrences — helpers puros)
 *  - CRUD (addTask/updateTask/toggleTask/completeTaskOccurrence/
 *    uncompleteTaskOccurrence — mutan state.tasks y persisten)
 * Mismo patrón que test-recurrence-model.js (R-1) y test-recurrence-r2.js
 * (R-2): nada de esto pinta UI, ni toca Scheduler/recordatorios/IA.
 *
 * Uso:  node js/test-recurrence-tasks-r3.js
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
// UTILIDADES DE FECHA + dowOfDate/getWeekMonday (mismo rango que usa
// test-recurrence-r2.js).
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
// Bloque real de saneamiento + recurrencia R-1/R-2/R-3 (isDateInRecurrence,
// getNextRecurrenceDate, getTaskOccurrences y helpers). Mismo rango que ya
// extraen test-recurrence-model.js y test-recurrence-r2.js.
// ---------------------------------------------------------------------
const recurrenceSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1/R-2/R-3)'
);

// ---------------------------------------------------------------------
// Bloque real de CRUD (addTask/updateTask/deleteTask/toggleTask/
// completeTaskOccurrence/uncompleteTaskOccurrence/addEvent/updateEvent/
// deleteEvent) de organizator.html. Mismo rango que ya extrae
// test-recurrence-model.js.
// ---------------------------------------------------------------------
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS',
  'bloque CRUD (incluye completeTaskOccurrence/uncompleteTaskOccurrence R-3)'
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

function makeSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  // 1) Utilidades de fecha (pad/parseYMD/dowOfDate/addDays/getWeekMonday),
  //    de las que dependen R-2 y R-3.
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  // 2) Saneamiento + recurrencia R-1 (sanitizeRecurrence) + R-2
  //    (isDateInRecurrence/getNextRecurrenceDate) + R-3 (helpers puros de
  //    ocurrencias: getTaskOccurrences y compañía).
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2/R-3)' });
  // 3) Entorno mínimo del que depende el bloque CRUD real.
  vm.runInContext(
    `let state = { tasks: [], events: [] };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function cancelRemindersForTarget(){ /* no-op: fuera de alcance de R-3 */ }
     function renderCurrentView(){ /* no-op: fuera de alcance de R-3 (UI) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-3 (UI) */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  // 4) CRUD real (addTask/updateTask/toggleTask/completeTaskOccurrence/
  //    uncompleteTaskOccurrence/addEvent/updateEvent), usa sanitizeRecurrence
  //    definido en (2).
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(
    `this.sanitizeRecurrence = sanitizeRecurrence;
     this.isDateInRecurrence = isDateInRecurrence;
     this.getNextRecurrenceDate = getNextRecurrenceDate;
     this.getTaskOccurrenceId = getTaskOccurrenceId;
     this.isTaskOccurrenceCompleted = isTaskOccurrenceCompleted;
     this.getTaskOccurrences = getTaskOccurrences;
     this.addTask = addTask;
     this.updateTask = updateTask;
     this.toggleTask = toggleTask;
     this.completeTaskOccurrence = completeTaskOccurrence;
     this.uncompleteTaskOccurrence = uncompleteTaskOccurrence;
     this.state = state;`,
    sandbox, { filename: 'expose-recurrence-R3' }
  );
  return sandbox;
}

// Tarea recurrente base reutilizable entre tests (mismo ejemplo que el
// pedido para R-3: diaria cada 3 días desde el 18/09/2026 → 18, 21, 24, 27...).
function makeDailyTask(sb, overrides = {}) {
  return {
    id: 'abc',
    title: 'Ducharse',
    dueDate: '2026-09-18',
    done: false,
    recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null },
    ...overrides,
  };
}

(async () => {

  // =====================================================================
  section('1) Tarea no recurrente');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = { id: 't1', title: 'Comprar pan', dueDate: '2026-09-20', done: false, recurrence: null };
    const occ = sb.getTaskOccurrences(task, '2026-09-01', '2026-09-30');
    check('1. devuelve exactamente una ocurrencia', occ.length === 1);
    check('1. la ocurrencia cae en dueDate', occ[0].occurrenceDate === '2026-09-20');
    check('1. taskId es el id de la tarea base', occ[0].taskId === 't1');
    check('1. conserva el título', occ[0].title === 'Comprar pan');
  }

  // =====================================================================
  section('2) Tarea diaria cada 3 días');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = makeDailyTask(sb);
    const occ = sb.getTaskOccurrences(task, '2026-09-18', '2026-09-27');
    const dates = occ.map(o => o.occurrenceDate);
    check('2. genera 18, 21, 24, 27', dates.join(',') === '2026-09-18,2026-09-21,2026-09-24,2026-09-27');
  }

  // =====================================================================
  section('3) Varias ocurrencias dentro de un rango');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = makeDailyTask(sb);
    const occ = sb.getTaskOccurrences(task, '2026-09-19', '2026-09-25');
    const dates = occ.map(o => o.occurrenceDate);
    check('3. solo incluye las que caen en [19, 25] → 21 y 24', dates.join(',') === '2026-09-21,2026-09-24');
  }

  // =====================================================================
  section('4) Rango que empieza antes de startDate');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = makeDailyTask(sb);
    const occ = sb.getTaskOccurrences(task, '2026-08-01', '2026-09-21');
    const dates = occ.map(o => o.occurrenceDate);
    check('4. la primera ocurrencia sigue siendo startDate, no antes', dates[0] === '2026-09-18');
    check('4. incluye 18 y 21, nada anterior a startDate', dates.join(',') === '2026-09-18,2026-09-21');
  }

  // =====================================================================
  section('5) Rango posterior a endDate');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = makeDailyTask(sb, { recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: '2026-09-24' } });
    const occInRange = sb.getTaskOccurrences(task, '2026-09-18', '2026-09-24').map(o => o.occurrenceDate);
    check('5. dentro de [startDate, endDate] hay ocurrencias', occInRange.join(',') === '2026-09-18,2026-09-21,2026-09-24');
    const occAfterEnd = sb.getTaskOccurrences(task, '2026-09-25', '2026-12-31');
    check('5. un rango totalmente posterior a endDate no devuelve nada', occAfterEnd.length === 0);
    const occStraddling = sb.getTaskOccurrences(task, '2026-09-20', '2026-12-31').map(o => o.occurrenceDate);
    check('5. un rango que cruza endDate se corta justo en endDate', occStraddling.join(',') === '2026-09-21,2026-09-24');
  }

  // =====================================================================
  section('6) Recurrencia semanal');
  // =====================================================================
  {
    const sb = makeSandbox();
    // 2026-09-07 es lunes; sin daysOfWeek explícito, cae el mismo día de
    // la semana que startDate (ver R-2).
    const task = makeDailyTask(sb, { recurrence: { type: 'weekly', interval: 1, daysOfWeek: [], startDate: '2026-09-07', endDate: null } });
    const occ = sb.getTaskOccurrences(task, '2026-09-07', '2026-09-28').map(o => o.occurrenceDate);
    check('6. una ocurrencia por semana, todas en lunes', occ.join(',') === '2026-09-07,2026-09-14,2026-09-21,2026-09-28');
  }

  // =====================================================================
  section('7) Recurrencia semanal con varios días');
  // =====================================================================
  {
    const sb = makeSandbox();
    // lunes/miércoles/viernes = [0,2,4].
    const task = makeDailyTask(sb, { recurrence: { type: 'weekly', interval: 1, daysOfWeek: [0, 2, 4], startDate: '2026-09-07', endDate: null } });
    const occ = sb.getTaskOccurrences(task, '2026-09-07', '2026-09-13').map(o => o.occurrenceDate);
    check('7. una semana completa produce lunes/miércoles/viernes', occ.join(',') === '2026-09-07,2026-09-09,2026-09-11');
  }

  // =====================================================================
  section('8) Recurrencia mensual');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = makeDailyTask(sb, { dueDate: '2026-01-15', recurrence: { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-01-15', endDate: null } });
    const occ = sb.getTaskOccurrences(task, '2026-01-01', '2026-04-30').map(o => o.occurrenceDate);
    check('8. una ocurrencia por mes, mismo día', occ.join(',') === '2026-01-15,2026-02-15,2026-03-15,2026-04-15');
  }

  // =====================================================================
  section('9) completedOccurrences inicialmente vacío');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const t = sb.state.tasks[0];
    check('9. completedOccurrences no existe todavía (o está vacío) al crear la tarea', t.completedOccurrences === undefined || (Array.isArray(t.completedOccurrences) && t.completedOccurrences.length === 0));
    check('9. isTaskOccurrenceCompleted da false para cualquier fecha', sb.isTaskOccurrenceCompleted(t, '2026-09-18') === false && sb.isTaskOccurrenceCompleted(t, '2026-09-21') === false);
  }

  // =====================================================================
  section('10) Completar una ocurrencia');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[0].id;
    await sb.completeTaskOccurrence(id, '2026-09-21');
    const t = sb.state.tasks[0];
    check('10. 2026-09-21 queda en completedOccurrences', Array.isArray(t.completedOccurrences) && t.completedOccurrences.includes('2026-09-21'));
    check('10. isTaskOccurrenceCompleted confirma esa fecha como completada', sb.isTaskOccurrenceCompleted(t, '2026-09-21') === true);
  }

  // =====================================================================
  section('11) Completar dos ocurrencias distintas');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[0].id;
    await sb.completeTaskOccurrence(id, '2026-09-18');
    await sb.completeTaskOccurrence(id, '2026-09-24');
    const t = sb.state.tasks[0];
    check('11. ambas fechas quedan registradas', t.completedOccurrences.length === 2 &&
      t.completedOccurrences.includes('2026-09-18') && t.completedOccurrences.includes('2026-09-24'));
  }

  // =====================================================================
  section('12) Completar la misma ocurrencia dos veces → no duplica');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[0].id;
    await sb.completeTaskOccurrence(id, '2026-09-21');
    await sb.completeTaskOccurrence(id, '2026-09-21');
    const t = sb.state.tasks[0];
    check('12. la fecha aparece una sola vez (idempotente)', t.completedOccurrences.filter(d => d === '2026-09-21').length === 1);
    check('12. completedOccurrences tiene longitud 1', t.completedOccurrences.length === 1);
  }

  // =====================================================================
  section('13) Deshacer una ocurrencia');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[0].id;
    await sb.completeTaskOccurrence(id, '2026-09-21');
    check('13. queda completada antes de deshacer', sb.isTaskOccurrenceCompleted(sb.state.tasks[0], '2026-09-21') === true);
    await sb.uncompleteTaskOccurrence(id, '2026-09-21');
    const t = sb.state.tasks[0];
    check('13. tras deshacer ya no está en completedOccurrences', !t.completedOccurrences.includes('2026-09-21'));
    check('13. isTaskOccurrenceCompleted da false tras deshacer', sb.isTaskOccurrenceCompleted(t, '2026-09-21') === false);
    // Deshacer una fecha ya pendiente es idempotente: no lanza ni rompe el estado.
    await sb.uncompleteTaskOccurrence(id, '2026-09-21');
    check('13b. deshacer dos veces seguidas no rompe nada (idempotente)', Array.isArray(sb.state.tasks[0].completedOccurrences));
  }

  // =====================================================================
  section('14) Completar una ocurrencia no afecta a otra');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[0].id;
    await sb.completeTaskOccurrence(id, '2026-09-21');
    const t = sb.state.tasks[0];
    check('14. 09-18 sigue pendiente', sb.isTaskOccurrenceCompleted(t, '2026-09-18') === false);
    check('14. 09-24 sigue pendiente', sb.isTaskOccurrenceCompleted(t, '2026-09-24') === false);
    check('14. solo 09-21 está completada', t.completedOccurrences.join(',') === '2026-09-21');
  }

  // =====================================================================
  section('15) Completar una ocurrencia no pone task.done = true');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[0].id;
    check('15. done empieza en false', sb.state.tasks[0].done === false);
    await sb.completeTaskOccurrence(id, '2026-09-21');
    check('15. done sigue en false tras completar una ocurrencia', sb.state.tasks[0].done === false);
    await sb.completeTaskOccurrence(id, '2026-09-24');
    await sb.completeTaskOccurrence(id, '2026-09-18');
    check('15. done sigue en false incluso completando varias ocurrencias', sb.state.tasks[0].done === false);
  }

  // =====================================================================
  section('16) Tarea no recurrente mantiene `done`');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Comprar pan', dueDate: '2026-09-20' });
    const id = sb.state.tasks[0].id;
    check('16. recurrence es null', sb.state.tasks[0].recurrence === null);
    await sb.completeTaskOccurrence(id, '2026-09-20');
    check('16. completeTaskOccurrence marca done=true (vía `done`, no completedOccurrences)', sb.state.tasks[0].done === true);
    check('16. no se crea completedOccurrences para una tarea no recurrente', sb.state.tasks[0].completedOccurrences === undefined);
    await sb.uncompleteTaskOccurrence(id, '2026-09-20');
    check('16. uncompleteTaskOccurrence vuelve a poner done=false', sb.state.tasks[0].done === false);
    // toggleTask (el camino de siempre) sigue funcionando exactamente igual.
    await sb.toggleTask(id);
    check('16b. toggleTask (el de siempre) sigue funcionando sin cambios', sb.state.tasks[0].done === true);
  }

  // =====================================================================
  section('17) Export/import conserva completedOccurrences');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[0].id;
    await sb.completeTaskOccurrence(id, '2026-09-18');
    await sb.completeTaskOccurrence(id, '2026-09-24');

    // "Exportar": organizator.html serializa state.tasks tal cual (mismo
    // criterio que exportData, que no filtra campos de tasks); se simula
    // con JSON.stringify + JSON.parse, igual que escribir el backup a
    // disco y volver a leerlo.
    const exported = JSON.parse(JSON.stringify({ tasks: sb.state.tasks }));
    check('17. la tarea exportada conserva completedOccurrences', JSON.stringify(exported.tasks[0].completedOccurrences) === JSON.stringify(['2026-09-18', '2026-09-24']));

    // "Importar": mismo criterio que initSettingsDataIO — tasks solo
    // normaliza recurrence, el resto de campos (incluido
    // completedOccurrences) se conserva tal cual.
    const importedTasks = exported.tasks.map(t => (t && typeof t === 'object') ? { ...t, recurrence: sb.sanitizeRecurrence(t.recurrence) } : t);
    check('17. tras "reimportar", completedOccurrences sigue intacto', JSON.stringify(importedTasks[0].completedOccurrences) === JSON.stringify(['2026-09-18', '2026-09-24']));
    check('17. tras "reimportar", isTaskOccurrenceCompleted sigue dando true para esas fechas', sb.isTaskOccurrenceCompleted(importedTasks[0], '2026-09-18') === true && sb.isTaskOccurrenceCompleted(importedTasks[0], '2026-09-24') === true);
  }

  // =====================================================================
  section('18) Datos antiguos sin completedOccurrences');
  // =====================================================================
  {
    const sb = makeSandbox();
    // Tarea recurrente "antigua", tal como quedaría guardada justo tras
    // R-1/R-2 (con recurrence pero sin completedOccurrences en absoluto).
    const legacyTask = { id: 'legacy1', title: 'Regar plantas', dueDate: '2026-09-18', done: false, recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } };
    check('18. isTaskOccurrenceCompleted no lanza y da false', sb.isTaskOccurrenceCompleted(legacyTask, '2026-09-21') === false);
    const occ = sb.getTaskOccurrences(legacyTask, '2026-09-18', '2026-09-24');
    check('18. getTaskOccurrences sigue funcionando con normalidad', occ.length === 3 && occ.every(o => o.done === false));
    sb.state.tasks.push(legacyTask);
    await sb.completeTaskOccurrence('legacy1', '2026-09-21');
    check('18. completeTaskOccurrence crea completedOccurrences sobre la marcha', Array.isArray(sb.state.tasks[0].completedOccurrences) && sb.state.tasks[0].completedOccurrences.includes('2026-09-21'));
  }

  // =====================================================================
  section('19) Los helpers puros no modifican `state.tasks`');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const snapshot = JSON.stringify(sb.state.tasks);
    sb.getTaskOccurrences(sb.state.tasks[0], '2026-09-01', '2026-12-31');
    sb.isTaskOccurrenceCompleted(sb.state.tasks[0], '2026-09-21');
    sb.getTaskOccurrenceId(sb.state.tasks[0].id, '2026-09-21');
    check('19. state.tasks no cambia tras llamar a los helpers puros', JSON.stringify(sb.state.tasks) === snapshot);
  }

  // =====================================================================
  section('20) Los helpers no modifican `recurrence`');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = makeDailyTask(sb);
    const snapshot = JSON.stringify(task.recurrence);
    sb.getTaskOccurrences(task, '2026-09-01', '2026-12-31');
    check('20. getTaskOccurrences no muta task.recurrence', JSON.stringify(task.recurrence) === snapshot);
    sb.isTaskOccurrenceCompleted(task, '2026-09-21');
    check('20. isTaskOccurrenceCompleted tampoco muta task.recurrence', JSON.stringify(task.recurrence) === snapshot);
  }

  // =====================================================================
  section('21) IDs/identificadores de tarea base permanecen estables');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = makeDailyTask(sb);
    const occ = sb.getTaskOccurrences(task, '2026-09-18', '2026-09-24');
    check('21. taskId es siempre el id de la tarea base en todas las ocurrencias', occ.every(o => o.taskId === 'abc'));
    check('21. el id de cada ocurrencia combina taskId + occurrenceDate de forma estable', occ[0].id === sb.getTaskOccurrenceId('abc', occ[0].occurrenceDate));
    check('21. dos llamadas con los mismos argumentos dan el mismo id (no depende de posición)', sb.getTaskOccurrenceId('abc', '2026-09-21') === sb.getTaskOccurrenceId('abc', '2026-09-21'));
    // Los ids de las distintas ocurrencias de la misma tarea son todos
    // distintos entre sí (una fecha por ocurrencia).
    const ids = occ.map(o => o.id);
    check('21b. los ids de las distintas ocurrencias no colisionan entre sí', new Set(ids).size === ids.length);
  }

  // =====================================================================
  section('22) node --check sobre el <script> principal de organizator.html');
  // =====================================================================
  {
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-recurrence-r3-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('22. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
    } catch (e) {
      check('22. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
