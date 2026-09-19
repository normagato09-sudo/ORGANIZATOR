/**
 * ORGANIZATOR — Tests de R-1.6 (recurrencia ANUAL: cumpleaños/aniversarios)
 *
 * Suite Node pura, SIN navegador ni jsdom. Extrae literalmente de
 * organizator.html los MISMOS bloques que ya usan test-recurrence-model.js
 * (R-1), test-recurrence-r2.js (R-2), test-recurrence-events-r4.js (R-4) y
 * test-recurrence-ui-r5.js (R-5) — R-1.6 no crea ningún bloque nuevo, solo
 * amplía `RECURRENCE_TYPES`/`isDateInRecurrence`/`getNextRecurrenceDate`
 * (R-1/R-2) y la UI compartida (R-5) para aceptar `type:'yearly'`.
 *
 * No repite exhaustivamente lo que ya cubren daily/weekly/monthly en sus
 * propias suites: se centra en el contrato específico de `yearly` —
 * validación, cálculo de fechas (incluido el caso de 29 de febrero),
 * ocurrencias de eventos, IDs estables, y la UI de edición/cambio de tipo.
 *
 * Uso:  node js/test-recurrence-r1-6-yearly.js
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
// extractBetween de abajo usan '\n' — mismo criterio que el resto de la
// familia R-1..R-7.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// Mismos bloques exactos que test-recurrence-ui-r5.js (R-1/R-2/R-3/R-4 +
// UI R-5 + CRUD + utilidades de fecha/esc/DOW_*).
const dowNamesSrc = extractBetween(html, 'const DOW_NAMES = ', '\n\n/* ==================================================================\n   AJUSTES', 'constantes DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES');
const escSrc = extractBetween(html, 'function esc(s){', '\n}\n\n/* ==================================================================\n   FILAS DE TAREA', 'función esc') + '\n}';
const dateUtilsSrc = extractBetween(html, '/* ==================================================================\n   UTILIDADES DE FECHA', '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS', 'bloque UTILIDADES DE FECHA');
const weekHelpersSrc = extractBetween(html, 'function dowOfDate(dateStr){', '\nfunction weekGoForward(){', 'helpers dowOfDate/getWeekMonday');
const recurrenceSrc = extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1/R-2/R-3/R-4, ampliada en R-1.6)');
const recurrenceUiSrc = extractBetween(html, '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)', '\n\n/* ==================================================================\n   MODAL: TAREA', 'bloque RECURRENCIA — UI compartida (Fase R-5)');
const crudSrc = extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS', 'bloque CRUD');

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
  sandbox.FormData = FormData;
  vm.createContext(sandbox);
  vm.runInContext(dowNamesSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES)' });
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2/R-3/R-4, R-1.6)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5)' });
  vm.runInContext(
    `let state = { tasks: [], events: [] };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function cancelRemindersForTarget(){ /* no-op: fuera de alcance de R-1.6 */ }
     function renderCurrentView(){ /* no-op: fuera de alcance de R-1.6 */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-1.6 */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(
    `this.RECURRENCE_TYPES = RECURRENCE_TYPES;
     this.sanitizeRecurrence = sanitizeRecurrence;
     this.isDateInRecurrence = isDateInRecurrence;
     this.getNextRecurrenceDate = getNextRecurrenceDate;
     this.getEventOccurrenceId = getEventOccurrenceId;
     this.eventDurationDays = eventDurationDays;
     this.buildEventOccurrence = buildEventOccurrence;
     this.getEventOccurrences = getEventOccurrences;
     this.recurrenceUnitLabel = recurrenceUnitLabel;
     this.recurrenceControlsHtml = recurrenceControlsHtml;
     this.readRecurrenceFromForm = readRecurrenceFromForm;
     this.isRecurrenceEndDateValid = isRecurrenceEndDateValid;
     this.addTask = addTask;
     this.updateTask = updateTask;
     this.addEvent = addEvent;
     this.updateEvent = updateEvent;
     this.state = state;`,
    sandbox, { filename: 'expose-recurrence-R1.6' }
  );
  return sandbox;
}

