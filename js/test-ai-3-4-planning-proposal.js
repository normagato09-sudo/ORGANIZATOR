/**
 * ORGANIZATOR — Tests de AI-3.4 (generar propuesta de planificación)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que el resto del
 * proyecto: extrae literalmente por CONTENIDO los bloques AI-1.2, AI-3.3
 * y AI-3.4 de ai-actions.js, junto con js/scheduler.js REAL y COMPLETO
 * (sin tocar ni un carácter, cargado como `window.Scheduler`, igual que
 * en producción), y ejecuta generatePlanningProposal() aislado en un
 * sandbox `vm`, sin mocks.
 *
 * generatePlanningProposal() consume analyzePlanningAvailability() REAL
 * (AI-3.3) para producir el `availability` de entrada en la mayoría de
 * los tests (evita construir a mano la forma exacta de availableSlots
 * en cada caso y prueba la integración real AI-3.2->AI-3.3->AI-3.4), y
 * también se prueba con objetos `availability` construidos a mano donde
 * hace falta cubrir un caso que analyzePlanningAvailability no produce
 * de forma natural (p.ej. "availability inválida").
 *
 * Es una función PURA: no lee `state`, no toca el DOM, no llama a
 * callAI, no toca Scheduler más allá de sus piezas puras (igual que
 * AI-3.3), no toca batches/iaProposals/reminders/Smart Forms/
 * recurrencia/ACTION_SCHEMA.
 *
 * Uso:  node js/test-ai-3-4-planning-proposal.js
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
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8').replace(/\r\n/g, '\n');
const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en ai-actions.js — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en ai-actions.js — ¿cambió el código?`);
  return source.slice(start, end);
}

const datetimeSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.2', '\n\n  /* ==================================================================\n     AI-1.3', 'bloque AI-1.2');
const availabilitySrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.3', '\n\n  /* ==================================================================\n     AI-3.4', 'bloque AI-3.3 (analyzePlanningAvailability)');
const proposalSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.4', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-3.4 (generatePlanningProposal)');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

function makeSandbox() {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext('let window = this; let global = this;', sandbox, { filename: 'window-self' });
  vm.runInContext(schedulerSrc, sandbox, { filename: 'scheduler.js (real, completo)' });
  vm.runInContext(
    datetimeSrc + '\n' + availabilitySrc + '\n' + proposalSrc + `
    this.analyzePlanningAvailability = analyzePlanningAvailability;
    this.generatePlanningProposal = generatePlanningProposal;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+AI-3.3+AI-3.4, bloques puros)' }
  );
  return sandbox;
}

const sb = makeSandbox();
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
const EMPTY = { dateFrom: null, dateTo: null, proposals: [], totalMinutes: 0, plannedTaskIds: [], unplannedTaskIds: [], notes: [] };
// 2026-09-17 es jueves (dow=3, convención 0=lunes..6=domingo).
const THU = '2026-09-17';
const FRI = '2026-09-18';
const SAT = '2026-09-19';
const SUN = '2026-09-20';
const MON = '2026-09-14';

/** Atajo: calcula availability REAL (AI-3.3) y luego la propuesta
 * (AI-3.4) — integración real, sin construir availableSlots a mano. */
function propose(context, constraints) {
  const availability = sb.analyzePlanningAvailability(context, constraints);
  return sb.generatePlanningProposal(context, constraints, availability);
}
function task(overrides) {
  return Object.assign({ id: 't1', title: 'Tarea', done: false }, overrides);
}
function isValidProposalShape(p) {
  return p && typeof p.taskId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(p.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.endTime) &&
    typeof p.minutes === 'number' && p.minutes > 0 && typeof p.reason === 'string' && p.reason.length > 0 &&
    Object.keys(p).sort().join(',') === 'date,endTime,minutes,reason,startTime,taskId';
}

