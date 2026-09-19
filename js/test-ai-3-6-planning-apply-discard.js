/**
 * ORGANIZATOR — Tests de AI-3.6 (Apply/Discard seguro para propuestas de
 * planificación, source:'planning')
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que
 * test-ai-3-5-planning-batches.js: carga js/scheduler.js REAL y COMPLETO
 * (sin tocar ni un carácter), el bloque REAL "IA — ASISTENTE PERSONAL" de
 * organizator.html (iaProposals, nextIAProposalId/nextIABatchId,
 * getIAProposalById/getIAProposalsByBatchId/getPendingIAProposalsByBatchId/
 * setIAProposalStatus/validateIAProposalBatch/getIAProposalBatchSummary/
 * getIAProposalFromBatch — el ciclo de vida COMPLETO ya existente, nada
 * reimplementado) y js/ai-actions.js REAL y COMPLETO (para que
 * applyPlanningProposal, createPlanningProposalBatch, generatePlanningProposal,
 * analyzePlanningAvailability y schedulerContext() convivan exactamente
 * igual que en la app real, sin extracciones parciales que puedan romper
 * dependencias internas entre bloques).
 *
 * `state`/`updateTask`/`addTask`/`addEvent`/`deleteTask` se mockean con el
 * MISMO patrón que test-ai-1-regression.js/test-ai-2-regression.js
 * (espías con contador de llamadas sobre un `state.tasks`/`state.events`
 * en memoria).
 *
 * Uso:  node js/test-ai-3-6-planning-apply-discard.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AI_ACTIONS_PATH = path.join(ROOT, 'js', 'ai-actions.js');
const SCHEDULER_PATH = path.join(ROOT, 'js', 'scheduler.js');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// ai-actions.js y organizator.html se guardan con CRLF en este entorno; se
// normaliza a LF SOLO para esta lectura en memoria (nunca se toca el
// archivo en disco) porque los marcadores de extractBetween de abajo usan
// '\n' — mismo criterio ya establecido por test-ai-3-5-planning-batches.js
// y el resto de la familia AI-1.x/AI-2.x/AI-3.x para evitar el problema
// preexistente de CRLF documentado en la verificación de AI-3.5.
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8').replace(/\r\n/g, '\n');
const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) — ¿cambió el código?`);
  return source.slice(start, end);
}

// Ciclo de vida REAL de propuestas/batches IA (organizator.html) — mismo
// bloque que ya extraen test-ai-3-5-planning-batches.js/
// test-ia-apply-idempotency.js/test-ia-batch-expiry.js.
const iaLifecycleSrc = extractBetween(html, '/* ==================================================================\n   IA — ASISTENTE PERSONAL', '\n\n/* ---------- Llamada a la IA ----------', 'bloque IA — ASISTENTE PERSONAL (ciclo de vida de propuestas/batches)');
// Bloque AI-3.6 en solitario — usado solo para las comprobaciones de
// CONTENIDO (no toca Scheduler/reminders/Smart Forms/persistencia).
// Vive junto a applyCreateTask/applyMoveItem/applyUpdatePriority (mismo
// patrón de mutación real), justo antes del comentario "AI-1.1" que
// introduce dedupeActions() — deliberadamente NO junto a
// createPlanningProposalBatch (AI-3.5), para no solapar con el marcador
// de fin que usa test-ai-3-5-planning-batches.js.
const applyDiscardSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.6', '\n\n  /** AI-1.1', 'bloque AI-3.6 (applyPlanningProposal)');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const THU = '2026-09-17'; // jueves
const FRI = '2026-09-18';

/** Sandbox completo: scheduler.js REAL + ciclo de vida REAL de
 * iaProposals/batches (organizator.html) + ai-actions.js REAL y COMPLETO
 * (no extractos parciales — así schedulerContext()/applyPlanningProposal/
 * createPlanningProposalBatch conviven exactamente como en la app real),
 * con `state`/addTask/updateTask/addEvent/deleteTask mockeados (mismo
 * patrón que toda la familia AI-1.x/AI-2.x). */
