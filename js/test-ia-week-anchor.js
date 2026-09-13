/**
 * ORGANIZATOR — Tests de 5F-3B (semana objetivo de planificación IA)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente el código
 * real de organizator.html (helpers de fecha, buildContext, ciclo de vida
 * de propuestas IA de 5D, planWeekProposals/validateWeeklyProposal de
 * 5E-2/5E-3 sin tocar, renderIAItemHTML, y runIAWeek(anchorDate) de esta
 * fase) y lo ejecuta con el js/scheduler.js real del proyecto (cargado tal
 * cual, sin tocar ni un carácter).
 *
 * callAI(), el DOM (iaThreadAddPending/iaThreadResolve/iaSetStatus/
 * iaSetButtonsDisabled/wireIAProposalButtons) y renderSemana() se sustituyen
 * por mocks mínimos: no son el objeto de esta fase (ya probados en
 * test-semana-ia-proposals.js / test-ia-week-validation.js) y no aportan
 * nada a "qué rango de 7 días se considera objetivo", que es lo único que
 * cambia en 5F-3B.
 *
 * Uso:  node js/test-ia-week-anchor.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
const SCHEDULER_PATH = path.join(ROOT, 'js', 'scheduler.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// 0) DOW_NAMES / DOW_FULL_MONFIRST — constantes usadas por buildContext.
const dowNamesSrc = "const DOW_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];";
const dowFullSrc = "const DOW_FULL_MONFIRST = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];";
if (!html.includes(dowNamesSrc)) throw new Error('No se encontró DOW_NAMES tal cual en organizator.html — ¿cambió el código?');
if (!html.includes(dowFullSrc)) throw new Error('No se encontró DOW_FULL_MONFIRST tal cual en organizator.html — ¿cambió el código?');

// 1) Helpers de fecha/día usados por buildContext (sin tocar en esta fase):
// pad/todayStr/nowTimeStr/parseYMD ... dowOfDate/schedulesForDow, y por
// separado addDays (misma zona del archivo, bloque contiguo hasta ahí).
const dateHelpersSrc = extractBetween(
  html,
  'function pad(n){',
  '\nfunction schedulesForDow(dow){\n  return state.customSchedules\n    .filter(s => Array.isArray(s.days) && s.days.includes(dow))\n    .sort((a,b) => (a.startTime||\'\').localeCompare(b.startTime||\'\'));\n}\n',
  'helpers de fecha (pad..schedulesForDow)'
) + '\n' + extractBetween(
  html,
  'function addDays(dateStr, n){',
  '\nfunction getWeekMonday(dateStr){',
  'addDays'
);

// 2) esc() — usada por renderIAItemHTML.
const escSrc = extractBetween(
  html,
  'function esc(s){',
  '\n\n/* ==================================================================',
  'esc()'
);

// 3) buildContext (la función modificada de esta fase).
const buildContextSrc = extractBetween(
  html,
  'function buildContext(scope, anchorDate){',
  '\nconst PLAN_ITEM_SCHEMA',
  'buildContext (5F-3B)'
);

// 4) PLAN_ITEM_SCHEMA + IA_RULES (constantes que runIAWeek referencia).
const constsSrc = extractBetween(
  html,
  'const PLAN_ITEM_SCHEMA = `{',
  '\nfunction iaSetStatus(msg){',
  'PLAN_ITEM_SCHEMA + IA_RULES'
);

// 5) Ciclo de vida de propuestas IA (5D, sin tocar en esta fase).
const lifecycleSrc = extractBetween(
  html,
  'let iaProposals = [];',
  '\n/* ---------- Llamada a la IA',
  'ciclo de vida de propuestas IA (5D)'
);

// 6) planWeekProposals (5E-2, sin tocar en esta fase).
const planWeekSrc = extractBetween(
  html,
  'function planWeekProposals(days, today, weekEnd, schedCtx){',
  '\n/* ---------- Validación de propuestas semanales',
  'planWeekProposals (5E-2)'
);

// 7) validateWeeklyProposal (5E-3, sin tocar en esta fase).
const validateSrc = extractBetween(
  html,
  'function validateWeeklyProposal(item, applyDate, schedCtx, weekStart, weekEnd, deadline){',
  '\n/* ---------- Agenda visual',
  'validateWeeklyProposal (5E-3)'
);

// 8) renderIAItemHTML (sin tocar en esta fase, la usa runIAWeek).
const renderIAItemSrc = extractBetween(
  html,
  'function renderIAItemHTML(it, dateForApply, batchId){',
  '\nfunction wireIAProposalButtons(container){',
  'renderIAItemHTML'
);

// 8b) iaExpirePendingProposalsBeforeReset (5F-3A, sin tocar en esta fase).
const expireSrc = extractBetween(
  html,
  'function iaExpirePendingProposalsBeforeReset(){',
  '\nasync function applyIAProposal(it, date){',
  'iaExpirePendingProposalsBeforeReset (5F-3A)'
);

// 9) runIAWeek(anchorDate) — la función nueva de esta fase.
const runIAWeekSrc = extractBetween(
  html,
  'async function runIAWeek(anchorDate){',
  '\n/* ---------- Chat con la IA',
  'runIAWeek (5F-3B)'
);

// ---------- Sandbox ----------
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.state = { tasks: [], events: [], customSchedules: [] };
sandbox.currentView = 'inicio';
// Mocks mínimos de DOM/IA — no son el objeto de esta fase.
sandbox.iaSetStatus = () => {};
sandbox.iaSetButtonsDisabled = () => {};
sandbox.iaThreadAddPending = () => ({});
sandbox.iaThreadResolve = () => {};
sandbox.wireIAProposalButtons = () => {};
sandbox.renderSemana = () => {};
sandbox.showToast = () => {};
sandbox.document = { getElementById: () => null, querySelectorAll: () => [] };
sandbox.parseAIJSON = (raw) => raw; // callAI mock ya devuelve el objeto final
// callAI mockeable por test: por defecto, una respuesta vacía válida.
sandbox.callAI = async (system, context) => {
  sandbox.__lastSystem = system;
  sandbox.__lastContext = context;
  return { summary: '', days: [] };
};
vm.createContext(sandbox);

vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });
vm.runInContext(dowNamesSrc, sandbox, { filename: 'organizator.html (DOW_NAMES)' });
vm.runInContext(dowFullSrc, sandbox, { filename: 'organizator.html (DOW_FULL_MONFIRST)' });
vm.runInContext(dateHelpersSrc, sandbox, { filename: 'organizator.html (helpers de fecha)' });
vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
vm.runInContext(buildContextSrc, sandbox, { filename: 'organizator.html (buildContext)' });
vm.runInContext(constsSrc, sandbox, { filename: 'organizator.html (PLAN_ITEM_SCHEMA/IA_RULES)' });
vm.runInContext(lifecycleSrc, sandbox, { filename: 'organizator.html (ciclo de vida IA)' });
vm.runInContext(planWeekSrc, sandbox, { filename: 'organizator.html (planWeekProposals)' });
vm.runInContext(validateSrc, sandbox, { filename: 'organizator.html (validateWeeklyProposal)' });
vm.runInContext(renderIAItemSrc, sandbox, { filename: 'organizator.html (renderIAItemHTML)' });
vm.runInContext(expireSrc, sandbox, { filename: 'organizator.html (iaExpirePendingProposalsBeforeReset)' });
vm.runInContext(runIAWeekSrc, sandbox, { filename: 'organizator.html (runIAWeek 5F-3B)' });
// `let iaProposals` es una variable léxica del contexto vm, no una
// propiedad de `sandbox` — y runIAWeek() la REASIGNA por completo
// ("iaProposals = [];" al reiniciar cada generación), lo que rompería una
// referencia estática tomada una sola vez. Se expone en su lugar un
// getter que siempre lee el binding léxico actual.
vm.runInContext('this.__getIAProposals = function(){ return iaProposals; };', sandbox, { filename: 'expose-iaProposals' });

const {
  buildContext, runIAWeek, addDays, todayStr,
  nextIAProposalId, nextIABatchId, getIAProposalById, getIAProposalFromBatch,
  setIAProposalStatus, validateWeeklyProposal, planWeekProposals,
} = sandbox;

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
function resetState() {
  sandbox.state.tasks = [];
  sandbox.state.events = [];
  sandbox.state.customSchedules = [];
  sandbox.__getIAProposals().length = 0;
  sandbox.currentView = 'inicio';
}

(async () => {

// =====================================================================
// A. runIAWeek() sin argumento → usa todayStr(), rango today..today+6
// =====================================================================
section('A — runIAWeek() sin argumento usa todayStr()');
{
  resetState();
  const real = todayStr();
  await runIAWeek();
  check('A. buildContext recibió el rango de hoy', sandbox.__lastContext.includes(`RANGO CONSIDERADO: ${real} a ${addDays(real, 6)}.`));
}

// =====================================================================
// B. runIAWeek('2030-01-14') → usa exactamente 2030-01-14..2030-01-20
// =====================================================================
section("B — runIAWeek('2030-01-14') usa ese rango exacto");
{
  resetState();
  await runIAWeek('2030-01-14');
  check('B. buildContext recibió 2030-01-14..2030-01-20', sandbox.__lastContext.includes('RANGO CONSIDERADO: 2030-01-14 a 2030-01-20.'));
  check('B. FECHA ACTUAL del contexto es la del anchor, no la real', sandbox.__lastContext.includes('FECHA ACTUAL: 2030-01-14'));
}

// =====================================================================
// C. Simular semana-next: week.anchorDate +7 → IA usa ese nuevo anchorDate
// =====================================================================
section('C — semana-next: +7 días usa el nuevo anchorDate');
{
  resetState();
  const week = { anchorDate: todayStr() };
  week.anchorDate = addDays(week.anchorDate, 7);
  await runIAWeek(week.anchorDate);
  check('C. usa el anchorDate tras avanzar una semana', sandbox.__lastContext.includes(`RANGO CONSIDERADO: ${week.anchorDate} a ${addDays(week.anchorDate, 6)}.`));
}

// =====================================================================
// D. Simular semana-prev: week.anchorDate -7 → IA usa ese anchorDate
// =====================================================================
section('D — semana-prev: -7 días usa el nuevo anchorDate');
{
  resetState();
  const week = { anchorDate: todayStr() };
  week.anchorDate = addDays(week.anchorDate, -7);
  await runIAWeek(week.anchorDate);
  check('D. usa el anchorDate tras retroceder una semana', sandbox.__lastContext.includes(`RANGO CONSIDERADO: ${week.anchorDate} a ${addDays(week.anchorDate, 6)}.`));
}

// =====================================================================
// E. semana-today: week.anchorDate = todayStr() → vuelve al rango actual
// =====================================================================
section('E — semana-today vuelve al rango actual');
{
  resetState();
  const week = { anchorDate: addDays(todayStr(), 21) };
  week.anchorDate = todayStr(); // "ir a hoy"
  const real = todayStr();
  await runIAWeek(week.anchorDate);
  check('E. tras volver a hoy, usa el rango de hoy', sandbox.__lastContext.includes(`RANGO CONSIDERADO: ${real} a ${addDays(real, 6)}.`));
}

// =====================================================================
// F. Las propuestas generadas con un anchorDate futuro tienen applyDate
//    dentro de anchorDate..anchorDate+6
// =====================================================================
section('F — propuestas de una semana futura caen dentro de ese rango');
{
  resetState();
  const anchor = '2030-03-04'; // lunes
  const weekEnd = addDays(anchor, 6);
  sandbox.callAI = async (system, context) => {
    sandbox.__lastSystem = system; sandbox.__lastContext = context;
    return {
      summary: 'Plan de prueba',
      days: [
        { date: anchor, label: 'Lunes', items: [
          { sourceType: 'proposal', kind: 'task', time: null, durationMinutes: null, estimatedMinutes: 30, title: 'Repasar temario', reason: 'tarea pendiente' },
        ] },
      ],
    };
  };
  await runIAWeek(anchor);
  const proposals = sandbox.__getIAProposals().filter(p => p.status === 'pending');
  check('F. se generó al menos una propuesta', proposals.length > 0);
  check('F. todas las propuestas caen dentro de anchorDate..anchorDate+6', proposals.every(p => p.applyDate >= anchor && p.applyDate <= weekEnd));
}

// =====================================================================
// G. buildContext('week') sin segundo argumento mantiene comportamiento
//    actual (usa todayStr())
// =====================================================================
section('G — buildContext(\'week\') sin anchorDate mantiene el comportamiento actual');
{
  resetState();
  const real = todayStr();
  const ctx = buildContext('week');
  check('G. usa el rango de hoy cuando no se pasa anchorDate', ctx.includes(`RANGO CONSIDERADO: ${real} a ${addDays(real, 6)}.`));
}

// =====================================================================
// H. buildContext('week', anchorDate) usa exactamente ese rango
// =====================================================================
section("H — buildContext('week', anchorDate) usa exactamente ese rango");
{
  resetState();
  const ctx = buildContext('week', '2031-07-01');
  check('H. RANGO CONSIDERADO es el del anchor', ctx.includes('RANGO CONSIDERADO: 2031-07-01 a 2031-07-07.'));
  check('H. FECHA ACTUAL del contexto es la del anchor', ctx.includes('FECHA ACTUAL: 2031-07-01'));
}

// =====================================================================
// I. Los demás modos de buildContext() no cambian (day no acepta/usa
//    anchorDate, sigue usando todayStr())
// =====================================================================
section('I — los demás modos de buildContext() no cambian');
{
  resetState();
  const real = todayStr();
  const ctxDay = buildContext('day', '2031-07-01'); // un anchorDate "colado" no debe afectar a 'day'
  check("I. buildContext('day') ignora un segundo argumento y sigue usando hoy", ctxDay.includes(`FECHA ACTUAL: ${real}`) && !ctxDay.includes('2031-07-01'));
}

// =====================================================================
// J. validateWeeklyProposal() sigue funcionando con un rango que no
//    empieza hoy (sin cambios, ya lo recibe todo por parámetro)
// =====================================================================
section('J — validateWeeklyProposal funciona con un rango que no empieza hoy');
{
  resetState();
  const weekStart = '2030-03-04', weekEnd = addDays(weekStart, 6);
  const item = { sourceType: 'proposal', kind: 'task', title: 'Estudiar', estimatedMinutes: 30 };
  const schedCtx = { events: [], tasks: [], customSchedules: [] };
  const check1 = validateWeeklyProposal(item, weekStart, schedCtx, weekStart, weekEnd, weekStart);
  check('J. valida correctamente una propuesta dentro de un rango futuro', check1.valid === true);
}

// =====================================================================
// K. 5F-2: una propuesta generada para una semana futura puede aplicarse
//    una sola vez (idempotencia intacta)
// =====================================================================
section('K — idempotencia 5F-2 intacta para propuestas de semana futura');
{
  resetState();
  const anchor = '2030-03-04';
  sandbox.callAI = async (system, context) => ({
    summary: '', days: [
      { date: anchor, label: 'Lunes', items: [
        { sourceType: 'proposal', kind: 'task', time: null, durationMinutes: null, estimatedMinutes: 30, title: 'Sesión de estudio', reason: '' },
      ] },
    ],
  });
  await runIAWeek(anchor);
  const p = sandbox.__getIAProposals().find(x => x.status === 'pending');
  check('K. hay una propuesta pendiente para aplicar', !!p);
  setIAProposalStatus(p.id, 'applied');
  check('K. tras aplicarla, queda en estado applied', getIAProposalById(p.id).status === 'applied');
  // Reintento de la misma transición (aplicar dos veces) no debe volver a "pending".
  setIAProposalStatus(p.id, 'applied');
  check('K. una segunda "aplicación" no reintroduce pending', getIAProposalById(p.id).status === 'applied');
}

// =====================================================================
// L. 5F-3A: generar una nueva semana después de otra sigue expirando las
//    pendientes correctamente
// =====================================================================
section('L — 5F-3A sigue expirando pendientes de la generación anterior');
{
  resetState();
  const anchor1 = '2030-03-04';
  sandbox.callAI = async () => ({
    summary: '', days: [
      { date: anchor1, label: 'Lunes', items: [
        { sourceType: 'proposal', kind: 'task', time: null, durationMinutes: null, estimatedMinutes: 30, title: 'Primera generación', reason: '' },
      ] },
    ],
  });
  await runIAWeek(anchor1);
  const first = sandbox.__getIAProposals().find(x => x.title === 'Primera generación');
  check('L. primera generación queda pending', !!first && first.status === 'pending');

  const anchor2 = addDays(anchor1, 7);
  sandbox.callAI = async () => ({
    summary: '', days: [
      { date: anchor2, label: 'Lunes', items: [
        { sourceType: 'proposal', kind: 'task', time: null, durationMinutes: null, estimatedMinutes: 30, title: 'Segunda generación', reason: '' },
      ] },
    ],
  });
  await runIAWeek(anchor2);
  const firstAfter = getIAProposalById(first.id);
  const second = sandbox.__getIAProposals().find(x => x.title === 'Segunda generación');
  // iaExpirePendingProposalsBeforeReset() se limita a avisar y deshabilitar
  // los botones ya renderizados en el DOM de esa generación anterior; el
  // propio reseteo de runIAWeek ("iaProposals = []") es lo que hace que la
  // propuesta vieja deje de estar activa: getIAProposalById ya no la
  // encuentra en absoluto (no queda como "discarded", simplemente deja de
  // rastrearse), que es el comportamiento real de 5F-3A sin tocar.
  check('L. la propuesta de la generación anterior ya no se rastrea tras el reseteo', firstAfter === null);
  check('L. la nueva generación queda pending', !!second && second.status === 'pending');
}

// ---------------- Resumen ----------------
console.log(`\nTotal: ${pass} ok, ${fail} fallidos.`);
process.exit(fail === 0 ? 0 : 1);

})();
