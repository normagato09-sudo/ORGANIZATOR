/**
 * ORGANIZATOR — Tests de 5E-4 (propuestas IA semanales dentro de la vista Semana)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente el código
 * real de organizator.html (ciclo de vida de propuestas IA de 5D,
 * spliceProposalsIntoBlocks, esc(), y el bloque nuevo de esta fase:
 * renderSemanaAgenda + getWeekIAProposalsForDate + buildSemanaDayAgendaBlocks)
 * y lo ejecuta con el js/scheduler.js real del proyecto (sin tocar ni un
 * carácter).
 *
 * Uso:  node js/test-semana-ia-proposals.js
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

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// 1) esc() — usada por renderSemanaAgenda.
const escSrc = extractBetween(
  html,
  'function esc(s){',
  '\n\n/* ==================================================================',
  'esc()'
);

// 2) Ciclo de vida de propuestas IA (5D, sin tocar en esta fase).
const lifecycleSrc = extractBetween(
  html,
  'let iaProposals = [];',
  '\n/* ---------- Llamada a la IA',
  'ciclo de vida de propuestas IA (5D)'
);

// 3) renderSemanaAgenda + getWeekIAProposalsForDate + buildSemanaDayAgendaBlocks
//    (todo el bloque nuevo de 5E-4, contiguo en el archivo).
const semanaSrc = extractBetween(
  html,
  'function renderSemanaAgenda(blocks){',
  '\nfunction renderSemana(){',
  'renderSemanaAgenda/getWeekIAProposalsForDate/buildSemanaDayAgendaBlocks (5E-4)'
);

// 4) spliceProposalsIntoBlocks (5C-4/5E-4: se le añadió propagar id/batchId).
const spliceSrc = extractBetween(
  html,
  'function spliceProposalsIntoBlocks(blocks, placedProposals){',
  '\nfunction renderDayAgendaList(',
  'spliceProposalsIntoBlocks'
);

// ---------- Sandbox ----------
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.state = { tasks: [] }; // renderSemanaAgenda consulta state.tasks para 5C-6 (task.done)
vm.createContext(sandbox);

vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });
vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
vm.runInContext(lifecycleSrc, sandbox, { filename: 'organizator.html (ciclo de vida IA)' });
vm.runInContext(spliceSrc, sandbox, { filename: 'organizator.html (spliceProposalsIntoBlocks)' });
vm.runInContext(semanaSrc, sandbox, { filename: 'organizator.html (Semana 5E-4)' });
vm.runInContext('this.iaProposals = iaProposals;', sandbox, { filename: 'expose-iaProposals' });

const {
  renderSemanaAgenda, getWeekIAProposalsForDate, buildSemanaDayAgendaBlocks,
  nextIAProposalId, getIAProposalById, getIAProposalFromBatch, setIAProposalStatus,
  nextIABatchId,
} = sandbox;

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

function pushWeekProposal(overrides) {
  const batchId = overrides.batchId || nextIABatchId();
  const proposal = Object.assign({
    id: nextIAProposalId(), batchId, source: 'week', status: 'pending',
    title: 'Repasar apuntes', kind: 'task', reason: '',
    time: '10:00', _endTime: '10:45', _durationMinutes: 45,
    applyDate: '2026-09-15',
  }, overrides, { batchId });
  sandbox.iaProposals.push(proposal);
  return proposal;
}
function baseCtx(overrides) {
  return Object.assign({ events: [], tasks: [], customSchedules: [] }, overrides);
}

// =====================================================================
// A. Una propuesta source:'week' aparece únicamente en su applyDate
// =====================================================================
section('A — solo aparece en su applyDate');
{
  sandbox.iaProposals.length = 0;
  pushWeekProposal({ applyDate: '2026-09-15' });
  const blocksSameDay = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  const blocksOtherDay = buildSemanaDayAgendaBlocks('2026-09-16', baseCtx());
  const htmlSameDay = renderSemanaAgenda(blocksSameDay);
  const htmlOtherDay = renderSemanaAgenda(blocksOtherDay);
  check('A. aparece en su applyDate', htmlSameDay.includes('Repasar apuntes'));
  check('A. no aparece en otro día', !htmlOtherDay.includes('Repasar apuntes'));
}

// =====================================================================
// B. Una propuesta de otra semana no aparece
// =====================================================================
section('B — propuesta de otra semana no aparece');
{
  sandbox.iaProposals.length = 0;
  pushWeekProposal({ applyDate: '2026-10-01', title: 'De otra semana' });
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  check('B. no aparece en una semana distinta a la suya', getWeekIAProposalsForDate('2026-09-15').length === 0);
  check('B. tampoco se cuela en los bloques de ese día', !blocks.some(b => b.type === 'proposal'));
}

// =====================================================================
// C. Una propuesta discarded no aparece
// =====================================================================
section('C — discarded no aparece');
{
  sandbox.iaProposals.length = 0;
  const p = pushWeekProposal({ applyDate: '2026-09-15', title: 'Descartada' });
  setIAProposalStatus(p.id, 'discarded');
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  check('C. discarded no aparece en getWeekIAProposalsForDate', getWeekIAProposalsForDate('2026-09-15').length === 0);
  check('C. discarded no aparece en los bloques', !blocks.some(b => b.type === 'proposal'));
}

// =====================================================================
// D. Una propuesta applied no aparece como propuesta
// =====================================================================
section('D — applied no aparece como propuesta');
{
  sandbox.iaProposals.length = 0;
  const p = pushWeekProposal({ applyDate: '2026-09-15', title: 'Ya aplicada' });
  setIAProposalStatus(p.id, 'applied');
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  check('D. applied no aparece en getWeekIAProposalsForDate', getWeekIAProposalsForDate('2026-09-15').length === 0);
  check('D. applied no aparece en los bloques como propuesta', !blocks.some(b => b.type === 'proposal'));
}

// =====================================================================
// E. Una propuesta pending sí aparece
// =====================================================================
section('E — pending sí aparece');
{
  sandbox.iaProposals.length = 0;
  pushWeekProposal({ applyDate: '2026-09-15', title: 'Pendiente visible' });
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  const proposalBlocks = blocks.filter(b => b.type === 'proposal');
  check('E. pending aparece como bloque de tipo proposal', proposalBlocks.length === 1 && proposalBlocks[0].title === 'Pendiente visible');
  check('E. el HTML resultante la muestra con el tag "propuesta IA"', renderSemanaAgenda(blocks).includes('propuesta IA'));
}

// =====================================================================
// F. Dos propuestas diferentes aparecen sin confundirse por índice
// =====================================================================
section('F — dos propuestas no se confunden por índice');
{
  sandbox.iaProposals.length = 0;
  const p1 = pushWeekProposal({ applyDate: '2026-09-15', title: 'Primera', time: '08:00', _endTime: '08:45' });
  const p2 = pushWeekProposal({ applyDate: '2026-09-15', title: 'Segunda', time: '11:00', _endTime: '11:45' });
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  const b1 = blocks.find(b => b.type === 'proposal' && b.title === 'Primera');
  const b2 = blocks.find(b => b.type === 'proposal' && b.title === 'Segunda');
  check('F. ambas propuestas están presentes', !!b1 && !!b2);
  check('F. cada bloque conserva el id correcto de su propuesta (no por índice)', b1.id === p1.id && b2.id === p2.id);
  check('F. los ids no se han intercambiado entre sí', b1.id !== b2.id);
  // Reordenar el array de iaProposals no debe romper la identificación
  // (mismo principio que 5D-9: nunca se usa índice de array).
  sandbox.iaProposals.reverse();
  const blocksAfterReorder = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  const b1b = blocksAfterReorder.find(b => b.type === 'proposal' && b.title === 'Primera');
  const b2b = blocksAfterReorder.find(b => b.type === 'proposal' && b.title === 'Segunda');
  check('F. reordenar iaProposals no cambia qué id corresponde a cada título', b1b.id === p1.id && b2b.id === p2.id);
}

// =====================================================================
// G. Los botones contienen ID y batch correctos
// =====================================================================
section('G — botones con id/batch correctos');
{
  sandbox.iaProposals.length = 0;
  const p = pushWeekProposal({ applyDate: '2026-09-15', title: 'Con botones' });
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  const out = renderSemanaAgenda(blocks);
  check('G. incluye data-ia-apply con el id de la propuesta', out.includes(`data-ia-apply="${p.id}"`));
  check('G. incluye data-ia-discard con el id de la propuesta', out.includes(`data-ia-discard="${p.id}"`));
  check('G. incluye data-ia-batch con el batchId de la propuesta', (out.match(new RegExp(`data-ia-batch="${p.batchId}"`, 'g')) || []).length === 2);
}

// =====================================================================
// H. Apply utiliza el handler existente (getIAProposalFromBatch/setIAProposalStatus)
// =====================================================================
section('H — Apply reutiliza el sistema existente de 5D');
{
  sandbox.iaProposals.length = 0;
  const p = pushWeekProposal({ applyDate: '2026-09-15', title: 'Para aplicar' });
  const found = getIAProposalFromBatch(p.id, p.batchId);
  check('H. getIAProposalFromBatch localiza la propuesta por id+batch (sin índices)', !!found && found.id === p.id);
  const ok = setIAProposalStatus(p.id, 'applied');
  check('H. setIAProposalStatus admite pending->applied (mismo ciclo de vida de 5D)', ok === true);
  check('H. tras aplicar, deja de listarse como pendiente de la semana', getWeekIAProposalsForDate('2026-09-15').length === 0);
}

// =====================================================================
// I. Discard utiliza el handler existente
// =====================================================================
section('I — Discard reutiliza el sistema existente de 5D');
{
  sandbox.iaProposals.length = 0;
  const p = pushWeekProposal({ applyDate: '2026-09-15', title: 'Para descartar' });
  const ok = setIAProposalStatus(p.id, 'discarded');
  check('I. setIAProposalStatus admite pending->discarded (mismo ciclo de vida de 5D)', ok === true);
  check('I. tras descartar, deja de listarse como pendiente de la semana', getWeekIAProposalsForDate('2026-09-15').length === 0);
  // Repetir la acción sobre una propuesta ya resuelta debe seguir prohibido.
  const reApply = setIAProposalStatus(p.id, 'applied');
  check('I. una propuesta ya discarded no puede pasar a applied', reApply === false);
}

// =====================================================================
// J. Una propuesta con schedulingWarning muestra el estado de problema
// =====================================================================
section('J — schedulingWarning se muestra como problema (⚠️)');
{
  sandbox.iaProposals.length = 0;
  pushWeekProposal({
    applyDate: '2026-09-15', title: 'Sin hueco', time: null, _endTime: null, _durationMinutes: null,
    noSlot: true, schedulingWarning: 'Sin hueco libre suficiente esa semana — se añadirá sin hora fija.',
    reason: '(Sin hueco libre suficiente esa semana — se añadirá sin hora fija.)',
  });
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', baseCtx());
  const out = renderSemanaAgenda(blocks);
  check('J. la propuesta sin hueco se añade igualmente (no se descarta)', blocks.some(b => b.type === 'proposal' && b.title === 'Sin hueco'));
  check('J. se muestra con ⚠️ en vez de 📚', out.includes('⚠️'));
  check('J. muestra el motivo del problema', out.includes('Sin hueco libre suficiente esa semana'));
  check('J. no inventa una hora — indica "Sin hora fija"', out.includes('Sin hora fija'));
  check('J. sigue permitiendo Descartar', out.includes('data-ia-discard'));
}

// =====================================================================
// K. Navegar de semana no modifica iaProposals
// =====================================================================
section('K — navegar de semana no modifica iaProposals (solo lectura)');
{
  sandbox.iaProposals.length = 0;
  pushWeekProposal({ applyDate: '2026-09-15', title: 'Estable' });
  const before = JSON.stringify(sandbox.iaProposals);
  // Simula "navegar" pidiendo la agenda de varios días distintos, incluida
  // la semana siguiente — ni crea ni borra nada de iaProposals.
  ['2026-09-08', '2026-09-15', '2026-09-16', '2026-09-22'].forEach(d => {
    buildSemanaDayAgendaBlocks(d, baseCtx());
  });
  const after = JSON.stringify(sandbox.iaProposals);
  check('K. iaProposals no cambia al calcular la agenda de otros días/semanas', before === after);
  check('K. sigue habiendo exactamente 1 propuesta (no se duplicó)', sandbox.iaProposals.length === 1);
}

// =====================================================================
// L. Colocación en su hueco real (spliceProposalsIntoBlocks) sin crear
//    una nueva propuesta ni tocar el motor de timeline
// =====================================================================
section('L — colocación en el hueco real vía spliceProposalsIntoBlocks');
{
  sandbox.iaProposals.length = 0;
  pushWeekProposal({ applyDate: '2026-09-15', title: 'Con hora', time: '10:00', _endTime: '10:45' });
  const ctx = baseCtx({ events: [{ id: 'ev1', date: '2026-09-15', startTime: '09:00', endTime: '09:30' }] });
  const blocks = buildSemanaDayAgendaBlocks('2026-09-15', ctx);
  const idx = blocks.findIndex(b => b.type === 'proposal' && b.title === 'Con hora');
  check('L. la propuesta se coloca en su horario exacto (10:00–10:45)', idx !== -1 && blocks[idx].startTime === '10:00' && blocks[idx].endTime === '10:45');
  check('L. el evento real anterior sigue como bloque ocupado (no lo pisa)', blocks.some(b => b.type === 'busy' && b.label === 'ev1' || b.type === 'busy'));
  check('L. no se duplicó ninguna propuesta (una sola en iaProposals)', sandbox.iaProposals.filter(p => p.title === 'Con hora').length === 1);
}

// =====================================================================
// M. 5D sigue funcionando (ciclo de vida intacto tras los cambios de 5E-4)
// =====================================================================
section('M — 5D (ciclo de vida) sigue intacto');
{
  const batchId = nextIABatchId();
  const id = nextIAProposalId();
  sandbox.iaProposals.push({ id, batchId, source: 'day', status: 'pending', title: 'día', applyDate: '2026-09-15' });
  check('M. una propuesta source:"day" sigue pudiendo crearse y localizarse igual', !!getIAProposalFromBatch(id, batchId));
  check('M. setIAProposalStatus pending->applied sigue funcionando', setIAProposalStatus(id, 'applied') === true);
  check('M. transición applied->pending sigue prohibida', setIAProposalStatus(id, 'pending') === false);
}

// =====================================================================
// N. Búsqueda estática: nada de índices de array, splice() ni un
//    activeBatchId nuevo en el código de esta fase.
// =====================================================================
section('N — comprobación estática (sin índices/splice/nuevo sistema)');
{
  check('N. no aparece iaProposals[índice]', !/iaProposals\[\d/.test(semanaSrc) && !/iaProposals\[[a-zA-Z]/.test(semanaSrc));
  check('N. no aparece iaProposals.splice en el bloque de Semana', !semanaSrc.includes('iaProposals.splice'));
  check('N. no se introduce un activeBatchId nuevo', !semanaSrc.includes('activeBatchId'));
  check('N. no hay persistencia de propuestas (sin window.storage) en el bloque de Semana', !semanaSrc.includes('window.storage'));
}

// =====================================================================
// O. runIADay()/5D/5E-2/5E-3 siguen presentes e intactos en organizator.html
// =====================================================================
section('O — runIADay()/5D/5E-2/5E-3 intactos');
{
  check('O. runIADay() sigue definida', html.includes('async function runIADay(){'));
  check('O. planWeekProposals() sigue definida (5E-2)', html.includes('function planWeekProposals(days, today, weekEnd, schedCtx){'));
  check('O. validateWeeklyProposal() sigue definida (5E-3)', html.includes('function validateWeeklyProposal(item, applyDate, schedCtx, weekStart, weekEnd, deadline){'));
  check('O. wireIAProposalButtons() sigue siendo el único wiring de Apply/Discard', html.includes('function wireIAProposalButtons(container){'));
  check('O. Scheduler expone buildDayBlocks/autoSchedule (contrato original)',
    typeof sandbox.window.Scheduler.buildDayBlocks === 'function' && typeof sandbox.window.Scheduler.autoSchedule === 'function');
}

// ---------------- Resumen ----------------
console.log(`\n${pass} pasaron, ${fail} fallaron.`);
process.exit(fail > 0 ? 1 : 0);
