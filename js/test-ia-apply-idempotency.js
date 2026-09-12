/**
 * ORGANIZATOR — Tests de 5F-2 (blindaje del Apply de propuestas IA)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente el código
 * real de organizator.html (wireIAProposalButtons, applyIAProposal,
 * setIAProposalStatus, getIAProposalById, getIAProposalFromBatch,
 * addTask, addEvent, saveTasks, saveEvents) y lo ejecuta contra
 * `state.tasks`/`state.events` reales — no una copia ni un mock del
 * modelo de datos.
 *
 * Objetivo: demostrar que una propuesta IA identificada por su `id`
 * crea como máximo UNA entidad real (tarea o evento), sin importar
 * cuántas veces se dispare el Apply ni desde cuántos botones/vistas.
 *
 * Nota de diseño: `iaProposals` vive DENTRO del mismo vm.context que las
 * funciones extraídas (igual que en organizator.html, donde es una
 * variable de módulo compartida) — así getIAProposalById/FromBatch,
 * setIAProposalStatus y wireIAProposalButtons operan todas sobre el
 * mismo array real, exactamente como en producción.
 *
 * Uso:  node js/test-ia-apply-idempotency.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
let passed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failures++; console.error(`  ❌ ${msg}`); }
}

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

// ---------------------------------------------------------------------
// Extracción literal de las funciones reales de organizator.html.
// Los cierres de función en este archivo están sin indentar ("^}\n"),
// convención ya usada por el resto de tests de la suite (5E-2/5E-3/5E-4).
// ---------------------------------------------------------------------
function extractFn(signatureRegex, label) {
  const re = new RegExp(signatureRegex.source + '[\\s\\S]*?\\n\\}\\n', signatureRegex.flags);
  const m = html.match(re);
  if (!m) throw new Error(`No se encontró "${label}" en organizator.html — ¿cambió el código?`);
  return m[0];
}

const transitionsMatch = html.match(/const IA_PROPOSAL_ALLOWED_TRANSITIONS = \{[\s\S]*?\n\};/);
if (!transitionsMatch) throw new Error('No se encontró IA_PROPOSAL_ALLOWED_TRANSITIONS en organizator.html');

const src = [
  extractFn(/async function saveTasks\(\)\{/, 'saveTasks'),
  extractFn(/async function saveEvents\(\)\{/, 'saveEvents'),
  extractFn(/async function addTask\(data\)\{/, 'addTask'),
  extractFn(/async function addEvent\(data\)\{/, 'addEvent'),
  extractFn(/function getIAProposalById\(id\) \{/, 'getIAProposalById'),
  extractFn(/function getIAProposalFromBatch\(id, batchId\) \{/, 'getIAProposalFromBatch'),
  transitionsMatch[0],
  extractFn(/function setIAProposalStatus\(id, status\) \{/, 'setIAProposalStatus'),
  extractFn(/async function applyIAProposal\(it, date\)\{/, 'applyIAProposal'),
  extractFn(/function wireIAProposalButtons\(container\)\{/, 'wireIAProposalButtons'),
].join('\n');

check(typeof src === 'string' && src.length > 0, 'todas las funciones necesarias se extrajeron literalmente de organizator.html');

// Comprobaciones estáticas sobre el código REAL extraído (no sobre una
// reescritura nuestra): confirman que el blindaje de 5F-2 sigue presente
// tal y como se implementó en la Parte 3/4.
check(src.includes('it._applying'), 'wireIAProposalButtons/applyIAProposal siguen usando el candado _applying');
check(src.includes('sourceProposalId: it.id'), 'applyIAProposal sigue estampando sourceProposalId al crear la entidad');
check(/const already = it\.time/.test(src), 'applyIAProposal conserva la comprobación de idempotencia antes de crear nada');
check(!/iaProposals\[\s*\d/.test(src), 'no hay acceso posicional a iaProposals (iaProposals[N]) en el código extraído');
check(!/Number\(\s*(b\.dataset\.iaApply|dataset\.iaApply)/.test(src), 'no se usa Number(dataset.iaApply) en el código extraído');
check(!/iaProposals\.splice/.test(src), 'no se usa iaProposals.splice(...) en el código extraído');
check(!/it\.status\s*=\s*['"]applied['"]/.test(src), 'el status nunca se asigna directamente (it.status = ...): solo vía setIAProposalStatus()');

// ---------------------------------------------------------------------
// Entorno mínimo para ejecutar el código extraído. `iaProposals` se
// declara DENTRO del vm.context (no fuera) para que las funciones reales
// extraídas —que la referencian como variable de módulo, igual que en
// organizator.html— lean y escriban sobre el mismo array que ve el test.
// ---------------------------------------------------------------------
function buildSandbox({ storageDelayMs = 0, initialProposals = [] } = {}) {
  const state = { tasks: [], events: [] };
  const window_ = {
    storage: {
      async set() { if (storageDelayMs) await new Promise(r => setTimeout(r, storageDelayMs)); return {}; }
    }
  };
  let uidSeq = 0;
  function uid() { uidSeq += 1; return 'uid-' + uidSeq; }
  function todayStr() { return '2026-09-12'; }
  let toastCount = 0;
  function showToast() { toastCount++; }
  const currentView = 'inicio';
  function renderInicio() {}
  function renderCalendar() {}
  function renderSemana() {}

  const context = {
    state, window: window_, uid, todayStr, showToast,
    currentView, renderInicio, renderCalendar, renderSemana,
    iaProposals: initialProposals, // variable de módulo real, compartida por todo el código extraído
    module: { exports: {} }, console,
  };
  vm.createContext(context);
  vm.runInContext(
    src + '\nmodule.exports = { wireIAProposalButtons, applyIAProposal, setIAProposalStatus, getIAProposalById, getIAProposalFromBatch, get iaProposals(){ return iaProposals; } };',
    context
  );
  return {
    state,
    get toastCount() { return toastCount; },
    ...context.module.exports,
  };
}

function makeProposal(overrides = {}) {
  return {
    id: overrides.id || 'ia-1',
    batchId: overrides.batchId || 'ia-batch-1',
    source: 'day',
    status: 'pending',
    title: overrides.title || 'Repasar temario',
    time: overrides.time !== undefined ? overrides.time : null, // null => tarea; string HH:MM => evento
    kind: overrides.kind || 'task',
    reason: null,
    applyDate: '2026-09-12',
  };
}

function makeFakeButton(id, batchId, kind) {
  const listeners = [];
  return {
    disabled: false,
    textContent: '',
    dataset: kind === 'apply' ? { iaApply: id, iaBatch: batchId } : { iaDiscard: id, iaBatch: batchId },
    addEventListener(evt, fn) { listeners.push(fn); },
    async click() { for (const fn of listeners) await fn(); },
    closest() { return { remove() {} }; },
  };
}

// Cablea AMBOS botones (apply + discard) de una propuesta usando la
// función real wireIAProposalButtons(container), sin modificarla.
function wireProposalButtons(env, id, batchId) {
  const applyBtn = makeFakeButton(id, batchId, 'apply');
  const discardBtn = makeFakeButton(id, batchId, 'discard');
  const container = {
    querySelectorAll: (sel) => sel === '[data-ia-apply]' ? [applyBtn] : (sel === '[data-ia-discard]' ? [discardBtn] : [])
  };
  env.wireIAProposalButtons(container);
  return { applyBtn, discardBtn };
}

(async () => {
  console.log('\nA — pending → Apply crea exactamente 1 entidad, status termina en applied');
  let sharedEnv, sharedP, sharedApplyBtn;
  {
    const p = makeProposal({ id: 'ia-a' });
    const env = buildSandbox({ initialProposals: [p] });
    const { applyBtn } = wireProposalButtons(env, p.id, p.batchId);
    await applyBtn.click();
    check(env.state.tasks.length === 1 && env.state.events.length === 0, 'A. se creó exactamente 1 entidad (tarea)');
    check(p.status === 'applied', 'A. status termina en applied');
    check(env.state.tasks[0].sourceProposalId === p.id, 'A. la tarea creada lleva el sourceProposalId correcto');
    sharedEnv = env; sharedP = p; sharedApplyBtn = applyBtn;
  }

  console.log('\nB — segundo Apply de la misma propuesta (ya applied)');
  {
    await sharedApplyBtn.click(); // el botón real ya estaría disabled, pero probamos el handler igualmente
    check(sharedEnv.state.tasks.length === 1, 'B. no se crean entidades adicionales (total sigue en 1)');
    check(sharedP.status === 'applied', 'B. status sigue en applied');
  }

  console.log('\nC — applied → Apply es no-op vía el handler (status ya no es pending)');
  {
    const p = makeProposal({ id: 'ia-c' });
    p.status = 'applied'; // ya estaba aplicada de antes, por otra vía
    const env = buildSandbox({ initialProposals: [p] });
    const { applyBtn } = wireProposalButtons(env, p.id, p.batchId);
    await applyBtn.click();
    check(env.state.tasks.length === 0 && env.state.events.length === 0, 'C. el handler no crea ninguna entidad cuando status ya es applied');
    check(p.status === 'applied', 'C. status permanece applied (no se toca)');
  }

  console.log('\nC-bis — applyIAProposal() llamado directamente sobre una propuesta ya materializada (capa de idempotencia, no el handler)');
  {
    const p = makeProposal({ id: 'ia-c2' });
    const env = buildSandbox({ initialProposals: [p] });
    // Simula que la entidad YA fue creada antes (por un Apply anterior).
    env.state.tasks.push({ id: 'tarea-previa', title: p.title, sourceProposalId: p.id, done: false, createdAt: Date.now() });
    p.status = 'applied';
    await env.applyIAProposal(p, p.applyDate);
    check(env.state.tasks.length === 1, 'C-bis. una llamada directa a applyIAProposal sobre una propuesta ya materializada no crea una segunda entidad');
  }

  console.log('\nD — pending → Discard crea 0 entidades');
  {
    const p = makeProposal({ id: 'ia-d' });
    const env = buildSandbox({ initialProposals: [p] });
    const { discardBtn } = wireProposalButtons(env, p.id, p.batchId);
    await discardBtn.click();
    check(env.state.tasks.length === 0 && env.state.events.length === 0, 'D. discard no crea ninguna entidad');
    check(p.status === 'discarded', 'D. status termina en discarded');
  }

  console.log('\nE — discarded → Apply es no-op (no crea nada)');
  {
    const p = makeProposal({ id: 'ia-e' });
    p.status = 'discarded';
    const env = buildSandbox({ initialProposals: [p] });
    const { applyBtn } = wireProposalButtons(env, p.id, p.batchId);
    await applyBtn.click();
    check(env.state.tasks.length === 0 && env.state.events.length === 0, 'E. Apply sobre una propuesta discarded no crea ninguna entidad');
    check(p.status === 'discarded', 'E. status permanece discarded (no revierte a applied)');
  }

  console.log('\nF — ID inexistente: no-op, sin error');
  {
    const env = buildSandbox({ initialProposals: [] }); // ninguna propuesta registrada
    const btn = makeFakeButton('ia-no-existe', 'ia-batch-x', 'apply');
    env.wireIAProposalButtons({ querySelectorAll: (sel) => sel === '[data-ia-apply]' ? [btn] : [] });
    let threw = false;
    try { await btn.click(); } catch (e) { threw = true; }
    check(!threw, 'F. click sobre un id inexistente no lanza error');
    check(env.state.tasks.length === 0 && env.state.events.length === 0, 'F. no se crea ninguna entidad');
  }

  console.log('\nG — batch incorrecto: no-op, no crea entidad');
  {
    const p = makeProposal({ id: 'ia-g', batchId: 'ia-batch-real' });
    const env = buildSandbox({ initialProposals: [p] });
    // El botón lleva un batchId distinto al de la propuesta real.
    const btn = makeFakeButton(p.id, 'ia-batch-OTRO', 'apply');
    env.wireIAProposalButtons({ querySelectorAll: (sel) => sel === '[data-ia-apply]' ? [btn] : [] });
    await btn.click();
    check(env.state.tasks.length === 0, 'G. batch incorrecto no crea ninguna entidad');
    check(p.status === 'pending', 'G. la propuesta real permanece pending (no se tocó)');
  }

  console.log('\nH — dos propuestas distintas: cada una se aplica una vez, total 2 entidades, sourceProposalId no se mezcla');
  {
    const p1 = makeProposal({ id: 'ia-h1', title: 'Tarea H1' });
    const p2 = makeProposal({ id: 'ia-h2', title: 'Tarea H2' });
    const env = buildSandbox({ initialProposals: [p1, p2] });
    const { applyBtn: btn1 } = wireProposalButtons(env, p1.id, p1.batchId);
    const { applyBtn: btn2 } = wireProposalButtons(env, p2.id, p2.batchId);
    await btn1.click();
    await btn2.click();
    check(env.state.tasks.length === 2, 'H. se crean exactamente 2 entidades en total');
    check(p1.status === 'applied' && p2.status === 'applied', 'H. ambas propuestas quedan applied');
    const ids = env.state.tasks.map(t => t.sourceProposalId).sort();
    check(ids[0] === 'ia-h1' && ids[1] === 'ia-h2', 'H. los sourceProposalId no se mezclan entre las dos entidades');
  }

  console.log('\nI — doble ejecución consecutiva del handler (mismo botón, dos clicks disparados sin esperar) → 1 entidad');
  {
    const p = makeProposal({ id: 'ia-i' });
    const env = buildSandbox({ storageDelayMs: 25, initialProposals: [p] }); // ensancha la ventana de carrera
    const { applyBtn } = wireProposalButtons(env, p.id, p.batchId);
    const c1 = applyBtn.click();
    const c2 = applyBtn.click(); // disparado antes de que el primero llegue a su await
    await Promise.all([c1, c2]);
    check(env.state.tasks.length === 1, 'I. doble ejecución consecutiva del handler crea exactamente 1 entidad');
    check(p.status === 'applied', 'I. status termina en applied');
  }

  console.log('\nI-bis — misma propuesta representada en DOS botones a la vez (chat + Semana), pulsados casi al mismo tiempo');
  {
    const p = makeProposal({ id: 'ia-i2' });
    const env = buildSandbox({ storageDelayMs: 25, initialProposals: [p] });
    const btnChat = makeFakeButton(p.id, p.batchId, 'apply');
    const btnSemana = makeFakeButton(p.id, p.batchId, 'apply');
    env.wireIAProposalButtons({ querySelectorAll: (sel) => sel === '[data-ia-apply]' ? [btnChat] : [] });
    env.wireIAProposalButtons({ querySelectorAll: (sel) => sel === '[data-ia-apply]' ? [btnSemana] : [] });
    const c1 = btnChat.click();
    const c2 = btnSemana.click();
    await Promise.all([c1, c2]);
    check(env.state.tasks.length === 1, 'I-bis. dos botones distintos para la misma propuesta crean 1 sola entidad');
    check(p.status === 'applied', 'I-bis. status termina en applied');
  }

  console.log('\nJ — cubre tanto tarea (sin hora) como evento (con hora)');
  {
    const pTask = makeProposal({ id: 'ia-j-task', time: null });
    const pEvent = makeProposal({ id: 'ia-j-event', time: '09:30' });
    const env = buildSandbox({ initialProposals: [pTask, pEvent] });
    const { applyBtn: btnTask } = wireProposalButtons(env, pTask.id, pTask.batchId);
    const { applyBtn: btnEvent } = wireProposalButtons(env, pEvent.id, pEvent.batchId);
    await btnTask.click();
    await btnEvent.click();
    check(env.state.tasks.length === 1 && env.state.events.length === 1, 'J. se crea 1 tarea y 1 evento, cada uno en su colección real');
    check(env.state.tasks[0].sourceProposalId === pTask.id, 'J. la tarea lleva su propio sourceProposalId');
    check(env.state.events[0].sourceProposalId === pEvent.id, 'J. el evento lleva su propio sourceProposalId');
    check(env.state.events[0].startTime === '09:30', 'J. el evento conserva la hora de la propuesta');

    // Doble apply sobre el evento ya aplicado: tampoco duplica.
    await btnEvent.click();
    check(env.state.events.length === 1, 'J. un segundo Apply sobre el evento no crea un segundo evento');
  }

  console.log(`\n${passed} pasaron, ${failures} fallaron.`);
  process.exit(failures ? 1 : 0);
})();
