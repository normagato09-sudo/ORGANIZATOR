/**
 * ORGANIZATOR — Tests de R-6 (QA e integración de recurrencia en las vistas)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html los bloques de los que depende R-6:
 *  - UTILIDADES DE FECHA + dowOfDate/getWeekMonday (parseYMD/addDays/
 *    isDateInRange/pad, de las que dependen R-2/R-3/R-4/R-6)
 *  - SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA
 *    R-1: sanitizeRecurrence; R-2: isDateInRecurrence/
 *    getNextRecurrenceDate; R-3: getTaskOccurrences y compañía; R-4:
 *    getEventOccurrences y compañía)
 *  - CATEGORÍAS DE EVENTOS (resolveEventCategory/resolveEventBlocksSchedule,
 *    de las que depende eventsForSchedulerInRange) + RECURRENCIA —
 *    integración con vistas (Fase R-6): taskOccurrencesInRange,
 *    expandEventOccurrencesInRange, eventsOnDate,
 *    eventsForSchedulerInRange, toggleTaskOccurrenceFromView
 *  - CRUD (addTask/updateTask/toggleTask/completeTaskOccurrence/
 *    uncompleteTaskOccurrence/addEvent/updateEvent)
 *  - CONFIGURACIÓN (PRIORITIES/DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/
 *    MONTH_NAMES) + función esc(), de las que dependen taskRowHTML/
 *    eventRowHTML (FILAS DE TAREA/EVENTO — también tocadas por R-6:
 *    reciben ocurrencias derivadas, no solo la entidad base)
 *
 * R-6 solo INTEGRA las vistas con los helpers ya existentes de R-2/R-3/
 * R-4 — no reimplementa ningún cálculo de fechas. Esta suite prueba las
 * funciones de integración (taskOccurrencesInRange, etc.) como funciones
 * puras/orquestadoras contra un `state` en memoria, con el mismo patrón
 * que el resto de la suite (test-recurrence-tasks-r3.js,
 * test-recurrence-events-r4.js). No hay jsdom: el DOM real de las vistas
 * (renderInicio/renderCalendar/renderDayPanel/renderSemana) no se
 * ejecuta aquí, pero SÍ se prueban exactamente las mismas funciones que
 * esas vistas llaman para obtener sus datos.
 *
 * Uso:  node js/test-recurrence-r6.js
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
// CATEGORÍAS DE EVENTOS (resolveEventCategory/resolveEventBlocksSchedule)
// + RECURRENCIA — integración con vistas (Fase R-6): ambos bloques van
// seguidos en organizator.html, se extraen juntos.
// ---------------------------------------------------------------------
const categoriesAndR6Src = extractBetween(
  html,
  '/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  '\n\n/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt',
  'bloque CATEGORÍAS DE EVENTOS + RECURRENCIA — integración con vistas (Fase R-6)'
);

// ---------------------------------------------------------------------
// Bloque real de CRUD (addTask/updateTask/toggleTask/
// completeTaskOccurrence/uncompleteTaskOccurrence/addEvent/updateEvent).
// ---------------------------------------------------------------------
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS',
  'bloque CRUD'
);

// ---------------------------------------------------------------------
// CONFIGURACIÓN (PRIORITIES/DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/
// MONTH_NAMES) + función esc() + FILAS DE TAREA/EVENTO (taskRowHTML/
// eventRowHTML) — estas dos últimas SÍ las toca R-6: ahora reciben
// ocurrencias derivadas (con taskId/eventId + occurrenceDate) además de
// la entidad base, y deben seguir identificando editar/eliminar con el
// id de la entidad BASE, nunca con el id compuesto de la ocurrencia.
// ---------------------------------------------------------------------
const configSrc = extractBetween(
  html,
  'const PRIORITIES = ',
  '\n\n/* ==================================================================\n   AJUSTES',
  'constantes PRIORITIES/DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES'
);
const escSrc = extractBetween(
  html,
  'function esc(s){',
  '\n}\n\n/* ==================================================================\n   FILAS DE TAREA',
  'función esc'
) + '\n}';
const rowsSrc = extractBetween(
  html,
  'function taskRowHTML(t){',
  '\n\n/* ==================================================================\n   RENDER: CALENDARIO',
  'bloque FILAS DE TAREA/EVENTO (taskRowHTML/eventRowHTML)'
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
    `let state = { tasks: [], events: [], eventCategories: [] };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function saveEventCategories(){ await window.storage.set('eventCategories', JSON.stringify(state.eventCategories), false); }
     async function cancelRemindersForTarget(){ /* no-op: fuera de alcance de R-6 */ }
     function renderCurrentView(){ /* no-op: el DOM real no se ejecuta en esta suite (sin jsdom) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-6 (ver nota de minutos reales) */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(categoriesAndR6Src, sandbox, { filename: 'organizator.html (categorías + RECURRENCIA vistas R-6)' });
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(configSrc, sandbox, { filename: 'organizator.html (PRIORITIES/DOW_*/MONTH_NAMES)' });
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(rowsSrc, sandbox, { filename: 'organizator.html (taskRowHTML/eventRowHTML)' });
  vm.runInContext(
    `this.sanitizeRecurrence = sanitizeRecurrence;
     this.isDateInRecurrence = isDateInRecurrence;
     this.getNextRecurrenceDate = getNextRecurrenceDate;
     this.getTaskOccurrences = getTaskOccurrences;
     this.getEventOccurrences = getEventOccurrences;
     this.isTaskOccurrenceCompleted = isTaskOccurrenceCompleted;
     this.taskOccurrencesInRange = taskOccurrencesInRange;
     this.expandEventOccurrencesInRange = expandEventOccurrencesInRange;
     this.eventsOnDate = eventsOnDate;
     this.eventsForSchedulerInRange = eventsForSchedulerInRange;
     this.toggleTaskOccurrenceFromView = toggleTaskOccurrenceFromView;
     this.addTask = addTask;
     this.updateTask = updateTask;
     this.toggleTask = toggleTask;
     this.completeTaskOccurrence = completeTaskOccurrence;
     this.uncompleteTaskOccurrence = uncompleteTaskOccurrence;
     this.addEvent = addEvent;
     this.updateEvent = updateEvent;
     this.addEventCategory = addEventCategory;
     this.taskRowHTML = taskRowHTML;
     this.eventRowHTML = eventRowHTML;
     this.state = state;`,
    sandbox, { filename: 'expose-recurrence-R6' }
  );
  return sandbox;
}

