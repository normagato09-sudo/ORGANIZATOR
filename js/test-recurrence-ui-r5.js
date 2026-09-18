/**
 * ORGANIZATOR — Tests de R-5 (UI de recurrencia para TAREAS y EVENTOS)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html los bloques de los que depende R-5:
 *  - CONFIGURACIÓN (DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES)
 *  - función esc() (usada por recurrenceControlsHtml para escapar HTML)
 *  - UTILIDADES DE FECHA + dowOfDate/getWeekMonday (de las que dependen
 *    R-2/R-3/R-4, cargadas por consistencia con el resto de la suite)
 *  - SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA
 *    R-1: sanitizeRecurrence; R-2/R-3/R-4)
 *  - RECURRENCIA — UI compartida entre tarea y evento (Fase R-5):
 *    recurrenceControlsHtml/wireRecurrenceControls/
 *    readRecurrenceFromForm/isRecurrenceEndDateValid/recurrenceUnitLabel
 *  - CRUD (addTask/updateTask/addEvent/updateEvent)
 *
 * No hay jsdom instalado en este proyecto, así que esta suite prueba:
 *  a) recurrenceControlsHtml como generador de STRING (comprobado con
 *     aserciones sobre el HTML devuelto: value/selected/checked/
 *     disabled/labels), sin necesidad de un DOM real;
 *  b) readRecurrenceFromForm/isRecurrenceEndDateValid como funciones
 *     puras, usando el `FormData` nativo de Node (disponible desde
 *     Node 18, misma API que `new FormData(formElement)` en el
 *     navegador: fd.get()/fd.getAll());
 *  c) el flujo completo end-to-end contra addTask/updateTask/addEvent/
 *     updateEvent reales (mismo patrón que test-recurrence-model.js),
 *     para confirmar que la UI reutiliza sanitizeRecurrence y no crea
 *     copias persistentes.
 * wireRecurrenceControls (el show/hide en un DOM real) no se puede
 * probar sin jsdom; su lógica es un simple show/hide sobre los mismos
 * datos que sí se prueban aquí (recurrenceControlsHtml/
 * readRecurrenceFromForm), así que el riesgo no cubierto es mínimo.
 *
 * Uso:  node js/test-recurrence-ui-r5.js
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
// CONFIGURACIÓN: DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES, de
// las que depende recurrenceControlsHtml (días de la semana).
// ---------------------------------------------------------------------
const dowNamesSrc = extractBetween(
  html,
  'const DOW_NAMES = ',
  '\n\n/* ==================================================================\n   AJUSTES',
  'constantes DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES'
);

// ---------------------------------------------------------------------
// función esc() (escapa HTML), usada por recurrenceControlsHtml.
// ---------------------------------------------------------------------
const escSrc = extractBetween(
  html,
  'function esc(s){',
  '\n}\n\n/* ==================================================================\n   FILAS DE TAREA',
  'función esc'
) + '\n}';

// ---------------------------------------------------------------------
// UTILIDADES DE FECHA + dowOfDate/getWeekMonday (mismo rango que usan
// test-recurrence-r2.js, test-recurrence-tasks-r3.js y
// test-recurrence-events-r4.js).
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
// (sanitizeRecurrence, isDateInRecurrence, getNextRecurrenceDate,
// getTaskOccurrences, getEventOccurrences y helpers). Mismo rango que ya
// extraen las suites de R-1 a R-4.
// ---------------------------------------------------------------------
const recurrenceSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1/R-2/R-3/R-4)'
);

// ---------------------------------------------------------------------
// RECURRENCIA — UI compartida entre tarea y evento (Fase R-5):
// recurrenceUnitLabel/recurrenceControlsHtml/wireRecurrenceControls/
// readRecurrenceFromForm/isRecurrenceEndDateValid.
// ---------------------------------------------------------------------
const recurrenceUiSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)',
  '\n\n/* ==================================================================\n   MODAL: TAREA',
  'bloque RECURRENCIA — UI compartida (Fase R-5)'
);

// ---------------------------------------------------------------------
// Bloque real de CRUD (addTask/updateTask/deleteTask/toggleTask/
// completeTaskOccurrence/uncompleteTaskOccurrence/addEvent/updateEvent/
// deleteEvent) de organizator.html.
// ---------------------------------------------------------------------
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS',
  'bloque CRUD'
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
  // FormData nativo de Node: misma API que usa el navegador con
  // `new FormData(formElement)` (fd.get()/fd.getAll()), así que
  // readRecurrenceFromForm se prueba con el objeto real que recibe en
  // producción, no con un mock aparte.
  sandbox.FormData = FormData;
  vm.createContext(sandbox);
  vm.runInContext(dowNamesSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES)' });
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2/R-3/R-4)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5)' });
  vm.runInContext(
    `let state = { tasks: [], events: [] };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function cancelRemindersForTarget(){ /* no-op: fuera de alcance de R-5 */ }
     function renderCurrentView(){ /* no-op: fuera de alcance de R-5 (UI de render) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-5 */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(
    `this.sanitizeRecurrence = sanitizeRecurrence;
     this.recurrenceUnitLabel = recurrenceUnitLabel;
     this.recurrenceControlsHtml = recurrenceControlsHtml;
     this.readRecurrenceFromForm = readRecurrenceFromForm;
     this.isRecurrenceEndDateValid = isRecurrenceEndDateValid;
     this.addTask = addTask;
     this.updateTask = updateTask;
     this.addEvent = addEvent;
     this.updateEvent = updateEvent;
     this.state = state;`,
    sandbox, { filename: 'expose-recurrence-ui-R5' }
  );
  return sandbox;
}

