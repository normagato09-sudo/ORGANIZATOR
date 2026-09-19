/**
 * ORGANIZATOR — Tests de AI-3.7 (QA final de AI-3, extremo a extremo)
 *
 * Suite Node pura, SIN navegador ni jsdom. NO reimplementa ni repite el
 * detalle exhaustivo de cada fase (eso ya lo cubren test-ai-3-1..3-6, que
 * siguen siendo la referencia): esta suite comprueba que las SEIS fases
 * de AI-3 funcionan JUNTAS, de extremo a extremo, en el mismo orden en
 * que las usaría la app real:
 *
 *   AI-3.1 detectPlanningIntent
 *   -> AI-3.2 extractPlanningConstraints
 *   -> AI-3.3 analyzePlanningAvailability
 *   -> AI-3.4 generatePlanningProposal
 *   -> AI-3.5 createPlanningProposalBatch
 *   -> AI-3.6 applyPlanningProposal / setIAProposalStatus(discarded)
 *
 * Mismo patrón de sandbox que test-ai-3-6-planning-apply-discard.js:
 * scheduler.js REAL y COMPLETO, el ciclo de vida REAL de iaProposals/
 * batches (organizator.html) y ai-actions.js REAL y COMPLETO (sin
 * extractos parciales), con `state`/updateTask/addTask/addEvent/
 * deleteTask mockeados (espías con contador).
 *
 * Uso:  node js/test-ai-3-7-planning-qa-e2e.js
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
// archivo en disco) — mismo criterio ya establecido por el resto de la
// familia AI-1.x/AI-2.x/AI-3.x para evitar el problema preexistente de
// CRLF documentado en las verificaciones de AI-3.5/AI-3.6.
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
// bloque que ya extraen test-ai-3-5/test-ai-3-6.
const iaLifecycleSrc = extractBetween(html, '/* ==================================================================\n   IA — ASISTENTE PERSONAL', '\n\n/* ---------- Llamada a la IA ----------', 'bloque IA — ASISTENTE PERSONAL (ciclo de vida de propuestas/batches)');
// Bloques en solitario — usados solo para comprobaciones de CONTENIDO
// (punto 14 del encargo: ausencia de aplicación automática).
const proposalSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.4', '\n\n  /* ==================================================================\n     AI-3.5', 'bloque AI-3.4 (generatePlanningProposal)');
const batchSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.5', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-3.5 (createPlanningProposalBatch)');
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
const FRI = '2026-09-18'; // viernes ("mañana" relativo a THU)

/** Sandbox completo: scheduler.js REAL + ciclo de vida REAL de
 * iaProposals/batches (organizator.html) + ai-actions.js REAL y COMPLETO,
 * con `state`/addTask/updateTask/addEvent/deleteTask mockeados (mismo
 * patrón que toda la familia AI-1.x/AI-2.x/AI-3.6). */
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

/** Encadena las SEIS fases de AI-3 tal cual las usaría la app real, desde
 * un mensaje de usuario en lenguaje natural hasta un batch listo para
 * Apply/Discard. `ctxForConstraints` es el contexto mínimo que necesita
 * AI-3.2 (solo `today`, ver AI-3.2: "context.today", nunca `global.todayStr()`);
 * `ctx` es el contexto real (`{ tasks }`) para AI-3.3/AI-3.4/AI-3.5. */
function runFullPipeline(sb, message, ctxForConstraints, ctx) {
  const intent = sb.AIActions.detectPlanningIntent(message, ctxForConstraints);
  const constraints = sb.AIActions.extractPlanningConstraints(message, ctxForConstraints);
  const availability = sb.AIActions.analyzePlanningAvailability(ctx, constraints);
  const proposal = sb.AIActions.generatePlanningProposal(ctx, constraints, availability);
  const batch = sb.AIActions.createPlanningProposalBatch(proposal, ctx);
  return { intent, constraints, availability, proposal, batch };
}