(async () => {

const sb = makeSandbox();

// =====================================================================
section('1) Tarea no recurrente sigue apareciendo');
// =====================================================================
{
  await sb.addTask({ title: 'Comprar pan', dueDate: '2026-09-20' });
  const occ = sb.taskOccurrencesInRange(sb.state.tasks, '2026-09-01', '2026-09-30');
  check('1. la tarea no recurrente aparece exactamente una vez', occ.length === 1);
  check('1. en su propia fecha (dueDate)', occ[0].occurrenceDate === '2026-09-20');
}

// =====================================================================
section('2) Evento no recurrente sigue apareciendo');
// =====================================================================
{
  await sb.addEvent({ title: 'Cita médica', date: '2026-09-20', allDay: false, startTime: '10:00' });
  const recurring = sb.expandEventOccurrencesInRange(sb.state.events, '2026-09-01', '2026-09-30');
  const onDate = sb.eventsOnDate(sb.state.events, recurring, '2026-09-20');
  check('2. el evento no recurrente aparece en su fecha', onDate.length === 1 && onDate[0].title === 'Cita médica');
  const onOtherDate = sb.eventsOnDate(sb.state.events, recurring, '2026-09-21');
  check('2b. no aparece en otra fecha', onOtherDate.length === 0);
}

// =====================================================================
section('3) Tarea diaria aparece en las fechas correctas');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 2, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-07').map(o => o.occurrenceDate);
  check('3. genera 01, 03, 05, 07 de septiembre (cada 2 días)', occ.join(',') === '2026-09-01,2026-09-03,2026-09-05,2026-09-07');
  check('3. state.tasks sigue teniendo una única tarea base', sb2.state.tasks.length === 1);
}

// =====================================================================
section('4) Tarea semanal aparece en los días correctos');
// =====================================================================
{
  const sb2 = makeSandbox();
  // Lunes/miércoles/viernes = [0,2,4]; 2026-09-07 es lunes.
  await sb2.addTask({ title: 'Gimnasio', dueDate: '2026-09-07', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [0, 2, 4], startDate: '2026-09-07', endDate: null } });
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-07', '2026-09-13').map(o => o.occurrenceDate);
  check('4. genera lunes/miércoles/viernes de esa semana', occ.join(',') === '2026-09-07,2026-09-09,2026-09-11');
}

