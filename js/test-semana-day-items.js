/**
 * ORGANIZATOR — Tests de la vista Semana: tareas y eventos sin franja horaria
 *
 * Bug (2.3.0): Semana solo pintaba lo que Scheduler.buildDayBlocks()
 * convierte en bloque (horario fijo, eventos con hora dentro de
 * 07:00–23:00 y tareas con scheduledDate/Start/End). Las tareas con fecha
 * límite (exámenes/entregas guardados como tarea), las ocurrencias de
 * tareas recurrentes, los eventos sin hora y los eventos fuera de
 * 07:00–23:00 no aparecían, aunque Inicio y Calendario sí los mostraban.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html los bloques reales (utilidades de fecha, recurrencia,
 * integración R-6, ciclo de vida de propuestas IA, spliceProposalsIntoBlocks
 * y todo el bloque RENDER: SEMANA incluido renderSemana) y los ejecuta con
 * el js/scheduler.js real y un `document` mínimo falso.
 *
 * Uso:  node js/test-semana-day-items.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Se normaliza CRLF→LF solo en memoria (core.autocrlf puede dejar CRLF en disco).
const html = fs.readFileSync(path.join(ROOT, 'organizator.html'), 'utf8').replace(/\r\n/g, '\n');
const schedulerSrc = fs.readFileSync(path.join(ROOT, 'js', 'scheduler.js'), 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

const sources = [
  ['config', extractBetween(html, 'const PRIORITIES = ', '\n\n/* ==================================================================\n   AJUSTES', 'PRIORITIES/DOW_*/MONTH_NAMES')],
  ['fechas', extractBetween(html, '/* ==================================================================\n   UTILIDADES DE FECHA', '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS', 'UTILIDADES DE FECHA')],
  ['semana helpers', extractBetween(html, 'function dowOfDate(dateStr){', '\nfunction weekGoForward(){', 'dowOfDate/getWeekMonday/getWeekDays')],
  ['recurrencia', extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'SANEAMIENTO + RECURRENCIA')],
  ['categorías + R-6', extractBetween(html, '/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', '\n\n/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt', 'CATEGORÍAS + R-6')],
  ['esc', extractBetween(html, 'function esc(s){', '\n}\n\n/* ==================================================================\n   FILAS DE TAREA', 'esc') + '\n}'],
  ['propuestas IA', extractBetween(html, 'let iaProposals = [];', '\n/* ---------- Llamada a la IA', 'ciclo de vida de propuestas IA')],
  ['splice', extractBetween(html, 'function spliceProposalsIntoBlocks(blocks, placedProposals){', '\nfunction renderDayAgendaList(', 'spliceProposalsIntoBlocks')],
  ['semana', extractBetween(html, 'function weekRangeLabel(days){', "\ndocument.getElementById('semana-prev')", 'RENDER: SEMANA')],
];

function makeSandbox(state, anchorDate) {
  const elements = {
    'semana-title': { textContent: '' },
    'semana-grid': { innerHTML: '', querySelectorAll: () => [] },
  };
  const sandbox = { console, document: { getElementById: (id) => elements[id] || null } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });
  vm.runInContext('var state = { tasks: [], events: [], customSchedules: [], eventCategories: [] };', sandbox);
  sources.forEach(([label, src]) => vm.runInContext(src, sandbox, { filename: `organizator.html (${label})` }));
  vm.runInContext('var week = { anchorDate: null }; function wireIAProposalButtons(){}', sandbox);
  Object.assign(sandbox.state, state);
  sandbox.week.anchorDate = anchorDate;
  return { sandbox, elements };
}

// Extrae el HTML de cada tarjeta de día: { 'YYYY-MM-DD': '<div ...>' }
function renderWeek(state, anchorDate) {
  const { sandbox, elements } = makeSandbox(state, anchorDate);
  vm.runInContext('renderSemana()', sandbox);
  const out = {};
  const gridHtml = elements['semana-grid'].innerHTML;
  const parts = gridHtml.split('<div class="semana-day ');
  parts.slice(1).forEach(p => {
    const m = p.match(/data-date="(\d{4}-\d{2}-\d{2})"/);
    if (m) out[m[1]] = p;
  });
  return out;
}
const count = (haystack, needle) => haystack.split(needle).length - 1;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// Semana futura fija (lunes 2026-10-12 → domingo 2026-10-18): evita que
// "hoy" (bloques 'past') influya en el resultado.
const MON = '2026-10-12', WED = '2026-10-14', THU = '2026-10-15', FRI = '2026-10-16';