(async () => {
  // =====================================================================
  section('0) Contrato público de AI-3 completo (1..6) sigue intacto');
  // =====================================================================
  {
    check('0a. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES en su línea principal', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0b. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op"', (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
    ['detectPlanningIntent', 'extractPlanningConstraints', 'analyzePlanningAvailability', 'generatePlanningProposal', 'createPlanningProposalBatch', 'applyPlanningProposal'].forEach(fn => {
      check(`0c. global.AIActions.${fn} (AI-3.x) sigue exportado como propiedad adicional`, (aiActionsSrc.match(new RegExp(`global\\.AIActions\\.${fn} = ${fn};`, 'g')) || []).length === 1);
    });
  }

  // =====================================================================
  section('1) Flujo completo de planificación: mensaje natural -> intención -> restricciones -> disponibilidad -> propuesta -> batch');
  // =====================================================================
  let e2eBatch, e2eSb;
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', title: 'Estudiar biología', estimatedMinutes: 60 }));
    const message = 'planifícame mañana';
    const ctxForConstraints = { today: THU, tasks: sb.state.tasks };
    const ctx = { tasks: sb.state.tasks };
    const { intent, constraints, availability, proposal, batch } = runFullPipeline(sb, message, ctxForConstraints, ctx);

    check('1a. AI-3.1 detecta intención de planificación ("planifícame mañana")', intent !== null && intent.type === 'planning');
    check('1b. AI-3.2 extrae dateFrom/dateTo = mañana (viernes) sin depender de global.todayStr()', constraints.dateFrom === FRI && constraints.dateTo === FRI);
    check('1c. AI-3.3 devuelve disponibilidad real para ese rango (al menos un availableSlot)', availability.availableSlots && availability.availableSlots.length > 0 && availability.dateFrom === FRI && availability.dateTo === FRI);
    check('1d. AI-3.4 genera una propuesta válida para la tarea pendiente', proposal.proposals.length === 1 && proposal.proposals[0].taskId === 't1');
    check('1e. AI-3.5 convierte la propuesta en un batch del sistema existente (status pending, source planning)', batch !== null && batch.proposals.length === 1 && batch.proposals[0].status === 'pending' && batch.proposals[0].source === 'planning');
    sb.iaProposals.push(...batch.proposals);
    check('1f. la propuesta queda accesible por los helpers YA EXISTENTES (getIAProposalFromBatch)', sb.getIAProposalFromBatch(batch.proposals[0].id, batch.batchId) !== null);

    const applyResult = await sb.AIActions.applyPlanningProposal(batch.proposals[0].id, batch.batchId);
    check('1g. AI-3.6 aplica la propuesta de extremo a extremo', applyResult.status === 'applied');
    check('1h. la tarea real queda programada EXACTAMENTE con lo calculado por AI-3.4 (fecha=mañana)', sb.state.tasks[0].scheduledDate === FRI && sb.state.tasks[0].scheduledStart === batch.proposals[0].startTime && sb.state.tasks[0].scheduledEnd === batch.proposals[0].endTime);
    check('1i. ninguna tarea/evento nuevo se creó en todo el flujo (addTask/addEvent en 0)', sb.__calls.addTask === 0 && sb.__calls.addEvent === 0);

    e2eBatch = batch; e2eSb = sb;
  }

  // =====================================================================
  section('2) Propuesta válida (AI-3.4): forma exacta preservada de extremo a extremo');
  // =====================================================================
  {
    const p = e2eBatch.proposals[0];
    check('2a. forma exacta de la propuesta convertida a iaProposal', ['id', 'batchId', 'source', 'status', 'taskId', 'date', 'startTime', 'endTime', 'minutes', 'reason'].every(k => Object.prototype.hasOwnProperty.call(p, k)));
    check('2b. minutes > 0 y startTime < endTime (coherencia temporal preservada)', p.minutes > 0 && p.startTime < p.endTime);
  }

  // =====================================================================
  section('3) Conversión a batch (AI-3.5): batchId compartido, ids únicos, nunca aplica/descarta al crear');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }));
    const ctx = { tasks: sb.state.tasks };
    const av = sb.AIActions.analyzePlanningAvailability(ctx, { dateFrom: THU, dateTo: THU });
    const pp = sb.AIActions.generatePlanningProposal(ctx, { dateFrom: THU, dateTo: THU }, av);
    const batch = sb.AIActions.createPlanningProposalBatch(pp, ctx);
    check('3a. todas las propuestas del batch comparten el mismo batchId', batch.proposals.every(p => p.batchId === batch.batchId));
    check('3b. cada propuesta tiene un id único', new Set(batch.proposals.map(p => p.id)).size === batch.proposals.length);
    check('3c. todas nacen "pending" (14. ausencia de aplicación automática)', batch.proposals.every(p => p.status === 'pending'));
  }

  // =====================================================================
  section('4, 7) Revisión/revalidación antes de aplicar: el calendario cambia entre generar y aplicar');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx = { tasks: sb.state.tasks };
    const { batch } = runFullPipeline(sb, 'planifícame mañana', { today: THU, tasks: sb.state.tasks }, ctx);
    sb.iaProposals.push(...batch.proposals);
    const p = batch.proposals[0];

    // El calendario cambia DESPUÉS de generar la propuesta (un evento nuevo
    // ocupa justo ese hueco) — Apply debe revalidar y NO aplicar a ciegas.
    sb.state.events.push({ id: 'e1', title: 'Imprevisto', date: p.date, endDate: '', allDay: false, startTime: p.startTime, endTime: p.endTime });
    const staleResult = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('4a/7a. revalidación detecta que el calendario cambió -> "stale" (no aplica a ciegas)', staleResult.status === 'stale');
    check('4b/7b. la propuesta sigue pending, no se pierde ni se aplica a medias', sb.getIAProposalById(p.id).status === 'pending');
    check('4c/7c. la tarea no quedó programada', sb.state.tasks[0].scheduledDate === undefined);

    // Sin ese cambio, la MISMA propuesta sí se aplica con normalidad.
    sb.state.events.length = 0;
    const okResult = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('4d. sin cambios en el calendario, la revisión pasa y Apply funciona', okResult.status === 'applied');
  }

  // =====================================================================
  section('5) Apply explícito: nunca ocurre solo, solo por llamada directa del usuario');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx = { tasks: sb.state.tasks };
    const { batch } = runFullPipeline(sb, 'planifícame mañana', { today: THU, tasks: sb.state.tasks }, ctx);
    sb.iaProposals.push(...batch.proposals);
    check('5a. tras generar el batch, la tarea SIGUE sin programar (createPlanningProposalBatch no aplica nada)', sb.state.tasks[0].scheduledDate === undefined);
    check('5b. updateTask no se llamó todavía (ningún Apply implícito)', sb.__calls.updateTask === 0);
    const result = await sb.AIActions.applyPlanningProposal(batch.proposals[0].id, batch.batchId);
    check('5c. solo tras la llamada EXPLÍCITA a applyPlanningProposal se aplica', result.status === 'applied' && sb.state.tasks[0].scheduledDate !== undefined);
  }

  // =====================================================================
  section('6) Discard explícito: usa el sistema existente, corta cualquier Apply posterior');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx = { tasks: sb.state.tasks };
    const { batch } = runFullPipeline(sb, 'planifícame mañana', { today: THU, tasks: sb.state.tasks }, ctx);
    sb.iaProposals.push(...batch.proposals);
    const p = batch.proposals[0];
    const discarded = sb.setIAProposalStatus(p.id, 'discarded'); // MISMO mecanismo existente que day/week, sin cambios de AI-3.6
    check('6a. Discard explícito (setIAProposalStatus existente) funciona igual para planning', discarded === true && sb.getIAProposalById(p.id).status === 'discarded');
    check('6b. Discard no modifica la tarea real', sb.state.tasks[0].scheduledDate === undefined && sb.__calls.updateTask === 0);
    const applyAfterDiscard = await sb.AIActions.applyPlanningProposal(p.id, p.batchId);
    check('6c. Apply tras Discard no aplica nada ("discarded")', applyAfterDiscard.status === 'discarded' && sb.state.tasks[0].scheduledDate === undefined);
  }

  // =====================================================================
  section('8, 9) Conflictos e idempotencia end-to-end (dos tareas del mismo batch, doble Apply)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }));
    const ctx = { tasks: sb.state.tasks };
    const av = sb.AIActions.analyzePlanningAvailability(ctx, { dateFrom: THU, dateTo: THU });
    const pp = sb.AIActions.generatePlanningProposal(ctx, { dateFrom: THU, dateTo: THU }, av);
    const batch = sb.AIActions.createPlanningProposalBatch(pp, ctx);
    sb.iaProposals.push(...batch.proposals);
    check('8a. AI-3.4 ya genera el batch real SIN solapes entre sí (por construcción)', batch.proposals.every((p, i) => batch.proposals.every((q, j) => i === j || p.date !== q.date || p.endTime <= q.startTime || q.endTime <= p.startTime)));

    const [pA, pB] = batch.proposals;
    const r1 = await sb.AIActions.applyPlanningProposal(pA.id, pA.batchId);
    check('8b. Apply de la primera propuesta del batch funciona con normalidad', r1.status === 'applied');
    const r2 = await sb.AIActions.applyPlanningProposal(pA.id, pA.batchId);
    check('9a. doble Apply de la MISMA propuesta es idempotente ("already_applied")', r2.status === 'already_applied');
    check('9b. la tarea no cambió entre la primera y la segunda Apply', sb.state.tasks.find(t => t.id === pA.taskId).scheduledStart === pA.startTime);
    const r3 = await sb.AIActions.applyPlanningProposal(pB.id, pB.batchId);
    check('8c. la segunda propuesta del batch (no solapada) se aplica sin verse afectada por la primera', r3.status === 'applied');

    // Conflicto defensivo: dos propuestas PENDIENTES del mismo batch que sí
    // se solaparan (AI-3.4 nunca las produce así, pero Apply debe seguir
    // defendiéndose — ver AI-3.6, sección 12/13 del encargo original).
    const batchId = sb.nextIABatchId();
    const clashA = { id: sb.nextIAProposalId(), batchId, source: 'planning', status: 'pending', taskId: 't1', date: THU, startTime: '15:00', endTime: '15:30', minutes: 30, reason: 'r' };
    const clashB = { id: sb.nextIAProposalId(), batchId, source: 'planning', status: 'pending', taskId: 't2', date: THU, startTime: '15:15', endTime: '15:45', minutes: 30, reason: 'r' };
    sb.iaProposals.push(clashA, clashB);
    const clashResult = await sb.AIActions.applyPlanningProposal(clashA.id, batchId);
    check('8d. dos propuestas pendientes del mismo batch que SÍ se solapan -> "conflict" (defensa explícita)', clashResult.status === 'conflict');
    check('8e. ante conflicto, ninguna tarea se tocó (sin cambios parciales)', sb.state.tasks.find(t => t.id === 't2').scheduledStart === pB.startTime); // t2 conserva su Apply legítimo anterior, no el del choque
  }

  // =====================================================================
  section('10) IDs estables y reordenación de arrays (extremo a extremo)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }), task({ id: 't3', estimatedMinutes: 30 }));
    const ctx = { tasks: sb.state.tasks };
    const av = sb.AIActions.analyzePlanningAvailability(ctx, { dateFrom: THU, dateTo: THU });
    const pp = sb.AIActions.generatePlanningProposal(ctx, { dateFrom: THU, dateTo: THU }, av);
    const batch = sb.AIActions.createPlanningProposalBatch(pp, ctx);
    sb.iaProposals.push(...batch.proposals);
    const middle = batch.proposals[1];
    sb.iaProposals.reverse();
    sb.iaProposals.sort(() => Math.random() - 0.5); // orden arbitrario adicional
    const result = await sb.AIActions.applyPlanningProposal(middle.id, middle.batchId);
    check('10a. localiza y aplica la propuesta correcta pese a la reordenación del array', result.status === 'applied');
    check('10b. actualiza la tarea correcta (por id, nunca por posición)', sb.state.tasks.find(t => t.id === middle.taskId).scheduledDate === middle.date);
    check('10c. las demás tareas del batch no se tocaron por esta Apply', sb.state.tasks.filter(t => t.id !== middle.taskId).every(t => t.scheduledDate === undefined));
  }

  // =====================================================================
  section('11) Tareas que han cambiado desde la generación (completadas entre tanto)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx = { tasks: sb.state.tasks };
    const { batch } = runFullPipeline(sb, 'planifícame mañana', { today: THU, tasks: sb.state.tasks }, ctx);
    sb.iaProposals.push(...batch.proposals);
    sb.state.tasks[0].done = true; // el usuario completó la tarea mientras la propuesta seguía pendiente
    const result = await sb.AIActions.applyPlanningProposal(batch.proposals[0].id, batch.batchId);
    check('11a. una tarea completada entre la generación y el Apply -> "invalid"', result.status === 'invalid');
    check('11b. no se toca la tarea ya completada', sb.state.tasks[0].scheduledDate === undefined);
  }

  // =====================================================================
  section('12) Tareas inexistentes (borradas entre la generación y el Apply)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx = { tasks: sb.state.tasks };
    const { batch } = runFullPipeline(sb, 'planifícame mañana', { today: THU, tasks: sb.state.tasks }, ctx);
    sb.iaProposals.push(...batch.proposals);
    await sb.deleteTask('t1'); // el usuario borró la tarea antes de decidir sobre la propuesta
    const result = await sb.AIActions.applyPlanningProposal(batch.proposals[0].id, batch.batchId);
    check('12a. la tarea objetivo ya no existe -> "invalid"', result.status === 'invalid');
    check('12b. no se crea nada en su lugar (ni addTask ni una tarea fantasma)', sb.state.tasks.length === 0 && sb.__calls.addTask === 0);
  }

  // =====================================================================
  section('13) Propuestas expiradas/inválidas');
  // =====================================================================
  {
    // (a) la propuesta desaparece de iaProposals (mismo efecto que la
    // caducidad de 5F-3A al generar una nueva tanda: iaProposals se
    // reemplaza) -> Apply por un id que ya no existe es "not_found",
    // nunca revive ni inventa nada.
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx = { tasks: sb.state.tasks };
    const { batch } = runFullPipeline(sb, 'planifícame mañana', { today: THU, tasks: sb.state.tasks }, ctx);
    sb.iaProposals.push(...batch.proposals);
    sb.iaProposals.length = 0; // simula el reemplazo de iaProposals (misma mecánica que runIADay/runIAWeek)
    const expiredResult = await sb.AIActions.applyPlanningProposal(batch.proposals[0].id, batch.batchId);
    check('13a. una propuesta ya no presente en iaProposals (expirada/reemplazada) -> "not_found"', expiredResult.status === 'not_found');
    check('13b. no se toca la tarea', sb.state.tasks[0].scheduledDate === undefined);

    // (b) la propuesta sigue en iaProposals pero con forma corrupta
    // (p.ej. le falta startTime) — nunca se recalcula ni se inventa: se
    // rechaza explícitamente como inválida.
    const sb2 = makeSandbox(THU);
    sb2.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const ctx2 = { tasks: sb2.state.tasks };
    const { batch: batch2 } = runFullPipeline(sb2, 'planifícame mañana', { today: THU, tasks: sb2.state.tasks }, ctx2);
    sb2.iaProposals.push(...batch2.proposals);
    delete sb2.iaProposals[0].startTime; // corrupción manual, simula un dato inválido/obsoleto
    const invalidResult = await sb2.AIActions.applyPlanningProposal(batch2.proposals[0].id, batch2.batchId);
    check('13c. una propuesta con forma inválida (startTime ausente) -> "invalid"', invalidResult.status === 'invalid');
    check('13d. no se toca la tarea ante una propuesta corrupta', sb2.state.tasks[0].scheduledDate === undefined);
  }

  // =====================================================================
  section('14) Ausencia de aplicación automática (verificación de código, no solo de comportamiento)');
  // =====================================================================
  {
    const proposalCode = stripComments(proposalSrc);
    const batchCode = stripComments(batchSrc);
    check('14a. AI-3.4 (generatePlanningProposal) nunca llama a setIAProposalStatus/applyPlanningProposal', !/setIAProposalStatus\(/.test(proposalCode) && !/applyPlanningProposal\(/.test(proposalCode));
    check('14b. AI-3.5 (createPlanningProposalBatch) nunca llama a setIAProposalStatus/applyPlanningProposal', !/setIAProposalStatus\(/.test(batchCode) && !/applyPlanningProposal\(/.test(batchCode));
    check('14c. applyPlanningProposal no tiene ningún llamador interno en ai-actions.js (solo se invoca explícitamente): exactamente 3 apariciones (definición + "prop = valor" del export)', (aiActionsSrc.match(/applyPlanningProposal/g) || []).length === 3);
    check('14d. runIAAction (AI-1, el único punto de entrada automático real) no menciona applyPlanningProposal ni createPlanningProposalBatch', (() => {
      const runIAActionSrc = extractBetween(aiActionsSrc, 'async function runIAAction(message)', '\n\n  global.AIActions = {', 'runIAAction');
      return !/applyPlanningProposal/.test(runIAActionSrc) && !/createPlanningProposalBatch/.test(runIAActionSrc);
    })());
  }

  // =====================================================================
  section('15) No duplicación de tareas (extremo a extremo, incluyendo Apply repetido)');
  // =====================================================================
  {
    const sb = makeSandbox(THU);
    sb.state.tasks.push(task({ id: 't1', estimatedMinutes: 60 }));
    const before = sb.state.tasks.length;
    const ctx = { tasks: sb.state.tasks };
    const { batch } = runFullPipeline(sb, 'planifícame mañana', { today: THU, tasks: sb.state.tasks }, ctx);
    sb.iaProposals.push(...batch.proposals);
    await sb.AIActions.applyPlanningProposal(batch.proposals[0].id, batch.batchId);
    await sb.AIActions.applyPlanningProposal(batch.proposals[0].id, batch.batchId); // repetido a propósito
    check('15a. el número de tareas nunca cambia en todo el flujo (ni una vez ni repetido)', sb.state.tasks.length === before);
    check('15b. ningún evento se creó tampoco', sb.state.events.length === 0);
    check('15c. addTask/addEvent nunca se llamaron', sb.__calls.addTask === 0 && sb.__calls.addEvent === 0);
  }

  // =====================================================================
  section('Regresión: Scheduler/reminders/Smart Forms/persistencia siguen sin tocarse desde AI-3');
  // =====================================================================
  {
    const allPlanningCode = stripComments(proposalSrc + '\n' + batchSrc + '\n' + applyDiscardSrc);
    check('R1. ningún bloque de AI-3 menciona reminders/recordatorios en el código real', !/reminder/i.test(allPlanningCode));
    check('R2. ningún bloque de AI-3 menciona Smart Forms/prefill/detectSmartFormIntent en el código real', !/SmartForm|detectSmartFormIntent|prefill/i.test(allPlanningCode));
    check('R3. ningún bloque de AI-3 llama a window.storage/saveTasks directamente (persistencia solo vía updateTask, como el resto de ai-actions.js)', !/window\.storage/.test(allPlanningCode) && !/saveTasks\(/.test(allPlanningCode));
    check('R4. js/scheduler.js no se modificó: getBusyIntervals/findConflicts siguen con una única definición', (schedulerSrc.match(/function getBusyIntervals\(/g) || []).length === 1 && (schedulerSrc.match(/function findConflicts\(/g) || []).length === 1);
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