// =====================================================================
section('5) Tarea mensual aparece correctamente');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Pagar alquiler', dueDate: '2026-01-01', recurrence: { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-01-01', endDate: null } });
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-01-01', '2026-04-30').map(o => o.occurrenceDate);
  check('5. una ocurrencia por mes, mismo día', occ.join(',') === '2026-01-01,2026-02-01,2026-03-01,2026-04-01');
}

// =====================================================================
section('6) Evento diario');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addEvent({ title: 'Meditar', date: '2026-09-01', allDay: true, recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const recurring = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-04');
  const dates = recurring.map(o => o.occurrenceDate);
  check('6. genera 01, 02, 03, 04 de septiembre', dates.join(',') === '2026-09-01,2026-09-02,2026-09-03,2026-09-04');
  check('6. state.events sigue teniendo un único evento base', sb2.state.events.length === 1);
}

// =====================================================================
section('7) Evento semanal');
// =====================================================================
{
  const sb2 = makeSandbox();
  // 2026-09-18 es viernes (daysOfWeek: [4]).
  await sb2.addEvent({ title: 'Entrenamiento', date: '2026-09-18', startTime: '18:00', endTime: '19:30', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [4], startDate: '2026-09-18', endDate: null } });
  const recurring = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-18', '2026-10-09');
  const dates = recurring.map(o => o.occurrenceDate);
  check('7. una ocurrencia por semana, todas en viernes', dates.join(',') === '2026-09-18,2026-09-25,2026-10-02,2026-10-09');
}

// =====================================================================
section('8) Evento mensual');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addEvent({ title: 'Revisión', date: '2026-01-15', recurrence: { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-01-15', endDate: null } });
  const recurring = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-01-01', '2026-03-31');
  const dates = recurring.map(o => o.occurrenceDate);
  check('8. una ocurrencia por mes, mismo día', dates.join(',') === '2026-01-15,2026-02-15,2026-03-15');
}

// =====================================================================
section('9) Recurrencia limitada por endDate');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Curso', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: '2026-09-05' } });
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-30').map(o => o.occurrenceDate);
  check('9. no hay ocurrencias después de endDate', occ.join(',') === '2026-09-01,2026-09-02,2026-09-03,2026-09-04,2026-09-05');

  await sb2.addEvent({ title: 'Curso evento', date: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: '2026-09-05' } });
  const evOcc = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-30').map(o => o.occurrenceDate);
  check('9b. lo mismo para eventos', evOcc.join(',') === '2026-09-01,2026-09-02,2026-09-03,2026-09-04,2026-09-05');
}

