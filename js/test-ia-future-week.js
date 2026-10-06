/**
 * ORGANIZATOR — Tests: "Planificar con IA" en una semana futura coloca
 * las propuestas dentro de esa semana (fallo 1 de DIAGNOSTICO-IA.md)
 *
 * Antes, Scheduler siempre buscaba hueco desde HOY: en la semana
 * siguiente, las propuestas se colocaban hoy, quedaban fuera de la semana
 * elegida y salían "sin hora fija". Ahora scheduleTask/autoSchedule
 * aceptan opts.fromDate (nunca antes de hoy) y planWeekProposals pasa el
 * primer día de la semana planificada.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el código real y lo ejecuta con el js/scheduler.js
 * real. callAI y el DOM son mocks.
 *
 * Uso:  node js/test-ia-future-week.js
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
  ['horarios', extractBetween(html, 'function schedulesForDow(dow){', '\n}\n', 'schedulesForDow') + '\n}\n'],
  ['semana helpers', extractBetween(html, 'function dowOfDate(dateStr){', '\n\n/* ==================================================================\n   ALMACENAMIENTO', 'dowOfDate/getWeekMonday/getWeekDays')],
  ['recurrencia', extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'SANEAMIENTO + RECURRENCIA')],
  ['categorías + R-6', extractBetween(html, '/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', '\n\n/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt', 'CATEGORÍAS + R-6')],
  ['CRUD', extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS', 'CRUD')],
  ['esc', extractBetween(html, 'function esc(s){', '\n}\n\n/* ==================================================================\n   FILAS DE TAREA', 'esc') + '\n}'],
  ['propuestas IA', extractBetween(html, 'let iaProposals = [];', '\n/* ---------- Llamada a la IA', 'ciclo de vida de propuestas IA')],
  ['buildContext', extractBetween(html, 'function buildContext(scope, anchorDate, endDate){', '\nconst PLAN_ITEM_SCHEMA', 'buildContext')],
  ['constantes IA', extractBetween(html, 'const PLAN_ITEM_SCHEMA = `{', '\nfunction iaSetStatus(msg){', 'PLAN_ITEM_SCHEMA + IA_RULES')],
  ['planWeekProposals', extractBetween(html, 'function planWeekProposals(days, today, weekEnd, schedCtx){', '\n/* ---------- Validación de propuestas semanales', 'planWeekProposals')],
  ['validación + revalidación', extractBetween(html, 'function validateWeeklyProposal(item, applyDate, schedCtx, weekStart, weekEnd, deadline){', '\n/* ---------- Agenda visual', 'validateWeeklyProposal + revalidateIAProposalBeforeApply')],
  ['splice + agenda', extractBetween(html, 'function spliceProposalsIntoBlocks(blocks, placedProposals){', '\n\n/* ---------- Hilo único del asistente', 'spliceProposalsIntoBlocks + renderDayAgendaList')],
  ['renderIAItemHTML', extractBetween(html, 'function renderIAItemHTML(it, dateForApply, batchId){', '\nfunction wireIAProposalButtons(container){', 'renderIAItemHTML')],
  ['expire', extractBetween(html, 'function iaExpirePendingProposalsBeforeReset(){', '\n/** Franja real de una propuesta IA', 'iaExpirePendingProposalsBeforeReset')],
  ['applyIAProposal', extractBetween(html, '/** Franja real de una propuesta IA', '\n/* ---------- Organizar mi día', 'iaProposalSlot/findIAProposalSourceTask/applyIAProposal')],
  ['runIADay + runIAWeek', extractBetween(html, 'async function runIADay(){', '\n/* ---------- Chat con la IA', 'runIADay + runIAWeek')],
  ['badges', extractBetween(html, 'function renderEventContextBadges(eventContext){', '\n\n/* ==================================================================\n   RECURRENCIA — UI compartida', 'renderEventContextBadges')],
];

function makeSandbox() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.document = { getElementById: () => null, querySelectorAll: () => [] };
  sandbox.currentView = 'inicio';
  sandbox.iaSetStatus = () => {};
  sandbox.iaSetButtonsDisabled = () => {};
  sandbox.iaThreadAddPending = () => ({});
  sandbox.iaThreadResolve = () => {};
  sandbox.wireIAProposalButtons = () => {};
  sandbox.renderInicio = () => {};
  sandbox.renderCalendar = () => {};
  sandbox.renderCurrentView = () => {};
  sandbox.showToast = () => {};
  sandbox.parseAIJSON = (raw) => raw; // callAI (mock) ya devuelve el objeto final
  sandbox.__aiResponse = null;
  sandbox.callAI = async (system, context) => { sandbox.__lastSystem = system; sandbox.__lastContext = context; return sandbox.__aiResponse; };
  sandbox.storage = { async get() { return null; }, async set() { return {}; } };
  vm.createContext(sandbox);
  vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });
  vm.runInContext(`var state = { tasks: [], events: [], customSchedules: [], eventCategories: [] };
    var uidSeq = 0; function uid(){ uidSeq += 1; return 'uid-' + uidSeq; }
    async function saveTasks(){} async function saveEvents(){} async function saveEventCategories(){}
    async function cancelRemindersForTaskAndOccurrences(){} async function cancelRemindersForTarget(){}
    function openActualMinutesModal(){}`, sandbox);
  sources.forEach(([label, src]) => vm.runInContext(src, sandbox, { filename: `organizator.html (${label})` }));
  vm.runInContext('this.__getIAProposals = function(){ return iaProposals; };', sandbox);
  return sandbox;
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

(async () => {
  section('A — Scheduler: opts.fromDate');
  {
    const sb = makeSandbox();
    const today = sb.todayStr();
    const empty = { events: [], tasks: [], customSchedules: [] };
    const future = sb.addDays(today, 10);
    const r1 = sb.Scheduler.scheduleTask({ id: 't1', title: 'X', dueDate: sb.addDays(today, 20), estimatedMinutes: 30 }, empty, { fromDate: future });
    check('A. con fromDate futuro, el hueco es ese día (agenda vacía)', r1.scheduledDate === future);
    const r2 = sb.Scheduler.scheduleTask({ id: 't2', title: 'X', dueDate: sb.addDays(today, 20), estimatedMinutes: 30 }, empty, { fromDate: sb.addDays(today, -3) });
    const r3 = sb.Scheduler.scheduleTask({ id: 't3', title: 'X', dueDate: sb.addDays(today, 20), estimatedMinutes: 30 }, empty);
    check('A. fromDate en el pasado no adelanta nada: igual que sin fromDate', r2.scheduledDate === r3.scheduledDate && r2.scheduledDate >= today);
    const r4 = sb.Scheduler.autoSchedule([{ id: 't4', title: 'X', dueDate: sb.addDays(today, 20), estimatedMinutes: 30 }], empty, { fromDate: future });
    check('A. autoSchedule pasa fromDate a scheduleTask', r4[0].scheduledDate === future);
  }

  section('B — Planificar con IA la semana siguiente');
  {
    const sb = makeSandbox();
    const today = sb.todayStr();
    const anchor = sb.addDays(today, 7);
    const weekEnd = sb.addDays(anchor, 6);
    // El tercer día de esa semana está ocupado entero: la propuesta de ese
    // día se adelanta a otro día de la MISMA semana, nunca a hoy (el día
    // que elige la IA funciona como fecha límite).
    const fullDay = sb.addDays(anchor, 2);
    sb.state.events.push({ id: 'full', title: 'Excursión', date: fullDay, endDate: '', allDay: true, startTime: '', endTime: '' });
    sb.__aiResponse = { summary: '', days: [
      { date: anchor, label: 'd1', items: [{ sourceType: 'proposal', kind: 'task', title: 'Repasar', estimatedMinutes: 45, time: null }] },
      { date: sb.addDays(anchor, 2), label: 'd3', items: [{ sourceType: 'proposal', kind: 'task', title: 'Leer', estimatedMinutes: 30, time: null }] },
      { date: sb.addDays(anchor, 5), label: 'd6', items: [{ sourceType: 'proposal', kind: 'task', title: 'Ejercicios', estimatedMinutes: 60, time: null }] },
    ] };
    await sb.runIAWeek(anchor);
    const ps = sb.__getIAProposals();
    check('B. hay 3 propuestas', ps.length === 3);
    check('B. todas tienen hora (ninguna "sin hora fija")', ps.length === 3 && ps.every(p => !!p.time && !p.noSlot));
    check('B. todas caen dentro de la semana elegida', ps.every(p => p.applyDate >= anchor && p.applyDate <= weekEnd));
    check('B. ninguna con el aviso "fuera del horizonte"', ps.every(p => !String(p.reason || '').includes('horizonte')));
    check('B. nada cae el día ocupado entero', ps.every(p => p.applyDate !== fullDay));
    const leer = ps.find(p => p.title === 'Leer');
    check('B. la del día ocupado se adelanta dentro de la semana', !!leer && leer.applyDate >= anchor && leer.applyDate < fullDay);
    const p6 = ps.find(p => p.title === 'Ejercicios');
    check('B. la de 60 min dura 60 min', !!p6 && p6._durationMinutes === 60);
  }

  section('C — la semana actual sigue igual: empieza hoy');
  {
    const sb = makeSandbox();
    const today = sb.todayStr();
    sb.state.events.push({ id: 'hoy', title: 'Ocupado', date: today, endDate: '', allDay: true, startTime: '', endTime: '' });
    sb.__aiResponse = { summary: '', days: [{ date: sb.addDays(today, 1), label: 'mañana', items: [{ sourceType: 'proposal', kind: 'task', title: 'Repasar', estimatedMinutes: 45, time: null }] }] };
    await sb.runIAWeek();
    const p = sb.__getIAProposals()[0];
    check('C. colocada mañana, con hora', !!p && !!p.time && p.applyDate === sb.addDays(today, 1));
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
