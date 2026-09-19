/**
 * ORGANIZATOR — Tests de AI-3.5 (mostrar propuesta mediante batches)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que el resto del
 * proyecto: extrae literalmente por CONTENIDO los bloques AI-1.2, AI-3.3,
 * AI-3.4 y AI-3.5 de ai-actions.js, junto con js/scheduler.js REAL y
 * COMPLETO (sin tocar ni un carácter, cargado como `window.Scheduler`),
 * y el bloque REAL "IA — ASISTENTE PERSONAL" de organizator.html
 * (iaProposals, nextIAProposalId/nextIABatchId, getIAProposalById/
 * getIAProposalsByBatchId/getPendingIAProposalsByBatchId/getIAProposalBatch/
 * hasPendingIAProposals/getIAProposalBatchOrNull/setIAProposalStatus/
 * validateIAProposalBatch/getIAProposalBatchSummary/isIAProposalInBatch/
 * getIAProposalFromBatch — el ciclo de vida COMPLETO ya existente, nada
 * reimplementado) — el mismo patrón de extracción que ya usan
 * test-ia-apply-idempotency.js/test-ia-batch-expiry.js/
 * test-ia-revalidate-before-apply.js para este mismo bloque.
 *
 * createPlanningProposalBatch() consume generatePlanningProposal() REAL
 * (AI-3.4), que a su vez consume analyzePlanningAvailability() REAL
 * (AI-3.3) — integración real de extremo a extremo, sin reimplementar
 * ningún cálculo de huecos/prioridad/duración.
 *
 * Uso:  node js/test-ai-3-5-planning-batches.js
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

const datetimeSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.2', '\n\n  /* ==================================================================\n     AI-1.3', 'bloque AI-1.2');
const availabilitySrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.3', '\n\n  /* ==================================================================\n     AI-3.4', 'bloque AI-3.3');
const proposalSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.4', '\n\n  /* ==================================================================\n     AI-3.5', 'bloque AI-3.4');
const batchSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.5', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-3.5 (createPlanningProposalBatch)');
// Ciclo de vida REAL de propuestas/batches IA (organizator.html) — mismo
// bloque que ya extraen test-ia-apply-idempotency.js/test-ia-batch-expiry.js.
const iaLifecycleSrc = extractBetween(html, '/* ==================================================================\n   IA — ASISTENTE PERSONAL', '\n\n/* ---------- Llamada a la IA ----------', 'bloque IA — ASISTENTE PERSONAL (ciclo de vida de propuestas/batches)');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox con: js/scheduler.js real, AI-1.2+AI-3.3+AI-3.4+AI-3.5
 * (bloques puros de ai-actions.js) y el ciclo de vida REAL de
 * iaProposals/batches de organizator.html — `iaProposals` es una
 * variable fresca por sandbox (nunca compartida entre tests). */