section('A — tareas con fecha límite (sin bloque programado)');
{
  const days = renderWeek({
    tasks: [
      { id: 't1', title: 'Examen de historia', dueDate: WED, dueTime: '', done: false, recurrence: null },
      { id: 't2', title: 'Entregar práctica', dueDate: WED, dueTime: '17:30', done: false, recurrence: null },
      { id: 't3', title: 'Lectura hecha', dueDate: THU, dueTime: '', done: true, recurrence: null },
    ],
  }, WED);
  check('A. la tarea sin hora aparece en su día', days[WED].includes('Examen de historia'));
  check('A. la tarea con hora límite aparece con su hora', days[WED].includes('Entregar práctica') && days[WED].includes('17:30'));
  check('A. no aparece en otro día', !days[THU].includes('Examen de historia') && !days[MON].includes('Examen de historia'));
  check('A. la tarea completada se ve marcada como hecha', days[THU].includes('Lectura hecha') && days[THU].includes('semana-item-done'));
}

section('B — eventos sin franja en la agenda');
{
  const days = renderWeek({
    events: [
      { id: 'e1', title: 'Examen de física', date: FRI, endDate: '', allDay: false, startTime: '', endTime: '' },
      { id: 'e2', title: 'Entreno temprano', date: FRI, endDate: '', allDay: false, startTime: '06:00', endTime: '06:45' },
    ],
  }, FRI);
  check('B. evento sin hora (no todo el día) aparece', days[FRI].includes('Examen de física') && days[FRI].includes('sin hora'));
  check('B. evento antes de las 07:00 aparece con su hora', days[FRI].includes('Entreno temprano') && days[FRI].includes('06:00'));
}

section('C — lo que ya tiene bloque no se duplica');
{
  const days = renderWeek({
    events: [{ id: 'e1', title: 'Examen de mates', date: WED, endDate: '', allDay: false, startTime: '10:00', endTime: '11:00' }],
    tasks: [{ id: 't1', title: 'Estudiar tema 3', dueDate: THU, scheduledDate: WED, scheduledStart: '17:00', scheduledEnd: '18:00', done: false, recurrence: null }],
    customSchedules: [{ id: 'c1', name: 'Clase', days: [2], startTime: '08:00', endTime: '09:30' }],
  }, WED);
  check('C. evento con hora sale una sola vez (como bloque)', count(days[WED], 'Examen de mates') === 1);
  check('C. tarea programada sale una sola vez (como bloque)', count(days[WED], 'Estudiar tema 3') === 1);
  check('C. la tarea programada no se repite en su fecha límite', !days[THU].includes('Estudiar tema 3'));
  check('C. la clase (horario fijo) sigue saliendo', days[WED].includes('Clase'));
  check('C. sin elementos sueltos no se añade la lista', !days[WED].includes('semana-day-items'));
}

section('D — recurrencia');
{
  const days = renderWeek({
    tasks: [{ id: 'tr', title: 'Repasar vocabulario', dueDate: MON, done: false,
      recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: MON, endDate: null } }],
    events: [{ id: 'er', title: 'Tutoría', date: MON, endDate: '', allDay: false, startTime: '', endTime: '',
      recurrence: { type: 'weekly', interval: 1, daysOfWeek: [0], startDate: MON, endDate: null } }],
  }, THU);
  check('D. la tarea diaria aparece cada día de la semana', Object.keys(days).length === 7 && Object.values(days).every(d => d.includes('Repasar vocabulario')));
  check('D. el evento semanal sin hora aparece solo el lunes', days[MON].includes('Tutoría') && !days[WED].includes('Tutoría'));
}

section('E — eventos todo el día: sin cambios');
{
  const days = renderWeek({
    events: [{ id: 'ea', title: 'Viaje', date: MON, endDate: '', allDay: true, startTime: '', endTime: '' }],
  }, MON);
  check('E. un evento todo el día sale una vez (bloque), no en la lista', count(days[MON], 'Viaje') === 1 && !days[MON].includes('semana-day-items'));
}

console.log(`\n${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
