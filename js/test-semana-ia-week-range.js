/**
 * ORGANIZATOR — Tests: "Planificar con IA" desde Semana planifica de
 * lunes a domingo (B3 de PLAN-FINAL.md)
 *
 * Antes, el botón de la vista Semana llamaba a runIAWeek(week.anchorDate)
 * y planificaba 7 días desde el día visible (p. ej. de jueves a
 * miércoles), así que parte de las propuestas caían en la semana
 * siguiente. Ahora planifica la semana visible de lunes a domingo, desde
 * hoy si es la semana actual (semanaIAWeekRange), y no hace nada en una
 * semana ya pasada. "Organizar mi semana" de Inicio no cambia: 7 días
 * desde hoy.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el código real y lo ejecuta con el js/scheduler.js
 * real. callAI y el DOM son mocks.
 *
 * Uso:  node js/test-semana-ia-week-range.js
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

const rangeSrc = extractBetween(html, '/** Días que planifica "Planificar con IA" en la vista Semana', '\n\n/* ==================================================================\n   ALMACENAMIENTO', 'semanaIAWeekRange');

// Semana futura fija: lunes 11 – domingo 17 de marzo de 2030.
const MON = '2030-03-11', THU = '2030-03-14', SUN = '2030-03-17', NEXT_MON = '2030-03-18';

(async () => {
  section('A — semanaIAWeekRange: de lunes a domingo, sin días pasados');
  {
    const sb = makeSandbox();
    vm.runInContext(rangeSrc, sb, { filename: 'organizator.html (semanaIAWeekRange)' });
    // Se fija "hoy" para que el resultado no dependa del día del test.
    vm.runInContext(`todayStr = function(){ return '2030-03-01'; };`, sb);
    let r = sb.semanaIAWeekRange(THU);
    check('A. semana futura vista desde un jueves: lunes a domingo', r && r.from === MON && r.to === SUN);
    check('A. vista desde el domingo: la misma semana', JSON.stringify(sb.semanaIAWeekRange(SUN)) === JSON.stringify(r));
    vm.runInContext(`todayStr = function(){ return '${THU}'; };`, sb);
    r = sb.semanaIAWeekRange(THU);
    check('A. semana actual: desde hoy (jueves) hasta el domingo', r && r.from === THU && r.to === SUN);
    r = sb.semanaIAWeekRange(MON);
    check('A. semana actual vista desde su lunes: también desde hoy', r && r.from === THU && r.to === SUN);
    vm.runInContext(`todayStr = function(){ return '${SUN}'; };`, sb);
    r = sb.semanaIAWeekRange(MON);
    check('A. hoy es domingo: solo el domingo', r && r.from === SUN && r.to === SUN);
    vm.runInContext(`todayStr = function(){ return '${NEXT_MON}'; };`, sb);
    check('A. semana ya pasada: null', sb.semanaIAWeekRange(THU) === null);
  }

  section('B — runIAWeek(desde, hasta): la IA y las propuestas no salen del rango');
  {
    const sb = makeSandbox();
    sb.state.tasks.push({ id: 't1', title: 'Informe', dueDate: '2030-03-20', priority: 'alta', done: false, recurrence: null });
    sb.__aiResponse = { summary: '', days: [
      { date: THU, label: 'jueves', items: [{ sourceType: 'proposal', kind: 'task', title: 'Repasar', estimatedMinutes: 45, time: null, taskId: null }] },
      { date: '2030-03-19', label: 'martes', items: [{ sourceType: 'proposal', kind: 'task', title: 'Fuera', estimatedMinutes: 30, time: null, taskId: null }] },
    ] };
    await sb.runIAWeek(THU, SUN);
    const ctx = sb.__lastContext;
    check('B. rango del contexto: jueves a domingo', ctx.includes(`RANGO CONSIDERADO: ${THU} a ${SUN}.`));
    check('B. huecos libres solo de jueves a domingo (4 días)', ctx.includes(`- ${SUN} (`) && !ctx.includes(`- ${NEXT_MON} (`) && !ctx.includes('- 2030-03-20 ('));
    check('B. la tarea que vence después del domingo no entra en el rango', !ctx.includes('[id:t1] Informe — vence'));
    check('B. el prompt no habla de 7 días', !sb.__lastSystem.includes('los 7 días'));
    const props = sb.__getIAProposals();
    check('B. ninguna propuesta queda después del domingo', props.length > 0 && props.every(p => (p.applyDate || p._finalDate || '') <= SUN));
  }

  section('C — Inicio ("Organizar mi semana") no cambia: 7 días');
  {
    const sb = makeSandbox();
    sb.__aiResponse = { summary: '', days: [] };
    await sb.runIAWeek(THU);
    check('C. runIAWeek(día) sin final: 7 días desde ese día', sb.__lastContext.includes(`RANGO CONSIDERADO: ${THU} a 2030-03-20.`));
    check('C. huecos de los 7 días', sb.__lastContext.includes('- 2030-03-20 ('));
    const today = sb.todayStr();
    await sb.runIAWeek();
    check('C. sin argumentos: desde hoy, 7 días', sb.__lastContext.includes(`RANGO CONSIDERADO: ${today} a ${sb.addDays(today, 6)}.`));
    await sb.runIAWeek(THU, '2030-03-01');
    check('C. un final anterior al inicio se ignora (7 días)', sb.__lastContext.includes(`RANGO CONSIDERADO: ${THU} a 2030-03-20.`));
  }

  section('D — el botón de Semana usa semanaIAWeekRange');
  {
    const handler = extractBetween(html, "if(semanaWeekBtn) semanaWeekBtn.addEventListener('click', () => {", '\n  });', 'botón de Semana');
    check('D. calcula el rango con la semana visible', handler.includes('semanaIAWeekRange(week.anchorDate)'));
    check('D. semana pasada: aviso y no llama a la IA', /if\(!range\)\{ showToast\([^)]*\); return; \}/.test(handler));
    check('D. llama a runIAWeek(desde, hasta)', handler.includes('runIAWeek(range.from, range.to)'));
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