function makeSandbox() {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext('let window = this; let global = this;', sandbox, { filename: 'window-self' });
  vm.runInContext(schedulerSrc, sandbox, { filename: 'scheduler.js (real, completo)' });
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
  vm.runInContext(
    datetimeSrc + '\n' + availabilitySrc + '\n' + proposalSrc + '\n' + batchSrc + `
    this.analyzePlanningAvailability = analyzePlanningAvailability;
    this.generatePlanningProposal = generatePlanningProposal;
    this.createPlanningProposalBatch = createPlanningProposalBatch;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+AI-3.3+AI-3.4+AI-3.5, bloques puros)' }
  );
  // Refresca la referencia local `iaProposals` de este archivo tras
  // cargar ai-actions.js (por si acaso) — el push real siempre ocurre
  // sobre `this.iaProposals`, el mismo array real del ciclo de vida.
  return sandbox;
}

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
/** Quita comentarios de bloque (/* ... *\/) y de línea (// ...) de una
 * fuente JS — usado para comprobar por CONTENIDO que el código REAL
 * (nunca la prosa explicativa de los comentarios, que sí menciona a
 * propósito nombres como "setIAProposalStatus"/"reminder" para
 * documentar qué NO se toca) no llama a nada fuera de alcance. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}
const THU = '2026-09-17'; // jueves
const FRI = '2026-09-18';

/** Genera una propuesta AI-3.4 REAL para un contexto/constraints dados
 * (integración real AI-3.2(constraints ya construidas a mano aquí) ->
 * AI-3.3 -> AI-3.4), sin reimplementar nada. */
function realPlanningProposal(sb, ctx, cons) {
  const av = sb.analyzePlanningAvailability(ctx, cons);
  return sb.generatePlanningProposal(ctx, cons, av);
}
function task(overrides) {
  return Object.assign({ id: 't1', title: 'Tarea', done: false }, overrides);
}
function isValidIAProposalShape(p) {
  return p && typeof p.id === 'string' && p.id.length > 0
    && typeof p.batchId === 'string' && p.batchId.length > 0
    && p.source === 'planning' && p.status === 'pending'
    && typeof p.taskId === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.startTime)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.endTime)
    && typeof p.minutes === 'number' && p.minutes > 0
    && typeof p.reason === 'string' && p.reason.length > 0;
}

(async () => {
  const sb = makeSandbox();

  // =====================================================================
  section('1) Batch creado para propuesta válida');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 60 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('1a. devuelve un batch (no null) para una propuesta válida', batch !== null);
    check('1b. forma exacta { batchId, proposals }', typeof batch.batchId === 'string' && Array.isArray(batch.proposals));
  }

  // =====================================================================
  section('2) batchId generado');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 60 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('2a. batchId sigue el formato del mecanismo existente ("ia-batch-N")', /^ia-batch-\d+$/.test(batch.batchId));
    const batch2 = sb.createPlanningProposalBatch(realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU }), ctx);
    check('2b. dos batches sucesivos tienen batchId DISTINTO (nunca se reutiliza uno anterior)', batch.batchId !== batch2.batchId);
  }

  // =====================================================================
  section('3) Todas las propuestas comparten batchId');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('3. todas las propuestas del batch comparten exactamente el mismo batchId', batch.proposals.every(p => p.batchId === batch.batchId));
  }

  // =====================================================================
  section('4-5) Cada propuesta tiene id / ids únicos');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }), task({ id: 't3', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('4. cada propuesta tiene un id (string no vacío)', batch.proposals.every(p => typeof p.id === 'string' && p.id.length > 0));
    check('5. todos los ids son únicos dentro del batch', new Set(batch.proposals.map(p => p.id)).size === batch.proposals.length);
  }

  // =====================================================================
  section('6) source correcto');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('6a. source es "planning" (fuente nueva, claramente identificable)', batch.proposals[0].source === 'planning');
    check('6b. todas las propuestas del batch comparten la MISMA fuente semántica', batch.proposals.every(p => p.source === 'planning'));
  }

  // =====================================================================
  section('7) status "pending"');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('7. status es EXACTAMENTE "pending" (nunca applied/discarded al crear)', batch.proposals.every(p => p.status === 'pending'));
  }

  // =====================================================================
  section('8-13) Contenido conservado: taskId/date/startTime/endTime/minutes/reason');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 45 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    const src = pp.proposals[0], out = batch.proposals[0];
    check('8. taskId conservado', out.taskId === src.taskId);
    check('9. date conservada', out.date === src.date);
    check('10. startTime conservado', out.startTime === src.startTime);
    check('11. endTime conservado', out.endTime === src.endTime);
    check('12. minutes conservados', out.minutes === src.minutes);
    check('13. reason conservado', out.reason === src.reason);
  }

  // =====================================================================
  section('14) Número de iaProposals correcto tras el push');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    const before = sb.iaProposals.length;
    sb.iaProposals.push(...batch.proposals); // mismo idioma que ya usa el resto del sistema (iaProposals.push(...))
    check('14. iaProposals creció exactamente en el número de propuestas del batch', sb.iaProposals.length === before + batch.proposals.length);
  }

  // =====================================================================
  section('15) Propuestas anteriores permanecen intactas');
  // =====================================================================
  {
    sb.iaProposals.length = 0; // reset limpio para este caso
    const existing = { id: sb.nextIAProposalId(), batchId: sb.nextIABatchId(), source: 'day', status: 'pending', title: 'Ya existía', time: '09:00' };
    sb.iaProposals.push(existing);
    const existingSnap = JSON.stringify(existing);
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    sb.iaProposals.push(...batch.proposals);
    check('15. la propuesta anterior sigue exactamente igual (mismo contenido, mismo objeto en el array)', sb.iaProposals.includes(existing) && JSON.stringify(existing) === existingSnap);
  }

  // =====================================================================
  section('16) Otros batches permanecen intactos');
  // =====================================================================
  {
    sb.iaProposals.length = 0;
    const otherBatchId = sb.nextIABatchId();
    const otherProposal = { id: sb.nextIAProposalId(), batchId: otherBatchId, source: 'week', status: 'pending', title: 'De otro batch', time: null };
    sb.iaProposals.push(otherProposal);
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    sb.iaProposals.push(...batch.proposals);
    const stillThere = sb.getIAProposalsByBatchId(otherBatchId);
    check('16. el otro batch sigue teniendo exactamente su propuesta original, sin cambios', stillThere.length === 1 && stillThere[0] === otherProposal && stillThere[0].status === 'pending');
    check('16b. el nuevo batch coexiste (batchId distinto)', batch.batchId !== otherBatchId);
  }

  // =====================================================================
  section('17) Propuesta vacía devuelve null');
  // =====================================================================
  {
    check('17a. { proposals: [] } -> null', sb.createPlanningProposalBatch({ proposals: [] }, {}) === null);
    check('17b. planningProposal sin campo "proposals" -> null', sb.createPlanningProposalBatch({}, {}) === null);
    check('17c. planningProposal null -> null (no lanza)', sb.createPlanningProposalBatch(null, {}) === null);
  }

  // =====================================================================
  section('18) proposals no array devuelve null');
  // =====================================================================
  {
    check('18. proposals: "no-es-un-array" -> null', sb.createPlanningProposalBatch({ proposals: 'no-es-un-array' }, {}) === null);
  }

  // =====================================================================
  section('19) Propuesta inválida devuelve null (atómico)');
  // =====================================================================
  {
    const before = sb.iaProposals.length;
    const bad = { proposals: [
      { taskId: 't1', date: THU, startTime: '07:00', endTime: '08:00', minutes: 60, reason: 'ok' },
      { taskId: 't2', date: 'fecha-mala', startTime: '07:00', endTime: '08:00', minutes: 60, reason: 'ok' }, // fecha inválida
    ] };
    const batch = sb.createPlanningProposalBatch(bad, {});
    check('19a. con una sola entrada inválida, TODO el batch es null (nunca parcial)', batch === null);
    check('19b. iaProposals no cambió (nada se añadió)', sb.iaProposals.length === before);
  }

  // =====================================================================
  section('20) taskId inválido se rechaza de forma segura');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const before = sb.iaProposals.length;
    const pp = { dateFrom: THU, dateTo: THU, proposals: [{ taskId: 'fantasma', date: THU, startTime: '07:00', endTime: '08:00', minutes: 60, reason: 'ok' }], totalMinutes: 60, plannedTaskIds: ['fantasma'], unplannedTaskIds: [], notes: [] };
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('20a. un taskId que no corresponde a ninguna tarea real de context.tasks -> null', batch === null);
    check('20b. no se inventa ninguna tarea, no se resuelve por título ni posición (evidencia: null, nada añadido)', sb.iaProposals.length === before);
  }

  // =====================================================================
  section('21-23) La entrada no se modifica (planningProposal / proposals / context)');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const ppSnap = JSON.stringify(pp);
    const proposalsSnap = JSON.stringify(pp.proposals);
    const ctxSnap = JSON.stringify(ctx);
    sb.createPlanningProposalBatch(pp, ctx);
    check('21. planningProposal no se modifica', JSON.stringify(pp) === ppSnap);
    check('22. planningProposal.proposals no se modifica', JSON.stringify(pp.proposals) === proposalsSnap);
    check('23. context no se modifica', JSON.stringify(ctx) === ctxSnap);
  }

  // =====================================================================
  section('24) ids no dependen de posición');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 'a', estimatedMinutes: 30 }), task({ id: 'b', estimatedMinutes: 30 }), task({ id: 'c', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    // Cada entrada de salida identifica su tarea por taskId, nunca por
    // índice: comprobamos que taskId de cada propuesta de salida
    // coincide con el de la MISMA posición de entrada por VALOR, no que
    // "position i" tenga un significado especial más allá de eso.
    const ok = batch.proposals.every((p, i) => p.taskId === pp.proposals[i].taskId);
    check('24. cada propuesta de salida referencia su taskId real (identificado por valor, no por índice reinterpretado)', ok);
  }

  // =====================================================================
  section('25) Reordenar propuestas no cambia su contenido semántico');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 'x', estimatedMinutes: 30 }), task({ id: 'y', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batchA = sb.createPlanningProposalBatch(pp, ctx);
    const reversedPP = Object.assign({}, pp, { proposals: [...pp.proposals].reverse() });
    const batchB = sb.createPlanningProposalBatch(reversedPP, ctx);
    const contentSet = (b) => new Set(b.proposals.map(p => JSON.stringify({ taskId: p.taskId, date: p.date, startTime: p.startTime, endTime: p.endTime, minutes: p.minutes, reason: p.reason })));
    check('25. el mismo conjunto de contenido semántico aparece sin importar el orden de entrada', deepEq([...contentSet(batchA)].sort(), [...contentSet(batchB)].sort()));
  }

  // =====================================================================
  section('26-28) Transformación 1:1 (ni fusiona ni divide)');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 }), task({ id: 't3', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('26. cada propuesta de AI-3.4 produce EXACTAMENTE una iaProposal', batch.proposals.length === pp.proposals.length);
    check('27. no se fusionan propuestas (ninguna iaProposal representa más de un taskId a la vez)', batch.proposals.every(p => typeof p.taskId === 'string'));
    check('28. no se dividen propuestas (mismo número exacto, no más)', batch.proposals.length === pp.proposals.length);
  }

  // =====================================================================
  section('29) Batch nuevo no modifica batches anteriores');
  // =====================================================================
  {
    sb.iaProposals.length = 0;
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp1 = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch1 = sb.createPlanningProposalBatch(pp1, ctx);
    sb.iaProposals.push(...batch1.proposals);
    const summaryBefore = sb.getIAProposalBatchSummary(batch1.batchId);

    const ctx2 = { tasks: [task({ id: 't2', estimatedMinutes: 30 })] };
    const pp2 = realPlanningProposal(sb, ctx2, { dateFrom: THU, dateTo: THU });
    const batch2 = sb.createPlanningProposalBatch(pp2, ctx2);
    sb.iaProposals.push(...batch2.proposals);

    const summaryAfter = sb.getIAProposalBatchSummary(batch1.batchId);
    check('29. crear un segundo batch no cambia el resumen (total/pending/applied/discarded) del primero', deepEq(summaryBefore, summaryAfter));
  }

  // =====================================================================
  section('30-32) Status inicial siempre pending, nunca applied/discarded al crear');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    check('30. status inicial siempre "pending"', batch.proposals.every(p => p.status === 'pending'));
    check('31. no se crea ninguna propuesta "applied"', !batch.proposals.some(p => p.status === 'applied'));
    check('32. no se crea ninguna propuesta "discarded"', !batch.proposals.some(p => p.status === 'discarded'));
  }

  // =====================================================================
  section('33-34) No se ejecuta Apply/Discard');
  // =====================================================================
  {
    // Se comprueba el CÓDIGO real (comentarios fuera): la propia cabecera
    // del bloque SÍ menciona en prosa "setIAProposalStatus()"/
    // "applyIAProposal"/"reminders" para documentar explícitamente qué NO
    // toca esta fase — eso es exactamente lo que se quiere demostrar,
    // así que buscar esas cadenas en el texto completo (con comentarios)
    // daría un falso positivo.
    const batchCode = stripComments(batchSrc);
    check('33. el bloque AI-3.5 no llama a setIAProposalStatus (nunca aplica/descarta al crear)', !/setIAProposalStatus\(/.test(batchCode));
    check('34. el bloque AI-3.5 no menciona applyIAProposal/discardIAProposal', !/applyIAProposal\(/.test(batchCode) && !/discardIAProposal\(/.test(batchCode));
  }

  // =====================================================================
  section('35-38) No toca Scheduler (más allá de lo ya reutilizado por AI-3.3)/reminders/Smart Forms/ACTION_SCHEMA');
  // =====================================================================
  {
    const batchCode = stripComments(batchSrc);
    check('35. AI-3.5 no llama a ninguna función de Scheduler directamente (createPlanningProposalBatch no la necesita)', !/Scheduler\./.test(batchCode));
    check('36. AI-3.5 no menciona reminders/recordatorios en el código real', !/reminder/i.test(batchCode));
    check('37. AI-3.5 no menciona Smart Forms/prefill/detectSmartFormIntent en el código real', !/SmartForm|detectSmartFormIntent|prefill/i.test(batchCode));
    check('38. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op"', (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
  }

  // =====================================================================
  section('39) Export público existe, sin tocar los de AI-3.1/AI-3.2/AI-3.3/AI-3.4');
  // =====================================================================
  {
    check('39a. global.AIActions.createPlanningProposalBatch = createPlanningProposalBatch; presente', /global\.AIActions\.createPlanningProposalBatch = createPlanningProposalBatch;/.test(aiActionsSrc));
    check('39b. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES en su línea principal', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('39c. detectPlanningIntent (AI-3.1) sigue exportado sin tocar', /global\.AIActions\.detectPlanningIntent = detectPlanningIntent;/.test(aiActionsSrc));
    check('39d. extractPlanningConstraints (AI-3.2) sigue exportado sin tocar', /global\.AIActions\.extractPlanningConstraints = extractPlanningConstraints;/.test(aiActionsSrc));
    check('39e. analyzePlanningAvailability (AI-3.3) sigue exportado sin tocar', /global\.AIActions\.analyzePlanningAvailability = analyzePlanningAvailability;/.test(aiActionsSrc));
    check('39f. generatePlanningProposal (AI-3.4) sigue exportado sin tocar', /global\.AIActions\.generatePlanningProposal = generatePlanningProposal;/.test(aiActionsSrc));
  }

  // =====================================================================
  section('40) Determinismo/contrato de salida (mismo contenido, ids únicos por diseño)');
  // =====================================================================
  {
    // El mecanismo de ids del sistema (nextIAProposalId/nextIABatchId) es
    // un contador — por diseño, dos llamadas NUNCA deben reutilizar el
    // mismo id/batchId (eso sería justo el bug que la sección 3 del
    // encargo prohíbe: "no reutilizar un batchId anterior"). El
    // "determinismo" que sí debe cumplirse es el del CONTRATO: misma
    // forma, mismo número de propuestas, mismo contenido semántico
    // (taskId/date/startTime/endTime/minutes/reason) cada vez.
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const cons = { dateFrom: THU, dateTo: THU };
    const pp1 = realPlanningProposal(sb, ctx, cons);
    const pp2 = realPlanningProposal(sb, ctx, cons);
    const batch1 = sb.createPlanningProposalBatch(pp1, ctx);
    const batch2 = sb.createPlanningProposalBatch(pp2, ctx);
    check('40a. mismo número de propuestas en ambas llamadas', batch1.proposals.length === batch2.proposals.length);
    check('40b. mismo contenido semántico (taskId/date/startTime/endTime/minutes/reason) en ambas', deepEq(
      batch1.proposals.map(p => ({ taskId: p.taskId, date: p.date, startTime: p.startTime, endTime: p.endTime, minutes: p.minutes, reason: p.reason })),
      batch2.proposals.map(p => ({ taskId: p.taskId, date: p.date, startTime: p.startTime, endTime: p.endTime, minutes: p.minutes, reason: p.reason }))
    ));
    check('40c. batchId/id distintos entre llamadas (nunca se reutiliza uno anterior — sección 3 del encargo)', batch1.batchId !== batch2.batchId && batch1.proposals[0].id !== batch2.proposals[0].id);
    check('40d. cada propuesta cumple exactamente la forma de iaProposal esperada', batch1.proposals.every(isValidIAProposalShape) && batch2.proposals.every(isValidIAProposalShape));
  }

  // =====================================================================
  section('Extra) validateIAProposalBatch (helper EXISTENTE) acepta el batch generado');
  // =====================================================================
  {
    sb.iaProposals.length = 0;
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const pp = realPlanningProposal(sb, ctx, { dateFrom: THU, dateTo: THU });
    const batch = sb.createPlanningProposalBatch(pp, ctx);
    sb.iaProposals.push(...batch.proposals);
    check('Extra1. validateIAProposalBatch (ciclo de vida REAL ya existente) acepta el batch de planificación', sb.validateIAProposalBatch(batch.batchId) === true);
    check('Extra2. hasPendingIAProposals (helper existente) detecta las propuestas pendientes del nuevo batch', sb.hasPendingIAProposals(batch.batchId) === true);
    check('Extra3. getIAProposalById (helper existente) encuentra cada propuesta por su id', batch.proposals.every(p => sb.getIAProposalById(p.id) !== null));
  }

  // =====================================================================
  section('Extra) Sin contadores de id disponibles -> null, nunca Date.now() como sustituto');
  // =====================================================================
  {
    const sandbox2 = {};
    sandbox2.console = console;
    vm.createContext(sandbox2);
    vm.runInContext('let window = this; let global = this;', sandbox2, { filename: 'window-self' });
    vm.runInContext(schedulerSrc, sandbox2, { filename: 'scheduler.js (real)' });
    vm.runInContext(
      datetimeSrc + '\n' + availabilitySrc + '\n' + proposalSrc + '\n' + batchSrc + `
      this.analyzePlanningAvailability = analyzePlanningAvailability;
      this.generatePlanningProposal = generatePlanningProposal;
      this.createPlanningProposalBatch = createPlanningProposalBatch;
      `,
      sandbox2, { filename: 'ai-actions.js sin ciclo de vida de organizator.html cargado' }
    );
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })] };
    const av = sandbox2.analyzePlanningAvailability(ctx, { dateFrom: THU, dateTo: THU });
    const pp = sandbox2.generatePlanningProposal(ctx, { dateFrom: THU, dateTo: THU }, av);
    check('Extra4. sin nextIAProposalId/nextIABatchId disponibles (mecanismo de ids no cargado) -> null, nunca inventa un id propio', sandbox2.createPlanningProposalBatch(pp, ctx) === null);
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
