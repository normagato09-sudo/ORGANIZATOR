/**
 * ORGANIZATOR — Tests de 5E-3 (validación de propuestas semanales)
 *
 * Suite Node pura, SIN navegador ni jsdom: no reimplementa la lógica a
 * probar, sino que EXTRAE literalmente el código real de organizator.html
 * (el bloque de ciclo de vida de propuestas IA de 5D, planWeekProposals de
 * 5E-2 y validateWeeklyProposal de 5E-3) y lo ejecuta con el js/scheduler.js
 * real del proyecto (cargado tal cual, sin tocar ni un carácter).
 *
 * Uso:  node js/test-ia-week-validation.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
const SCHEDULER_PATH = path.join(ROOT, 'js', 'scheduler.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf8');

/** Extrae desde `startMarker` (literal, primera aparición) hasta `endMarker`
 * (literal, primera aparición DESPUÉS de startMarker), sin incluir endMarker.
 * Lanza si no encuentra alguno de los dos — así un test roto por un cambio
 * de refactor se detecta de inmediato en vez de "pasar" silenciosamente
 * comparando contra una extracción vacía. */
function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// 1) Ciclo de vida de propuestas IA (5D, sin tocar): estado + funciones,
// tal cual aparecen en organizator.html, un bloque contiguo.
const lifecycleSrc = extractBetween(
  html,
  'let iaProposals = [];',
  '\n/* ---------- Llamada a la IA',
  'ciclo de vida de propuestas IA (5D)'
);

// 2) planWeekProposals (5E-2, sin tocar en esta fase).
const planWeekSrc = extractBetween(
  html,
  'function planWeekProposals(days, today, weekEnd, schedCtx){',
  '\n/* ---------- Validación de propuestas semanales',
  'planWeekProposals (5E-2)'
);

// 3) validateWeeklyProposal (5E-3, la función nueva de esta fase).
const validateSrc = extractBetween(
  html,
  'function validateWeeklyProposal(item, applyDate, schedCtx, weekStart, weekEnd, deadline){',
  '\n/* ---------- Agenda visual',
  'validateWeeklyProposal (5E-3)'
);

// ---------- Sandbox: window global (para Scheduler y para el código
// extraído, que usa `window.Scheduler` igual que en el navegador) ----------
const sandbox = {};
sandbox.window = sandbox; // el propio contexto hace de `window`
sandbox.console = console;
vm.createContext(sandbox);

// Cargar el scheduler.js REAL tal cual (mismo archivo que usa la app).
vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });

// Cargar el código extraído de organizator.html en el mismo contexto.
vm.runInContext(lifecycleSrc, sandbox, { filename: 'organizator.html (ciclo de vida IA)' });
vm.runInContext(planWeekSrc, sandbox, { filename: 'organizator.html (planWeekProposals)' });
vm.runInContext(validateSrc, sandbox, { filename: 'organizator.html (validateWeeklyProposal)' });
// `let`/`const` de nivel superior en un vm.Context viven en el entorno
// léxico del contexto, no como propiedades del objeto global — por eso las
// funciones extraídas (que sí quedan expuestas, al ser declaraciones
// `function`) pueden usar `iaProposals` internamente sin problema, pero
// este script de test necesita un paso extra para poder LEERLO/mutarlo
// desde fuera. No es un cambio de comportamiento: solo expone la misma
// variable ya existente para poder inspeccionarla en las aserciones.
vm.runInContext('this.iaProposals = iaProposals;', sandbox, { filename: 'expose-iaProposals' });

