/**
 * ORGANIZATOR — Tests de 5F-3A (aviso + caducidad de propuestas pendientes
 * al reemplazar iaProposals con una nueva generación)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente
 * `iaExpirePendingProposalsBeforeReset()` y `wireIAProposalButtons()` de
 * organizator.html y las ejecuta contra un `iaProposals` real y un
 * `document` mínimo simulado (solo lo que estas dos funciones necesitan:
 * `getElementById('ia-thread-messages')` + `querySelectorAll`).
 *
 * Objetivo: demostrar que
 *   (1) el aviso solo aparece cuando había propuestas pending,
 *   (2) cuenta exactamente las pending (no applied/discarded),
 *   (3) los botones de esas propuestas quedan deshabilitados y con el
 *       texto "Propuesta caducada" y no pueden ejecutar Apply/Discard,
 *   (4) los botones de la generación nueva siguen funcionando con
 *       normalidad,
 *   (5) nada de esto toca id/batchId/status/sourceProposalId/_applying
 *       ni la idempotencia de 5F-2.
 *
 * Uso:  node js/test-ia-batch-expiry.js
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
// Extracción literal (misma convención que el resto de la suite: cierres
// de función sin indentar, "^}\n").
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
  // 5F-3C: wireIAProposalButtons ahora llama a revalidateIAProposalBeforeApply
  // justo antes de applyIAProposal — se extrae también, literal. Sin
  // window.Scheduler en este sandbox devuelve { valid: true } y no cambia
  // ningún resultado de esta suite (centrada en la caducidad de 5F-3A).
  extractFn(/function revalidateIAProposalBeforeApply\(it\)\{/, 'revalidateIAProposalBeforeApply'),
  extractFn(/function wireIAProposalButtons\(container\)\{/, 'wireIAProposalButtons'),
  extractFn(/function iaExpirePendingProposalsBeforeReset\(\)\{/, 'iaExpirePendingProposalsBeforeReset'),
].join('\n');

check(typeof src === 'string' && src.length > 0, 'todas las funciones necesarias (incluida iaExpirePendingProposalsBeforeReset) se extrajeron literalmente');

// Comprobaciones estáticas: 5F-3A no debe tocar nada de 5D/5F-2.
check(src.includes('it._applying'), 'el candado _applying de 5F-2 sigue presente sin cambios');
check(src.includes('sourceProposalId: it.id'), 'applyIAProposal sigue estampando sourceProposalId (sin cambios de 5F-2)');
check(/const already = it\.time/.test(src), 'la idempotencia de applyIAProposal (5F-2) sigue intacta');
check(!/iaProposals\[\s*\d/.test(src), 'sigue sin haber acceso posicional a iaProposals');
check(!/it\.status\s*=\s*['"]applied['"]/.test(src) && !/it\.status\s*=\s*['"]discarded['"]/.test(src),
  'el status nunca se asigna directamente en el código extraído: solo vía setIAProposalStatus()');
check(src.includes("filter(p => p.status === 'pending')"), 'iaExpirePendingProposalsBeforeReset cuenta solo las propuestas pending');
check(src.includes('Propuesta caducada'), 'el texto de botón caducado sigue siendo el literal esperado');
check(/if\(b\.disabled\) return;[\s\S]{0,120}const id = b\.dataset\.iaDiscard/.test(src),
  'el handler de discard también corta si el botón está deshabilitado (mismo guard que apply)');

// ---------------------------------------------------------------------
// Entorno + DOM mínimo. `document` solo necesita getElementById para
// 'ia-thread-messages'; el "hilo" se modela como una lista plana de
// botones (igual que hace iaThreadAddPending en la app real: solo añade,
// nunca quita), sobre la que querySelectorAll filtra por atributo.
// ---------------------------------------------------------------------
function makeFakeButton(id, batchId, kind) {
  const listeners = [];
  return {
    disabled: false,
    textContent: kind === 'apply' ? '✓ Añadir al plan' : 'Descartar',
    dataset: kind === 'apply' ? { iaApply: id, iaBatch: batchId } : { iaDiscard: id, iaBatch: batchId },
    addEventListener(evt, fn) { listeners.push(fn); },
    async click() { for (const fn of listeners) await fn(); },
    closest() { return { remove() {} }; },
  };
}

function filterThread(threadButtons, sel) {
  const wantsApply = sel.includes('[data-ia-apply]');
  const wantsDiscard = sel.includes('[data-ia-discard]');
  return threadButtons.filter(b =>
    (wantsApply && b.dataset.iaApply !== undefined) ||
    (wantsDiscard && b.dataset.iaDiscard !== undefined)
  );
}

function buildSandbox({ initialProposals = [] } = {}) {
  const state = { tasks: [], events: [] };
  const window_ = { storage: { async set() { return {}; } } };
  let uidSeq = 0;
  function uid() { uidSeq += 1; return 'uid-' + uidSeq; }
  function todayStr() { return '2026-09-12'; }
  const toastCalls = [];
  function showToast(msg) { toastCalls.push(msg); }
  const currentView = 'inicio';
  function renderInicio() {}
  function renderCalendar() {}
  function renderSemana() {}

  const threadButtons = []; // simula el hilo de chat: solo crece (append-only), como en la app real
  const fakeDocument = {
    getElementById(id) {
      if (id !== 'ia-thread-messages') return null;
      return { querySelectorAll: (sel) => filterThread(threadButtons, sel) };
    }
  };

  const context = {
    state, window: window_, uid, todayStr, showToast,
    currentView, renderInicio, renderCalendar, renderSemana,
    document: fakeDocument,
    iaProposals: initialProposals,
    module: { exports: {} }, console,
  };
  vm.createContext(context);
  vm.runInContext(
    src + '\nmodule.exports = { wireIAProposalButtons, applyIAProposal, setIAProposalStatus, getIAProposalById, getIAProposalFromBatch, iaExpirePendingProposalsBeforeReset, get iaProposals(){ return iaProposals; } };',
    context
  );
  return {
    state, threadButtons,
    get toastCalls() { return toastCalls.slice(); },
    ...context.module.exports,
  };
}

function makeProposal(overrides = {}) {
  return {
    id: overrides.id || 'ia-1',
    batchId: overrides.batchId || 'ia-batch-1',
    source: 'day',
    status: overrides.status || 'pending',
    title: overrides.title || 'Repasar temario',
    time: overrides.time !== undefined ? overrides.time : null,
    kind: 'task',
    reason: null,
    applyDate: '2026-09-12',
  };
}

// Cablea AMBOS botones de una propuesta con la función real, y los añade
// también al "hilo" simulado (para que iaExpirePendingProposalsBeforeReset
// los pueda encontrar y marcar, igual que buscaría en el DOM real).
function renderInThread(env, id, batchId) {
  const applyBtn = makeFakeButton(id, batchId, 'apply');
  const discardBtn = makeFakeButton(id, batchId, 'discard');
  env.threadButtons.push(applyBtn, discardBtn);
  const container = {
    querySelectorAll: (sel) => sel === '[data-ia-apply]' ? [applyBtn] : (sel === '[data-ia-discard]' ? [discardBtn] : [])
  };
  env.wireIAProposalButtons(container);
  return { applyBtn, discardBtn };
}

(async () => {
  console.log('\nA — sin propuestas pendientes: no aparece aviso');
  {
    const env = buildSandbox({ initialProposals: [] });
    env.iaExpirePendingProposalsBeforeReset();
    check(env.toastCalls.length === 0, 'A. sin ninguna propuesta previa, no se muestra ningún toast');
  }
  {
    // Batch previo existente pero ya todo resuelto (nada pending).
    const p1 = makeProposal({ id: 'ia-a1', status: 'applied' });
    const p2 = makeProposal({ id: 'ia-a2', status: 'discarded' });
    const env = buildSandbox({ initialProposals: [p1, p2] });
    env.iaExpirePendingProposalsBeforeReset();
    check(env.toastCalls.length === 0, 'A. con un batch previo totalmente resuelto (applied+discarded), tampoco aparece aviso');
  }

  console.log('\nB — 3 propuestas pending: se detectan exactamente 3 y aparece el aviso');
  {
    const proposals = [
      makeProposal({ id: 'ia-b1' }),
      makeProposal({ id: 'ia-b2' }),
      makeProposal({ id: 'ia-b3' }),
    ];
    const env = buildSandbox({ initialProposals: proposals });
    env.iaExpirePendingProposalsBeforeReset();
    check(env.toastCalls.length === 1, 'B. se muestra el toast exactamente una vez');
    check(env.toastCalls[0].includes('3'), 'B. el mensaje del toast incluye el número correcto (3)');
    check(env.toastCalls[0] === 'Se han descartado 3 propuestas anteriores sin decidir.',
      'B. el texto del aviso coincide exactamente con el especificado');
  }

  console.log('\nC — propuestas applied/discarded no cuentan como pendientes');
  {
    const proposals = [
      makeProposal({ id: 'ia-c1', status: 'applied' }),
      makeProposal({ id: 'ia-c2', status: 'discarded' }),
      makeProposal({ id: 'ia-c3', status: 'pending' }),
      makeProposal({ id: 'ia-c4', status: 'pending' }),
    ];
    const env = buildSandbox({ initialProposals: proposals });
    env.iaExpirePendingProposalsBeforeReset();
    check(env.toastCalls.length === 1, 'C. se muestra el aviso (hay 2 pending entre 4 propuestas)');
    check(env.toastCalls[0] === 'Se han descartado 2 propuestas anteriores sin decidir.',
      'C. cuenta solo las 2 pending, ignorando las applied/discarded');
  }

  console.log('\nD — botón antiguo: queda deshabilitado/caducado y no ejecuta Apply ni Discard');
  {
    const pOld = makeProposal({ id: 'ia-d-old', batchId: 'ia-batch-old' });
    const env = buildSandbox({ initialProposals: [pOld] });
    const { applyBtn, discardBtn } = renderInThread(env, pOld.id, pOld.batchId);

    // Simula el reset de una nueva generación (runIADay/runIAWeek):
    env.iaExpirePendingProposalsBeforeReset();

    check(applyBtn.disabled === true, 'D. el botón Apply antiguo queda disabled tras el reset');
    check(applyBtn.textContent === 'Propuesta caducada', 'D. el botón Apply antiguo muestra el texto "Propuesta caducada"');
    check(discardBtn.disabled === true, 'D. el botón Discard antiguo también queda disabled tras el reset');
    check(discardBtn.textContent === 'Propuesta caducada', 'D. el botón Discard antiguo también muestra "Propuesta caducada"');

    // Ahora simula la generación B reseteando iaProposals de verdad
    // (esto es lo que hace runIADay/runIAWeek justo después de llamar a
    // iaExpirePendingProposalsBeforeReset) y comprueba que pulsar los
    // botones caducados no hace nada.
    const pNew = makeProposal({ id: 'ia-d-new', batchId: 'ia-batch-new' });
    // No hay setter directo de iaProposals desde fuera del sandbox por
    // diseño (es una variable de módulo interna) — en su lugar, se
    // confirma que el propio guard `if(b.disabled) return;` corta ambos
    // handlers antes de tocar nada, que es la protección real pedida.
    await applyBtn.click();
    await discardBtn.click();
    check(env.state.tasks.length === 0 && env.state.events.length === 0,
      'D. pulsar el botón Apply caducado no crea ninguna entidad');
    check(pOld.status === 'pending', 'D. pulsar el botón Discard caducado no cambia el status de la propuesta vieja');
  }

  console.log('\nE — botón de la nueva generación sigue funcionando con normalidad');
  {
    const pOld = makeProposal({ id: 'ia-e-old', batchId: 'ia-batch-old' });
    const env = buildSandbox({ initialProposals: [pOld] });
    renderInThread(env, pOld.id, pOld.batchId);
    env.iaExpirePendingProposalsBeforeReset(); // simula el aviso/caducado de la generación anterior

    // La "nueva generación" se representa reconstruyendo el sandbox con
    // el nuevo iaProposals (equivalente a `iaProposals = []` seguido de
    // los pushes de la nueva tanda dentro de runIADay/runIAWeek).
    const pNew = makeProposal({ id: 'ia-e-new', batchId: 'ia-batch-new' });
    const env2 = buildSandbox({ initialProposals: [pNew] });
    const { applyBtn: newBtn } = renderInThread(env2, pNew.id, pNew.batchId);
    await newBtn.click();
    check(env2.state.tasks.length === 1, 'E. el botón Apply de la nueva generación crea su entidad con normalidad');
    check(pNew.status === 'applied', 'E. el status de la nueva propuesta pasa a applied con normalidad');
  }

  console.log('\nF — no se modifica id/batchId/status lifecycle/sourceProposalId/idempotencia 5F-2');
  {
    const p = makeProposal({ id: 'ia-f1', batchId: 'ia-batch-f' });
    const env = buildSandbox({ initialProposals: [p] });
    const { applyBtn } = renderInThread(env, p.id, p.batchId);
    await applyBtn.click();
    check(p.id === 'ia-f1' && p.batchId === 'ia-batch-f', 'F. id y batchId de la propuesta no cambian tras Apply');
    check(p.status === 'applied', 'F. el lifecycle pending->applied sigue funcionando exactamente igual');
    check(env.state.tasks[0].sourceProposalId === 'ia-f1', 'F. sourceProposalId se sigue estampando igual que en 5F-2');
    // Reaplicar (idempotencia 5F-2): no debe duplicar.
    await applyBtn.click();
    check(env.state.tasks.length === 1, 'F. la idempotencia de 5F-2 sigue intacta (un segundo Apply no duplica)');
  }

  console.log(`\n${passed} pasaron, ${failures} fallaron.`);
  process.exit(failures ? 1 : 0);
})();