const sb = makeSandbox();

// Helper de test: construye un FormData nativo a partir de un objeto
// plano { campo: valor | [valores] } — [valores] hace varios append()
// (usado para repeatDaysOfWeek, que puede tener varias casillas marcadas).
function makeFormData(fields) {
  const fd = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach(v => fd.append(key, v));
    else if (value !== undefined && value !== null) fd.append(key, value);
  });
  return fd;
}

// Campos por defecto de "No repetir" (tal como saldría del formulario
// recién abierto, sin tocar nada, para una tarea/evento nuevo).
function noneFields() {
  return { repeatType: 'none', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' };
}

(async () => {

  // =====================================================================
  section('1) Tarea nueva por defecto → recurrence: null');
  // =====================================================================
  {
    const fd = makeFormData(noneFields());
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('1. readRecurrenceFromForm con "No repetir" devuelve null', raw === null);
    await sb.addTask({ title: 'Tarea nueva', dueDate: '2026-09-18', recurrence: raw });
    check('1. la tarea creada queda con recurrence: null', sb.state.tasks[0].recurrence === null);
    // El HTML por defecto (sin recurrencia existente) también arranca en "No repetir".
    const html1 = sb.recurrenceControlsHtml('task', null);
    check('1b. el HTML inicial marca "No repetir" como seleccionada', /<option value="none" selected>No repetir<\/option>/.test(html1));
    check('1b. el detalle de recurrencia empieza oculto', /id="task-repeat-detail" style="display:none;"/.test(html1));
  }

  // =====================================================================
  section('2) Seleccionar diario');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'daily', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('2. type: daily', raw.type === 'daily');
    check('2. startDate se deriva de la fecha ancla (dueDate/date)', raw.startDate === '2026-09-18');
    const r = sb.sanitizeRecurrence(raw);
    check('2. tras sanitizeRecurrence sigue siendo daily válida', r && r.type === 'daily');
  }

  // =====================================================================
  section('3) Intervalo diario');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'daily', repeatInterval: '3', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('3. interval leído del formulario (Cada 3 días)', raw.interval === 3);
    const r = sb.sanitizeRecurrence(raw);
    check('3. sanitizeRecurrence conserva interval: 3', r && r.interval === 3);
  }

  // =====================================================================
  section('4) Seleccionar semanal');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('4. type: weekly', raw.type === 'weekly');
    const r = sb.sanitizeRecurrence(raw);
    check('4. sanitizeRecurrence acepta weekly con daysOfWeek vacío', r && r.type === 'weekly' && r.daysOfWeek.length === 0);
  }

  // =====================================================================
  section('5) Intervalo semanal');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '2', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('5. interval leído del formulario (Cada 2 semanas)', raw.interval === 2);
    const r = sb.sanitizeRecurrence(raw);
    check('5. sanitizeRecurrence conserva interval: 2', r && r.interval === 2);
  }

  // =====================================================================
  section('6) Selección de un día');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['2'], repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('6. daysOfWeek con un único día marcado', JSON.stringify(raw.daysOfWeek) === JSON.stringify([2]));
    const r = sb.sanitizeRecurrence(raw);
    check('6. sanitizeRecurrence conserva ese único día', r && JSON.stringify(r.daysOfWeek) === JSON.stringify([2]));
  }

  // =====================================================================
  section('7) Selección de varios días');
  // =====================================================================
  {
    // Lunes/miércoles/viernes = [0,2,4] (checkboxes en cualquier orden).
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['4', '0', '2'], repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('7. daysOfWeek recoge las tres casillas marcadas', JSON.stringify(raw.daysOfWeek.slice().sort()) === JSON.stringify([0, 2, 4]));
    const r = sb.sanitizeRecurrence(raw);
    check('7. sanitizeRecurrence conserva los tres días', r && r.daysOfWeek.length === 3);
  }

  // =====================================================================
  section('8) Seleccionar mensual');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'monthly', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-01-15');
    check('8. type: monthly', raw.type === 'monthly');
    const r = sb.sanitizeRecurrence(raw);
    check('8. sanitizeRecurrence acepta monthly', r && r.type === 'monthly');
  }

  // =====================================================================
  section('9) Intervalo mensual');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'monthly', repeatInterval: '2', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-01-15');
    check('9. interval leído del formulario (Cada 2 meses)', raw.interval === 2);
    const r = sb.sanitizeRecurrence(raw);
    check('9. sanitizeRecurrence conserva interval: 2', r && r.interval === 2);
  }

  // =====================================================================
  section('10) "Nunca" → endDate: null');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'daily', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('10. endDate es null con "Nunca"', raw.endDate === null);
    // Incluso si quedara basura en el input de fecha (oculto/disabled),
    // "Nunca" debe ganar siempre.
    const fdDirty = makeFormData({ repeatType: 'daily', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '2026-12-31' });
    const rawDirty = sb.readRecurrenceFromForm(fdDirty, '2026-09-18');
    check('10b. "Nunca" ignora repeatEndDate aunque tenga valor', rawDirty.endDate === null);
  }

  // =====================================================================
  section('11) "Hasta una fecha"');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'daily', repeatInterval: '1', repeatEnd: 'until', repeatEndDate: '2026-12-31' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('11. endDate toma el valor del input de fecha', raw.endDate === '2026-12-31');
    const r = sb.sanitizeRecurrence(raw);
    check('11. sanitizeRecurrence conserva ese endDate', r && r.endDate === '2026-12-31');
  }

  // =====================================================================
  section('12) Impedir fecha final anterior a startDate');
  // =====================================================================
  {
    check('12. endDate anterior a startDate → inválido', sb.isRecurrenceEndDateValid('2026-09-18', '2026-09-01') === false);
    check('12. endDate posterior a startDate → válido', sb.isRecurrenceEndDateValid('2026-09-18', '2026-12-31') === true);
    check('12. endDate === startDate → válido (no es "anterior")', sb.isRecurrenceEndDateValid('2026-09-18', '2026-09-18') === true);
    check('12. sin endDate → siempre válido', sb.isRecurrenceEndDateValid('2026-09-18', null) === true);
    // Doble red de seguridad: aunque el guard de la UI fallara, sanitizeRecurrence también lo rechaza.
    const raw = sb.readRecurrenceFromForm(makeFormData({ repeatType: 'daily', repeatInterval: '1', repeatEnd: 'until', repeatEndDate: '2026-09-01' }), '2026-09-18');
    check('12b. sanitizeRecurrence también rechaza ese caso (red de seguridad)', sb.sanitizeRecurrence(raw) === null);
  }

  // =====================================================================
  section('13) Edición de tarea recurrente conserva configuración');
  // =====================================================================
  {
    const original = { type: 'weekly', interval: 2, daysOfWeek: [0, 2, 4], startDate: '2026-09-18', endDate: '2026-12-31' };
    const html13 = sb.recurrenceControlsHtml('task', original);
    check('13. "Cada semana" queda seleccionada', /<option value="weekly" selected>Cada semana<\/option>/.test(html13));
    check('13. el interval se precarga en el input (2)', /id="task-repeat-interval"[^>]*value="2"/.test(html13));
    check('13. los tres días quedan marcados (checked)', (html13.match(/checked/g) || []).length === 4); // 3 días + el radio "Hasta"
    check('13. día 0 (lunes) marcado', /id="task-repeat-day-0"[^>]*checked/.test(html13));
    check('13. día 2 (miércoles) marcado', /id="task-repeat-day-2"[^>]*checked/.test(html13));
    check('13. día 4 (viernes) marcado', /id="task-repeat-day-4"[^>]*checked/.test(html13));
    check('13. día 1 (martes) NO marcado', !/id="task-repeat-day-1"[^>]*checked/.test(html13));
    check('13. "Hasta" queda seleccionada y la fecha precargada', /id="task-repeat-end-until"[^>]*checked/.test(html13) && /id="task-repeat-end-date"[^>]*value="2026-12-31"/.test(html13));
    // Simula "reabrir y guardar sin tocar nada": el formulario precargado
    // con esos valores debe reconstruir la MISMA recurrencia.
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '2', repeatDaysOfWeek: ['0', '2', '4'], repeatEnd: 'until', repeatEndDate: '2026-12-31' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    const resaved = sb.sanitizeRecurrence(raw);
    check('13b. reconstruye exactamente la misma recurrencia (interval/daysOfWeek/startDate/endDate)', JSON.stringify(resaved) === JSON.stringify(original));
  }

  // =====================================================================
  section('14) Cambiar a "No repetir" elimina recurrencia');
  // =====================================================================
  {
    await sb.addTask({ title: 'Ducharse', dueDate: '2026-09-18', recurrence: { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-18', endDate: null } });
    const id = sb.state.tasks[sb.state.tasks.length - 1].id;
    check('14. empieza con recurrencia', sb.state.tasks.find(t => t.id === id).recurrence !== null);
    const fd = makeFormData(noneFields());
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    await sb.updateTask(id, { recurrence: raw });
    check('14. tras editar a "No repetir", recurrence queda en null', sb.state.tasks.find(t => t.id === id).recurrence === null);
  }

  // =====================================================================
  section('15) Evento nuevo sin recurrencia');
  // =====================================================================
  {
    const fd = makeFormData(noneFields());
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-20');
    await sb.addEvent({ title: 'Cita médica', date: '2026-09-20', recurrence: raw });
    const ev = sb.state.events[sb.state.events.length - 1];
    check('15. el evento creado queda con recurrence: null', ev.recurrence === null);
  }

  // =====================================================================
  section('16) Evento recurrente');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['4'], repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    await sb.addEvent({ title: 'Entrenamiento', date: '2026-09-18', startTime: '18:00', endTime: '19:30', allDay: false, recurrence: raw });
    const ev = sb.state.events[sb.state.events.length - 1];
    check('16. recurrence.type: weekly', ev.recurrence && ev.recurrence.type === 'weekly');
    check('16. recurrence.startDate se deriva de event.date', ev.recurrence.startDate === '2026-09-18');
    check('16. recurrence.daysOfWeek: [4]', JSON.stringify(ev.recurrence.daysOfWeek) === JSON.stringify([4]));
  }

  // =====================================================================
  section('17) Evento all-day recurrente');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'daily', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-20');
    await sb.addEvent({ title: 'Día libre', date: '2026-09-20', allDay: true, recurrence: raw });
    const ev = sb.state.events[sb.state.events.length - 1];
    check('17. allDay se conserva junto a la recurrencia', ev.allDay === true);
    check('17. la recurrencia se guarda igual con allDay', ev.recurrence && ev.recurrence.type === 'daily');
    // El HTML de recurrencia no depende de allDay: funciona igual con o sin hora.
    const htmlAllDay = sb.recurrenceControlsHtml('event', ev.recurrence);
    check('17b. el HTML de recurrencia no menciona campos de hora', !/startTime|endTime/.test(htmlAllDay));
  }

  // =====================================================================
  section('18) Evento de varios días recurrente');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['3'], repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-10');
    // event.endDate (fin del tramo de días del evento) es un campo
    // totalmente distinto de recurrence.endDate (fin de la serie).
    await sb.addEvent({ title: 'Viaje', date: '2026-09-10', endDate: '2026-09-12', recurrence: raw });
    const ev = sb.state.events[sb.state.events.length - 1];
    check('18. event.endDate (tramo de días) se conserva tal cual', ev.endDate === '2026-09-12');
    check('18. recurrence.endDate (fin de la serie) es un campo distinto y sigue siendo null', ev.recurrence.endDate === null);
    check('18. recurrence.startDate se deriva de event.date, no de event.endDate', ev.recurrence.startDate === '2026-09-10');
  }

  // =====================================================================
  section('19) Edición de evento recurrente conserva configuración');
  // =====================================================================
  {
    const original = { type: 'monthly', interval: 3, daysOfWeek: [], startDate: '2026-01-15', endDate: null };
    const html19 = sb.recurrenceControlsHtml('event', original);
    check('19. "Cada mes" queda seleccionada', /<option value="monthly" selected>Cada mes<\/option>/.test(html19));
    check('19. el interval se precarga en el input (3)', /id="event-repeat-interval"[^>]*value="3"/.test(html19));
    check('19. "Nunca" queda seleccionada (sin endDate)', /id="event-repeat-end-never"[^>]*checked/.test(html19));
    check('19. el bloque de días de la semana empieza oculto (mensual no usa daysOfWeek)', /id="event-repeat-days-group" style="display:none;"/.test(html19));
    const fd = makeFormData({ repeatType: 'monthly', repeatInterval: '3', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-01-15');
    const resaved = sb.sanitizeRecurrence(raw);
    check('19b. reconstruye la misma recurrencia al reguardar sin cambios', JSON.stringify(resaved) === JSON.stringify(original));
  }

  // =====================================================================
  section('20) Tareas antiguas sin recurrence siguen funcionando');
  // =====================================================================
  {
    // Tarea "antigua" (anterior a R-1), sin la clave recurrence en absoluto.
    await sb.addTask({ title: 'Tarea antigua', dueDate: '2026-09-01', priority: 'media' });
    const t = sb.state.tasks[sb.state.tasks.length - 1];
    check('20. la tarea antigua se crea con normalidad', t.title === 'Tarea antigua');
    check('20. obtiene recurrence: null automáticamente (vía sanitizeRecurrence, R-1)', t.recurrence === null);
    // El formulario de edición para esa tarea debe arrancar en "No repetir" sin fallar.
    const html20 = sb.recurrenceControlsHtml('task', t.recurrence);
    check('20. recurrenceControlsHtml no lanza con una tarea antigua y muestra "No repetir"', /<option value="none" selected>/.test(html20));
  }

  // =====================================================================
  section('21) Eventos antiguos sin recurrence siguen funcionando');
  // =====================================================================
  {
    await sb.addEvent({ title: 'Evento antiguo', date: '2026-09-01' });
    const ev = sb.state.events[sb.state.events.length - 1];
    check('21. el evento antiguo se crea con normalidad', ev.title === 'Evento antiguo');
    check('21. obtiene recurrence: null automáticamente', ev.recurrence === null);
    const html21 = sb.recurrenceControlsHtml('event', ev.recurrence);
    check('21. recurrenceControlsHtml no lanza con un evento antiguo y muestra "No repetir"', /<option value="none" selected>/.test(html21));
  }

  // =====================================================================
  section('22) La UI reutiliza sanitizeRecurrence (no duplica validación)');
  // =====================================================================
  {
    // Un interval inválido (0) escrito a mano en el campo numérico: la UI
    // NO lo rechaza por su cuenta (readRecurrenceFromForm no valida), así
    // que debe llegar tal cual hasta sanitizeRecurrence, que es quien lo
    // descarta — si la UI reimplementara su propia validación en paralelo,
    // este raw ya vendría "arreglado" o distinto.
    const fd = makeFormData({ repeatType: 'daily', repeatInterval: '0', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('22. readRecurrenceFromForm NO valida: deja pasar interval: 0 tal cual', raw.interval === 0);
    const savedViaCrud = await (async () => {
      await sb.addTask({ title: 'Prueba interval inválido', dueDate: '2026-09-18', recurrence: raw });
      return sb.state.tasks[sb.state.tasks.length - 1];
    })();
    check('22. addTask (que llama a sanitizeRecurrence) descarta ese interval inválido a null', savedViaCrud.recurrence === null);
    // Mismo interval inválido pasado DIRECTAMENTE a sanitizeRecurrence: mismo resultado (misma función, no una copia).
    check('22b. sanitizeRecurrence(raw) directo da el mismo resultado que a través de addTask', sb.sanitizeRecurrence(raw) === null);
  }

  // =====================================================================
  section('23) No se crean copias persistentes');
  // =====================================================================
  {
    const tasksBefore = sb.state.tasks.length;
    const eventsBefore = sb.state.events.length;
    const fd = makeFormData({ repeatType: 'daily', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    await sb.addTask({ title: 'Tarea recurrente', dueDate: '2026-09-18', recurrence: raw });
    await sb.addEvent({ title: 'Evento recurrente', date: '2026-09-18', recurrence: raw });
    check('23. addTask con recurrencia añade exactamente UNA tarea (no una por ocurrencia)', sb.state.tasks.length === tasksBefore + 1);
    check('23. addEvent con recurrencia añade exactamente UN evento (no uno por ocurrencia)', sb.state.events.length === eventsBefore + 1);
    // Editar una tarea recurrente tampoco crea entradas nuevas.
    const t = sb.state.tasks[sb.state.tasks.length - 1];
    await sb.updateTask(t.id, { title: 'Tarea recurrente (editada)', recurrence: raw });
    check('23b. updateTask no añade tareas nuevas al editar', sb.state.tasks.length === tasksBefore + 1);
  }

  // =====================================================================
  section('24) node --check sobre el <script> principal de organizator.html');
  // =====================================================================
  {
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-recurrence-r5-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('24. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
    } catch (e) {
      check('24. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