function makeFormData(fields) {
  const fd = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach(v => fd.append(key, v));
    else if (value !== undefined && value !== null) fd.append(key, value);
  });
  return fd;
}

function makeYearlyEvent(overrides) {
  return Object.assign({
    id: 'e1', title: 'Cumpleaños', date: '2026-05-20', endDate: '', allDay: false,
    startTime: '', endTime: '', location: '', notes: '',
    recurrence: { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2026-05-20', endDate: null },
  }, overrides);
}

(async () => {
  const sb = makeSandbox();

  // =====================================================================
  section('0) Contrato: RECURRENCE_TYPES incluye yearly sin perder los existentes');
  // =====================================================================
  {
    check('0. RECURRENCE_TYPES = [daily, weekly, monthly, yearly] (en ese orden, nada eliminado)', JSON.stringify(sb.RECURRENCE_TYPES) === JSON.stringify(['daily', 'weekly', 'monthly', 'yearly']));
  }

  // =====================================================================
  section('1) yearly válido con interval 1');
  // =====================================================================
  {
    const r = sb.sanitizeRecurrence({ type: 'yearly', interval: 1, startDate: '2026-05-20', endDate: null });
    check('1. sanitizeRecurrence acepta yearly con interval 1', r !== null && r.type === 'yearly' && r.interval === 1);
    check('1b. conserva startDate tal cual', r.startDate === '2026-05-20');
    check('1c. daysOfWeek queda vacío (yearly no lo usa, igual que daily/monthly)', Array.isArray(r.daysOfWeek) && r.daysOfWeek.length === 0);
  }

  // =====================================================================
  section('2) yearly válido con interval 2');
  // =====================================================================
  {
    const r = sb.sanitizeRecurrence({ type: 'yearly', interval: 2, startDate: '2026-05-20', endDate: null });
    check('2. sanitizeRecurrence acepta yearly con interval 2', r !== null && r.interval === 2);
  }

  // =====================================================================
  section('3) Intervalo inválido para yearly');
  // =====================================================================
  {
    const cases = [0, -1, 1.5, 'a', null, undefined, NaN];
    const results = cases.map(interval => sb.sanitizeRecurrence({ type: 'yearly', interval, startDate: '2026-05-20', endDate: null }));
    check('3. ningún interval inválido produce una recurrencia yearly válida', results.every(r => r === null));
  }

  // =====================================================================
  section('4) yearly sin startDate');
  // =====================================================================
  {
    check('4a. sin startDate en absoluto → null', sb.sanitizeRecurrence({ type: 'yearly', interval: 1, endDate: null }) === null);
    check('4b. startDate no es una fecha real → null', sb.sanitizeRecurrence({ type: 'yearly', interval: 1, startDate: 'no-es-fecha', endDate: null }) === null);
    check('4c. startDate con fecha de calendario imposible (30 de febrero) → null', sb.sanitizeRecurrence({ type: 'yearly', interval: 1, startDate: '2026-02-30', endDate: null }) === null);
  }

  // =====================================================================
  section('5) yearly con endDate');
  // =====================================================================
  {
    const r = sb.sanitizeRecurrence({ type: 'yearly', interval: 1, startDate: '2026-05-20', endDate: '2030-05-20' });
    check('5a. endDate se conserva tal cual', r !== null && r.endDate === '2030-05-20');
    check('5b. endDate anterior a startDate → null (misma semántica que el resto de types)', sb.sanitizeRecurrence({ type: 'yearly', interval: 1, startDate: '2026-05-20', endDate: '2025-05-20' }) === null);
    check('5c. la recurrencia respeta endDate: no hay ocurrencia después de él', sb.isDateInRecurrence('2031-05-20', r) === false && sb.isDateInRecurrence('2030-05-20', r) === true);
  }

  // =====================================================================
  section('6, 7) Fecha antes de startDate / exactamente en startDate');
  // =====================================================================
  {
    const r = { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2026-05-20', endDate: null };
    check('6. una fecha anterior a startDate nunca es ocurrencia', sb.isDateInRecurrence('2025-05-20', r) === false);
    check('6b. una fecha del mismo año pero anterior al mes/día tampoco lo es', sb.isDateInRecurrence('2026-05-19', r) === false);
    check('7. startDate mismo SIEMPRE es una ocurrencia válida de su propia recurrencia', sb.isDateInRecurrence('2026-05-20', r) === true);
  }

  // =====================================================================
  section('8, 9) Fecha anual válida / fecha de un año que no corresponde');
  // =====================================================================
  {
    const r1 = { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2026-05-20', endDate: null };
    check('8. mismo mes/día un año después → válida (interval 1)', sb.isDateInRecurrence('2027-05-20', r1) === true);
    check('8b. mismo mes/día pero DÍA distinto → inválida', sb.isDateInRecurrence('2027-05-21', r1) === false);
    check('8c. mismo día pero MES distinto → inválida', sb.isDateInRecurrence('2027-06-20', r1) === false);

    const r2 = { type: 'yearly', interval: 2, daysOfWeek: [], startDate: '2026-05-20', endDate: null };
    check('9. interval 2: el año siguiente (no múltiplo) NO corresponde', sb.isDateInRecurrence('2027-05-20', r2) === false);
    check('9b. interval 2: dos años después SÍ corresponde', sb.isDateInRecurrence('2028-05-20', r2) === true);
    check('9c. interval 2: tres años después NO corresponde', sb.isDateInRecurrence('2029-05-20', r2) === false);
  }

  // =====================================================================
  section('10) getNextRecurrenceDate para yearly');
  // =====================================================================
  {
    const r = { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2026-05-20', endDate: null };
    check('10a. desde una fecha anterior a startDate devuelve startDate', sb.getNextRecurrenceDate('2025-01-01', r) === '2026-05-20');
    check('10b. desde startDate mismo devuelve el año siguiente', sb.getNextRecurrenceDate('2026-05-20', r) === '2027-05-20');
    check('10c. desde una fecha intermedia del mismo ciclo devuelve la siguiente ocurrencia', sb.getNextRecurrenceDate('2026-12-01', r) === '2027-05-20');
    check('10d. el resultado es siempre estrictamente posterior a la fecha dada', sb.getNextRecurrenceDate('2027-05-20', r) > '2027-05-20');
  }

  // =====================================================================
  section('11) Múltiples años consecutivos (caso principal del encargo, interval 1)');
  // =====================================================================
  {
    const r = { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2026-05-20', endDate: null };
    const dates = ['2026-05-20'];
    let cursor = '2026-05-20';
    for (let i = 0; i < 3; i++) { cursor = sb.getNextRecurrenceDate(cursor, r); dates.push(cursor); }
    check('11. 2026, 2027, 2028, 2029 (interval 1)', JSON.stringify(dates) === JSON.stringify(['2026-05-20', '2027-05-20', '2028-05-20', '2029-05-20']));
  }

  // =====================================================================
  section('12) Intervalo anual > 1 (caso principal del encargo, interval 2)');
  // =====================================================================
  {
    const r = { type: 'yearly', interval: 2, daysOfWeek: [], startDate: '2026-05-20', endDate: null };
    const dates = ['2026-05-20'];
    let cursor = '2026-05-20';
    for (let i = 0; i < 2; i++) { cursor = sb.getNextRecurrenceDate(cursor, r); dates.push(cursor); }
    check('12. 2026, 2028, 2030 (interval 2)', JSON.stringify(dates) === JSON.stringify(['2026-05-20', '2028-05-20', '2030-05-20']));
  }

  // =====================================================================
  section('13) Evento yearly genera ocurrencias correctas');
  // =====================================================================
  {
    const event = makeYearlyEvent();
    const occ = sb.getEventOccurrences(event, '2026-01-01', '2029-12-31');
    check('13a. genera exactamente 4 ocurrencias (2026-2029)', occ.length === 4);
    check('13b. fechas correctas en orden', JSON.stringify(occ.map(o => o.date)) === JSON.stringify(['2026-05-20', '2027-05-20', '2028-05-20', '2029-05-20']));
    check('13c. cada ocurrencia conserva el título/otros campos del evento base', occ.every(o => o.title === 'Cumpleaños'));
  }

  // =====================================================================
  section('14) IDs de ocurrencia estables');
  // =====================================================================
  {
    const event = makeYearlyEvent();
    const occ = sb.getEventOccurrences(event, '2026-01-01', '2029-12-31');
    check('14a. cada id sigue el formato eventId::occurrenceDate', occ.every(o => o.id === sb.getEventOccurrenceId('e1', o.date)));
    check('14b. eventId de cada ocurrencia apunta siempre al id real del evento base', occ.every(o => o.eventId === 'e1'));
    check('14c. ids únicos entre sí', new Set(occ.map(o => o.id)).size === occ.length);
    check('14d. llamar dos veces produce exactamente los mismos ids (determinismo)', JSON.stringify(sb.getEventOccurrences(event, '2026-01-01', '2029-12-31').map(o => o.id)) === JSON.stringify(occ.map(o => o.id)));
  }

  // =====================================================================
  section('15) Reordenar el array de eventos no cambia las ocurrencias');
  // =====================================================================
  {
    const e1 = makeYearlyEvent({ id: 'e1', title: 'Cumpleaños A', recurrence: { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2026-05-20', endDate: null } });
    const e2 = makeYearlyEvent({ id: 'e2', title: 'Cumpleaños B', date: '2026-08-03', recurrence: { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2026-08-03', endDate: null } });
    const order1 = [e1, e2].flatMap(e => sb.getEventOccurrences(e, '2026-01-01', '2028-12-31'));
    const order2 = [e2, e1].flatMap(e => sb.getEventOccurrences(e, '2026-01-01', '2028-12-31'));
    const norm = (arr) => arr.map(o => `${o.eventId}|${o.date}`).sort();
    check('15. mismo conjunto de ocurrencias sin importar el orden del array de entrada', JSON.stringify(norm(order1)) === JSON.stringify(norm(order2)));
  }

  // =====================================================================
  section('16) No se crean eventos base adicionales');
  // =====================================================================
  {
    const event = makeYearlyEvent();
    const before = JSON.stringify(event);
    sb.getEventOccurrences(event, '2026-01-01', '2035-12-31');
    check('16a. getEventOccurrences no muta el evento base', JSON.stringify(event) === before);
    sb.state.events.push(event);
    const lenBefore = sb.state.events.length;
    sb.getEventOccurrences(event, '2026-01-01', '2035-12-31');
    check('16b. state.events no crece al generar ocurrencias (nada de esto es persistente)', sb.state.events.length === lenBefore);
  }

  // =====================================================================
  section('17) Edición de evento yearly restaura correctamente los controles');
  // =====================================================================
  {
    const existing = { type: 'yearly', interval: 3, daysOfWeek: [], startDate: '2026-05-20', endDate: '2040-05-20' };
    const htmlOut = sb.recurrenceControlsHtml('event', existing);
    check('17a. "Cada año" queda seleccionada', /<option value="yearly" selected>Cada año<\/option>/.test(htmlOut));
    check('17b. el intervalo (3) se precarga en el input', /id="event-repeat-interval"[^>]*value="3"/.test(htmlOut));
    check('17c. la unidad mostrada es "años"', />años<\/span>/.test(htmlOut));
    check('17d. el detalle de recurrencia empieza visible (no "display:none")', /id="event-repeat-detail" style=""/.test(htmlOut));
    check('17e. el grupo de días de la semana permanece oculto (yearly no los usa)', /id="event-repeat-days-group" style="display:none;"/.test(htmlOut));
    check('17f. "Hasta" queda seleccionado y la fecha de fin se precarga', /id="event-repeat-end-until"[^>]* checked/.test(htmlOut) && /id="event-repeat-end-date"[^>]*value="2040-05-20"/.test(htmlOut));
  }

  // =====================================================================
  section('18) Cambio yearly → no recurrence');
  // =====================================================================
  {
    await sb.addEvent({ title: 'Aniversario', date: '2026-05-20', endDate: '', allDay: false, startTime: '', endTime: '', location: '', notes: '', recurrence: { type: 'yearly', interval: 1, startDate: '2026-05-20', endDate: null } });
    const ev = sb.state.events[sb.state.events.length - 1];
    check('18a. el evento se crea con recurrencia yearly', ev.recurrence !== null && ev.recurrence.type === 'yearly');
    const fd = makeFormData({ repeatType: 'none', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, ev.date);
    check('18b. readRecurrenceFromForm con "No repetir" devuelve null', raw === null);
    await sb.updateEvent(ev.id, { recurrence: sb.sanitizeRecurrence(raw) });
    check('18c. tras guardar, el evento queda sin recurrencia (null), no "yearly fantasma"', sb.state.events.find(e => e.id === ev.id).recurrence === null);
  }

  // =====================================================================
  section('19) Cambio yearly → monthly');
  // =====================================================================
  {
    await sb.addEvent({ title: 'Revisión', date: '2026-05-20', endDate: '', allDay: false, startTime: '', endTime: '', location: '', notes: '', recurrence: { type: 'yearly', interval: 1, startDate: '2026-05-20', endDate: null } });
    const ev = sb.state.events[sb.state.events.length - 1];
    const fd = makeFormData({ repeatType: 'monthly', repeatInterval: '2', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, ev.date);
    await sb.updateEvent(ev.id, { recurrence: sb.sanitizeRecurrence(raw) });
    const updated = sb.state.events.find(e => e.id === ev.id);
    check('19a. el evento pasa a monthly con interval 2', updated.recurrence.type === 'monthly' && updated.recurrence.interval === 2);
    check('19b. la generación de ocurrencias ya usa la regla monthly, no yearly (siguiente en julio, no en 2027)', sb.getNextRecurrenceDate('2026-05-20', updated.recurrence) === '2026-07-20');
  }

  // =====================================================================
  section('20) Cambio monthly → yearly');
  // =====================================================================
  {
    await sb.addEvent({ title: 'Pago', date: '2026-05-20', endDate: '', allDay: false, startTime: '', endTime: '', location: '', notes: '', recurrence: { type: 'monthly', interval: 1, startDate: '2026-05-20', endDate: null } });
    const ev = sb.state.events[sb.state.events.length - 1];
    const fd = makeFormData({ repeatType: 'yearly', repeatInterval: '1', repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, ev.date);
    await sb.updateEvent(ev.id, { recurrence: sb.sanitizeRecurrence(raw) });
    const updated = sb.state.events.find(e => e.id === ev.id);
    check('20a. el evento pasa a yearly', updated.recurrence.type === 'yearly' && updated.recurrence.interval === 1);
    check('20b. la generación de ocurrencias ya usa la regla yearly (siguiente en 2027, no en junio)', sb.getNextRecurrenceDate('2026-05-20', updated.recurrence) === '2027-05-20');
  }

  // =====================================================================
  section('21) La UI semanal sigue funcionando (yearly no la rompe)');
  // =====================================================================
  {
    const htmlWeekly = sb.recurrenceControlsHtml('task', { type: 'weekly', interval: 1, daysOfWeek: [0, 2, 4], startDate: '2026-09-14', endDate: null });
    check('21a. "Cada semana" sigue seleccionable y seleccionada', /<option value="weekly" selected>Cada semana<\/option>/.test(htmlWeekly));
    check('21b. el grupo de días de la semana sigue visible para weekly', /id="task-repeat-days-group" style=""/.test(htmlWeekly));
    check('21c. los días marcados (lunes/miércoles/viernes) siguen precargados', /id="task-repeat-day-0"[^>]* checked/.test(htmlWeekly) && /id="task-repeat-day-2"[^>]* checked/.test(htmlWeekly) && /id="task-repeat-day-4"[^>]* checked/.test(htmlWeekly));
    check('21d. "Cada año" NO aparece seleccionada cuando la recurrencia es weekly', !/<option value="yearly" selected>/.test(htmlWeekly));

    const fdWeekly = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['1', '3'], repeatEnd: 'never', repeatEndDate: '' });
    const rawWeekly = sb.readRecurrenceFromForm(fdWeekly, '2026-09-14');
    check('21e. readRecurrenceFromForm sigue leyendo daysOfWeek con normalidad para weekly', JSON.stringify(rawWeekly.daysOfWeek) === JSON.stringify([1, 3]));

    // R-5.1: casillas de días marcadas pero type=yearly -> daysOfWeek vacío.
    const fdYearlyWithStaleDays = makeFormData({ repeatType: 'yearly', repeatInterval: '1', repeatDaysOfWeek: ['1', '3'], repeatEnd: 'never', repeatEndDate: '' });
    const rawYearly = sb.readRecurrenceFromForm(fdYearlyWithStaleDays, '2026-09-14');
    check('21f. casillas de días "fantasma" (de un cambio de tipo anterior) nunca se cuelan en una recurrencia yearly', Array.isArray(rawYearly.daysOfWeek) && rawYearly.daysOfWeek.length === 0);
  }

  // =====================================================================
  section('22) Caso 29 de febrero (semántica definida: recorte, igual que monthly)');
  // =====================================================================
  {
    const r = { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2024-02-29', endDate: null }; // 2024 es bisiesto
    check('22a. startDate (29/02/2024, bisiesto) es su propia ocurrencia', sb.isDateInRecurrence('2024-02-29', r) === true);
    check('22b. 2025 (no bisiesto) recorta al 28 de febrero — NUNCA se salta el año', sb.isDateInRecurrence('2025-02-28', r) === true);
    check('22c. 2025-03-01 (el día siguiente al recorte) NUNCA es una ocurrencia (el recorte es exclusivo de esa fecha concreta)', sb.isDateInRecurrence('2025-03-01', r) === false);
    check('22d. 2028 (bisiesto de nuevo) recupera el 29 de febrero exacto', sb.isDateInRecurrence('2028-02-29', r) === true);
    check('22e. getNextRecurrenceDate encadena 2024→2025(28)→2026(28)→2027(28)→2028(29)', (() => {
      const seq = ['2024-02-29'];
      let cursor = '2024-02-29';
      for (let i = 0; i < 4; i++) { cursor = sb.getNextRecurrenceDate(cursor, r); seq.push(cursor); }
      return JSON.stringify(seq) === JSON.stringify(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    })());
    check('22f. un evento con startDate 29/02 genera sus ocurrencias sin saltarse ningún año', (() => {
      const event = makeYearlyEvent({ id: 'eleap', date: '2024-02-29', recurrence: { type: 'yearly', interval: 1, daysOfWeek: [], startDate: '2024-02-29', endDate: null } });
      const occ = sb.getEventOccurrences(event, '2024-01-01', '2028-12-31');
      return JSON.stringify(occ.map(o => o.date)) === JSON.stringify(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    })());
  }

  // =====================================================================
  section('23) node --check sobre el <script> principal de organizator.html');
  // =====================================================================
  {
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-r1-6-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('23. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
    } catch (e) {
      check('23. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