// =====================================================================
section('10) Ocurrencias anteriores a startDate no aparecen');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 2, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-08-01', '2026-09-03').map(o => o.occurrenceDate);
  check('10. la primera ocurrencia sigue siendo startDate, nada antes', occ.join(',') === '2026-09-01,2026-09-03');

  await sb2.addEvent({ title: 'Evento con inicio', date: '2026-09-01', recurrence: { type: 'daily', interval: 2, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const evOcc = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-08-01', '2026-09-03').map(o => o.occurrenceDate);
  check('10b. lo mismo para eventos', evOcc.join(',') === '2026-09-01,2026-09-03');
}

// =====================================================================
section('11) Una tarea base no se duplica en state.tasks');
// =====================================================================
{
  const sb2 = makeSandbox();
  const before = sb2.state.tasks.length;
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-12-31'); // genera ~120 ocurrencias derivadas
  check('11. state.tasks solo creció en 1 (la tarea base)', sb2.state.tasks.length === before + 1);
  check('11b. el id de la tarea base no cambia', sb2.state.tasks[0].id && !sb2.state.tasks[0].id.includes('::'));
}

// =====================================================================
section('12) Un evento base no se duplica en state.events');
// =====================================================================
{
  const sb2 = makeSandbox();
  const before = sb2.state.events.length;
  await sb2.addEvent({ title: 'Entrenamiento', date: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-12-31');
  check('12. state.events solo creció en 1 (el evento base)', sb2.state.events.length === before + 1);
  check('12b. el id del evento base no cambia', sb2.state.events[0].id && !sb2.state.events[0].id.includes('::'));
}

// =====================================================================
section('13) Completar una ocurrencia recurrente solo afecta a esa fecha');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const id = sb2.state.tasks[0].id;
  await sb2.toggleTaskOccurrenceFromView(id, '2026-09-03');
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-05');
  const byDate = Object.fromEntries(occ.map(o => [o.occurrenceDate, o.done]));
  check('13. 03/09 queda completada', byDate['2026-09-03'] === true);
  check('13. 01/09, 02/09, 04/09, 05/09 siguen pendientes', byDate['2026-09-01'] === false && byDate['2026-09-02'] === false && byDate['2026-09-04'] === false && byDate['2026-09-05'] === false);
}

// =====================================================================
section('14) Deshacer una ocurrencia solo afecta a esa fecha');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const id = sb2.state.tasks[0].id;
  await sb2.toggleTaskOccurrenceFromView(id, '2026-09-02');
  await sb2.toggleTaskOccurrenceFromView(id, '2026-09-03');
  await sb2.toggleTaskOccurrenceFromView(id, '2026-09-02'); // deshace 02/09 (segundo toggle)
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-05');
  const byDate = Object.fromEntries(occ.map(o => [o.occurrenceDate, o.done]));
  check('14. 02/09 vuelve a estar pendiente', byDate['2026-09-02'] === false);
  check('14. 03/09 sigue completada (no se ha tocado)', byDate['2026-09-03'] === true);
}

// =====================================================================
section('15) completedOccurrences se conserva');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const id = sb2.state.tasks[0].id;
  await sb2.completeTaskOccurrence(id, '2026-09-01');
  await sb2.completeTaskOccurrence(id, '2026-09-05');
  const t = sb2.state.tasks[0];
  check('15. completedOccurrences contiene exactamente esas dos fechas', JSON.stringify(t.completedOccurrences.slice().sort()) === JSON.stringify(['2026-09-01', '2026-09-05']));
  // Ejemplo exacto del enunciado: la tarea se ve completada el 01/09 y el
  // 05/09, pendiente el resto.
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-07');
  const byDate = Object.fromEntries(occ.map(o => [o.occurrenceDate, o.done]));
  check('15b. 01/09 completada, 05/09 completada, resto pendiente', byDate['2026-09-01'] === true && byDate['2026-09-05'] === true &&
    byDate['2026-09-02'] === false && byDate['2026-09-03'] === false && byDate['2026-09-04'] === false && byDate['2026-09-06'] === false && byDate['2026-09-07'] === false);
}

// =====================================================================
section('16) Otras ocurrencias siguen pendientes');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const id = sb2.state.tasks[0].id;
  await sb2.completeTaskOccurrence(id, '2026-09-03');
  const occ = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-10');
  const pendingCount = occ.filter(o => !o.done).length;
  check('16. 9 de las 10 ocurrencias siguen pendientes (solo 03/09 está completada)', pendingCount === 9 && occ.length === 10);
}