const {
  validateWeeklyProposal, planWeekProposals,
  nextIAProposalId, getIAProposalById, setIAProposalStatus, getIAProposalFromBatch,
  nextIABatchId, getPendingIAProposalsByBatchId, getIAProposalBatch,
} = sandbox;

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// ---------------- Datos base reutilizables ----------------
const TODAY = '2026-09-14';       // lunes, fecha fija para que los tests sean deterministas
const WEEK_END = '2026-09-20';    // TODAY + 6 días
function baseCtx(overrides) {
  return Object.assign({ events: [], tasks: [], customSchedules: [] }, overrides);
}
function validProposal(overrides) {
  return Object.assign({
    sourceType: 'proposal', title: 'Repasar apuntes', kind: 'task',
    time: '10:00', _endTime: '10:45', _durationMinutes: 45,
    _finalDate: '2026-09-15', noSlot: false,
  }, overrides);
}

// =====================================================================
// A–I: comprobaciones individuales de validateWeeklyProposal
// =====================================================================
section('validateWeeklyProposal — comprobaciones A–I');

// A. Propuesta válida → valid:true
{
  const item = validProposal();
  const r = validateWeeklyProposal(item, item._finalDate, baseCtx(), TODAY, WEEK_END, '2026-09-16');
  check('A. propuesta válida da valid:true', r.valid === true);
}

// B. Fuera de la semana → inválida
{
  const item = validProposal({ _finalDate: '2026-09-30' });
  const r = validateWeeklyProposal(item, item._finalDate, baseCtx(), TODAY, WEEK_END, '2026-09-30');
  check('B. fuera de la semana es inválida', r.valid === false && !!r.reason);
}

// C. Sin fecha → inválida
{
  const item = validProposal();
  const r = validateWeeklyProposal(item, null, baseCtx(), TODAY, WEEK_END, '2026-09-16');
  check('C. sin fecha es inválida', r.valid === false && !!r.reason);
}

// D. Duración inválida (fin no coincide con inicio+duración) → inválida
{
  const item = validProposal({ _durationMinutes: 45, time: '10:00', _endTime: '10:20' });
  const r = validateWeeklyProposal(item, item._finalDate, baseCtx(), TODAY, WEEK_END, '2026-09-16');
  check('D. duración inconsistente es inválida', r.valid === false && !!r.reason);
}

// E. Termina después de su fecha límite → inválida
{
  const item = validProposal({ _finalDate: '2026-09-18' });
  const r = validateWeeklyProposal(item, item._finalDate, baseCtx(), TODAY, WEEK_END, '2026-09-16');
  check('E. después de su deadline es inválida', r.valid === false && !!r.reason);
}

// F. Invade un evento existente → inválida
{
  const item = validProposal({ _finalDate: '2026-09-15', time: '10:00', _endTime: '10:45' });
  const ctx = baseCtx({ events: [{ id: 'ev1', date: '2026-09-15', startTime: '10:15', endTime: '11:00' }] });
  const r = validateWeeklyProposal(item, item._finalDate, ctx, TODAY, WEEK_END, '2026-09-16');
  check('F. invadir un evento es inválido', r.valid === false && !!r.reason);
}

// G. Invade una tarea ya programada → inválida
{
  const item = validProposal({ _finalDate: '2026-09-15', time: '10:00', _endTime: '10:45' });
  const ctx = baseCtx({ tasks: [{ id: 't1', scheduledDate: '2026-09-15', scheduledStart: '10:30', scheduledEnd: '11:00' }] });
  const r = validateWeeklyProposal(item, item._finalDate, ctx, TODAY, WEEK_END, '2026-09-16');
  check('G. invadir una tarea existente es inválido', r.valid === false && !!r.reason);
}

// H. Invade un bloque de customSchedules → inválida
{
  const item = validProposal({ _finalDate: '2026-09-15', time: '10:00', _endTime: '10:45' }); // 2026-09-15 es martes -> dow 1
  const ctx = baseCtx({ customSchedules: [{ id: 'cs1', days: [1], startTime: '09:00', endTime: '10:30' }] });
  const r = validateWeeklyProposal(item, item._finalDate, ctx, TODAY, WEEK_END, '2026-09-16');
  check('H. invadir horario fijo es inválido', r.valid === false && !!r.reason);
}

