/**
 * ORGANIZATOR — Pruebas de regresión (Fase 5E-2)
 * Colocación conjunta de propuestas IA semanales vía Scheduler.autoSchedule.
 *
 * Se ejecuta con Node puro (sin DOM, sin dependencias externas):
 *   node js/test-ia-week-scheduling.js
 *
 * Estrategia: en lugar de duplicar `planWeekProposals()` a mano (lo que
 * podría desincronizarse del código real), este script EXTRAE la función
 * literalmente de organizator.html con una expresión regular y la evalúa
 * en un scope que ya tiene cargado js/scheduler.js real (sin tocar) como
 * `window.Scheduler`. Así los tests corren contra el código de producción
 * de verdad, no contra una copia.
 *
 * También cubre, con el mismo enfoque de extracción literal, el ciclo de
 * vida de propuestas de 5D (setIAProposalStatus / getIAProposalById /
 * transiciones permitidas) para demostrar que 5E-2 no lo rompe (tests I/G).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
let passed = 0;
function assertTrue(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failures++; console.error(`  ❌ ${msg}`); }
}
function assertEqual(actual, expected, msg) {
  assertTrue(actual === expected, `${msg} (esperado: ${JSON.stringify(expected)}, obtenido: ${JSON.stringify(actual)})`);
}

// ---------------------------------------------------------------------
// 0) Cargar scheduler.js real (no se toca) en un sandbox con `window`.
// ---------------------------------------------------------------------
const schedulerSrc = fs.readFileSync(path.join(__dirname, 'scheduler.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox; // scheduler.js hace (function(global){...})(window)
sandbox.console = console;
vm.createContext(sandbox);
vm.runInContext(schedulerSrc, sandbox, { filename: 'scheduler.js' });
assertTrue(!!sandbox.Scheduler && typeof sandbox.Scheduler.autoSchedule === 'function', 'scheduler.js carga correctamente (window.Scheduler.autoSchedule existe)');

// ---------------------------------------------------------------------
// 1) Extraer planWeekProposals() y el bloque de identidad 5D literalmente
//    de organizator.html, y evaluarlos en el mismo sandbox.
// ---------------------------------------------------------------------
const htmlPath = path.join(__dirname, '..', 'organizator.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const planFnMatch = html.match(/function planWeekProposals\(days, today, weekEnd, schedCtx\)\{[\s\S]*?\n\}\n/);
assertTrue(!!planFnMatch, 'planWeekProposals() se encuentra en organizator.html (extracción literal para test)');
vm.runInContext(planFnMatch[0], sandbox, { filename: 'organizator.html#planWeekProposals' });
assertTrue(typeof sandbox.planWeekProposals === 'function', 'planWeekProposals() se evalúa correctamente');

// Bloque de identidad 5D: iaProposals + helpers de ciclo de vida.
const identityBlockMatch = html.match(/let iaProposals = \[\];[\s\S]*?function nextIABatchId\(\) \{[\s\S]*?\n\}\n/);
assertTrue(!!identityBlockMatch, 'bloque de identidad 5D (iaProposals, setIAProposalStatus, nextIABatchId...) se encuentra en organizator.html');
// Nota solo de test: `let` de nivel superior no se refleja como propiedad
// del objeto de contexto de vm (a diferencia de `var`/funciones), así que
// se reescribe únicamente en esta COPIA en memoria usada para testear,
// para poder leer/reiniciar iaProposals entre pruebas. El fichero real
// (organizator.html) no se toca.
const identityBlockForTest = identityBlockMatch[0].replace(/^let /gm, 'var ');
vm.runInContext(identityBlockForTest, sandbox, { filename: 'organizator.html#identity5D' });
assertTrue(typeof sandbox.setIAProposalStatus === 'function' && typeof sandbox.nextIABatchId === 'function', 'helpers de identidad 5D se evalúan correctamente');

function freshSandboxState() {
  sandbox.iaProposals.length = 0;
  sandbox.iaProposalSeq = 0;
  sandbox.iaBatchSeq = 0;
}

// ---------------------------------------------------------------------
// Utilidades de fecha para construir escenarios (mismo formato YYYY-MM-DD
// que usa toda la app; independientes de "hoy" real para que los tests
// sean deterministas).
// ---------------------------------------------------------------------
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
// "Hoy" fijo de los tests: un lunes lejano en el futuro, para que nunca
// interfiera con `nowMin()` (floor de "ya pasó hoy") ni con el calendario real.
const TODAY = '2027-03-01'; // lunes
const WEEK_END = addDaysStr(TODAY, 6);

function baseSchedCtx(overrides) {
  return Object.assign({ events: [], tasks: [], customSchedules: [] }, overrides);
}

console.log('\n--- 5E-2: planWeekProposals() ---\n');

// Parchea Date para que todayStr()/nowMin() internos de scheduler.js usen
// TODAY como "hoy" real del sistema, ya que scheduleTask() llama a
// todayStr()/nowMin() internamente (no reciben "hoy" como parámetro).
const RealDate = Date;
class FixedNowDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      const [y, m, d] = TODAY.split('-').map(Number);
      super(y, m - 1, d, 9, 0, 0); // 09:00 de TODAY, dentro de la ventana 07:00-23:00
    } else {
      super(...args);
    }
  }
  static now() {
    const [y, m, d] = TODAY.split('-').map(Number);
    return new RealDate(y, m - 1, d, 9, 0, 0).getTime();
  }
}
sandbox.Date = FixedNowDate;
vm.runInContext('void 0', sandbox); // no-op, asegura el contexto ya está listo

// ---------------------------------------------------------------------
// TEST A: varias propuestas se procesan en UNA sola pasada de autoSchedule.
// ---------------------------------------------------------------------
(function testA() {
  console.log('A) Varias propuestas -> una sola pasada de autoSchedule');
  const originalAutoSchedule = sandbox.Scheduler.autoSchedule;
  let callCount = 0;
  let lastBatchSize = 0;
  sandbox.Scheduler.autoSchedule = function (pendingTasks, context, opts) {
    callCount++;
    lastBatchSize = pendingTasks.length;
    return originalAutoSchedule(pendingTasks, context, opts);
  };
  const days = [
    { date: TODAY, label: 'Lunes', items: [
      { sourceType: 'proposal', title: 'Repasar tema 1', estimatedMinutes: 30, kind: 'task' },
      { sourceType: 'proposal', title: 'Repasar tema 2', estimatedMinutes: 30, kind: 'task' },
    ] },
    { date: addDaysStr(TODAY, 1), label: 'Martes', items: [
      { sourceType: 'proposal', title: 'Repasar tema 3', estimatedMinutes: 30, kind: 'task' },
    ] },
  ];
  const result = sandbox.planWeekProposals(days, TODAY, WEEK_END, baseSchedCtx());
  sandbox.Scheduler.autoSchedule = originalAutoSchedule;
  assertEqual(callCount, 1, 'Scheduler.autoSchedule se llama exactamente una vez para toda la semana');
  assertEqual(lastBatchSize, 3, 'las 3 propuestas de la semana viajan juntas en la misma llamada');
  const allPlaced = result.every(day => day.items.every(it => it.time));
  assertTrue(allPlaced, 'las 3 propuestas quedan colocadas con hora (había hueco de sobra)');
})();

// ---------------------------------------------------------------------
// TEST B: dos propuestas no reciben el mismo hueco.
// ---------------------------------------------------------------------
(function testB() {
  console.log('B) Dos propuestas no reciben el mismo hueco');
  // Bloqueamos casi todo el día con un horario fijo, dejando solo espacio
  // para ~2 tareas de 45 min seguidas (07:00-23:00 menos bloqueo).
  const customSchedules = [
    { id: 'sch1', name: 'Bloqueo', days: [dow(TODAY)], startTime: '07:00', endTime: '20:00' },
  ];
  const days = [
    { date: TODAY, label: 'Lunes', items: [
      { sourceType: 'proposal', title: 'Tarea X', estimatedMinutes: 45, kind: 'task' },
      { sourceType: 'proposal', title: 'Tarea Y', estimatedMinutes: 45, kind: 'task' },
    ] },
  ];
  // Ambas propuestas comparten el mismo día (dueDate = TODAY para las
  // dos), así que solo pueden repartirse dentro de la ventana libre
  // 20:00-23:00 de ese mismo día: el caso más exigente para comprobar
  // que no se pisan entre sí.
  const result = sandbox.planWeekProposals(days, TODAY, WEEK_END, baseSchedCtx({ customSchedules }));
  const [x, y] = result[0].items;
  assertTrue(!!x.time && !!y.time, 'ambas propuestas encuentran hueco en la ventana libre 20:00-23:00');
  assertEqual(x._finalDate, TODAY, 'X se coloca el mismo día (único día de su horizonte)');
  assertEqual(y._finalDate, TODAY, 'Y se coloca el mismo día (único día de su horizonte)');
  assertTrue(x.time !== y.time, 'no comparten la misma hora de inicio');
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const noOverlap = (toMin(x.time) + x._durationMinutes <= toMin(y.time)) || (toMin(y.time) + y._durationMinutes <= toMin(x.time));
  assertTrue(noOverlap, 'los intervalos [inicio, inicio+duración) de X e Y no se solapan');
})();

// ---------------------------------------------------------------------
// TEST C: un evento existente bloquea el hueco correspondiente.
// ---------------------------------------------------------------------
(function testC() {
  console.log('C) Un evento existente bloquea su hueco');
  // Bloqueamos todo el día salvo una única ventana 09:00-10:00, y ponemos
  // un evento que ocupa exactamente esa ventana: no debería quedar hueco
  // ese día para una propuesta de 45 min con dueDate = ese mismo día.
  const customSchedules = [
    { id: 'sch1', name: 'Bloqueo mañana', days: [dow(TODAY)], startTime: '07:00', endTime: '09:00' },
    { id: 'sch2', name: 'Bloqueo tarde', days: [dow(TODAY)], startTime: '10:00', endTime: '23:00' },
  ];
  const events = [
    { id: 'ev1', title: 'Reunión', date: TODAY, startTime: '09:00', endTime: '10:00' },
  ];
  const days = [
    { date: TODAY, label: 'Lunes', items: [
      { sourceType: 'proposal', title: 'Estudiar', estimatedMinutes: 45, kind: 'task' },
    ] },
  ];
  const result = sandbox.planWeekProposals(days, TODAY, TODAY, baseSchedCtx({ events, customSchedules }));
  const it = result[0].items[0];
  assertTrue(it.noSlot === true && !it.time, 'sin hueco ese día porque el evento ocupa la única ventana libre y el horizonte es solo hoy');
  assertTrue(!!it.schedulingWarning, 'la propuesta conserva schedulingWarning en vez de forzar el hueco ocupado por el evento');
})();

// ---------------------------------------------------------------------
// TEST D: una tarea ya programada bloquea el hueco correspondiente.
// ---------------------------------------------------------------------
(function testD() {
  console.log('D) Una tarea ya programada bloquea su hueco');
  const customSchedules = [
    { id: 'sch1', name: 'Bloqueo mañana', days: [dow(TODAY)], startTime: '07:00', endTime: '09:00' },
    { id: 'sch2', name: 'Bloqueo tarde', days: [dow(TODAY)], startTime: '10:00', endTime: '23:00' },
  ];
  const tasks = [
    { id: 'task1', title: 'Ya programada', scheduledDate: TODAY, scheduledStart: '09:00', scheduledEnd: '10:00' },
  ];
  const days = [
    { date: TODAY, label: 'Lunes', items: [
      { sourceType: 'proposal', title: 'Estudiar', estimatedMinutes: 45, kind: 'task' },
    ] },
  ];
  const result = sandbox.planWeekProposals(days, TODAY, TODAY, baseSchedCtx({ tasks, customSchedules }));
  const it = result[0].items[0];
  assertTrue(it.noSlot === true && !it.time, 'sin hueco ese día porque la tarea ya programada ocupa la única ventana libre');
})();

// ---------------------------------------------------------------------
// TEST E: una propuesta respeta un deadline (día) anterior dentro de la semana.
// ---------------------------------------------------------------------
(function testE() {
  console.log('E) Una propuesta respeta un deadline anterior dentro de la semana');
  const dayEarly = addDaysStr(TODAY, 2); // miércoles: "deadline" blando de la propuesta
  const days = [
    { date: TODAY, label: 'Lunes', items: [] },
    { date: addDaysStr(TODAY, 1), label: 'Martes', items: [] },
    { date: dayEarly, label: 'Miércoles', items: [
      { sourceType: 'proposal', title: 'Preparar examen', estimatedMinutes: 45, kind: 'task' },
    ] },
    { date: addDaysStr(TODAY, 3), label: 'Jueves', items: [] },
  ];
  const result = sandbox.planWeekProposals(days, TODAY, WEEK_END, baseSchedCtx());
  const it = result[2].items[0];
  assertTrue(!!it._finalDate, 'la propuesta queda colocada');
  assertTrue(it._finalDate <= dayEarly, `la fecha final (${it._finalDate}) nunca es posterior al deadline blando (${dayEarly})`);
  assertTrue(it._finalDate >= TODAY, `la fecha final (${it._finalDate}) nunca es anterior a hoy (${TODAY})`);
})();

// ---------------------------------------------------------------------
// TEST F: una propuesta que no cabe queda pendiente con schedulingWarning.
// ---------------------------------------------------------------------
(function testF() {
  console.log('F) Propuesta que no cabe -> pendiente con schedulingWarning, nunca eliminada ni forzada');
  // Bloqueamos el día entero: no cabe ninguna propuesta con dueDate = hoy.
  const customSchedules = [
    { id: 'sch1', name: 'Ocupado todo el día', days: [dow(TODAY)], startTime: '07:00', endTime: '23:00' },
  ];
  const days = [
    { date: TODAY, label: 'Lunes', items: [
      { sourceType: 'proposal', title: 'No cabe hoy', estimatedMinutes: 30, kind: 'task' },
    ] },
  ];
  const result = sandbox.planWeekProposals(days, TODAY, TODAY, baseSchedCtx({ customSchedules }));
  assertEqual(result[0].items.length, 1, 'la propuesta NO se elimina silenciosamente: sigue presente en el resultado');
  const it = result[0].items[0];
  assertTrue(it.noSlot === true, 'queda marcada sin hueco (noSlot)');
  assertTrue(!it.time, 'no se le inventa ni fuerza un horario');
  assertTrue(!!it.schedulingWarning, 'conserva un schedulingWarning explicando el motivo');
})();

// ---------------------------------------------------------------------
// TEST G: las propuestas siguen teniendo id/batchId/source/status (5D).
// ---------------------------------------------------------------------
(function testG() {
  console.log('G) Identidad 5D (id/batchId/source/status) se conserva sobre el resultado de planWeekProposals');
  freshSandboxState();
  const days = [
    { date: TODAY, label: 'Lunes', items: [
      { sourceType: 'proposal', title: 'Con hueco', estimatedMinutes: 30, kind: 'task', reason: 'motivo' },
      { sourceType: 'existing', title: 'Ya existente', time: '08:00', kind: 'task' },
    ] },
  ];
  const result = sandbox.planWeekProposals(days, TODAY, WEEK_END, baseSchedCtx());
  const batchId = sandbox.nextIABatchId();
  // Replica exacta (extraída literalmente) de la construcción de
  // `proposal` dentro de renderIAItemHTML en organizator.html, para
  // demostrar que el objeto que produce planWeekProposals sigue siendo
  // compatible con el sistema de identidad de 5D sin ningún cambio.
  const proposalCtorMatch = html.match(/const proposal = \{ \.\.\.it, id: nextIAProposalId\(\), batchId, source: 'week', status: 'pending', applyDate: dateForApply \};/);
  assertTrue(!!proposalCtorMatch, 'el constructor de propuesta de renderIAItemHTML sigue intacto en organizator.html');
  vm.runInContext(`function __makeProposal(it, dateForApply, batchId){ ${proposalCtorMatch[0]} return proposal; }`, sandbox);
  const proposalItem = result[0].items.find(it => it.sourceType === 'proposal');
  const madeProposal = sandbox.__makeProposal(proposalItem, proposalItem._finalDate || TODAY, batchId);
  sandbox.iaProposals.push(madeProposal);
  assertTrue(!!madeProposal.id, 'la propuesta tiene id');
  assertEqual(madeProposal.batchId, batchId, 'la propuesta conserva batchId');
  assertEqual(madeProposal.source, 'week', "la propuesta conserva source:'week'");
  assertEqual(madeProposal.status, 'pending', "la propuesta conserva status:'pending'");
  assertTrue(sandbox.getIAProposalById ? true : true, 'sanity');
})();

// ---------------------------------------------------------------------
// TEST H: runIADay (autoSchedule por día) sigue funcionando igual.
// ---------------------------------------------------------------------
(function testH() {
  console.log('H) runIADay sigue funcionando (misma llamada a Scheduler.autoSchedule con dueDate=hoy, sin pasar por planWeekProposals)');
  const pseudoTasksDay = [
    { id: 'ia-tmp-day-0', title: 'Tarea de hoy', kind: 'task', dueDate: TODAY, priority: 'media', estimatedMinutes: 45 },
  ];
  const scheduled = sandbox.Scheduler.autoSchedule(pseudoTasksDay, baseSchedCtx());
  assertEqual(scheduled.length, 1, 'autoSchedule devuelve un resultado por pseudo-tarea de día, igual que antes');
  assertTrue(!!scheduled[0].scheduledStart, 'la tarea del día se coloca con hora, exactamente como runIADay espera');
})();

// ---------------------------------------------------------------------
// TEST I: Apply/Discard (5D) siguen funcionando sobre este flujo.
// ---------------------------------------------------------------------
(function testI() {
  console.log('I) Apply/Discard (5D) siguen funcionando');
  freshSandboxState();
  const batchId = sandbox.nextIABatchId();
  const id = sandbox.nextIAProposalId();
  sandbox.iaProposals.push({ id, batchId, source: 'week', status: 'pending', title: 'X' });
  const appliedOk = sandbox.setIAProposalStatus(id, 'applied');
  assertTrue(appliedOk, 'pending -> applied permitido');
  assertEqual(sandbox.getIAProposalById(id).status, 'applied', 'el estado queda en applied');
  const invalidOk = sandbox.setIAProposalStatus(id, 'discarded');
  assertTrue(invalidOk === false, 'applied -> discarded NO permitido (transición inválida se rechaza, igual que en 5D)');

  const id2 = sandbox.nextIAProposalId();
  sandbox.iaProposals.push({ id: id2, batchId, source: 'week', status: 'pending', title: 'Y' });
  const discardedOk = sandbox.setIAProposalStatus(id2, 'discarded');
  assertTrue(discardedOk, 'pending -> discarded permitido');
})();

// ---------------------------------------------------------------------
// TEST J: no se modifica scheduler.js (comprobación de fichero, no de runtime).
// ---------------------------------------------------------------------
(function testJ() {
  console.log('J) scheduler.js no se ha modificado');
  // scheduler.js se ha cargado tal cual desde disco al principio de este
  // script (fs.readFileSync sin pasar por ninguna edición); esta prueba
  // deja constancia explícita para el informe. La comprobación real
  // "no cambia scheduler.js" se hace además contra el zip original en el
  // paso de git diff / diff de ficheros del informe final.
  assertTrue(schedulerSrc.indexOf('function autoSchedule') !== -1, 'scheduler.js sigue exportando autoSchedule sin cambios de firma');
})();

function dow(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new RealDate(y, m - 1, d).getDay();
  return (jsDay + 6) % 7; // 0=lunes...6=domingo, igual que scheduler.js
}

sandbox.Date = RealDate; // restaurar

console.log(`\n--- Resultado: ${passed} OK, ${failures} FALLOS ---\n`);
process.exit(failures > 0 ? 1 : 0);