// =====================================================================
section('17) ID de ocurrencia estable');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  await sb2.addEvent({ title: 'Entrenamiento', date: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const taskId = sb2.state.tasks[0].id;
  const eventId = sb2.state.events[0].id;
  const occ1 = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-05');
  const occ2 = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-05');
  check('17. el id de una ocurrencia de tarea es el mismo entre dos llamadas', occ1[2].id === occ2[2].id);
  check('17. el id combina taskId + occurrenceDate', occ1[2].id === `${taskId}::${occ1[2].occurrenceDate}` && occ1[2].taskId === taskId);
  const evOcc1 = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-05');
  const evOcc2 = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-05');
  check('17b. el id de una ocurrencia de evento es el mismo entre dos llamadas', evOcc1[2].id === evOcc2[2].id);
  check('17b. el id combina eventId + occurrenceDate', evOcc1[2].id === `${eventId}::${evOcc1[2].occurrenceDate}` && evOcc1[2].eventId === eventId);
}

// =====================================================================
section('18) Reordenar arrays no cambia el resultado');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addTask({ title: 'A', dueDate: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  await sb2.addTask({ title: 'B', dueDate: '2026-09-05' });
  const original = sb2.state.tasks.slice();
  const reversed = sb2.state.tasks.slice().reverse();
  const occOriginal = sb2.taskOccurrencesInRange(original, '2026-09-01', '2026-09-07').map(o => o.id).sort();
  const occReversed = sb2.taskOccurrencesInRange(reversed, '2026-09-01', '2026-09-07').map(o => o.id).sort();
  check('18. mismo conjunto de ocurrencias de tarea, sin importar el orden del array', JSON.stringify(occOriginal) === JSON.stringify(occReversed));

  await sb2.addEvent({ title: 'C', date: '2026-09-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  await sb2.addEvent({ title: 'D', date: '2026-09-05' });
  const eventsOriginal = sb2.state.events.slice();
  const eventsReversed = sb2.state.events.slice().reverse();
  const evOccOriginal = sb2.expandEventOccurrencesInRange(eventsOriginal, '2026-09-01', '2026-09-07').map(o => o.id).sort();
  const evOccReversed = sb2.expandEventOccurrencesInRange(eventsReversed, '2026-09-01', '2026-09-07').map(o => o.id).sort();
  check('18b. mismo conjunto de ocurrencias de evento, sin importar el orden del array', JSON.stringify(evOccOriginal) === JSON.stringify(evOccReversed));
}

// =====================================================================
section('19) Eventos all-day recurrentes');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addEvent({ title: 'Festivo', date: '2026-09-01', allDay: true, recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1], startDate: '2026-09-01', endDate: null } });
  const recurring = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-15');
  check('19. todas las ocurrencias conservan allDay: true', recurring.length > 0 && recurring.every(o => o.allDay === true));
}

// =====================================================================
section('20) Eventos recurrentes con hora');
// =====================================================================
{
  const sb2 = makeSandbox();
  await sb2.addEvent({ title: 'Entrenamiento', date: '2026-09-18', startTime: '18:00', endTime: '19:30', allDay: false, recurrence: { type: 'weekly', interval: 1, daysOfWeek: [4], startDate: '2026-09-18', endDate: null } });
  const recurring = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-18', '2026-10-09');
  check('20. todas las ocurrencias conservan startTime', recurring.length > 0 && recurring.every(o => o.startTime === '18:00'));
  check('20. todas las ocurrencias conservan endTime', recurring.every(o => o.endTime === '19:30'));
  check('20. todas las ocurrencias conservan allDay: false', recurring.every(o => o.allDay === false));
}

// =====================================================================
section('21) Eventos recurrentes de varios días');
// =====================================================================
{
  const sb2 = makeSandbox();
  // Evento base: 10/09 → 12/09 (2 días de duración), recurrente cada semana.
  await sb2.addEvent({ title: 'Viaje', date: '2026-09-10', endDate: '2026-09-12', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [3], startDate: '2026-09-10', endDate: null } });
  const recurring = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-10', '2026-09-24');
  const spans = recurring.map(o => `${o.date}->${o.endDate}`);
  check('21. cada ocurrencia conserva el tramo de 2 días', spans.join(' | ') === '2026-09-10->2026-09-12 | 2026-09-17->2026-09-19 | 2026-09-24->2026-09-26');
  // También visible desde eventsOnDate en un día intermedio del tramo.
  const onMiddleDay = sb2.eventsOnDate(sb2.state.events, recurring, '2026-09-18');
  check('21b. eventsOnDate encuentra la ocurrencia en un día intermedio de su tramo (no solo el día de inicio)', onMiddleDay.length === 1 && onMiddleDay[0].date === '2026-09-17' && onMiddleDay[0].endDate === '2026-09-19');
}

// =====================================================================
section('22) categoryId se conserva');
// =====================================================================
{
  const sb2 = makeSandbox();
  const cat = await sb2.addEventCategory({ name: 'Deporte', color: '#ff0000', blocksSchedule: true });
  await sb2.addEvent({ title: 'Entrenamiento', date: '2026-09-01', categoryId: cat.id, recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } });
  const recurring = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-05');
  check('22. todas las ocurrencias conservan categoryId', recurring.length > 0 && recurring.every(o => o.categoryId === cat.id));
  // eventsForSchedulerInRange también debe conservarlo (y resolver blocksSchedule a partir de él).
  const forScheduler = sb2.eventsForSchedulerInRange('2026-09-01', '2026-09-05');
  check('22b. eventsForSchedulerInRange conserva categoryId y resuelve blocksSchedule', forScheduler.length > 0 && forScheduler.every(o => o.categoryId === cat.id && o.blocksSchedule === true));
}