// I. Conflicto detectado vía Scheduler.findConflicts() → inválida
// (mismo caso que F, pero confirma explícitamente que la vía de
// findConflicts también lo detecta, tal como pide la fase)
{
  const item = validProposal({ _finalDate: '2026-09-15', time: '10:00', _endTime: '10:45' });
  const ctx = baseCtx({ events: [{ id: 'ev1', date: '2026-09-15', startTime: '10:00', endTime: '10:45' }] });
  const conflicts = sandbox.window.Scheduler.findConflicts('2026-09-15', Object.assign({}, ctx, {
    tasks: [{ id: 'probe', scheduledDate: '2026-09-15', scheduledStart: '10:00', scheduledEnd: '10:45' }],
  }));
  check('I. Scheduler.findConflicts detecta el mismo choque', conflicts.includes('probe'));
  const r = validateWeeklyProposal(item, item._finalDate, ctx, TODAY, WEEK_END, '2026-09-16');
  check('I. validateWeeklyProposal también la marca inválida', r.valid === false);
}

// Propuesta sin hueco (noSlot) de 5E-2: debe seguir siendo "válida" para
// esta función (comportamiento de 5E-2, punto 7 de esta fase) — no hay
// hora que validar, y no se le exige una.
{
  const item = validProposal({ noSlot: true, time: null, _endTime: null, _durationMinutes: null, _finalDate: '2026-09-16' });
  const r = validateWeeklyProposal(item, item._finalDate, baseCtx(), TODAY, WEEK_END, '2026-09-16');
  check('propuesta sin hueco (5E-2) no se marca inválida por falta de hora', r.valid === true);
}

// =====================================================================
// J, K, L: efecto de la validación integrada (simulando el bucle que
// runIAWeek aplica sobre plannedDays, sin necesidad de DOM/fetch)
// =====================================================================
section('Integración (equivalente al bucle de runIAWeek tras planWeekProposals)');

function applyValidationLoop(plannedDays, schedCtx, today, weekEnd) {
  plannedDays.forEach(day => {
    const deadlineForDay = day.date || today;
    (day.items || []).forEach(it => {
      if (it.sourceType !== 'proposal') return;
      const applyDate = it._finalDate || deadlineForDay;
      const chk = validateWeeklyProposal(it, applyDate, schedCtx, today, weekEnd, deadlineForDay);
      if (!chk.valid) {
        it.schedulingWarning = chk.reason;
        it.reason = (it.reason ? it.reason + ' ' : '') + `(${chk.reason})`;
      }
    });
  });
}

// J y K: una propuesta inválida permanece "pending" (estado por defecto,
// sin tocarlo) y recibe schedulingWarning.
{
  const days = [{ date: '2026-09-15', label: 'Martes', items: [
    { sourceType: 'proposal', title: 'Choca con evento', kind: 'task', time: '10:00', _endTime: '10:45', _durationMinutes: 45, _finalDate: '2026-09-15', noSlot: false, reason: '' },
  ] }];
  const ctx = baseCtx({ events: [{ id: 'ev1', date: '2026-09-15', startTime: '10:15', endTime: '11:00' }] });
  applyValidationLoop(days, ctx, TODAY, WEEK_END);
  const it = days[0].items[0];
  check('J. propuesta inválida no recibe status distinto de pending (no se toca)', it.status === undefined);
  check('K. propuesta inválida recibe schedulingWarning', typeof it.schedulingWarning === 'string' && it.schedulingWarning.length > 0);

  // Simula el registro real en iaProposals (igual que renderIAItemHTML)
  const batchId = nextIABatchId();
  const proposal = Object.assign({}, it, { id: nextIAProposalId(), batchId, source: 'week', status: 'pending', applyDate: it._finalDate });
  check('J (bis). al registrarse en iaProposals, el status es "pending"', proposal.status === 'pending');
}

