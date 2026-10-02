/**
 * ORGANIZATOR — Tests: la planificación con IA respeta TODAS las
 * repeticiones de los eventos recurrentes (fallo 3 de DIAGNOSTICO-IA.md)
 *
 * Antes, los flujos de IA (buildContext, Organizar mi día/semana,
 * revalidación antes de añadir, chat de acciones) usaban
 * eventsForScheduler() sin expandir la recurrencia: un evento que se
 * repite solo ocupaba su primera fecha, y la IA podía proponer cosas
 * encima del resto de repeticiones. La vista Semana sí las expandía.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el código real (fechas, recurrencia, categorías +
 * integración R-6, buildContext, planWeekProposals, validación,
 * revalidación, runIADay/runIAWeek y sus helpers de pintado) y lo ejecuta
 * con el js/scheduler.js real. callAI y el DOM se sustituyen por mocks.
 *
 * Uso:  node js/test-ia-recurring-events.js
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
  ['esc', extractBetween(html, 'function esc(s){', '\n}\n\n/* ==================================================================\n   FILAS DE TAREA', 'esc') + '\n}'],
  ['propuestas IA', extractBetween(html, 'let iaProposals = [];', '\n/* ---------- Llamada a la IA', 'ciclo de vida de propuestas IA')],
  ['buildContext', extractBetween(html, 'function buildContext(scope, anchorDate, endDate){', '\nconst PLAN_ITEM_SCHEMA', 'buildContext')],
  ['constantes IA', extractBetween(html, 'const PLAN_ITEM_SCHEMA = `{', '\nfunction iaSetStatus(msg){', 'PLAN_ITEM_SCHEMA + IA_RULES')],
  ['planWeekProposals', extractBetween(html, 'function planWeekProposals(days, today, weekEnd, schedCtx){', '\n/* ---------- Validación de propuestas semanales', 'planWeekProposals')],
  ['validación + revalidación', extractBetween(html, 'function validateWeeklyProposal(item, applyDate, schedCtx, weekStart, weekEnd, deadline){', '\n/* ---------- Agenda visual', 'validateWeeklyProposal + revalidateIAProposalBeforeApply')],
  ['splice + agenda', extractBetween(html, 'function spliceProposalsIntoBlocks(blocks, placedProposals){', '\n\n/* ---------- Hilo único del asistente', 'spliceProposalsIntoBlocks + renderDayAgendaList')],
  ['renderIAItemHTML', extractBetween(html, 'function renderIAItemHTML(it, dateForApply, batchId){', '\nfunction wireIAProposalButtons(container){', 'renderIAItemHTML')],
  ['expire', extractBetween(html, 'function iaExpirePendingProposalsBeforeReset(){', '\nasync function applyIAProposal(it, date){', 'iaExpirePendingProposalsBeforeReset')],
  ['runIADay + runIAWeek', extractBetween(html, 'async function runIADay(){', '\n/* ---------- Chat con la IA', 'runIADay + runIAWeek')],
  ['badges', extractBetween(html, 'function renderEventContextBadges(eventContext){', '\n/* ---------- Semana: lo del día', 'renderEventContextBadges')],
];

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
sandbox.showToast = () => {};
sandbox.parseAIJSON = (raw) => raw; // callAI (mock) ya devuelve el objeto final
sandbox.__aiResponse = null;
sandbox.callAI = async (system, context) => { sandbox.__lastContext = context; return sandbox.__aiResponse; };
vm.createContext(sandbox);
vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });
vm.runInContext('var state = { tasks: [], events: [], customSchedules: [], eventCategories: [] };', sandbox);
sources.forEach(([label, src]) => vm.runInContext(src, sandbox, { filename: `organizator.html (${label})` }));
vm.runInContext('this.__getIAProposals = function(){ return iaProposals; };', sandbox);

const { addDays, todayStr, eventsForScheduler, buildContext, runIADay, runIAWeek, revalidateIAProposalBeforeApply } = sandbox;
const { timeToMin } = sandbox.Scheduler._internal;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// Evento que se repite TODOS los días de 07:00 a 21:00, empezado hace una
// semana: el único hueco real de cada día es 21:10–23:00 (colchón de 10
// min incluido). Antes del arreglo solo ocupaba su primera fecha (pasada),
// así que la IA colocaba las propuestas a las 07:00.
const TODAY = todayStr();
const START = addDays(TODAY, -7);
const D3 = addDays(TODAY, 3);
const D10 = addDays(TODAY, 10);
function setRecurringClass() {
  sandbox.state.tasks = [];
  sandbox.state.customSchedules = [];
  sandbox.state.eventCategories = [];
  sandbox.state.events = [{
    id: 'ev-clase', title: 'Clase de inglés', date: START, endDate: '', allDay: false,
    startTime: '07:00', endTime: '21:00',
    recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: START, endDate: null },
  }];
  sandbox.__getIAProposals().length = 0;
}
const overlapsClass = (time, endTime) => timeToMin(time) < timeToMin('21:00') && timeToMin(endTime) > timeToMin('07:00');

(async () => {
  section('A — eventsForScheduler expande las repeticiones');
  {
    setRecurringClass();
    const all = eventsForScheduler();
    check('A. sin rango incluye la repetición de dentro de 10 días', all.some(e => e.eventId === 'ev-clase' && e.date === D10));
    const one = eventsForScheduler(D3, D3);
    check('A. con rango [d, d] incluye la repetición de ese día', one.some(e => e.eventId === 'ev-clase' && e.date === D3));
    check('A. blocksSchedule sigue resuelto', all.every(e => e.blocksSchedule === true));
    check('A. no toca state.events', sandbox.state.events.length === 1 && !sandbox.state.events[0].eventId);
  }

  section('B — buildContext: la IA ve la clase y los huecos reales cada día');
  {
    setRecurringClass();
    const ctx = buildContext('week');
    check('B. la clase aparece en la lista de eventos en una fecha futura', ctx.includes(`Clase de inglés — ${D3}`));
    const slotLine = ctx.split('\n').find(l => l.startsWith(`- ${D3} `));
    check('B. huecos libres de ese día: solo 21:10–23:00', !!slotLine && slotLine.includes('21:10–23:00') && !slotLine.includes('07:00'));
  }

  section('C — Organizar mi semana no coloca nada encima de la clase');
  {
    setRecurringClass();
    // Hoy ocupado entero (evento normal de todo el día): así el resultado
    // no depende de la hora a la que se ejecute el test — la propuesta
    // tiene que ir a otro día, donde solo la clase recurrente la limita.
    sandbox.state.events.push({ id: 'ev-hoy', title: 'Ocupado hoy', date: TODAY, endDate: '', allDay: true, startTime: '', endTime: '' });
    sandbox.__aiResponse = { summary: '', days: [{ date: D3, label: 'día', items: [
      { sourceType: 'proposal', kind: 'task', title: 'Repasar vocabulario', estimatedMinutes: 60, time: null },
    ] }] };
    await runIAWeek();
    const props = sandbox.__getIAProposals().filter(p => p.source === 'week');
    check('C. se generó la propuesta', props.length === 1);
    check('C. con hora y fuera de 07:00–21:00', props.length === 1 && !!props[0].time && !overlapsClass(props[0].time, props[0]._endTime));
    check('C. empieza a las 21:10 o más tarde', props.length === 1 && !!props[0].time && timeToMin(props[0].time) >= timeToMin('21:10'));
    check('C. no va a hoy (ocupado entero)', props.length === 1 && props[0].applyDate !== TODAY);
  }

  // Depende de la hora real (Organizar mi día solo usa huecos desde ahora):
  // después de las 21:00 no puede fallar, pero tampoco detecta el error.
  section('D — Organizar mi día no coloca nada encima de la clase');
  {
    setRecurringClass();
    sandbox.__aiResponse = { summary: '', planItems: [
      { sourceType: 'proposal', kind: 'task', title: 'Leer', estimatedMinutes: 30, time: null },
    ] };
    await runIADay();
    const timed = sandbox.__getIAProposals().filter(p => p.source === 'day' && p.time);
    check('D. ninguna propuesta de hoy cae dentro de 07:00–21:00', timed.every(p => !overlapsClass(p.time, p._endTime)));
  }

  section('E — revalidación antes de añadir detecta la repetición');
  {
    setRecurringClass();
    const res = revalidateIAProposalBeforeApply({ id: 'p1', time: '10:00', _endTime: '11:00', _durationMinutes: 60, applyDate: D3 });
    check('E. una propuesta a las 10:00 en un día con clase ya no es válida', res.valid === false);
    const ok = revalidateIAProposalBeforeApply({ id: 'p2', time: '21:30', _endTime: '22:00', _durationMinutes: 30, applyDate: D3 });
    check('E. una propuesta a las 21:30 sí es válida', ok.valid === true);
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