function makeSandbox(todayStr) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;

  let nextId = 1;
  const state = { tasks: [], events: [], customSchedules: [] };
  sandbox.state = state;
  sandbox.currentView = 'test';
  sandbox.todayStr = () => (todayStr || THU);

  const calls = { addTask: 0, addEvent: 0, updateTask: 0, updateEvent: 0, deleteTask: 0, deleteEvent: 0 };
  sandbox.__calls = calls;
  sandbox.addTask = async (data) => { calls.addTask++; state.tasks.push(Object.assign({ id: 't' + (nextId++), done: false, createdAt: 1 }, data)); };
  sandbox.addEvent = async (data) => { calls.addEvent++; state.events.push(Object.assign({ id: 'e' + (nextId++), createdAt: 1 }, data)); };
  sandbox.updateTask = async (id, data) => { calls.updateTask++; const t = state.tasks.find(x => x.id === id); if (t) Object.assign(t, data); };
  sandbox.updateEvent = async (id, data) => { calls.updateEvent++; const e = state.events.find(x => x.id === id); if (e) Object.assign(e, data); };
  sandbox.deleteTask = async (id) => { calls.deleteTask++; state.tasks = state.tasks.filter(t => t.id !== id); };
  sandbox.deleteEvent = async (id) => { calls.deleteEvent++; state.events = state.events.filter(e => e.id !== id); };

  vm.createContext(sandbox);
  vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js (real, completo)' });
  vm.runInContext(
    iaLifecycleSrc + `
    this.iaProposals = iaProposals;
    this.nextIAProposalId = nextIAProposalId;
    this.nextIABatchId = nextIABatchId;
    this.getIAProposalById = getIAProposalById;
    this.getIAProposalsByBatchId = getIAProposalsByBatchId;
    this.getPendingIAProposalsByBatchId = getPendingIAProposalsByBatchId;
    this.getIAProposalBatch = getIAProposalBatch;
    this.hasPendingIAProposals = hasPendingIAProposals;
    this.setIAProposalStatus = setIAProposalStatus;
    this.validateIAProposalBatch = validateIAProposalBatch;
    this.getIAProposalBatchSummary = getIAProposalBatchSummary;
    this.isIAProposalInBatch = isIAProposalInBatch;
    this.getIAProposalFromBatch = getIAProposalFromBatch;
    `,
    sandbox, { filename: 'organizator.html (ciclo de vida real de iaProposals/batches)' }
  );
  vm.runInContext(aiActionsSrc, sandbox, { filename: 'js/ai-actions.js (real, completo)' });
  return sandbox;
}

function task(overrides) {
  return Object.assign({ id: 't1', title: 'Tarea', done: false }, overrides);
}

/** Construye a mano una iaProposal `source:'planning'` ya "convertida"
 * (como la dejaría createPlanningProposalBatch), usando el MISMO
 * mecanismo de ids del sistema existente (nextIAProposalId/nextIABatchId)
 * — nunca un id inventado a mano. Permite fijar escenarios concretos
 * (conflicto, obsolescencia) que generatePlanningProposal nunca produciría
 * por construcción (ver test-ai-3-4, sección 28: "ninguna propuesta se
 * solapa con otra"), pero que Apply debe seguir defendiendo igualmente. */
function makePlanningProposal(sb, { taskId, date, startTime, endTime, minutes, reason, batchId }) {
  const bId = batchId || sb.nextIABatchId();
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const p = {
    id: sb.nextIAProposalId(),
    batchId: bId,
    source: 'planning',
    status: 'pending',
    taskId, date, startTime, endTime,
    minutes: minutes != null ? minutes : ((eh * 60 + em) - (sh * 60 + sm)),
    reason: reason || 'Propuesta de prueba (AI-3.6).',
  };
  sb.iaProposals.push(p);
  return p;
}

function realPlanningBatch(sb, ctx, cons) {
  const av = sb.AIActions.analyzePlanningAvailability(ctx, cons);
  const pp = sb.AIActions.generatePlanningProposal(ctx, cons, av);
  return sb.AIActions.createPlanningProposalBatch(pp, ctx);
}