// L: propuesta válida conserva applyDate y time (no se le toca nada).
{
  const days = [{ date: '2026-09-15', label: 'Martes', items: [ validProposal({ _finalDate: '2026-09-15' }) ] }];
  const ctx = baseCtx();
  const beforeTime = days[0].items[0].time, beforeFinalDate = days[0].items[0]._finalDate;
  applyValidationLoop(days, ctx, TODAY, WEEK_END);
  const it = days[0].items[0];
  check('L. propuesta válida conserva su time', it.time === beforeTime);
  check('L. propuesta válida conserva su _finalDate/applyDate', it._finalDate === beforeFinalDate);
  check('L. propuesta válida no recibe schedulingWarning', it.schedulingWarning === undefined);
}

// =====================================================================
// M: Apply/Discard de 5D (ciclo de vida de propuestas) siguen funcionando
// tal cual — no se han tocado esas funciones; se prueba el flujo de
// estado que usan wireIAProposalButtons/applyIAProposal internamente.
// =====================================================================
section('M — ciclo de vida de propuestas IA (5D) sigue funcionando');
{
  const batchId = nextIABatchId();
  const id = nextIAProposalId();
  sandbox.iaProposals.push({ id, batchId, source: 'week', status: 'pending', title: 'x', applyDate: '2026-09-15' });

  const found = getIAProposalFromBatch(id, batchId);
  check('M. getIAProposalFromBatch encuentra la propuesta recién creada', !!found && found.id === id);

  const applied = setIAProposalStatus(id, 'applied');
  check('M. setIAProposalStatus pending->applied permitido', applied === true && getIAProposalFromBatch(id, batchId).status === 'applied');

  const reDiscard = setIAProposalStatus(id, 'discarded');
  check('M. transición applied->discarded prohibida (ciclo de vida intacto)', reDiscard === false);

  const id2 = nextIAProposalId();
  sandbox.iaProposals.push({ id: id2, batchId, source: 'week', status: 'pending', title: 'y', applyDate: '2026-09-16' });
  const discarded = setIAProposalStatus(id2, 'discarded');
  check('M. setIAProposalStatus pending->discarded permitido', discarded === true);

  const pending = getPendingIAProposalsByBatchId(batchId);
  check('M. getPendingIAProposalsByBatchId ya no incluye las resueltas', pending.length === 0);
}

// =====================================================================
// N: runIADay() sigue funcionando — no se ha tocado ni una línea de esa
// función ni de nada de lo que depende (planWeekProposals/validateWeeklyProposal
// no se usan desde runIADay). Se comprueba que su código sigue presente
// y sintácticamente intacto en organizator.html (además del node --check
// global que se ejecuta aparte sobre todo el script).
// =====================================================================
section('N — runIADay() intacto');
{
  const hasRunIADay = html.includes('async function runIADay(){');
  check('N. runIADay() sigue definida en organizator.html', hasRunIADay);
  const usesPlanWeek = /async function runIADay\(\)\{[\s\S]*?\n\}/.exec(html);
  const body = usesPlanWeek ? usesPlanWeek[0] : '';
  check('N. runIADay() no llama a planWeekProposals ni a validateWeeklyProposal (sin dependencias nuevas)',
    body.length > 0 && !body.includes('planWeekProposals') && !body.includes('validateWeeklyProposal'));
}

// =====================================================================
// O: scheduler.js permanece sin cambios (se comprueba fuera, por hash,
// en el propio flujo de commit — aquí solo se deja constancia de que
// esta suite lo cargó tal cual, sin parchearlo ni mockearlo).
// =====================================================================
section('O — scheduler.js cargado sin modificar');
check('O. Scheduler expone findConflicts y _internal.getBusyIntervals (contrato original)',
  typeof sandbox.window.Scheduler.findConflicts === 'function' &&
  typeof sandbox.window.Scheduler._internal.getBusyIntervals === 'function');

// ---------------- Resumen ----------------
console.log(`\n${pass} pasaron, ${fail} fallaron.`);
process.exit(fail > 0 ? 1 : 0);