// =====================================================================
section('23) Las vistas no generan ocurrencias fuera del rango visible');
// =====================================================================
{
  const sb2 = makeSandbox();
  // Tarea/evento SIN fin (endDate: null): si se generara la recurrencia
  // completa en vez de acotarla al rango pedido, esto podría "explotar"
  // o devolver miles de fechas. Se pide solo una semana.
  await sb2.addTask({ title: 'Ducha', dueDate: '2026-01-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-01-01', endDate: null } });
  await sb2.addEvent({ title: 'Entrenamiento', date: '2026-01-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-01-01', endDate: null } });
  const weekOcc = sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-07');
  check('23. una semana de una tarea diaria sin fin da exactamente 7 ocurrencias (no miles)', weekOcc.length === 7);
  check('23. ninguna ocurrencia cae fuera de [fromDate, toDate]', weekOcc.every(o => o.occurrenceDate >= '2026-09-01' && o.occurrenceDate <= '2026-09-07'));
  const weekEvOcc = sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-07');
  check('23b. lo mismo para el evento diario sin fin', weekEvOcc.length === 7 && weekEvOcc.every(o => o.occurrenceDate >= '2026-09-01' && o.occurrenceDate <= '2026-09-07'));

  // Instrumentación: pedir "un mes" de ocurrencias llama a
  // getTaskOccurrences/getEventOccurrences UNA vez por tarea/evento (el
  // rango completo de una sola pasada), no una vez por cada día visible
  // — así es como taskOccurrencesInRange/expandEventOccurrencesInRange
  // evitan recalcular 30 veces lo mismo en un mes.
  let taskCalls = 0, eventCalls = 0;
  const realGetTaskOccurrences = sb2.getTaskOccurrences;
  const realGetEventOccurrences = sb2.getEventOccurrences;
  sb2.getTaskOccurrences = (...args) => { taskCalls++; return realGetTaskOccurrences(...args); };
  sb2.getEventOccurrences = (...args) => { eventCalls++; return realGetEventOccurrences(...args); };
  sb2.taskOccurrencesInRange(sb2.state.tasks, '2026-09-01', '2026-09-30');
  sb2.expandEventOccurrencesInRange(sb2.state.events, '2026-09-01', '2026-09-30');
  check('23c. getTaskOccurrences se llama exactamente una vez por tarea para todo el mes (no 30 veces)', taskCalls === sb2.state.tasks.length);
  check('23c. getEventOccurrences se llama exactamente una vez por evento recurrente para todo el mes (no 30 veces)', eventCalls === sb2.state.events.filter(e => !!e.recurrence).length);
}

