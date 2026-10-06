/**
 * ORGANIZATOR — Tests: las tareas normales con hora fija ocupan su bloque
 * (B2 de PLAN-FINAL.md)
 *
 * Antes, una tarea no recurrente con hora (dueTime) pero sin franja
 * planificada no ocupaba nada: la IA podía proponer encima y la vista
 * Semana la pintaba aparte, como "sin bloque". Ahora tasksForScheduler la
 * pasa a Scheduler con su franja (dueTime → dueTime + estimatedMinutes,
 * 60 min si no hay) el día de su fecha, igual que ya hacían las
 * repeticiones de las tareas recurrentes (A4). state.tasks no cambia.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el código real y lo ejecuta con el js/scheduler.js
 * real. callAI y el DOM son mocks.
 *
 * Uso:  node js/test-fixed-time-tasks.js
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

// Semana futura fija: el resultado no depende del día del test.
const MON = '2030-03-11', WED = '2030-03-13', SUN = '2030-03-17';
const fixedTask = (o) => Object.assign({ id: 'fija', title: 'Dentista', dueDate: WED, dueTime: '17:00', priority: 'media', done: false, recurrence: null }, o);

(async () => {
  section('A — tasksForScheduler: la hora fija ocupa su bloque');
  {
    const sb = makeSandbox();
    sb.state.tasks.push(fixedTask({ estimatedMinutes: 30 }));
    sb.state.tasks.push(fixedTask({ id: 'sin-dur', title: 'Llamar', dueTime: '10:00' }));
    sb.state.tasks.push(fixedTask({ id: 'sin-hora', title: 'Leer', dueTime: '' }));
    sb.state.tasks.push(fixedTask({ id: 'planificada', title: 'Estudiar', dueTime: '12:00', scheduledDate: '2030-03-12', scheduledStart: '18:00', scheduledEnd: '19:00' }));
    sb.state.tasks.push(fixedTask({ id: 'fuera', title: 'Fuera', dueDate: '2030-03-20' }));
    sb.state.tasks.push(fixedTask({ id: 'mala', title: 'Hora rara', dueTime: '25:00' }));
    const list = sb.tasksForScheduler(MON, SUN);
    const byId = (id) => list.find(t => t.id === id);
    check('A. 17:00–17:30 el día de su fecha', byId('fija').scheduledDate === WED && byId('fija').scheduledStart === '17:00' && byId('fija').scheduledEnd === '17:30');
    check('A. sin duración: 60 min', byId('sin-dur').scheduledStart === '10:00' && byId('sin-dur').scheduledEnd === '11:00');
    check('A. sin hora: no ocupa nada', !byId('sin-hora').scheduledDate);
    check('A. ya planificada: conserva su franja, no la de su hora fija', byId('planificada').scheduledDate === '2030-03-12' && byId('planificada').scheduledStart === '18:00');
    check('A. fuera del rango: sin cambios', !byId('fuera').scheduledDate);
    check('A. hora no válida: no ocupa nada', !byId('mala').scheduledDate);
    check('A. misma cantidad de tareas, mismo id', list.length === 6 && byId('fija').title === 'Dentista');
    check('A. state.tasks no cambia', !sb.state.tasks[0].scheduledDate && !('scheduledStart' in sb.state.tasks[0]));
  }

  section('B — una propuesta no cae encima de una tarea con hora fija');
  {
    const sb = makeSandbox();
    // Solo queda libre 17:00–18:10 el miércoles (con el colchón de 10 min).
    sb.state.customSchedules.push({ id: 's1', name: 'Clase', days: [0, 1, 2, 3, 4, 5, 6], startTime: '07:00', endTime: '16:50' });
    sb.state.customSchedules.push({ id: 's2', name: 'Trabajo', days: [0, 1, 2, 3, 4, 5, 6], startTime: '18:10', endTime: '23:00' });
    const pseudo = [{ id: 'x', title: 'Estudiar', dueDate: WED, notBefore: WED, estimatedMinutes: 45, priority: 'media' }];
    const ctx = () => ({ events: [], tasks: sb.tasksForScheduler(WED, WED), customSchedules: sb.state.customSchedules });
    check('B. sin la tarea, cabe a las 17:00', sb.Scheduler.autoSchedule(pseudo, ctx(), { fromDate: WED })[0].scheduledStart === '17:00');
    sb.state.tasks.push(fixedTask());
    check('B. con el dentista a las 17:00, ya no cabe', !sb.Scheduler.autoSchedule(pseudo, ctx(), { fromDate: WED })[0].scheduledStart);
  }

  section('C — Organizar mi semana: ni huecos libres ni propuestas encima');
  {
    const sb = makeSandbox();
    // El miércoles (primer día planificado) solo queda libre 17:00–18:10.
    sb.state.customSchedules.push({ id: 's1', name: 'Clase', days: [0, 1, 2, 3, 4, 5, 6], startTime: '07:00', endTime: '16:50' });
    sb.state.customSchedules.push({ id: 's2', name: 'Trabajo', days: [0, 1, 2, 3, 4, 5, 6], startTime: '18:10', endTime: '23:00' });
    sb.state.tasks.push(fixedTask());
    sb.__aiResponse = { summary: '', days: [{ date: WED, label: 'miércoles', items: [
      { sourceType: 'proposal', kind: 'task', title: 'Repasar', estimatedMinutes: 45, time: null, taskId: null },
    ] }] };
    await sb.runIAWeek(WED);
    check('C. el miércoles no le quedan huecos libres a la IA', sb.__lastContext.includes(`- ${WED} (Miércoles): (sin huecos libres ese día)`));
    const p = sb.__getIAProposals()[0];
    check('C. la propuesta no se coloca encima del dentista: queda sin hora', !!p && !p.time);
    check('C. revalidar una propuesta encima falla', !sb.revalidateIAProposalBeforeApply({ id: 'z', time: '17:15', _endTime: '17:45', applyDate: WED }).valid);
    check('C. revalidar en otra hora libre sí vale', sb.revalidateIAProposalBeforeApply({ id: 'z', time: '06:00', _endTime: '06:30', applyDate: WED }).valid);
  }

  section('E — chat (ai-actions.js): tampoco coloca ni recoloca encima');
  {
    const sb = makeSandbox();
    const aiActionsSrc = fs.readFileSync(path.join(ROOT, 'js', 'ai-actions.js'), 'utf8').replace(/\r\n/g, '\n');
    sb.global = sb;
    vm.runInContext(extractBetween(aiActionsSrc, 'function schedulerContext() {', '\n\n  async function applyMoveItem', 'schedulerContext…reconcileConflicts')
      + '\nthis.schedulerContext = schedulerContext; this.reconcileConflicts = reconcileConflicts;', sb, { filename: 'ai-actions.js (schedulerContext…reconcileConflicts)' });
    // Fecha relativa: schedulerContext() mira desde hoy. Hoy, todo
    // ocupado; el resto de días solo quedan libres 12:00–13:00 y
    // 17:00–18:00 (con el colchón de 10 min).
    const today = sb.todayStr();
    const tomorrow = sb.addDays(today, 1);
    const todayDow = sb.Scheduler._internal.dowOfDate(today);
    const otherDays = [0, 1, 2, 3, 4, 5, 6].filter(d => d !== todayDow);
    sb.state.customSchedules.push(
      { id: 'hoy', name: 'Hoy', days: [todayDow], startTime: '00:00', endTime: '23:59' },
      { id: 'm', name: 'Mañana', days: otherDays, startTime: '07:00', endTime: '11:50' },
      { id: 't', name: 'Tarde', days: otherDays, startTime: '13:10', endTime: '16:50' },
      { id: 'n', name: 'Noche', days: otherDays, startTime: '18:10', endTime: '23:00' });
    sb.state.tasks.push(fixedTask({ dueDate: tomorrow }));
    const slots = sb.Scheduler.getFreeSlotsFormatted(tomorrow, sb.schedulerContext());
    check('E. el chat no ve libre la hora del dentista', JSON.stringify(slots) === JSON.stringify(['12:00–13:00']));
    sb.state.tasks.push(fixedTask({ id: 'movible', title: 'Repasar', dueDate: sb.addDays(tomorrow, 7), dueTime: '', estimatedMinutes: 60, scheduledDate: tomorrow, scheduledStart: '12:00', scheduledEnd: '13:00' }));
    sb.state.events.push({ id: 'ev', title: 'Reunión', date: tomorrow, startTime: '12:00', endTime: '13:00', allDay: false });
    await sb.reconcileConflicts(tomorrow);
    const fija = sb.state.tasks.find(t => t.id === 'fija');
    const movible = sb.state.tasks.find(t => t.id === 'movible');
    check('E. un evento nuevo recoloca la tarea planificada, pero no encima del dentista', movible.scheduledDate === sb.addDays(tomorrow, 1) && movible.scheduledStart === '12:00');
    check('E. la tarea con hora fija no se toca', !fija.scheduledDate && fija.dueTime === '17:00');
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