(async () => {

  // =====================================================================
  section('1) Propuesta simple de una tarea');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: THU });
    check('1a. genera exactamente una propuesta', r.proposals.length === 1);
    check('1b. forma exacta (taskId/date/startTime/endTime/minutes/reason, nada más)', isValidProposalShape(r.proposals[0]));
    check('1c. plannedTaskIds contiene el id', deepEq(r.plannedTaskIds, ['t1']));
    check('1d. unplannedTaskIds vacío', deepEq(r.unplannedTaskIds, []));
  }

  // =====================================================================
  section('2) Varias tareas');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 }), task({ id: 't2', estimatedMinutes: 30 })] }, { dateFrom: THU, dateTo: THU });
    check('2a. ambas tareas quedan planificadas', deepEq(r.plannedTaskIds, ['t1', 't2']));
    check('2b. dos propuestas, sin solaparse', r.proposals.length === 2 && r.proposals[0].endTime <= r.proposals[1].startTime);
  }

  // =====================================================================
  section('3) Tareas ordenadas');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'b', estimatedMinutes: 30 }), task({ id: 'a', estimatedMinutes: 30 })] }, { dateFrom: THU, dateTo: THU });
    check('3. sin priority explícita, orden base determinista por fecha límite/id (aquí ambas sin fecha límite -> por id: "a" antes que "b")', r.proposals[0].taskId === 'a' && r.proposals[1].taskId === 'b');
  }

  // =====================================================================
  section('4) Tareas desordenadas producen mismo resultado');
  // =====================================================================
  {
    const tasks = [task({ id: 'x', estimatedMinutes: 30 }), task({ id: 'y', estimatedMinutes: 30 }), task({ id: 'z', estimatedMinutes: 30 })];
    const cons = { dateFrom: THU, dateTo: THU };
    const r1 = propose({ tasks }, cons);
    const r2 = propose({ tasks: [...tasks].reverse() }, cons);
    const r3 = propose({ tasks: [tasks[1], tasks[2], tasks[0]] }, cons);
    check('4. mismo resultado exacto con los arrays reordenados', deepEq(r1, r2) && deepEq(r1, r3));
  }

  // =====================================================================
  section('5) Tarea completada no se planifica');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'done1', estimatedMinutes: 60, done: true })] }, { dateFrom: THU, dateTo: THU });
    check('5. una tarea con done:true nunca se planifica ni aparece en unplannedTaskIds', r.proposals.length === 0 && !r.plannedTaskIds.includes('done1') && !r.unplannedTaskIds.includes('done1'));
  }

  // =====================================================================
  section('6) Tarea cancelada no se planifica');
  // =====================================================================
  {
    // ORGANIZATOR no tiene un estado "cancelada" propio en el modelo de
    // tareas (cancelar una tarea existente, AI-1.5, la BORRA vía
    // deleteTask — ver applyCancelItem en este mismo archivo): una
    // tarea "cancelada" simplemente ya no está en context.tasks. Se
    // simula aquí tal cual (ausente del array) — no se inventa un campo
    // "cancelled" que ORGANIZATOR no tiene.
    const r = propose({ tasks: [task({ id: 'otra', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: THU });
    check('6. una tarea "cancelada" (ausente de context.tasks, tal como la deja deleteTask) nunca aparece en la propuesta', !r.plannedTaskIds.includes('cancelada-inexistente') && !r.unplannedTaskIds.includes('cancelada-inexistente'));
  }

  // =====================================================================
  section('7) Tarea sin duración');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'sindur', estimatedMinutes: undefined })] }, { dateFrom: THU, dateTo: THU });
    check('7a. sin estimatedMinutes válido -> unplannedTaskIds, nunca inventa una duración', deepEq(r.unplannedTaskIds, ['sindur']));
    check('7b. explica el motivo en notes', r.notes.some(n => /duraci[oó]n/i.test(n)));
  }

  // =====================================================================
  section('8) Tarea con duración');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'condur', estimatedMinutes: 45 })] }, { dateFrom: THU, dateTo: THU });
    check('8. con estimatedMinutes válido -> se planifica con esos minutos exactos', r.proposals.length === 1 && r.proposals[0].minutes === 45);
  }

  // =====================================================================
  section('9) Hueco exacto');
  // =====================================================================
  {
    // Jornada completa del día (07:00-23:00 = 960 min); pedimos EXACTAMENTE 960.
    const r = propose({ tasks: [task({ id: 'exacto', estimatedMinutes: 960 })] }, { dateFrom: THU, dateTo: THU });
    check('9. una tarea que ocupa EXACTAMENTE el hueco disponible se planifica en una sola propuesta', r.proposals.length === 1 && r.proposals[0].minutes === 960 && r.proposals[0].startTime === '07:00' && r.proposals[0].endTime === '23:00');
  }

  // =====================================================================
  section('10) Hueco mayor');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'corta', estimatedMinutes: 30 })] }, { dateFrom: THU, dateTo: THU });
    check('10. un hueco mayor que la duración necesaria deja el resto disponible para otras tareas (no lo consume entero)', r.proposals[0].minutes === 30 && r.proposals[0].endTime !== '23:00');
  }

  // =====================================================================
  section('11) Hueco insuficiente');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'gigante', estimatedMinutes: 2000 })] }, { dateFrom: THU, dateTo: THU });
    check('11. si ni siquiera dividiendo cabe toda la duración en el rango, la tarea queda sin planificar (nunca se planifica una parte)', r.proposals.length === 0 && deepEq(r.unplannedTaskIds, ['gigante']));
  }

  // =====================================================================
  section('12) Varios huecos');
  // =====================================================================
  {
    const r = propose(
      { events: [{ id: 'e1', date: THU, startTime: '10:00', endTime: '18:00' }], tasks: [task({ id: 'repartida', estimatedMinutes: 400 })] },
      { dateFrom: THU, dateTo: THU }
    );
    check('12. una tarea puede repartirse entre varios huecos del mismo día (antes y después del evento) si hace falta', r.proposals.filter(p => p.taskId === 'repartida').length >= 2);
  }

  // =====================================================================
  section('13) Varios días');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 }), task({ id: 't2', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: FRI });
    const dates = new Set(r.proposals.map(p => p.date));
    check('13. las propuestas pueden caer en distintos días del rango', r.proposals.length === 2);
    check('13b. ambas caben el mismo primer día si hay sitio (huecos de sobra)', dates.has(THU));
  }

  // =====================================================================
  section('14) dateFrom/dateTo');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: FRI });
    check('14. dateFrom/dateTo del resultado son los del rango analizado (heredados de availability)', r.dateFrom === THU && r.dateTo === FRI);
    check('14b. ninguna propuesta cae fuera del rango', r.proposals.every(p => p.date >= THU && p.date <= FRI));
  }

  // =====================================================================
  section('15) taskIds específicos');
  // =====================================================================
  {
    const tasks = [task({ id: 't1', estimatedMinutes: 60 }), task({ id: 't2', estimatedMinutes: 60 })];
    const r = propose({ tasks }, { dateFrom: THU, dateTo: THU, taskIds: ['t2'] });
    check('15. solo se planifica la tarea referenciada en taskIds', deepEq(r.plannedTaskIds, ['t2']));
    check('15b. la tarea NO referenciada ni se planifica ni aparece en unplannedTaskIds (no se consideró candidata)', !r.plannedTaskIds.includes('t1') && !r.unplannedTaskIds.includes('t1'));
  }

  // =====================================================================
  section('16) taskIds inexistentes');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: THU, taskIds: ['no-existe'] });
    check('16a. un id inexistente nunca se inventa ni aparece en ningún array de salida', !r.plannedTaskIds.includes('no-existe') && !r.unplannedTaskIds.includes('no-existe'));
    check('16b. no se planifica nada (la única tarea real no estaba referenciada)', r.proposals.length === 0);
    check('16c. se documenta en notes que el id no correspondía a ninguna tarea real', r.notes.some(n => /taskIds/.test(n)));
  }

  // =====================================================================
  section('17) excludedDates');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: FRI, excludedDates: [THU] });
    check('17. ninguna propuesta cae en una fecha excluida', !r.proposals.some(p => p.date === THU));
  }

  // =====================================================================
  section('18) daysOfWeek');
  // =====================================================================
  {
    // Lunes(0)/jueves(3) permitidos; se pide un rango con varios días.
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: MON, dateTo: SUN, daysOfWeek: [0, 3] });
    check('18. ninguna propuesta cae en un día de la semana no permitido', r.proposals.every(p => p.date === MON || p.date === THU));
  }

  // =====================================================================
  section('19) availableMinutesPerDay');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 200 })] }, { dateFrom: THU, dateTo: THU, availableMinutesPerDay: 60 });
    const dayTotal = r.proposals.filter(p => p.date === THU).reduce((s, p) => s + p.minutes, 0);
    check('19a. el total planificado ese día nunca supera availableMinutesPerDay', dayTotal <= 60);
    check('19b. como no cabe toda la tarea en un solo día con ese tope y el rango es de un único día, queda sin planificar', r.unplannedTaskIds.includes('t1'));
  }

  // =====================================================================
  section('20) maxSessionMinutes');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 90 })] }, { dateFrom: THU, dateTo: THU, maxSessionMinutes: 30 });
    const mine = r.proposals.filter(p => p.taskId === 't1');
    check('20a. ninguna sesión supera maxSessionMinutes', mine.every(p => p.minutes <= 30));
    check('20b. todas las sesiones referencian el mismo taskId', mine.every(p => p.taskId === 't1'));
    check('20c. la suma de las sesiones es EXACTAMENTE la duración necesaria (nunca se pierden minutos)', mine.reduce((s, p) => s + p.minutes, 0) === 90);
  }

  // =====================================================================
  section('21) Fecha límite');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'conlimite', estimatedMinutes: 60, dueDate: THU })] }, { dateFrom: THU, dateTo: SAT });
    check('21. se planifica dentro (o antes) de la fecha límite, nunca después', r.proposals[0].date <= THU);
  }

  // =====================================================================
  section('22) Fecha límite incompatible');
  // =====================================================================
  {
    // La única disponibilidad cae DESPUÉS de la fecha límite de la tarea.
    const r = propose({ tasks: [task({ id: 'tarde', estimatedMinutes: 60, dueDate: MON })] }, { dateFrom: THU, dateTo: FRI });
    check('22. si todo el hueco disponible queda después del límite, la tarea NO se planifica', r.proposals.length === 0 && deepEq(r.unplannedTaskIds, ['tarde']));
  }

  // =====================================================================
  section('23) Prioridad urgent');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'baja', estimatedMinutes: 480, priority: 'baja' }), task({ id: 'alta', estimatedMinutes: 480, priority: 'alta' })] }, { dateFrom: THU, dateTo: THU, priority: 'urgent' });
    check('23. la tarea de prioridad "alta" se planifica primero (hueco más temprano)', r.proposals.find(p => p.taskId === 'alta').startTime < r.proposals.find(p => p.taskId === 'baja').startTime);
  }

  // =====================================================================
  section('24) Prioridad important');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'media', estimatedMinutes: 480, priority: 'media' }), task({ id: 'alta2', estimatedMinutes: 480, priority: 'alta' })] }, { dateFrom: THU, dateTo: THU, priority: 'important' });
    check('24. la tarea de prioridad "alta" se planifica primero también con priority:"important"', r.proposals.find(p => p.taskId === 'alta2').startTime < r.proposals.find(p => p.taskId === 'media').startTime);
  }

  // =====================================================================
  section('25) Prioridad shortest');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 'larga', estimatedMinutes: 120 }), task({ id: 'cortita', estimatedMinutes: 15 })] }, { dateFrom: THU, dateTo: THU, priority: 'shortest' });
    check('25. la tarea de menor estimatedMinutes se planifica primero', r.proposals.find(p => p.taskId === 'cortita').startTime < r.proposals.find(p => p.taskId === 'larga').startTime);
  }

  // =====================================================================
  section('26) Prioridad earliest');
  // =====================================================================
  {
    const r = propose(
      { tasks: [task({ id: 'lejos', estimatedMinutes: 30, dueDate: SAT }), task({ id: 'cerca', estimatedMinutes: 30, dueDate: THU })] },
      { dateFrom: THU, dateTo: SAT, priority: 'earliest' }
    );
    check('26. la tarea con fecha límite más próxima se planifica primero', r.proposals.find(p => p.taskId === 'cerca').date <= r.proposals.find(p => p.taskId === 'lejos').date);
  }

  // =====================================================================
  section('27) Empate determinista por ID');
  // =====================================================================
  {
    // Mismas condiciones exactas (sin fecha límite, sin priority) -> el
    // desempate final es el id.
    const r = propose({ tasks: [task({ id: 'zzz', estimatedMinutes: 30 }), task({ id: 'aaa', estimatedMinutes: 30 })] }, { dateFrom: THU, dateTo: THU });
    check('27. con todo igual, "aaa" se planifica antes que "zzz" (desempate por id)', r.proposals[0].taskId === 'aaa');
  }

  // =====================================================================
  section('28) No solapamientos');
  // =====================================================================
  {
    const r = propose(
      { events: [{ id: 'e2', date: THU, startTime: '12:00', endTime: '13:00' }], tasks: [task({ id: 't1', estimatedMinutes: 300 }), task({ id: 't2', estimatedMinutes: 300 }), task({ id: 't3', estimatedMinutes: 300 })] },
      { dateFrom: THU, dateTo: THU }
    );
    const byDate = {};
    r.proposals.forEach(p => { (byDate[p.date] = byDate[p.date] || []).push(p); });
    let overlap = false;
    Object.values(byDate).forEach(list => {
      const sorted = list.slice().sort((a, b) => a.startTime < b.startTime ? -1 : 1);
      for (let i = 1; i < sorted.length; i++) if (sorted[i].startTime < sorted[i - 1].endTime) overlap = true;
    });
    check('28. ninguna propuesta se solapa con otra (ni siquiera entre tareas distintas)', !overlap);
  }

  // =====================================================================
  section('29) totalMinutes correcto');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 45 }), task({ id: 't2', estimatedMinutes: 90 })] }, { dateFrom: THU, dateTo: THU });
    check('29. totalMinutes es la suma EXACTA de minutes de todas las propuestas', r.totalMinutes === r.proposals.reduce((s, p) => s + p.minutes, 0) && r.totalMinutes === 135);
  }

  // =====================================================================
  section('30) plannedTaskIds correcto');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 }), task({ id: 't2', estimatedMinutes: 2000 })] }, { dateFrom: THU, dateTo: THU });
    check('30. plannedTaskIds contiene solo las tareas realmente planificadas por completo', deepEq(r.plannedTaskIds, ['t1']));
  }

  // =====================================================================
  section('31) unplannedTaskIds correcto');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60 }), task({ id: 't2', estimatedMinutes: 2000 })] }, { dateFrom: THU, dateTo: THU });
    check('31. unplannedTaskIds contiene solo las que no pudieron completarse', deepEq(r.unplannedTaskIds, ['t2']));
  }

  // =====================================================================
  section('32) Arrays sin duplicados');
  // =====================================================================
  {
    const r = propose({ tasks: [task({ id: 't1', estimatedMinutes: 30 }), task({ id: 't2', estimatedMinutes: 30 })] }, { dateFrom: THU, dateTo: FRI });
    check('32a. plannedTaskIds sin duplicados', new Set(r.plannedTaskIds).size === r.plannedTaskIds.length);
    check('32b. unplannedTaskIds sin duplicados', new Set(r.unplannedTaskIds).size === r.unplannedTaskIds.length);
    check('32c. ambos ordenados por id', deepEq(r.plannedTaskIds, [...r.plannedTaskIds].sort()) && deepEq(r.unplannedTaskIds, [...r.unplannedTaskIds].sort()));
  }

  // =====================================================================
  section('33) Reason determinista');
  // =====================================================================
  {
    const r1 = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60, priority: 'alta' })] }, { dateFrom: THU, dateTo: THU, priority: 'urgent' });
    const r2 = propose({ tasks: [task({ id: 't1', estimatedMinutes: 60, priority: 'alta' })] }, { dateFrom: THU, dateTo: THU, priority: 'urgent' });
    check('33a. la misma entrada produce siempre la misma razón', r1.proposals[0].reason === r2.proposals[0].reason);
    check('33b. la razón es texto fijo/determinista, nunca vacío', typeof r1.proposals[0].reason === 'string' && r1.proposals[0].reason.length > 0);
  }

  // =====================================================================
  section('34) constraints vacías');
  // =====================================================================
  {
    const av = sb.analyzePlanningAvailability({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: THU });
    const r = sb.generatePlanningProposal({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, {}, av);
    check('34. constraints {} sigue funcionando (sin taskIds/priority/etc, usa los defaults conservadores)', r.proposals.length === 1);
  }

  // =====================================================================
  section('35) availability vacía');
  // =====================================================================
  {
    const r = sb.generatePlanningProposal({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: THU }, {});
    check('35. availability {} (sin dateFrom/dateTo/availableSlots) -> resultado vacío estable', deepEq(r, EMPTY));
  }

  // =====================================================================
  section('36) availability inválida');
  // =====================================================================
  {
    const r1 = sb.generatePlanningProposal({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: THU }, { dateFrom: FRI, dateTo: THU, availableSlots: [] });
    check('36a. dateFrom > dateTo en availability -> resultado vacío estable', deepEq(r1, EMPTY));
    const r2 = sb.generatePlanningProposal({ tasks: [task({ id: 't1', estimatedMinutes: 60 })] }, { dateFrom: THU, dateTo: THU }, { dateFrom: THU, dateTo: THU, availableSlots: 'no-es-un-array' });
    check('36b. availableSlots que no es un array -> resultado vacío estable', deepEq(r2, EMPTY));
  }

  // =====================================================================
  section('37-39) No mutación de tasks/availability/constraints');
  // =====================================================================
  {
    const tasks = [task({ id: 't1', estimatedMinutes: 60 })];
    const constraints = { dateFrom: THU, dateTo: THU, taskIds: [], excludedDates: [], daysOfWeek: [] };
    const availability = sb.analyzePlanningAvailability({ tasks }, constraints);
    const tasksSnap = JSON.stringify(tasks);
    const constraintsSnap = JSON.stringify(constraints);
    const availabilitySnap = JSON.stringify(availability);
    sb.generatePlanningProposal({ tasks }, constraints, availability);
    check('37. tasks no se modifica', JSON.stringify(tasks) === tasksSnap);
    check('38. availability no se modifica', JSON.stringify(availability) === availabilitySnap);
    check('39. constraints no se modifica', JSON.stringify(constraints) === constraintsSnap);
  }

  // =====================================================================
  section('40) Determinismo completo entre dos ejecuciones');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 60, priority: 'alta' }), task({ id: 't2', estimatedMinutes: 30, dueDate: FRI })], events: [{ id: 'e1', date: THU, startTime: '10:00', endTime: '11:00' }] };
    const cons = { dateFrom: THU, dateTo: SAT, priority: 'urgent' };
    const av = sb.analyzePlanningAvailability(ctx, cons);
    const r1 = sb.generatePlanningProposal(ctx, cons, av);
    const r2 = sb.generatePlanningProposal(ctx, cons, av);
    check('40. dos ejecuciones idénticas producen exactamente el mismo resultado', deepEq(r1, r2));
  }

  // =====================================================================
  section('Extra) Todas las propuestas están completamente dentro de un availableSlot real');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 120 })], events: [{ id: 'e3', date: THU, startTime: '09:00', endTime: '10:00' }] };
    const cons = { dateFrom: THU, dateTo: THU };
    const av = sb.analyzePlanningAvailability(ctx, cons);
    const r = sb.generatePlanningProposal(ctx, cons, av);
    const inside = r.proposals.every(p => av.availableSlots.some(s => s.date === p.date && p.startTime >= s.start && p.endTime <= s.end));
    check('Extra1. cada propuesta cae ENTERA dentro de un availableSlot de AI-3.3', inside);
  }

  // =====================================================================
  section('Extra) preferredDayParts no inventa horarios (nota explicativa)');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 60 })] };
    const cons = { dateFrom: THU, dateTo: THU, preferredDayParts: ['morning'] };
    const av = sb.analyzePlanningAvailability(ctx, cons);
    const r = sb.generatePlanningProposal(ctx, cons, av);
    check('Extra2. no recorta a un horario inventado (la propuesta sigue cayendo en la jornada real completa)', r.proposals[0].startTime === '07:00');
    check('Extra3. deja constancia en notes', r.notes.some(n => /preferredDayParts/.test(n)));
  }

  // =====================================================================
  section('Extra) Sin tareas planificables -> resultado vacío con dateFrom/dateTo');
  // =====================================================================
  {
    const av = sb.analyzePlanningAvailability({ tasks: [] }, { dateFrom: THU, dateTo: THU });
    const r = sb.generatePlanningProposal({ tasks: [] }, { dateFrom: THU, dateTo: THU }, av);
    check('Extra4. dateFrom/dateTo siguen presentes aunque no haya ninguna tarea', r.dateFrom === THU && r.dateTo === THU);
    check('Extra5. proposals/plannedTaskIds/unplannedTaskIds vacíos', r.proposals.length === 0 && r.plannedTaskIds.length === 0 && r.unplannedTaskIds.length === 0);
  }

  // =====================================================================
  section('Extra) Sin huecos disponibles -> candidatas quedan sin planificar, explicado en notes');
  // =====================================================================
  {
    const ctx = { tasks: [task({ id: 't1', estimatedMinutes: 30 })], events: [{ id: 'e4', date: THU, allDay: true }] };
    const cons = { dateFrom: THU, dateTo: THU };
    const av = sb.analyzePlanningAvailability(ctx, cons);
    const r = sb.generatePlanningProposal(ctx, cons, av);
    check('Extra6. sin huecos -> no se crea ninguna propuesta', r.proposals.length === 0);
    check('Extra7. la tarea candidata queda en unplannedTaskIds', deepEq(r.unplannedTaskIds, ['t1']));
    check('Extra8. se explica en notes', r.notes.some(n => /hueco/i.test(n)));
  }

  // =====================================================================
  section('Extra) No se toca ACTION_SCHEMA ni los exports existentes de AI-3.1/AI-3.2/AI-3.3');
  // =====================================================================
  {
    check('Extra9. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op"', (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
    check('Extra10. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES en su línea principal', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('Extra11. detectPlanningIntent (AI-3.1) sigue exportado sin tocar', /global\.AIActions\.detectPlanningIntent = detectPlanningIntent;/.test(aiActionsSrc));
    check('Extra12. extractPlanningConstraints (AI-3.2) sigue exportado sin tocar', /global\.AIActions\.extractPlanningConstraints = extractPlanningConstraints;/.test(aiActionsSrc));
    check('Extra13. analyzePlanningAvailability (AI-3.3) sigue exportado sin tocar', /global\.AIActions\.analyzePlanningAvailability = analyzePlanningAvailability;/.test(aiActionsSrc));
    check('Extra14. generatePlanningProposal se expone como propiedad ADICIONAL', /global\.AIActions\.generatePlanningProposal = generatePlanningProposal;/.test(aiActionsSrc));
    const pushBlock = proposalSrc.match(/proposals\.push\(\{[\s\S]*?\}\);/)[0];
    check('Extra15. el objeto de cada propuesta empujado a `proposals` no incluye id/source/batchId/status (esos son de AI-3.5)', !/\bsource:/.test(pushBlock) && !/\bbatchId:/.test(pushBlock) && !/\bstatus:/.test(pushBlock));
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
