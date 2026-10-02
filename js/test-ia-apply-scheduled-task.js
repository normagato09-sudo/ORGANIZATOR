/**
 * ORGANIZATOR — Tests: una propuesta IA aceptada se guarda como TAREA
 * PLANIFICADA con su duración real (fallo 2 de DIAGNOSTICO-IA.md)
 *
 * Antes, "Añadir al plan" guardaba una propuesta con hora como EVENTO con
 * solo hora de inicio (la app suponía 1 h) y nunca como tarea; y si la
 * propuesta salía de una tarea ya existente, se creaba otra aparte.
 * Ahora:
 *  - con hora → tarea con scheduledDate/scheduledStart/scheduledEnd y la
 *    duración real;
 *  - si la IA indica "taskId" de una tarea pendiente sin planificar → se
 *    planifica ESA tarea (no se crea otra); si ya tenía hueco (otra sesión
 *    ya añadida) → tarea nueva para esta sesión, con la misma fecha límite;
 *  - sin hora y con tarea original → no se duplica.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el código real (fechas, recurrencia, categorías + R-6,
 * CRUD, buildContext, runIAWeek y sus helpers, applyIAProposal) y lo
 * ejecuta con el js/scheduler.js real. callAI y el DOM son mocks.
 *
 * Uso:  node js/test-ia-apply-scheduled-task.js
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

const DAY = '2030-03-12';
const proposal = (o) => Object.assign({ id: 'p-' + Math.random().toString(36).slice(2, 8), batchId: 'b1', source: 'week', status: 'pending', kind: 'task', title: 'Estudiar tema 4', reason: 'Examen el viernes', applyDate: DAY }, o);

(async () => {
  section('A — con hora: tarea planificada con su duración real, no evento de 1 h');
  {
    const sb = makeSandbox();
    const msg = await sb.applyIAProposal(proposal({ time: '16:00', _endTime: '16:30', _durationMinutes: 30 }), DAY);
    const t = sb.state.tasks[0];
    check('A. se crea 1 tarea y ningún evento', sb.state.tasks.length === 1 && sb.state.events.length === 0);
    check('A. planificada ese día 16:00–16:30', !!t && t.scheduledDate === DAY && t.scheduledStart === '16:00' && t.scheduledEnd === '16:30');
    check('A. estimatedMinutes = 30', !!t && t.estimatedMinutes === 30);
    check('A. fecha límite = el día de la propuesta', !!t && t.dueDate === DAY);
    check('A. aviso por defecto', msg === 'Añadido al plan');
  }

  section('B — sin _endTime: el fin sale de la duración (90 min)');
  {
    const sb = makeSandbox();
    await sb.applyIAProposal(proposal({ time: '17:00', _durationMinutes: 90 }), DAY);
    const t = sb.state.tasks[0];
    check('B. 17:00–18:30', !!t && t.scheduledStart === '17:00' && t.scheduledEnd === '18:30' && t.estimatedMinutes === 90);
  }

  section('C — sale de una tarea existente sin planificar: se planifica ESA tarea');
  {
    const sb = makeSandbox();
    sb.state.tasks.push({ id: 'orig', title: 'Estudiar mates', dueDate: '2030-03-15', dueTime: '', priority: 'alta', done: false, recurrence: null });
    const p = proposal({ time: '10:00', _endTime: '10:45', _durationMinutes: 45, taskId: 'orig' });
    const msg = await sb.applyIAProposal(p, DAY);
    const t = sb.state.tasks[0];
    check('C. no se crea otra tarea', sb.state.tasks.length === 1 && sb.state.events.length === 0);
    check('C. la tarea original queda planificada 10:00–10:45 ese día', t.scheduledDate === DAY && t.scheduledStart === '10:00' && t.scheduledEnd === '10:45' && t.estimatedMinutes === 45);
    check('C. conserva título, fecha límite y prioridad', t.title === 'Estudiar mates' && t.dueDate === '2030-03-15' && t.priority === 'alta');
    check('C. aviso con el nombre de la tarea', typeof msg === 'string' && msg.includes('Estudiar mates') && msg.includes('10:00'));
    await sb.applyIAProposal(p, DAY);
    check('C. aplicar dos veces la misma propuesta no hace nada más', sb.state.tasks.length === 1);
    const blocks = sb.Scheduler.buildDayBlocks(DAY, { events: [], tasks: sb.state.tasks, customSchedules: [] }).blocks;
    check('C. la agenda del día (Semana) la muestra como bloque de tarea', blocks.some(b => b.type === 'busy' && b.kinds[0] === 'task' && b.ids[0] === 'orig'));
  }

  section('D — segunda sesión de una tarea ya planificada: tarea nueva, la original no se mueve');
  {
    const sb = makeSandbox();
    sb.state.tasks.push({ id: 'orig', title: 'Estudiar mates', dueDate: '2030-03-15', dueTime: '', priority: 'alta', done: false, recurrence: null });
    await sb.applyIAProposal(proposal({ time: '10:00', _endTime: '10:45', _durationMinutes: 45, taskId: 'orig' }), DAY);
    await sb.applyIAProposal(proposal({ title: 'Estudiar mates (2ª sesión)', time: '18:00', _endTime: '19:00', _durationMinutes: 60, taskId: 'orig', applyDate: '2030-03-13' }), '2030-03-13');
    const orig = sb.state.tasks.find(t => t.id === 'orig');
    const session = sb.state.tasks.find(t => t.id !== 'orig');
    check('D. hay 2 tareas', sb.state.tasks.length === 2);
    check('D. la original sigue en su primer hueco', orig.scheduledDate === DAY && orig.scheduledStart === '10:00');
    check('D. la sesión nueva queda planificada 18:00–19:00 del día 13', !!session && session.scheduledDate === '2030-03-13' && session.scheduledStart === '18:00' && session.scheduledEnd === '19:00');
    check('D. la sesión hereda fecha límite y prioridad y enlaza con la original', !!session && session.dueDate === '2030-03-15' && session.priority === 'alta' && session.sourceTaskId === 'orig');
  }

  section('E — taskId que no vale (hecha, inexistente o recurrente): tarea nueva');
  {
    const sb = makeSandbox();
    sb.state.tasks.push({ id: 'done', title: 'Hecha', dueDate: DAY, done: true, recurrence: null });
    sb.state.tasks.push({ id: 'rec', title: 'Diaria', dueDate: DAY, done: false, recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: DAY, endDate: null } });
    await sb.applyIAProposal(proposal({ time: '09:00', _endTime: '09:30', _durationMinutes: 30, taskId: 'done' }), DAY);
    await sb.applyIAProposal(proposal({ time: '11:00', _endTime: '11:30', _durationMinutes: 30, taskId: 'no-existe' }), DAY);
    await sb.applyIAProposal(proposal({ time: '12:00', _endTime: '12:30', _durationMinutes: 30, taskId: 'rec' }), DAY);
    check('E. se crean 3 tareas nuevas', sb.state.tasks.length === 5);
    check('E. la tarea hecha no se toca', !sb.state.tasks.find(t => t.id === 'done').scheduledDate);
    check('E. la recurrente no se toca', !sb.state.tasks.find(t => t.id === 'rec').scheduledDate);
  }

  section('F — sin hora y con tarea original: no se duplica');
  {
    const sb = makeSandbox();
    sb.state.tasks.push({ id: 'orig', title: 'Entregar trabajo', dueDate: DAY, done: false, recurrence: null });
    const msg = await sb.applyIAProposal(proposal({ time: null, noSlot: true, taskId: 'orig' }), DAY);
    check('F. no se crea nada', sb.state.tasks.length === 1 && sb.state.events.length === 0);
    check('F. el aviso lo explica', typeof msg === 'string' && msg.includes('ya está en tus tareas'));
    const sb2 = makeSandbox();
    await sb2.applyIAProposal(proposal({ time: null, noSlot: true }), DAY);
    check('F. sin tarea original, sigue creando la tarea con fecha límite (como antes)', sb2.state.tasks.length === 1 && sb2.state.tasks[0].dueDate === DAY && !sb2.state.tasks[0].scheduledDate);
  }

  section('G — de extremo a extremo: Organizar mi semana → Añadir al plan');
  {
    const sb = makeSandbox();
    const today = sb.todayStr();
    const tomorrow = sb.addDays(today, 1);
    // Hoy ocupado entero: el resultado no depende de la hora del test.
    sb.state.events.push({ id: 'hoy', title: 'Ocupado', date: today, endDate: '', allDay: true, startTime: '', endTime: '' });
    sb.state.tasks.push({ id: 'orig', title: 'Estudiar mates', dueDate: sb.addDays(today, 5), dueTime: '', priority: 'alta', done: false, recurrence: null });
    sb.__aiResponse = { summary: '', days: [{ date: tomorrow, label: 'mañana', items: [
      { sourceType: 'proposal', kind: 'task', title: 'Estudiar mates', estimatedMinutes: 50, time: null, taskId: 'orig' },
    ] }] };
    await sb.runIAWeek();
    check('G. el contexto de la IA incluye el id de la tarea', sb.__lastContext.includes('[id:orig] Estudiar mates'));
    check('G. el esquema pide "taskId"', sb.__lastSystem.includes('"taskId"'));
    const p = sb.__getIAProposals()[0];
    check('G. la propuesta conserva taskId', !!p && p.taskId === 'orig' && !!p.time);
    await sb.applyIAProposal(p, p.applyDate);
    const t = sb.state.tasks.find(x => x.id === 'orig');
    check('G. se planifica la tarea original, sin crear otra', sb.state.tasks.length === 1 && t.scheduledDate === p.applyDate && t.scheduledStart === p.time && t.scheduledEnd === p._endTime);
    check('G. con la duración pedida (50 min)', t.estimatedMinutes === 50);
  }

  section('H — Organizar mi día también conserva taskId');
  {
    const sb = makeSandbox();
    sb.state.tasks.push({ id: 'orig', title: 'Leer capítulo', dueDate: sb.todayStr(), dueTime: '', priority: 'media', done: false, recurrence: null });
    sb.__aiResponse = { summary: '', planItems: [
      { sourceType: 'proposal', kind: 'task', title: 'Leer capítulo', estimatedMinutes: 20, time: null, taskId: 'orig' },
    ] };
    await sb.runIADay();
    // Con hueco (según la hora a la que se ejecute) o sin él, la propuesta
    // tiene que llevar el taskId por cualquiera de los dos caminos.
    const props = sb.__getIAProposals().filter(p => p.source === 'day');
    check('H. se generó la propuesta y lleva taskId', props.length === 1 && props[0].taskId === 'orig');
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
