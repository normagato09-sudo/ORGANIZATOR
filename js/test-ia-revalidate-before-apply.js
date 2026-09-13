/**
 * ORGANIZATOR — Tests de 5F-3C (revalidación justo antes de Apply)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente el código
 * real de organizator.html (revalidateIAProposalBeforeApply,
 * wireIAProposalButtons, applyIAProposal, buildSemanaDayAgendaBlocks,
 * spliceProposalsIntoBlocks, getWeekIAProposalsForDate, ciclo de vida de
 * propuestas de 5D) y lo ejecuta con el js/scheduler.js real del proyecto
 * (cargado tal cual, sin tocar ni un carácter) — igual que test-ia-week-
 * validation.js hace con validateWeeklyProposal.
 *
 * Objetivo:
 *  A) revalidateIAProposalBeforeApply() detecta correctamente que el
 *     hueco exacto de una propuesta ya no está libre (evento/tarea/
 *     horario fijo nuevo) y lo deja pasar cuando sigue libre.
 *  B) wireIAProposalButtons() usa esa revalidación justo antes de
 *     applyIAProposal(): si falla, NO se crea la entidad, la propuesta
 *     sigue "pending" (recuperable), recibe schedulingWarning y se avisa
 *     por toast; si pasa, el comportamiento es exactamente el de 5F-2.
 *  C) buildSemanaDayAgendaBlocks()/spliceProposalsIntoBlocks() ya no
 *     ocultan en silencio una propuesta pending cuyo hueco antiguo dejó
 *     de caber (_noRoom): sigue apareciendo, con aviso.
 *
 * Uso:  node js/test-ia-revalidate-before-apply.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failures = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failures++; console.error(`  ❌ ${msg}`); }
}
function section(title) { console.log(`\n${title}`); }

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
const SCHEDULER_PATH = path.join(ROOT, 'js', 'scheduler.js');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf8');

// ---------------------------------------------------------------------
// Extracción literal de las funciones reales de organizator.html. Los
// cierres de función en este archivo están sin indentar ("^}\n"), misma
// convención que ya usa el resto de la suite (5E-2/5E-3/5F-2/5F-3A).
// ---------------------------------------------------------------------
function extractFn(signatureRegex, label) {
  const re = new RegExp(signatureRegex.source + '[\\s\\S]*?\\n\\}\\n', signatureRegex.flags);
  const m = html.match(re);
  if (!m) throw new Error(`No se encontró "${label}" en organizator.html — ¿cambió el código?`);
  return m[0];
}
function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) — ¿cambió el código?`);
  return source.slice(start, end);
}

// Ciclo de vida de propuestas IA (5D, sin tocar): estado + funciones.
const lifecycleSrc = extractBetween(
  html,
  'let iaProposals = [];',
  '\n/* ---------- Llamada a la IA',
  'ciclo de vida de propuestas IA (5D)'
);

const src = [
  lifecycleSrc,
  extractFn(/async function saveTasks\(\)\{/, 'saveTasks'),
  extractFn(/async function saveEvents\(\)\{/, 'saveEvents'),
  extractFn(/async function addTask\(data\)\{/, 'addTask'),
  extractFn(/async function addEvent\(data\)\{/, 'addEvent'),
  extractFn(/async function applyIAProposal\(it, date\)\{/, 'applyIAProposal'),
  extractFn(/function revalidateIAProposalBeforeApply\(it\)\{/, 'revalidateIAProposalBeforeApply'),
  extractFn(/function wireIAProposalButtons\(container\)\{/, 'wireIAProposalButtons'),
  extractFn(/function getWeekIAProposalsForDate\(dateStr\)\{/, 'getWeekIAProposalsForDate'),
  extractFn(/function spliceProposalsIntoBlocks\(blocks, placedProposals\)\{/, 'spliceProposalsIntoBlocks'),
  extractFn(/function buildSemanaDayAgendaBlocks\(dateStr, schedCtx\)\{/, 'buildSemanaDayAgendaBlocks'),
].join('\n');

check(typeof src === 'string' && src.length > 0, 'todas las funciones necesarias se extrajeron literalmente de organizator.html');

// Comprobaciones estáticas sobre el código real extraído: confirman que
// la revalidación reutiliza el contrato de Scheduler pedido (y no
// reimplementa la lógica de intervalos a mano) y que 5F-2 sigue intacto.
check(src.includes('window.Scheduler._internal'), 'revalidateIAProposalBeforeApply usa window.Scheduler._internal (mismo contrato que validateWeeklyProposal)');
check(src.includes('window.Scheduler.findConflicts'), 'revalidateIAProposalBeforeApply reutiliza Scheduler.findConflicts (no reimplementa conflictos a mano)');
check(src.includes('revalidateIAProposalBeforeApply(it)'), 'wireIAProposalButtons llama a revalidateIAProposalBeforeApply justo antes de aplicar');
check(src.includes('it._applying'), 'wireIAProposalButtons/applyIAProposal siguen usando el candado _applying de 5F-2');
check(!/it\.status\s*=\s*['"]applied['"]/.test(src), 'el status nunca se asigna directamente: solo vía setIAProposalStatus()');

// ---------------------------------------------------------------------
// Sandbox: `window` es un objeto propio (no el propio contexto) para que
// tanto scheduler.js como el código extraído compartan la MISMA
// referencia — igual que en el navegador real.
// ---------------------------------------------------------------------
function buildSandbox({ initialProposals = [], events = [], tasks = [], customSchedules = [] } = {}) {
  const state = { tasks, events, customSchedules };
  const window_ = { storage: { async set() { return {}; } } };
  let uidSeq = 0;
  function uid() { uidSeq += 1; return 'uid-' + uidSeq; }
  function todayStr() { return '2026-09-14'; }
  let toastMessages = [];
  function showToast(msg) { toastMessages.push(msg); }
  const currentView = 'inicio';
  function renderInicio() {}
  function renderCalendar() {}
  function renderSemana() {}

  const context = {
    state, window: window_, uid, todayStr, showToast,
    currentView, renderInicio, renderCalendar, renderSemana,
    module: { exports: {} }, console,
  };
  vm.createContext(context);
  vm.runInContext(schedulerSrc, context, { filename: 'js/scheduler.js' });
  vm.runInContext(
    src + '\nmodule.exports = { wireIAProposalButtons, applyIAProposal, revalidateIAProposalBeforeApply, setIAProposalStatus, getIAProposalById, getIAProposalFromBatch, buildSemanaDayAgendaBlocks, spliceProposalsIntoBlocks, get iaProposals(){ return iaProposals; } };',
    context,
    { filename: 'organizator.html (extraído 5F-3C)' }
  );
  // `let iaProposals = [];` (dentro de lifecycleSrc) es una declaración de
  // nivel superior: vive en el entorno léxico del vm.Context, NO como
  // propiedad del objeto global — por eso no basta con pasarla al
  // construir `context` (quedaría sombreada/ignorada). Se expone DESPUÉS
  // de cargar el código, igual que hace test-ia-week-validation.js, y se
  // rellena con las propuestas iniciales sobre la MISMA referencia que ya
  // usan internamente las funciones extraídas.
  vm.runInContext('this.iaProposals = iaProposals;', context, { filename: 'expose-iaProposals' });
  initialProposals.forEach(p => context.iaProposals.push(p));
  return {
    state, window: window_,
    get toastMessages() { return toastMessages; },
    ...context.module.exports,
  };
}

function makeFakeButton(id, batchId) {
  const listeners = [];
  return {
    disabled: false,
    textContent: '',
    dataset: { iaApply: id, iaBatch: batchId },
    addEventListener(evt, fn) { listeners.push(fn); },
    async click() { for (const fn of listeners) await fn(); },
    closest() { return { remove() {} }; },
  };
}
function wireApplyButton(env, id, batchId) {
  const btn = makeFakeButton(id, batchId);
  env.wireIAProposalButtons({ querySelectorAll: (sel) => sel === '[data-ia-apply]' ? [btn] : [] });
  return btn;
}

// =====================================================================
// A — revalidateIAProposalBeforeApply(): comprobaciones directas
// =====================================================================
section('A — revalidateIAProposalBeforeApply(), comprobaciones directas');
{
  const env = buildSandbox({});
  // A1: hueco libre -> válida
  {
    const it = { id: 'ia-1', time: '10:00', _endTime: '10:45', _durationMinutes: 45, applyDate: '2026-09-15' };
    const r = env.revalidateIAProposalBeforeApply(it);
    check(r.valid === true, 'A1. hueco libre -> valid:true');
  }
  // A2: un evento nuevo ocupa el hueco -> inválida
  {
    const env2 = buildSandbox({ events: [{ id: 'ev1', date: '2026-09-15', startTime: '10:15', endTime: '11:00' }] });
    const it = { id: 'ia-2', time: '10:00', _endTime: '10:45', _durationMinutes: 45, applyDate: '2026-09-15' };
    const r = env2.revalidateIAProposalBeforeApply(it);
    check(r.valid === false && typeof r.reason === 'string' && r.reason.length > 0, 'A2. evento nuevo en el hueco -> valid:false con motivo');
  }
  // A3: una tarea ya programada ocupa el hueco -> inválida
  {
    const env3 = buildSandbox({ tasks: [{ id: 't1', scheduledDate: '2026-09-15', scheduledStart: '10:30', scheduledEnd: '11:00' }] });
    const it = { id: 'ia-3', time: '10:00', _endTime: '10:45', _durationMinutes: 45, applyDate: '2026-09-15' };
    const r = env3.revalidateIAProposalBeforeApply(it);
    check(r.valid === false, 'A3. tarea ya programada en el hueco -> valid:false');
  }
  // A4: un horario fijo (customSchedules) ocupa el hueco -> inválida
  // (2026-09-15 es martes -> dow 1, igual que en test-ia-week-validation.js)
  {
    const env4 = buildSandbox({ customSchedules: [{ id: 'cs1', days: [1], startTime: '09:00', endTime: '10:30' }] });
    const it = { id: 'ia-4', time: '10:00', _endTime: '10:45', _durationMinutes: 45, applyDate: '2026-09-15' };
    const r = env4.revalidateIAProposalBeforeApply(it);
    check(r.valid === false, 'A4. horario fijo ocupando el hueco -> valid:false');
  }
  // A5: propuesta sin hora -> válida sin comprobar nada (comportamiento actual)
  {
    const it = { id: 'ia-5', time: null, applyDate: '2026-09-15' };
    const r = env.revalidateIAProposalBeforeApply(it);
    check(r.valid === true, 'A5. propuesta sin hora no se revalida (valid:true)');
  }
  // A6: propuesta de source:'day' sin _endTime explícito, usa _durationMinutes
  // como respaldo para calcular el fin del hueco a comprobar.
  {
    const env6 = buildSandbox({ events: [{ id: 'ev1', date: '2026-09-14', startTime: '09:20', endTime: '10:00' }] });
    const it = { id: 'ia-6', time: '09:00', _durationMinutes: 45, applyDate: '2026-09-14' }; // sin _endTime
    const r = env6.revalidateIAProposalBeforeApply(it);
    check(r.valid === false, 'A6. sin _endTime explícito, usa _durationMinutes como respaldo y detecta el choque igual');
  }
}

// =====================================================================
// B — wireIAProposalButtons(): revalidación integrada justo antes de
// applyIAProposal() (async porque los handlers de Apply son async)
// =====================================================================
(async () => {
  section('B — revalidación integrada en el handler de Apply (async)');

  // B1: choque nuevo -> no se aplica, sigue pending, con warning y toast.
  {
    const p = { id: 'ia-b1', batchId: 'batch-b1', source: 'day', status: 'pending', title: 'Repasar', time: '10:00', _endTime: '10:45', kind: 'task', reason: null, applyDate: '2026-09-15' };
    const conflictingEvent = { id: 'ev1', date: '2026-09-15', startTime: '10:00', endTime: '10:30' };
    const env = buildSandbox({ initialProposals: [p], events: [conflictingEvent] });
    const btn = wireApplyButton(env, p.id, p.batchId);
    await btn.click();
    // it.time está fijado -> de haberse aplicado, applyIAProposal habría
    // creado un EVENTO (no una tarea). Solo debe seguir existiendo el
    // evento conflictivo original, ninguno nuevo.
    check(env.state.tasks.length === 0 && env.state.events.length === 1 && env.state.events[0] === conflictingEvent, 'B1. no se crea ninguna entidad cuando el hueco ya no está libre');
    check(p.status === 'pending', 'B1. la propuesta sigue pending (recuperable, no se descarta)');
    check(typeof p.schedulingWarning === 'string' && p.schedulingWarning.length > 0, 'B1. la propuesta recibe schedulingWarning con el motivo');
    check(env.toastMessages.length === 1, 'B1. se avisa una vez por toast');
    check(btn.disabled === false, 'B1. el botón queda recuperable (no se deja disabled)');
    check(p._applying === false, 'B1. el candado _applying se libera igualmente (finally de 5F-2 intacto)');
  }

  // B2: hueco sigue libre -> comportamiento exactamente igual que antes
  // de 5F-3C: se aplica, status termina en applied. it.time está fijado,
  // así que applyIAProposal crea un EVENTO (no una tarea).
  {
    const p = { id: 'ia-b2', batchId: 'batch-b2', source: 'day', status: 'pending', title: 'Repasar', time: '10:00', _endTime: '10:45', kind: 'task', reason: null, applyDate: '2026-09-15' };
    const env = buildSandbox({ initialProposals: [p] });
    const btn = wireApplyButton(env, p.id, p.batchId);
    await btn.click();
    check(env.state.events.length === 1 && env.state.tasks.length === 0, 'B2. hueco libre -> se crea la entidad (evento) con normalidad');
    check(p.status === 'applied', 'B2. status termina en applied');
    check(p.schedulingWarning === undefined, 'B2. no se añade ningún aviso cuando la revalidación pasa');
  }

  // B3: propuesta sin hora (tarea suelta) -> se aplica igual aunque el
  // calendario haya cambiado (punto 5: no se inventa revalidación temporal).
  {
    const p = { id: 'ia-b3', batchId: 'batch-b3', source: 'day', status: 'pending', title: 'Comprar material', time: null, kind: 'task', reason: null, applyDate: '2026-09-15' };
    const env = buildSandbox({ initialProposals: [p], events: [{ id: 'ev1', date: '2026-09-15', startTime: '00:00', endTime: '23:59' }] });
    const btn = wireApplyButton(env, p.id, p.batchId);
    await btn.click();
    check(env.state.tasks.length === 1, 'B3. propuesta sin hora se aplica sin revalidar huecos');
    check(p.status === 'applied', 'B3. status termina en applied');
  }

  // B4: un segundo intento de Apply, ahora con el hueco liberado de nuevo
  // (se quita el evento que chocaba) -> la propuesta sigue pending tras
  // B1 y ahora sí se puede aplicar, demostrando que queda recuperable de
  // verdad y no quedó en un estado roto. it.time está fijado -> crea un
  // EVENTO (no una tarea) cuando por fin se aplica.
  {
    const p = { id: 'ia-b4', batchId: 'batch-b4', source: 'day', status: 'pending', title: 'Repasar', time: '10:00', _endTime: '10:45', kind: 'task', reason: null, applyDate: '2026-09-15' };
    const conflictingEvents = [{ id: 'ev1', date: '2026-09-15', startTime: '10:00', endTime: '10:30' }];
    const env = buildSandbox({ initialProposals: [p], events: conflictingEvents });
    const btn = wireApplyButton(env, p.id, p.batchId);
    await btn.click();
    check(p.status === 'pending', 'B4. primer intento (con choque) deja la propuesta pending');
    check(env.state.events.length === 1, 'B4. primer intento no añade ningún evento nuevo (solo queda el conflictivo original)');
    // El calendario vuelve a estar libre (se retira el evento conflictivo,
    // mutando el mismo array que ya usa schedCtx/state.events por dentro).
    conflictingEvents.length = 0;
    await btn.click();
    check(p.status === 'applied', 'B4. segundo intento (hueco ya libre) sí la aplica: sigue siendo recuperable');
    check(env.state.events.length === 1 && env.state.tasks.length === 0, 'B4. se crea exactamente 1 entidad (evento) en total (no quedó duplicada por el primer intento fallido)');
  }

  // =====================================================================
  // C — buildSemanaDayAgendaBlocks()/spliceProposalsIntoBlocks(): una
  // propuesta pending cuyo hueco antiguo ya no cabe (_noRoom) sigue
  // apareciendo en los bloques de Semana, con aviso, en vez de
  // desaparecer en silencio.
  // =====================================================================
  section('C — propuestas desplazadas (_noRoom) siguen visibles en Semana');
  {
    const DATE = '2026-09-15';
    // Propuesta semanal pendiente, colocada originalmente en 10:00-10:45.
    const p = { id: 'ia-c1', batchId: 'batch-c1', source: 'week', status: 'pending', title: 'Repasar temario', kind: 'task', reason: null, time: '10:00', _endTime: '10:45', _durationMinutes: 45, applyDate: DATE, noSlot: false };
    // Después de generarse, se añade un evento nuevo que ocupa TODO el
    // rango 09:00-11:00 — el hueco exacto de la propuesta (10:00-10:45)
    // ya no encaja en ningún bloque libre.
    const events = [{ id: 'ev-new', date: DATE, startTime: '09:00', endTime: '11:00' }];
    const env = buildSandbox({ initialProposals: [p], events });
    const schedCtx = { events: env.state.events, tasks: env.state.tasks, customSchedules: env.state.customSchedules };
    const blocks = env.buildSemanaDayAgendaBlocks(DATE, schedCtx);

    const proposalBlocks = blocks.filter(b => b.type === 'proposal' && b.id === p.id);
    check(proposalBlocks.length === 1, 'C1. la propuesta desplazada sigue presente en los bloques (no desaparece)');
    check(proposalBlocks.length === 1 && typeof proposalBlocks[0].schedulingWarning === 'string' && proposalBlocks[0].schedulingWarning.length > 0, 'C2. la propuesta desplazada lleva un schedulingWarning explicando el motivo');
    check(p.status === 'pending', 'C3. la propuesta real en iaProposals sigue pending (no se descarta ni se recoloca)');
    check(typeof p.schedulingWarning === 'string' && p.schedulingWarning.length > 0, 'C4. la propuesta real en iaProposals también recibe el aviso (persiste entre renders)');
  }
  {
    // Control: si el hueco SIGUE libre, la propuesta se sigue colocando
    // en su hora real (comportamiento sin cambios, mismo camino de 5E-4).
    const DATE = '2026-09-16';
    const p = { id: 'ia-c2', batchId: 'batch-c2', source: 'week', status: 'pending', title: 'Repasar temario', kind: 'task', reason: null, time: '10:00', _endTime: '10:45', _durationMinutes: 45, applyDate: DATE, noSlot: false };
    const env = buildSandbox({ initialProposals: [p] });
    const schedCtx = { events: env.state.events, tasks: env.state.tasks, customSchedules: env.state.customSchedules };
    const blocks = env.buildSemanaDayAgendaBlocks(DATE, schedCtx);
    const proposalBlock = blocks.find(b => b.type === 'proposal' && b.id === p.id);
    check(!!proposalBlock && proposalBlock.startTime === '10:00', 'C5. con el hueco libre, la propuesta se sigue colocando en su hora real (sin regresión)');
    check(!!proposalBlock && proposalBlock.schedulingWarning === undefined, 'C6. con el hueco libre, no lleva ningún aviso');
  }

  console.log(`\n${passed} pasaron, ${failures} fallaron.`);
  process.exit(failures ? 1 : 0);
})();