(async () => {
  // =====================================================================
  section('1-3) Apply de una propuesta planning válida: tarea actualizada + status applied');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    const result = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('1. Apply de una propuesta planning válida devuelve status "applied"', result.status === 'applied');
    check('2. La tarea queda correctamente actualizada (scheduledDate/Start/End = propuesta)', sb.state.tasks[0].scheduledDate === THU && sb.state.tasks[0].scheduledStart === '10:00' && sb.state.tasks[0].scheduledEnd === '11:00');
    check('3. El status de la propuesta pasa a "applied"', sb.getIAProposalById(p.id).status === 'applied');
    check('Extra: exactamente una llamada a updateTask, ninguna a addTask/addEvent', sb.__calls.updateTask === 1 && sb.__calls.addTask === 0 && sb.__calls.addEvent === 0);
  }

  // =====================================================================
  section('4, 17) Apply de una propuesta ya aplicada no duplica nada (doble Apply idempotente)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    const r1 = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    const before = JSON.stringify(sb.state.tasks[0]);
    const r2 = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    const after = JSON.stringify(sb.state.tasks[0]);
    check('4. primera Apply aplica de verdad', r1.status === 'applied');
    check('17a. segunda Apply de la MISMA propuesta devuelve "already_applied"', r2.status === 'already_applied');
    check('17b. la tarea no cambia entre la primera y la segunda Apply', before === after);
    check('4b/17c. updateTask NO se vuelve a llamar en la segunda Apply (sigue en 1)', sb.__calls.updateTask === 1);
  }

  // =====================================================================
  section('5) Apply de una propuesta inexistente');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1' }));
    const result = await sb.AIActions.applyPlanningProposal('ia-9999', 'ia-batch-9999');
    check('5. Apply de un id que no existe devuelve "not_found"', result.status === 'not_found');
    check('5b. no llama a updateTask/addTask ante un id inexistente', sb.__calls.updateTask === 0 && sb.__calls.addTask === 0);
  }

  // =====================================================================
  section('15) BatchId correcto: id real con batchId equivocado también es not_found');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }));
    const pA = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '09:00', endTime: '09:30' });
    const pB = makePlanningProposal(sb, { taskId: 't2', date: THU, startTime: '12:00', endTime: '12:30' }); // otro batch
    const result = await sb.AIActions.applyPlanningProposal(pA.id, pB.batchId); // id real, batchId de OTRO batch
    check('15. proposal.id real pero batchId de otro batch -> not_found (getIAProposalFromBatch exige ambos)', result.status === 'not_found');
    check('15b. la tarea t1 no se tocó', sb.state.tasks[0].scheduledDate === undefined);
  }

  // =====================================================================
  section('6, 9) Apply de una propuesta discarded; Apply tras Discard no aplica nada');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    check('7a. Discard de una propuesta pending devuelve true (transición permitida)', sb.setIAProposalStatus(p.id, 'discarded') === true);
    check('7b. status pasa a "discarded"', sb.getIAProposalById(p.id).status === 'discarded');
    check('8. Discard no modifica la tarea real', sb.state.tasks[0].scheduledDate === undefined && sb.__calls.updateTask === 0);
    const result = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('6/9. Apply de una propuesta discarded devuelve "discarded" y no aplica nada', result.status === 'discarded' && sb.state.tasks[0].scheduledDate === undefined);
    check('9b. updateTask sigue en 0 tras intentar Apply post-Discard', sb.__calls.updateTask === 0);
  }

  // =====================================================================
  section('19) Discard es idempotente (segundo Discard no hace nada nuevo)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1' }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    sb.setIAProposalStatus(p.id, 'discarded');
    const secondDiscard = sb.setIAProposalStatus(p.id, 'discarded');
    check('19a. un segundo Discard sobre la misma propuesta devuelve false (transición no permitida)', secondDiscard === false);
    check('19b. el status sigue siendo "discarded" (no se corrompe)', sb.getIAProposalById(p.id).status === 'discarded');
  }

  // =====================================================================
  section('8) Apply de una propuesta inválida: la tarea objetivo ya no existe');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    // Sin ninguna tarea 't1' en state.tasks (nunca existió o fue borrada).
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    const result = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('8. taskId que ya no corresponde a ninguna tarea real -> "invalid"', result.status === 'invalid');
    check('8b. no se llama a updateTask/addTask', sb.__calls.updateTask === 0 && sb.__calls.addTask === 0);
  }

  // =====================================================================
  section('10) Revalidación detecta que la tarea cambió (se completó entre tanto)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    sb.state.tasks[0].done = true; // el usuario completó la tarea mientras la propuesta seguía pendiente
    const result = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('10. una tarea ya completada (done:true) no se aplica -> "invalid"', result.status === 'invalid');
    check('10b. no se toca la tarea (sigue sin scheduledDate, updateTask en 0)', sb.state.tasks[0].scheduledDate === undefined && sb.__calls.updateTask === 0);
  }

  // =====================================================================
  section('11) Revalidación detecta que la propuesta está obsoleta (el calendario cambió)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    // Un evento nuevo ocupa justo ese hueco DESPUÉS de generarse la propuesta.
    sb.state.events.push({ id: 'e1', title: 'Reunión urgente', date: THU, endDate: '', allDay: false, startTime: '10:30', endTime: '10:45' });
    const result = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('11. el hueco ya no está libre -> "stale"', result.status === 'stale');
    check('11b. la propuesta sigue pending (no se descarta silenciosamente)', sb.getIAProposalById(p.id).status === 'pending');
    check('11c. la tarea no se tocó', sb.state.tasks[0].scheduledDate === undefined && sb.__calls.updateTask === 0);
  }

  // =====================================================================
  section('11d) La propia tarea objetivo no choca consigo misma (excludeTaskId)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    // La tarea YA estaba programada por una pasada anterior en un hueco que
    // SE SOLAPARÍA con el nuevo hueco propuesto (10:00-10:30 vs 10:00-11:00)
    // — pero es la MISMA tarea, así que revalidatePlanningProposalBeforeApply
    // debe excluir su propio bloque de su cálculo de huecos ocupados (si no
    // lo hiciera, cualquier re-planificación de una tarea ya programada se
    // marcaría "stale" contra sí misma). Se usa un hueco DISTINTO al nuevo
    // (no idéntico) para no disparar el atajo de idempotencia de arriba,
    // que es un caso ya cubierto aparte.
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60, scheduledDate: THU, scheduledStart: '10:00', scheduledEnd: '10:30' }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    const result = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('11d. una tarea ya programada no choca "stale" contra su PROPIO bloque anterior (excludeTaskId)', result.status === 'applied');
  }

  // =====================================================================
  section('12, 13) Conflicto entre dos propuestas del mismo batch; sin efectos parciales silenciosos');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }));
    const batchId = sb.nextIABatchId();
    const pA = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '10:30', batchId });
    const pB = makePlanningProposal(sb, { taskId: 't2', date: THU, startTime: '10:15', endTime: '10:45', batchId }); // se solapa con pA
    const result = await sb.AIActions.applyPlanningProposal(pA.id, pA.batchId);
    check('12. dos propuestas pendientes del mismo batch que se solapan -> "conflict"', result.status === 'conflict');
    check('13a. ninguna tarea se tocó (ni t1 ni t2)', sb.state.tasks[0].scheduledDate === undefined && sb.state.tasks[1].scheduledDate === undefined);
    check('13b. updateTask nunca se llamó (sin cambios parciales)', sb.__calls.updateTask === 0);
    check('13c. ambas propuestas siguen "pending" (ninguna se descarta/aplica a medias)', sb.getIAProposalById(pA.id).status === 'pending' && sb.getIAProposalById(pB.id).status === 'pending');
    // Sin conflicto: si la sibling NO se solapa, sí se aplica con normalidad.
    const pC = makePlanningProposal(sb, { taskId: 't2', date: THU, startTime: '11:00', endTime: '11:30', batchId }); // no se solapa con pA
    sb.iaProposals.splice(sb.iaProposals.indexOf(pB), 1); // fuera la que sí chocaba, para aislar el caso
    const resultC = await sb.AIActions.applyPlanningProposal(pC.id, pC.batchId);
    check('12b. dos propuestas del mismo batch que NO se solapan se aplican con normalidad', resultC.status === 'applied');
  }

  // =====================================================================
  section('14) IDs estables funcionan aunque iaProposals esté reordenado');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }), task({ id: 't3', estimatedMinutes: 30 }));
    const p1 = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '09:00', endTime: '09:30' });
    const p2 = makePlanningProposal(sb, { taskId: 't2', date: THU, startTime: '10:00', endTime: '10:30' });
    const p3 = makePlanningProposal(sb, { taskId: 't3', date: THU, startTime: '11:00', endTime: '11:30' });
    sb.iaProposals.reverse(); // el orden del array ya no coincide con el de creación
    const result = await sb.AIActions.applyPlanningProposal(p2.id, p2.batchId);
    check('14a. encuentra y aplica la propuesta correcta aunque el array esté reordenado', result.status === 'applied');
    check('14b. actualizó la tarea correcta (t2), no otra por posición', sb.state.tasks.find(t => t.id === 't2').scheduledDate === THU && sb.state.tasks.find(t => t.id === 't1').scheduledDate === undefined && sb.state.tasks.find(t => t.id === 't3').scheduledDate === undefined);
  }

  // =====================================================================
  section('16) source === "planning": otras fuentes no se aplican por este camino');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1' }));
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    check('16. la propuesta de planning realmente tiene source==="planning"', p.source === 'planning');
    // Una propuesta "day"/"week" real (mismo idioma que runIADay/runIAWeek:
    // title/time propios, sin taskId) no debe procesarse por este camino.
    const batchId = sb.nextIABatchId();
    const dayProp = { id: sb.nextIAProposalId(), batchId, source: 'day', status: 'pending', title: 'Estudiar', time: '09:00', kind: 'task', reason: 'motivo' };
    sb.iaProposals.push(dayProp);
    const result = await sb.AIActions.applyPlanningProposal(dayProp.id, dayProp.batchId);
    check('20a. una propuesta de otro source (day) devuelve "invalid" (AI-3.6 no la toca)', result.status === 'invalid');
    check('20b. no se llamó a updateTask/addTask/addEvent por esa propuesta de otro source', sb.__calls.updateTask === 0 && sb.__calls.addTask === 0 && sb.__calls.addEvent === 0);
    check('20c. el sistema existente (setIAProposalStatus) sigue funcionando igual para ese otro source', sb.setIAProposalStatus(dayProp.id, 'applied') === true && sb.getIAProposalById(dayProp.id).status === 'applied');
  }

  // =====================================================================
  section('18) Apply no crea una segunda tarea/ocurrencia');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const before = sb.state.tasks.length;
    const p = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '10:00', endTime: '11:00' });
    await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('18a. el número de tareas no cambia (no se crea una nueva)', sb.state.tasks.length === before);
    check('18b. no se creó ningún evento tampoco', sb.state.events.length === 0);
    check('18c. addTask/addEvent nunca se llamaron', sb.__calls.addTask === 0 && sb.__calls.addEvent === 0);
  }

  // =====================================================================
  section('27, Extra) Integración real de extremo a extremo: AI-3.3 -> AI-3.4 -> AI-3.5 -> AI-3.6, sin segundo sistema de batches');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx = { tasks: sb.state.tasks };
    const batch = realPlanningBatch(sb, ctx, { dateFrom: THU, dateTo: THU });
    check('Extra: el batch real de AI-3.5 se generó correctamente', batch !== null && batch.proposals.length === 1);
    sb.iaProposals.push(...batch.proposals); // mismo idioma que ya usa el resto del sistema
    const p = batch.proposals[0];
    const result = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('27a. Apply real de extremo a extremo aplica correctamente', result.status === 'applied');
    check('27b. la tarea real queda programada EXACTAMENTE con lo que calculó AI-3.4', sb.state.tasks[0].scheduledDate === p.date && sb.state.tasks[0].scheduledStart === p.startTime && sb.state.tasks[0].scheduledEnd === p.endTime);
    check('27c. validateIAProposalBatch (helper existente) sigue aceptando el batch tras aplicarlo', sb.validateIAProposalBatch(batch.batchId) === true);
    check('27d. getIAProposalBatchSummary (helper existente) refleja 1 applied, 0 pending/discarded', deepEq(sb.getIAProposalBatchSummary(batch.batchId), { batchId: batch.batchId, total: 1, pending: 0, applied: 1, discarded: 0 }));
  }

  // =====================================================================
  section('21) El sistema existente de 5D no se rompe (helpers genéricos siguen funcionando)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }));
    const batchId = sb.nextIABatchId();
    const p1 = makePlanningProposal(sb, { taskId: 't1', date: THU, startTime: '09:00', endTime: '09:30', batchId });
    const p2 = makePlanningProposal(sb, { taskId: 't2', date: THU, startTime: '10:00', endTime: '10:30', batchId });
    check('21a. getIAProposalsByBatchId sigue devolviendo ambas', sb.getIAProposalsByBatchId(batchId).length === 2);
    check('21b. hasPendingIAProposals sigue detectando pendientes', sb.hasPendingIAProposals(batchId) === true);
    await sb.AIActions.applyPlanningProposal(p1.id, batchId);
    sb.setIAProposalStatus(p2.id, 'discarded');
    check('21c. hasPendingIAProposals ya no detecta pendientes tras resolver ambas', sb.hasPendingIAProposals(batchId) === false);
    check('21d. getIAProposalBatchSummary cuenta correctamente applied/discarded', deepEq(sb.getIAProposalBatchSummary(batchId), { batchId, total: 2, pending: 0, applied: 1, discarded: 1 }));
    check('21e. isIAProposalInBatch sigue funcionando para propuestas planning', sb.isIAProposalInBatch(p1.id, batchId) === true);
  }

  // =====================================================================
  section('22, 16b) ACTION_SCHEMA permanece intacto');
  // =====================================================================
  {
    check('22. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op"', (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
    check('22b. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES en su línea principal', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('22c. applyPlanningProposal se expone como propiedad ADICIONAL, sin tocar esa línea principal', /global\.AIActions\.applyPlanningProposal = applyPlanningProposal;/.test(aiActionsSrc));
    check('22d. createPlanningProposalBatch (AI-3.5) sigue exportado sin tocar', /global\.AIActions\.createPlanningProposalBatch = createPlanningProposalBatch;/.test(aiActionsSrc));
    check('22e. generatePlanningProposal (AI-3.4) sigue exportado sin tocar', /global\.AIActions\.generatePlanningProposal = generatePlanningProposal;/.test(aiActionsSrc));
    check('22f. analyzePlanningAvailability (AI-3.3) sigue exportado sin tocar', /global\.AIActions\.analyzePlanningAvailability = analyzePlanningAvailability;/.test(aiActionsSrc));
    check('22g. detectPlanningIntent (AI-3.1) / extractPlanningConstraints (AI-3.2) siguen exportados sin tocar', /global\.AIActions\.detectPlanningIntent = detectPlanningIntent;/.test(aiActionsSrc) && /global\.AIActions\.extractPlanningConstraints = extractPlanningConstraints;/.test(aiActionsSrc));
  }

  // =====================================================================
  section('23) Scheduler permanece intacto (AI-3.6 solo lo CONSUME, nunca lo reimplementa)');
  // =====================================================================
  {
    const applyDiscardCode = stripComments(applyDiscardSrc);
    check('23a. AI-3.6 no define su propia lógica de getBusyIntervals/findConflicts (solo consume global.Scheduler)', !/function\s+getBusyIntervals\s*\(/.test(applyDiscardCode) && !/function\s+findConflicts\s*\(/.test(applyDiscardCode));
    check('23b. AI-3.6 SÍ reutiliza global.Scheduler._internal.getBusyIntervals (no lo reimplementa)', /global\.Scheduler\._internal/.test(applyDiscardCode));
    check('23c. js/scheduler.js no se modificó: getBusyIntervals sigue teniendo una única definición', (schedulerSrc.match(/function getBusyIntervals\(/g) || []).length === 1);
  }

  // =====================================================================
  section('24) reminders permanecen intactos (AI-3.6 no los menciona ni los toca)');
  // =====================================================================
  {
    const applyDiscardCode = stripComments(applyDiscardSrc);
    check('24. el bloque AI-3.6 no menciona reminders/recordatorios en el código real', !/reminder/i.test(applyDiscardCode));
  }

  // =====================================================================
  section('25) Smart Forms permanecen intactos');
  // =====================================================================
  {
    const applyDiscardCode = stripComments(applyDiscardSrc);
    check('25. el bloque AI-3.6 no menciona Smart Forms/prefill/detectSmartFormIntent en el código real', !/SmartForm|detectSmartFormIntent|prefill/i.test(applyDiscardCode));
  }

  // =====================================================================
  section('26) persistence permanece intacta (AI-3.6 nunca toca window.storage/saveTasks directamente)');
  // =====================================================================
  {
    const applyDiscardCode = stripComments(applyDiscardSrc);
    check('26a. el bloque AI-3.6 nunca llama a window.storage/saveTasks directamente (pasa siempre por global.updateTask, como el resto de ai-actions.js)', !/window\.storage/.test(applyDiscardCode) && !/saveTasks\(/.test(applyDiscardCode));
    check('26b. SÍ usa global.updateTask (mismo mecanismo de persistencia que applyMoveItem/applyCreateTask)', /global\.updateTask\(/.test(applyDiscardCode));
  }

  // =====================================================================
  section('27) No se crea un segundo sistema de batches');
  // =====================================================================
  {
    const applyDiscardCode = stripComments(applyDiscardSrc);
    check('27e. AI-3.6 no declara ningún array/objeto propio de batches (usa batchId + getIAProposalFromBatch existentes)', !/(let|const|var)\s+\w*[Bb]atches\w*\s*=/.test(applyDiscardCode));
    check('27f. AI-3.6 localiza SIEMPRE por getIAProposalFromBatch(id, batchId), nunca por índice de iaProposals', /getIAProposalFromBatch\(/.test(applyDiscardCode) && !/iaProposals\[/.test(applyDiscardCode));
  }

  // =====================================================================
  section('node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('C1. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('C1. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
