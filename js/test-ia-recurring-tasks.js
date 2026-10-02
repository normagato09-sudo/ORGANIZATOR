/**
 * ORGANIZATOR — Tests: tareas que se repiten en la planificación con IA (A4)
 *
 *  - Cada repetición pendiente llega a la IA con su propio id
 *    ("tarea::fecha") y la IA la planifica en SU día (task.notBefore en
 *    Scheduler), nunca en otro.
 *  - Una repetición con hora fija (dueTime) o ya planificada ocupa su
 *    bloque: no se propone nada encima (tasksForScheduler).
 *  - Al aceptar la propuesta se planifica ESA repetición en la propia
 *    tarea (scheduledOccurrences[fecha]), sin crear otra tarea.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el código real y lo ejecuta con el js/scheduler.js
 * real. callAI y el DOM son mocks.
 *
 * Uso:  node js/test-ia-recurring-tasks.js
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
  ['buildContext', extractBetween(html, 'function buildContext(scope, anchorDate){', '\nconst PLAN_ITEM_SCHEMA', 'buildContext')],
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

// Semana futura fija (lunes 2030-03-11 a domingo 2030-03-17): el
// resultado no depende del día en que se ejecute el test.
const MON = '2030-03-11', WED = '2030-03-13', SUN = '2030-03-17';
const recurringTask = (o) => Object.assign({ id: 'rec', title: 'Repasar inglés', dueDate: MON, dueTime: '', priority: 'media', done: false,
  recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: MON, endDate: null } }, o);
const proposal = (o) => Object.assign({ id: 'p-' + Math.random().toString(36).slice(2, 8), batchId: 'b1', source: 'week', status: 'pending', kind: 'task', title: 'Repasar inglés', reason: '', applyDate: WED }, o);

(async () => {
  section('A — tasksForScheduler: la hora fija de cada repetición ocupa su bloque');
  {
    const sb = makeSandbox();
    sb.state.tasks.push(recurringTask({ dueTime: '17:00', estimatedMinutes: 30 }));
    sb.state.tasks.push(recurringTask({ id: 'libre', title: 'Leer', dueTime: '' }));
    sb.state.tasks.push({ id: 'normal', title: 'Normal', dueDate: WED, done: false, recurrence: null, scheduledDate: WED, scheduledStart: '10:00', scheduledEnd: '11:00' });
    const list = sb.tasksForScheduler(MON, SUN);
    const recBlocks = list.filter(t => t.taskId === 'rec');
    check('A. 7 bloques, uno por repetición, 17:00–17:30', recBlocks.length === 7 && recBlocks.every(b => b.scheduledStart === '17:00' && b.scheduledEnd === '17:30'));
    check('A. con id "tarea::fecha"', recBlocks.some(b => b.id === `rec::${WED}` && b.scheduledDate === WED));
    check('A. una repetición sin hora no ocupa nada', !list.some(t => t.taskId === 'libre' || t.id === 'libre'));
    check('A. la tarea normal pasa tal cual', list.some(t => t.id === 'normal' && t.scheduledStart === '10:00'));
    const ctx = { events: [], tasks: list, customSchedules: [] };
    const busy = sb.Scheduler._internal.getBusyIntervals(WED, ctx);
    check('A. Scheduler ve 17:00–17:30 ocupado el miércoles', busy.some(([s, e]) => s <= 17 * 60 && e >= 17 * 60 + 30));
    const sb2 = makeSandbox();
    sb2.state.tasks.push(recurringTask({ dueTime: '17:00' }));
    check('A. sin duración: 60 min', sb2.tasksForScheduler(WED, WED)[0].scheduledEnd === '18:00');
  }

  section('B — una propuesta no cae encima de una repetición con hora fija');
  {
    const sb = makeSandbox();
    // Solo queda libre 17:00–18:10 el miércoles (con el colchón de 10 min).
    sb.state.customSchedules.push({ id: 's1', name: 'Clase', days: [0, 1, 2, 3, 4, 5, 6], startTime: '07:00', endTime: '16:50' });
    sb.state.customSchedules.push({ id: 's2', name: 'Trabajo', days: [0, 1, 2, 3, 4, 5, 6], startTime: '18:10', endTime: '23:00' });
    const pseudo = [{ id: 'x', title: 'Estudiar', dueDate: WED, notBefore: WED, estimatedMinutes: 45, priority: 'media' }];
    const ctxSin = { events: [], tasks: sb.tasksForScheduler(WED, WED), customSchedules: sb.state.customSchedules };
    check('B. sin la tarea recurrente, cabe a las 17:00', sb.Scheduler.autoSchedule(pseudo, ctxSin, { fromDate: WED })[0].scheduledStart === '17:00');
    sb.state.tasks.push(recurringTask({ dueTime: '17:00' }));
    const ctxCon = { events: [], tasks: sb.tasksForScheduler(WED, WED), customSchedules: sb.state.customSchedules };
    const r = sb.Scheduler.autoSchedule(pseudo, ctxCon, { fromDate: WED })[0];
    check('B. con su hora fija (17:00–18:00), ya no cabe', !r.scheduledStart);
  }

  section('C — Scheduler: task.notBefore');
  {
    const sb = makeSandbox();
    const ctx = { events: [], tasks: [], customSchedules: [] };
    const r = sb.Scheduler.scheduleTask({ id: 'x', title: 'X', dueDate: WED, notBefore: WED, estimatedMinutes: 30, priority: 'media' }, ctx, { fromDate: MON });
    check('C. no se adelanta antes de notBefore', r.scheduledDate === WED);
    const r2 = sb.Scheduler.scheduleTask({ id: 'y', title: 'Y', dueDate: WED, estimatedMinutes: 30, priority: 'media' }, ctx, { fromDate: MON });
    check('C. sin notBefore, igual que antes (desde fromDate)', r2.scheduledDate === MON);
  }

  section('D — buildContext: cada repetición pendiente con su id');
  {
    const sb = makeSandbox();
    sb.state.tasks.push(recurringTask({ dueDate: '2030-01-01', recurrence: { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2030-01-01', endDate: null }, completedOccurrences: [MON] }));
    sb.state.tasks.push(recurringTask({ id: 'fija', title: 'Gimnasio', dueTime: '19:00' }));
    const ctx = sb.buildContext('week', MON);
    check('D. la repetición del miércoles aparece con id "rec::fecha"', ctx.includes(`[id:rec::${WED}] Repasar inglés — el ${WED}, SIN HORA FIJA AÚN`));
    check('D. la repetición completada no aparece', !ctx.includes(`[id:rec::${MON}]`));
    check('D. la de hora fija aparece como ya programada', ctx.includes(`[id:fija::${WED}] Gimnasio — el ${WED}, YA PROGRAMADA de 19:00 a 20:00`));
    check('D. la recurrente no sale como atrasada', !/TAREAS ATRASADAS[^\n]*\n- \[id:rec\]/.test(ctx));
    check('D. huecos libres: el miércoles termina a las 18:50 por el gimnasio', ctx.includes(`- ${WED} (Miércoles): 07:00–18:50, 20:10–23:00`));
  }

  section('E — planWeekProposals: la repetición va en su día aunque la IA la ponga en otro');
  {
    const sb = makeSandbox();
    sb.state.tasks.push(recurringTask());
    const schedCtx = { events: [], tasks: sb.tasksForScheduler(MON, SUN), customSchedules: [] };
    const days = [{ date: MON, items: [
      { sourceType: 'proposal', kind: 'task', title: 'Repasar inglés', estimatedMinutes: 30, time: null, taskId: `rec::${WED}` },
      { sourceType: 'proposal', kind: 'task', title: 'Otra cosa', estimatedMinutes: 30, time: null, taskId: null },
    ] }];
    const out = sb.planWeekProposals(days, MON, SUN, schedCtx);
    check('E. la repetición queda el miércoles', out[0].items[0]._finalDate === WED && !!out[0].items[0].time);
    check('E. una propuesta normal sigue igual (el lunes)', out[0].items[1]._finalDate === MON);
  }


  section('F — aceptar: se planifica ESA repetición, sin crear otra tarea');
  {
    const sb = makeSandbox();
    sb.state.tasks.push(recurringTask());
    const p = proposal({ time: '16:00', _endTime: '16:30', _durationMinutes: 30, taskId: `rec::${WED}` });
    const msg = await sb.applyIAProposal(p, WED);
    const t = sb.state.tasks[0];
    check('F. no se crea ninguna tarea', sb.state.tasks.length === 1);
    check('F. scheduledOccurrences[miércoles] = 16:00–16:30', !!t.scheduledOccurrences && t.scheduledOccurrences[WED].start === '16:00' && t.scheduledOccurrences[WED].end === '16:30');
    check('F. la tarea base no cambia de fecha ni de hora', !t.scheduledDate && t.dueTime === '' && t.dueDate === MON);
    check('F. aviso con nombre, día y hora', msg.includes('Repasar inglés') && msg.includes(WED) && msg.includes('16:00'));
    await sb.applyIAProposal(p, WED);
    check('F. aplicar dos veces no hace nada más', sb.state.tasks.length === 1 && Object.keys(t.scheduledOccurrences).length === 1);
    const occ = sb.getTaskOccurrences(t, MON, SUN);
    const wed = occ.find(o => o.occurrenceDate === WED), thu = occ.find(o => o.occurrenceDate === '2030-03-14');
    check('F. la repetición del miércoles muestra su franja', wed.scheduledDate === WED && wed.scheduledStart === '16:00' && wed.scheduledEnd === '16:30');
    check('F. las demás repeticiones no', !thu.scheduledStart && !('scheduledOccurrences' in thu));
    const blocks = sb.Scheduler.buildDayBlocks(WED, { events: [], tasks: sb.tasksForScheduler(WED, WED), customSchedules: [] }).blocks;
    check('F. la agenda del miércoles la pinta como bloque de tarea', blocks.some(b => b.type === 'busy' && b.kinds[0] === 'task' && b.ids[0] === `rec::${WED}` && b.startTime === '16:00'));
    check('F. revalidar una propuesta encima de ella falla', !sb.revalidateIAProposalBeforeApply({ id: 'z', time: '16:15', _endTime: '16:45', applyDate: WED }).valid);

    await sb.applyIAProposal(proposal({ time: '18:00', _endTime: '18:30', _durationMinutes: 30, taskId: `rec::${WED}` }), WED);
    const extra = sb.state.tasks.find(x => x.id !== 'rec');
    check('F. otra sesión de la misma repetición: tarea aparte enlazada', sb.state.tasks.length === 2 && !!extra && extra.scheduledDate === WED && extra.scheduledStart === '18:00' && extra.sourceTaskId === 'rec');
    check('F. la repetición sigue en 16:00', t.scheduledOccurrences[WED].start === '16:00');
  }

  section('G — casos que no planifican la repetición');
  {
    const sb = makeSandbox();
    sb.state.tasks.push(recurringTask({ completedOccurrences: [WED] }));
    await sb.applyIAProposal(proposal({ time: '16:00', _endTime: '16:30', _durationMinutes: 30, taskId: `rec::${WED}` }), WED);
    check('G. repetición ya completada: tarea nueva, la recurrente no se toca', sb.state.tasks.length === 2 && !sb.state.tasks[0].scheduledOccurrences);

    const sb2 = makeSandbox();
    sb2.state.tasks.push(recurringTask());
    await sb2.applyIAProposal(proposal({ time: '16:00', _endTime: '16:30', _durationMinutes: 30, taskId: `rec::${WED}`, applyDate: '2030-03-14' }), '2030-03-14');
    check('G. aplicada en otro día: tarea nueva, la recurrente no se toca', sb2.state.tasks.length === 2 && !sb2.state.tasks[0].scheduledOccurrences);

    const sb3 = makeSandbox();
    sb3.state.tasks.push(recurringTask({ recurrence: { type: 'weekly', interval: 1, daysOfWeek: [0], startDate: MON, endDate: null } }));
    await sb3.applyIAProposal(proposal({ time: '16:00', _endTime: '16:30', _durationMinutes: 30, taskId: `rec::${WED}` }), WED);
    check('G. fecha que no es una repetición: tarea nueva', sb3.state.tasks.length === 2 && !sb3.state.tasks[0].scheduledOccurrences);

    const sb4 = makeSandbox();
    sb4.state.tasks.push(recurringTask());
    const msg = await sb4.applyIAProposal(proposal({ time: null, noSlot: true, taskId: `rec::${WED}` }), WED);
    check('G. sin hora: no se crea nada', sb4.state.tasks.length === 1 && msg.includes('ya está en tus tareas'));
  }

  section('H — de extremo a extremo: Organizar semana futura → Añadir al plan');
  {
    const sb = makeSandbox();
    sb.state.tasks.push(recurringTask({ recurrence: { type: 'weekly', interval: 1, daysOfWeek: [2], startDate: WED, endDate: null }, dueDate: WED }));
    sb.__aiResponse = { summary: '', days: [{ date: MON, label: 'lunes', items: [
      { sourceType: 'proposal', kind: 'task', title: 'Repasar inglés', estimatedMinutes: 40, time: null, taskId: `rec::${WED}` },
    ] }] };
    await sb.runIAWeek(MON);
    check('H. el contexto lleva el id de la repetición', sb.__lastContext.includes(`[id:rec::${WED}]`));
    check('H. las reglas explican los ids de repetición', sb.__lastSystem.includes('TAREAS QUE SE REPITEN'));
    const p = sb.__getIAProposals()[0];
    check('H. la propuesta cae el miércoles, con hora', !!p && p.applyDate === WED && !!p.time && p.taskId === `rec::${WED}`);
    await sb.applyIAProposal(p, p.applyDate);
    const t = sb.state.tasks[0];
    check('H. queda planificada esa repetición, 40 min', sb.state.tasks.length === 1 && t.scheduledOccurrences[WED].start === p.time && t.scheduledOccurrences[WED].end === p._endTime);
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
