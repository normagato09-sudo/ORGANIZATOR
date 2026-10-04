/**
 * ORGANIZATOR — Tests: ✅ en repeticiones completadas y ☕ descansos en la
 * vista Semana (B4 de PLAN-FINAL.md)
 *
 * - Una repetición completada de una tarea recurrente (bloque con id
 *   "taskId::fecha", ver tasksForScheduler) se pinta ✅, igual que una
 *   tarea normal hecha. Antes salía siempre 📚.
 * - Los 10 min de margen que Scheduler deja entre un bloque ocupado y lo
 *   siguiente (breakMinutes) se pintan como ☕ Descanso en vez de como
 *   tiempo libre (semanaAgendaWithBreaks). Solo cambia cómo se pinta:
 *   lo que queda 🟢 libre coincide exactamente con los huecos que usa
 *   Scheduler para planificar.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el código real y lo ejecuta con el js/scheduler.js
 * real. El DOM es un mock.
 *
 * Uso:  node js/test-semana-done-breaks.js
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
  ['semana helpers', extractBetween(html, 'function dowOfDate(dateStr){', '\nfunction weekGoForward(){', 'dowOfDate/getWeekMonday/getWeekDays')],
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
  ['badges', extractBetween(html, 'function renderEventContextBadges(eventContext){', '\n/* ---------- Semana: lo del día', 'renderEventContextBadges')],
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
  sandbox.renderSemana = () => {};
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

const semanaSrc = extractBetween(html, 'function renderSemanaAgenda(blocks){', '\n\n/* ---------- 5E-4: propuestas IA semanales', 'renderSemanaAgenda')
  + '\n' + extractBetween(html, '/** B4: el Scheduler nunca coloca nada', '\n/* ---------- 6A-4.2: eventos all-day', 'semanaAgendaWithBreaks');

// Semana futura fija: el resultado no depende del día del test.
const MON = '2030-03-11', WED = '2030-03-13', THU = '2030-03-14', SUN = '2030-03-17';
const rows = (blocks) => blocks.map(b => `${b.type} ${b.startTime}–${b.endTime}`);

(async () => {
  section('A — ✅ en una repetición completada');
  {
    const sb = makeSandbox();
    vm.runInContext(semanaSrc, sb, { filename: 'organizator.html (Semana)' });
    sb.state.tasks.push({ id: 'gym', title: 'Gimnasio', dueDate: MON, dueTime: '09:00', estimatedMinutes: 60, priority: 'media', done: false,
      recurrence: { frequency: 'daily', interval: 1 }, completedOccurrences: [WED] });
    const ctx = { events: [], tasks: sb.tasksForScheduler(MON, SUN), customSchedules: [] };
    const wed = sb.renderSemanaAgenda(sb.Scheduler.buildDayBlocks(WED, ctx).blocks);
    const thu = sb.renderSemanaAgenda(sb.Scheduler.buildDayBlocks(THU, ctx).blocks);
    check('A. la repetición tiene su bloque 09:00–10:00', wed.includes('09:00–10:00') && wed.includes('Gimnasio'));
    check('A. miércoles (completada): ✅', /semana-ag-task-done[\s\S]*?✅[\s\S]*?Gimnasio/.test(wed));
    check('A. jueves (sin completar): 📚, no ✅', thu.includes('📚') && !thu.includes('✅'));
    sb.state.tasks.push({ id: 'normal', title: 'Dentista', dueDate: WED, dueTime: '17:00', priority: 'media', done: true, recurrence: null });
    const ctx2 = { events: [], tasks: sb.tasksForScheduler(MON, SUN), customSchedules: [] };
    check('A. una tarea normal hecha sigue saliendo ✅', /✅<\/div>\s*<div class="ia-ag-body"><div class="ia-ag-title">Dentista/.test(sb.renderSemanaAgenda(sb.Scheduler.buildDayBlocks(WED, ctx2).blocks)));
  }

  section('B — ☕ descansos de 10 min junto a cada bloque');
  {
    const sb = makeSandbox();
    vm.runInContext(semanaSrc, sb, { filename: 'organizator.html (Semana)' });
    const ctx = { customSchedules: [{ id: 's', name: 'Clase', days: [2], startTime: '09:00', endTime: '10:00' }], tasks: [],
      events: [
        { id: 'e1', title: 'Médico', date: WED, startTime: '12:00', endTime: '13:00' },
        { id: 'e2', title: 'Reunión', date: WED, startTime: '14:00', endTime: '15:00' },
        { id: 'e3', title: 'Llamada', date: WED, startTime: '15:15', endTime: '16:00' },
      ] };
    const blocks = sb.semanaAgendaWithBreaks(sb.Scheduler.buildDayBlocks(WED, ctx).blocks, 10);
    check('B. la secuencia del día es la esperada', JSON.stringify(rows(blocks)) === JSON.stringify([
      'free 07:00–08:50', 'break 08:50–09:00', 'busy 09:00–10:00', 'break 10:00–10:10', 'free 10:10–11:50', 'break 11:50–12:00',
      'busy 12:00–13:00', 'break 13:00–13:10', 'free 13:10–13:50', 'break 13:50–14:00', 'busy 14:00–15:00',
      'break 15:00–15:15', 'busy 15:15–16:00', 'break 16:00–16:10', 'free 16:10–23:00',
    ]));
    check('B. hueco de 15 min entre dos bloques: un solo ☕', rows(blocks).includes('break 15:00–15:15'));
    const free = blocks.filter(b => b.type === 'free').map(b => `${b.startTime}–${b.endTime}`);
    check('B. lo que queda 🟢 libre es justo lo que usa Scheduler', JSON.stringify(free) === JSON.stringify(sb.Scheduler.getFreeSlotsFormatted(WED, ctx)));
    check('B. el día sigue cubierto sin huecos ni solapes', blocks.every((b, i) => i === 0 || blocks[i - 1].endTime === b.startTime));
    const html = sb.renderSemanaAgenda(blocks);
    check('B. se pinta ☕ Descanso', /ia-ag-break[\s\S]*?☕[\s\S]*?Descanso/.test(html));
    check('B. sin descansos (breakMinutes 0): los bloques no cambian', JSON.stringify(sb.semanaAgendaWithBreaks(sb.Scheduler.buildDayBlocks(WED, ctx).blocks, 0)) === JSON.stringify(sb.Scheduler.buildDayBlocks(WED, ctx).blocks));
    const empty = sb.semanaAgendaWithBreaks(sb.Scheduler.buildDayBlocks(THU, { events: [], tasks: [], customSchedules: [] }).blocks, 10);
    check('B. día sin nada: sin ☕', JSON.stringify(rows(empty)) === JSON.stringify(['free 07:00–23:00']));
  }

  section('C — también junto a una propuesta IA con hora; no junto a una sin hora');
  {
    const sb = makeSandbox();
    vm.runInContext(semanaSrc, sb, { filename: 'organizator.html (Semana)' });
    const blocks = sb.semanaAgendaWithBreaks([
      { type: 'free', start: 420, end: 600, startTime: '07:00', endTime: '10:00', label: 'Tiempo libre' },
      { type: 'proposal', startTime: '10:00', endTime: '11:00', title: 'Repasar', id: 'p1', batchId: 'b1' },
      { type: 'free', start: 660, end: 1380, startTime: '11:00', endTime: '23:00', label: 'Tiempo libre' },
      { type: 'proposal', startTime: null, endTime: null, title: 'Sin hueco', id: 'p2', batchId: 'b1' },
    ], 10);
    check('C. ☕ antes y después de la propuesta', JSON.stringify(rows(blocks)) === JSON.stringify([
      'free 07:00–09:50', 'break 09:50–10:00', 'proposal 10:00–11:00', 'break 11:00–11:10', 'free 11:10–23:00', 'proposal null–null',
    ]));
  }

  section('D — la vista Semana usa los descansos del Scheduler');
  {
    const call = 'renderSemanaAgenda(semanaAgendaWithBreaks(buildSemanaDayAgendaBlocks(dateStr, schedCtx), window.Scheduler.DEFAULTS.breakMinutes))';
    check('D. renderSemana pinta los bloques con semanaAgendaWithBreaks y breakMinutes del Scheduler', html.includes(call));
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