// =====================================================================
section('24) No se modifica la lógica R-2');
// =====================================================================
{
  const sb2 = makeSandbox();
  // Mismos casos que ya cubre test-recurrence-r2.js (regresión completa
  // en ese archivo); aquí solo se confirma que R-6 no ha alterado el
  // comportamiento de isDateInRecurrence/getNextRecurrenceDate al
  // extraerlos desde este mismo punto de la integración.
  const daily3 = { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-01', endDate: null };
  check('24. isDateInRecurrence sigue funcionando igual (daily cada 3 días)', sb2.isDateInRecurrence('2026-09-07', daily3) === true && sb2.isDateInRecurrence('2026-09-02', daily3) === false);
  check('24. getNextRecurrenceDate sigue funcionando igual', sb2.getNextRecurrenceDate('2026-09-01', daily3) === '2026-09-04');
  // No hay ninguna función "isDateInRecurrenceForView" ni equivalente:
  // taskOccurrencesInRange/expandEventOccurrencesInRange llaman
  // directamente a getTaskOccurrences/getEventOccurrences (R-3/R-4), que
  // a su vez llaman a isDateInRecurrence/getNextRecurrenceDate (R-2) —
  // una sola implementación, reutilizada en cadena.
  check('24b. taskOccurrencesInRange es literalmente un flatMap sobre getTaskOccurrences (sin reimplementar cálculo)', sb2.taskOccurrencesInRange.toString().includes('getTaskOccurrences'));
  check('24b. expandEventOccurrencesInRange es literalmente un flatMap sobre getEventOccurrences (sin reimplementar cálculo)', sb2.expandEventOccurrencesInRange.toString().includes('getEventOccurrences'));
}

// =====================================================================
section('26) taskRowHTML/eventRowHTML: editar/eliminar actúan sobre la entidad base');
// =====================================================================
{
  const sb2 = makeSandbox();
  // Ocurrencia de tarea recurrente (id compuesto "abc::2026-09-21",
  // taskId "abc" — mismo shape que produce getTaskOccurrences, R-3).
  const occTask = { id: 'abc::2026-09-21', taskId: 'abc', occurrenceDate: '2026-09-21', title: 'Ducharse', done: false, dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } };
  const taskHtml = sb2.taskRowHTML(occTask);
  check('26. el botón editar-tarea usa el id de la tarea BASE (taskId), no el id compuesto de la ocurrencia', /data-action="edit-task" data-id="abc"/.test(taskHtml));
  check('26. el botón eliminar-tarea usa el id de la tarea BASE', /data-action="delete-task" data-id="abc"/.test(taskHtml));
  check('26. el checkbox identifica taskId y occurrenceDate por separado (para completar SOLO esa fecha)', /data-task-id="abc" data-occurrence-date="2026-09-21"/.test(taskHtml));
  check('26. se muestra la fecha de la OCURRENCIA (21/09), no la dueDate original de la tarea base (18/09)', taskHtml.includes('2026-09-21') && !taskHtml.includes('2026-09-18'));

  // Tarea no recurrente: getTaskOccurrences también la envuelve en forma
  // de ocurrencia (R-3), pero taskId === id de la propia tarea (no hay
  // "otra" tarea base distinta) — mismo comportamiento que antes de R-6.
  const plainTask = { id: 'xyz', taskId: 'xyz', occurrenceDate: '2026-09-20', title: 'Comprar pan', done: false, dueDate: '2026-09-20', recurrence: null };
  const plainTaskHtml = sb2.taskRowHTML(plainTask);
  check('26b. tarea no recurrente: editar/eliminar siguen usando su propio id', /data-action="edit-task" data-id="xyz"/.test(plainTaskHtml) && /data-action="delete-task" data-id="xyz"/.test(plainTaskHtml));

  // Ocurrencia de evento recurrente (mismo shape que getEventOccurrences, R-4).
  const occEvent = { id: 'evt1::2026-09-21', eventId: 'evt1', occurrenceDate: '2026-09-21', title: 'Entrenamiento', date: '2026-09-21', allDay: false, startTime: '18:00', endTime: '19:30', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [0], startDate: '2026-09-14', endDate: null } };
  const eventHtml = sb2.eventRowHTML(occEvent);
  check('26c. el botón editar-evento usa el id del evento BASE (eventId), no el id compuesto de la ocurrencia', /data-action="edit-event" data-id="evt1"/.test(eventHtml));
  check('26c. el botón eliminar-evento usa el id del evento BASE', /data-action="delete-event" data-id="evt1"/.test(eventHtml));
  // eventRowHTML pinta la fecha con humanDateShort(e.date) (p.ej. "Lun,
  // 21 sep"), no el ISO crudo — se compara contra la MISMA función, no
  // contra el string '2026-09-21' literal.
  check('26c. la fila del evento sigue mostrando la fecha de la ocurrencia (ya desplazada por buildEventOccurrence, R-4)', eventHtml.includes(sb2.humanDateShort(occEvent.date)));
  check('26c. la fila del evento sigue mostrando la hora de la ocurrencia', eventHtml.includes('18:00'));
}

// =====================================================================
section('27) node --check sobre el <script> principal de organizator.html');
// =====================================================================
{
  const scriptStartMarker = '\n<script>\n';
  const scriptEndMarker = '\n</script>';
  const scriptStart = html.indexOf(scriptStartMarker);
  if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
  const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
  if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
  const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
  const tmpPath = path.join(require('os').tmpdir(), `organizator-recurrence-r6-check-${process.pid}.js`);
  fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
    check('27. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
  } catch (e) {
    check('27. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
    console.log(String(e.stderr || e.message));
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

console.log(`\n${pass} pasaron, ${fail} fallaron.`);
process.exit(fail > 0 ? 1 : 0);
})();
