/**
 * ORGANIZATOR — Tests de R-4 (integración de recurrencia con EVENTOS)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html los bloques de los que depende R-4:
 *  - UTILIDADES DE FECHA (pad, parseYMD, dowOfDate, addDays, getWeekMonday)
 *  - SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA
 *    R-1: sanitizeRecurrence; R-2: isDateInRecurrence/getNextRecurrenceDate;
 *    R-3: helpers de tareas; y R-4: getEventOccurrenceId/
 *    eventDurationDays/buildEventOccurrence/getEventOccurrences —
 *    helpers puros de eventos)
 * Mismo patrón que test-recurrence-model.js (R-1), test-recurrence-r2.js
 * (R-2) y test-recurrence-tasks-r3.js (R-3): nada de esto pinta UI, ni
 * toca Scheduler/recordatorios/IA/categorías.
 *
 * Uso:  node js/test-recurrence-events-r4.js
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
// UTILIDADES DE FECHA + dowOfDate/getWeekMonday (mismo rango que usan
// test-recurrence-r2.js y test-recurrence-tasks-r3.js).
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
// Bloque real de saneamiento + recurrencia R-1/R-2/R-3/R-4
// (isDateInRecurrence, getNextRecurrenceDate, getTaskOccurrences,
// getEventOccurrences y helpers). Mismo rango que ya extraen
// test-recurrence-model.js, test-recurrence-r2.js y
// test-recurrence-tasks-r3.js.
// ---------------------------------------------------------------------
const recurrenceSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1/R-2/R-3/R-4)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

function makeSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  // 1) Utilidades de fecha (pad/parseYMD/dowOfDate/addDays/getWeekMonday),
  //    de las que dependen R-2/R-4.
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  // 2) Saneamiento + recurrencia R-1 (sanitizeRecurrence) + R-2
  //    (isDateInRecurrence/getNextRecurrenceDate) + R-3 (tareas) + R-4
  //    (getEventOccurrences y compañía).
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2/R-3/R-4)' });
  vm.runInContext(
    `this.sanitizeRecurrence = sanitizeRecurrence;
     this.isDateInRecurrence = isDateInRecurrence;
     this.getNextRecurrenceDate = getNextRecurrenceDate;
     this.getEventOccurrenceId = getEventOccurrenceId;
     this.eventDurationDays = eventDurationDays;
     this.getEventOccurrences = getEventOccurrences;`,
    sandbox, { filename: 'expose-recurrence-R4' }
  );
  return sandbox;
}

const sb = makeSandbox();

// Evento base recurrente reutilizable (mismo ejemplo que el pedido para
// R-4: entrenamiento semanal los jueves desde el 18/09/2026).
function makeWeeklyEvent(overrides = {}) {
  return {
    id: 'evento-1',
    title: 'Entrenamiento',
    date: '2026-09-18',
    startTime: '18:00',
    endTime: '19:30',
    allDay: false,
    location: 'Gimnasio',
    notes: 'Llevar toalla',
    categoryId: 'cat-deporte',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [4], startDate: '2026-09-18', endDate: null },
    ...overrides,
  };
}

// =====================================================================
section('1) Evento no recurrente');
// =====================================================================
{
  const event = { id: 'e1', title: 'Cita médica', date: '2026-09-20', allDay: false, startTime: '10:00', endTime: '10:30', recurrence: null };
  const occ = sb.getEventOccurrences(event, '2026-09-01', '2026-09-30');
  check('1. devuelve exactamente una ocurrencia', occ.length === 1);
  check('1. la ocurrencia cae en date', occ[0].occurrenceDate === '2026-09-20');
  check('1. eventId es el id del evento base', occ[0].eventId === 'e1');
  check('1. conserva el título', occ[0].title === 'Cita médica');
  const outOfRange = sb.getEventOccurrences(event, '2026-10-01', '2026-10-31');
  check('1b. fuera de rango no devuelve nada', outOfRange.length === 0);
}

// =====================================================================
section('2) Evento diario recurrente');
// =====================================================================
{
  const event = makeWeeklyEvent({ recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-09-21').map(o => o.occurrenceDate);
  check('2. genera 18, 19, 20, 21', occ.join(',') === '2026-09-18,2026-09-19,2026-09-20,2026-09-21');
}

// =====================================================================
section('3) Evento cada 3 días');
// =====================================================================
{
  const event = makeWeeklyEvent({ recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-09-27').map(o => o.occurrenceDate);
  check('3. genera 18, 21, 24, 27', occ.join(',') === '2026-09-18,2026-09-21,2026-09-24,2026-09-27');
}

// =====================================================================
section('4) Evento semanal');
// =====================================================================
{
  // 2026-09-18 es viernes (daysOfWeek: [4], igual que el ejemplo del
  // enunciado); sin más días, cae cada semana en viernes.
  const event = makeWeeklyEvent();
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-10-09').map(o => o.occurrenceDate);
  check('4. una ocurrencia por semana, todas en viernes', occ.join(',') === '2026-09-18,2026-09-25,2026-10-02,2026-10-09');
}

// =====================================================================
section('5) Evento semanal con varios días');
// =====================================================================
{
  // martes/jueves = [1,3] (0=Lunes...6=Domingo).
  const event = makeWeeklyEvent({ recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1, 3], startDate: '2026-09-15', endDate: null } });
  const occ = sb.getEventOccurrences(event, '2026-09-15', '2026-09-21').map(o => o.occurrenceDate);
  check('5. una semana completa produce martes y jueves', occ.join(',') === '2026-09-15,2026-09-17');
}

// =====================================================================
section('6) Evento cada 2 semanas');
// =====================================================================
{
  const event = makeWeeklyEvent({ recurrence: { type: 'weekly', interval: 2, daysOfWeek: [4], startDate: '2026-09-18', endDate: null } });
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-10-16').map(o => o.occurrenceDate);
  check('6. salta la semana intermedia (18, 02/10, 16/10 — no 25/09)', occ.join(',') === '2026-09-18,2026-10-02,2026-10-16');
}

// =====================================================================
section('7) Evento mensual');
// =====================================================================
{
  const event = makeWeeklyEvent({ date: '2026-01-15', recurrence: { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-01-15', endDate: null } });
  const occ = sb.getEventOccurrences(event, '2026-01-01', '2026-04-30').map(o => o.occurrenceDate);
  check('7. una ocurrencia por mes, mismo día', occ.join(',') === '2026-01-15,2026-02-15,2026-03-15,2026-04-15');
}

// =====================================================================
section('8) Evento cada 2 meses');
// =====================================================================
{
  const event = makeWeeklyEvent({ date: '2026-01-15', recurrence: { type: 'monthly', interval: 2, daysOfWeek: [], startDate: '2026-01-15', endDate: null } });
  const occ = sb.getEventOccurrences(event, '2026-01-01', '2026-07-31').map(o => o.occurrenceDate);
  check('8. una ocurrencia cada dos meses', occ.join(',') === '2026-01-15,2026-03-15,2026-05-15,2026-07-15');
}

// =====================================================================
section('9) Rango anterior a startDate');
// =====================================================================
{
  const event = makeWeeklyEvent({ recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
  const occ = sb.getEventOccurrences(event, '2026-08-01', '2026-09-21').map(o => o.occurrenceDate);
  check('9. la primera ocurrencia sigue siendo startDate, no antes', occ[0] === '2026-09-18');
  check('9. no hay nada anterior a startDate', occ.join(',') === '2026-09-18,2026-09-21');
}

// =====================================================================
section('10) Rango posterior a endDate');
// =====================================================================
{
  const event = makeWeeklyEvent({ recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: '2026-09-24' } });
  const occAfter = sb.getEventOccurrences(event, '2026-09-25', '2026-12-31');
  check('10. un rango totalmente posterior a endDate no devuelve nada', occAfter.length === 0);
  const occStraddling = sb.getEventOccurrences(event, '2026-09-20', '2026-12-31').map(o => o.occurrenceDate);
  check('10. un rango que cruza endDate se corta justo en endDate', occStraddling.join(',') === '2026-09-21,2026-09-24');
}

// =====================================================================
section('11) Evento all-day');
// =====================================================================
{
  const event = { id: 'e-allday', title: 'Festivo', date: '2026-09-20', allDay: true, recurrence: null };
  const occ = sb.getEventOccurrences(event, '2026-09-01', '2026-09-30');
  check('11. genera la ocurrencia', occ.length === 1);
  check('11. conserva allDay: true', occ[0].allDay === true);
  check('11. no tiene startTime/endTime inventados', occ[0].startTime === undefined && occ[0].endTime === undefined);

  const recurringAllDay = { id: 'e-allday-r', title: 'Día libre', date: '2026-09-18', allDay: true, recurrence: { type: 'weekly', interval: 1, daysOfWeek: [4], startDate: '2026-09-18', endDate: null } };
  const occR = sb.getEventOccurrences(recurringAllDay, '2026-09-18', '2026-09-25');
  check('11b. all-day recurrente conserva allDay en todas las ocurrencias', occR.length === 2 && occR.every(o => o.allDay === true));
}

// =====================================================================
section('12) Evento con startTime/endTime');
// =====================================================================
{
  const event = makeWeeklyEvent();
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-09-25');
  check('12. cada ocurrencia conserva startTime', occ.every(o => o.startTime === '18:00'));
  check('12. cada ocurrencia conserva endTime', occ.every(o => o.endTime === '19:30'));
  check('12. cada ocurrencia conserva allDay: false', occ.every(o => o.allDay === false));
}

// =====================================================================
section('13) Evento de varios días');
// =====================================================================
{
  // Evento base: 10/09 → 12/09 (2 días de duración).
  const event = { id: 'viaje', title: 'Viaje', date: '2026-09-10', endDate: '2026-09-12', allDay: true, recurrence: { type: 'weekly', interval: 1, daysOfWeek: [3], startDate: '2026-09-10', endDate: null } };
  const occ = sb.getEventOccurrences(event, '2026-09-10', '2026-09-24');
  const dates = occ.map(o => `${o.date}->${o.endDate}`);
  check('13. cada ocurrencia conserva el tramo de 2 días', dates.join(' | ') === '2026-09-10->2026-09-12 | 2026-09-17->2026-09-19 | 2026-09-24->2026-09-26');
}

// =====================================================================
section('14) Preservación de duración');
// =====================================================================
{
  // Ejemplo exacto del enunciado: 10/09 → 12/09, ocurrencia en 17/09 → 19/09.
  const event = { id: 'viaje2', title: 'Viaje 2', date: '2026-09-10', endDate: '2026-09-12', recurrence: { type: 'daily', interval: 7, daysOfWeek: [], startDate: '2026-09-10', endDate: null } };
  const occ = sb.getEventOccurrences(event, '2026-09-17', '2026-09-17');
  check('14. la ocurrencia del 17/09 termina el 19/09 (misma duración de 2 días)', occ.length === 1 && occ[0].date === '2026-09-17' && occ[0].endDate === '2026-09-19');
  check('14. eventDurationDays calcula 2 días para el evento base', sb.eventDurationDays(event) === 2);
  // Evento de un solo día: duración 0, endDate no se inventa si no existía.
  const singleDay = { id: 'e-single', title: 'Café', date: '2026-09-10', recurrence: null };
  check('14b. evento sin endDate → eventDurationDays da 0', sb.eventDurationDays(singleDay) === 0);
  const occSingle = sb.getEventOccurrences(singleDay, '2026-09-10', '2026-09-10');
  check('14b. la ocurrencia de un evento sin endDate tampoco tiene endDate', occSingle[0].endDate === undefined || occSingle[0].endDate === null);
}

// =====================================================================
section('15) Preservación de categoryId');
// =====================================================================
{
  const event = makeWeeklyEvent();
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-09-25');
  check('15. todas las ocurrencias conservan categoryId', occ.every(o => o.categoryId === 'cat-deporte'));
  const noCategory = makeWeeklyEvent({ categoryId: undefined });
  const occNoCategory = sb.getEventOccurrences(noCategory, '2026-09-18', '2026-09-18');
  check('15b. un evento sin categoryId no inventa uno', occNoCategory[0].categoryId === undefined);
}

// =====================================================================
section('16) Identificador estable de ocurrencia');
// =====================================================================
{
  const event = makeWeeklyEvent();
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-09-25');
  check('16. el id de cada ocurrencia combina eventId + occurrenceDate', occ[0].id === sb.getEventOccurrenceId('evento-1', occ[0].occurrenceDate));
  check('16. dos llamadas con los mismos argumentos dan el mismo id', sb.getEventOccurrenceId('evento-1', '2026-09-18') === sb.getEventOccurrenceId('evento-1', '2026-09-18'));
  const ids = occ.map(o => o.id);
  check('16b. los ids de las distintas ocurrencias no colisionan entre sí', new Set(ids).size === ids.length);
}

// =====================================================================
section('17) Reordenar state.events no cambia el resultado');
// =====================================================================
{
  const eventA = makeWeeklyEvent({ id: 'a', date: '2026-09-18' });
  const eventB = { id: 'b', title: 'Otro', date: '2026-09-20', recurrence: null };
  const stateEvents1 = [eventA, eventB];
  const stateEvents2 = [eventB, eventA];
  const occFromA1 = sb.getEventOccurrences(stateEvents1[0], '2026-09-18', '2026-09-25');
  const occFromA2 = sb.getEventOccurrences(stateEvents2[1], '2026-09-18', '2026-09-25');
  check('17. getEventOccurrences no depende de la posición del evento en el array', JSON.stringify(occFromA1) === JSON.stringify(occFromA2));
}

// =====================================================================
section('18) Los helpers no modifican state.events');
// =====================================================================
{
  const events = [makeWeeklyEvent(), { id: 'e2', title: 'Otro', date: '2026-09-20', recurrence: null }];
  const snapshot = JSON.stringify(events);
  events.forEach(ev => sb.getEventOccurrences(ev, '2026-09-01', '2026-12-31'));
  check('18. el array de eventos no cambia tras llamar a los helpers', JSON.stringify(events) === snapshot);
}

// =====================================================================
section('19) Los helpers no modifican recurrence');
// =====================================================================
{
  const event = makeWeeklyEvent();
  const snapshot = JSON.stringify(event.recurrence);
  sb.getEventOccurrences(event, '2026-09-01', '2026-12-31');
  check('19. getEventOccurrences no muta event.recurrence', JSON.stringify(event.recurrence) === snapshot);
}

// =====================================================================
section('20) Evento base mantiene su id');
// =====================================================================
{
  const event = makeWeeklyEvent();
  const originalId = event.id;
  sb.getEventOccurrences(event, '2026-09-01', '2026-12-31');
  check('20. event.id no cambia tras generar ocurrencias', event.id === originalId);
  const occ = sb.getEventOccurrences(event, '2026-09-18', '2026-09-18');
  check('20. eventId en la ocurrencia sigue apuntando al id original de la base', occ[0].eventId === originalId);
}

// =====================================================================
section('21) Recurrencia inválida → resultado seguro');
// =====================================================================
{
  // R-1.6: 'yearly' ya es un type válido, así que se usa 'annual'
  // (inexistente) para seguir probando un type realmente desconocido.
  const badType = makeWeeklyEvent({ recurrence: { type: 'annual', interval: 1, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
  check('21. type inválido → sin ocurrencias (no lanza)', sb.getEventOccurrences(badType, '2026-09-01', '2026-12-31').length === 0);

  const badInterval = makeWeeklyEvent({ recurrence: { type: 'daily', interval: 0, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
  check('21. interval inválido → sin ocurrencias', sb.getEventOccurrences(badInterval, '2026-09-01', '2026-12-31').length === 0);

  const badStart = makeWeeklyEvent({ recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: 'no-es-fecha', endDate: null } });
  check('21. startDate inválida → sin ocurrencias', sb.getEventOccurrences(badStart, '2026-09-01', '2026-12-31').length === 0);

  const event = makeWeeklyEvent();
  check('21. rango con fromDate > toDate → []', sb.getEventOccurrences(event, '2026-09-30', '2026-09-01').length === 0);
  check('21. fromDate inválida → []', sb.getEventOccurrences(event, 'no-es-fecha', '2026-09-30').length === 0);
  check('21. event null → []', sb.getEventOccurrences(null, '2026-09-01', '2026-09-30').length === 0);
  check('21. ninguna de las llamadas anteriores lanza una excepción (si llegamos aquí, es así)', true);
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
  const tmpPath = path.join(require('os').tmpdir(), `organizator-recurrence-r4-check-${process.pid}.js`);
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
