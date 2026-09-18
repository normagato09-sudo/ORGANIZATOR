/**
 * ORGANIZATOR — AI-1.6: suite de regresión GLOBAL de la fase AI-1
 * (AI-1.1 detección de intención, AI-1.2 fechas/horas naturales,
 * AI-1.3 eventos implícitos, AI-1.4 tareas implícitas, AI-1.5 modificar/
 * mover/cancelar naturalmente).
 *
 * Esto NO sustituye a las cinco suites por fase (test-ai-1-1..5), que
 * siguen siendo la referencia detallada de cada una y deben seguir
 * ejecutándose por separado. Esta suite es el contrato CONJUNTO de AI-1:
 * comprueba de extremo a extremo (con `callAI` mockeado, mismo patrón
 * que el resto de la familia AI-1.x) que las cinco fases funcionan
 * JUNTAS sin contradecirse, que el contrato público no cambió, que no
 * se inventa información y que dedupeActions() sigue protegiendo contra
 * duplicados — incluidos los conflictos de precedencia descubiertos
 * durante AI-1.5 (AI-1.3 vs AI-1.5 sobre el mismo mensaje).
 *
 * No repite exhaustivamente cada caso ya cubierto en las suites por
 * fase (p.ej. no vuelve a probar las 25 variantes de fecha/hora de
 * AI-1.2): usa un caso representativo por categoría y se apoya en que
 * las suites por fase ya cubren el detalle.
 *
 * Uso:  node js/test-ai-1-regression.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AI_ACTIONS_PATH = path.join(ROOT, 'js', 'ai-actions.js');
// ai-actions.js se guarda con CRLF; se normaliza a LF solo para esta
// lectura en memoria (no se toca el archivo en disco) porque los
// marcadores de extractBetween de abajo usan '\n'.
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en ai-actions.js — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en ai-actions.js — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Bloques puros de AI-1.2/1.3/1.4/1.5, literales de ai-actions.js —
// usados solo para un puñado de comprobaciones directas de existencia/
// comportamiento básico (el detalle exhaustivo ya vive en cada suite
// por fase).
// ---------------------------------------------------------------------
const datetimeSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.2',
  '\n\n  /* ==================================================================\n     AI-1.3',
  'bloque AI-1.2 (resolución determinista de fechas/horas)'
);
const implicitEventSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.3',
  '\n\n  /* ==================================================================\n     AI-1.4',
  'bloque AI-1.3 (reconocimiento de eventos implícitos/festivos)'
);
const implicitTaskSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.4',
  '\n\n  /* ==================================================================\n     AI-1.5',
  'bloque AI-1.4 (reconocimiento de tareas implícitas)'
);
const modificationSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.5',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-1.5 (modificar/mover/cancelar naturalmente)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con los bloques puros AI-1.2+1.3+1.4+1.5, sin
 * `state` ni DOM — para el puñado de comprobaciones directas de
 * existencia/comportamiento básico de esta suite. */
function makeHelperSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + '\n' + implicitTaskSrc + '\n' + modificationSrc + `
    this.resolveDateExpression = resolveDateExpression;
    this.resolveTimeExpression = resolveTimeExpression;
    this.isHolidayMessage = isHolidayMessage;
    this.isAppointmentMessage = isAppointmentMessage;
    this.isTaskMessage = isTaskMessage;
    this.isMoveMessage = isMoveMessage;
    this.isCancelMessage = isCancelMessage;
    this.isPriorityChangeMessage = isPriorityChangeMessage;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+1.3+1.4+1.5, bloques puros)' }
  );
  return sandbox;
}

/** Sandbox completo con ai-actions.js REAL cargado (para las pruebas
 * end-to-end de runIAAction), mismo patrón de mocks que toda la familia
 * AI-1.x. `todayStr` es fijo y NO usa `new Date()`. */
function makeActionSandbox(callAIImpl, todayStr) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;

  let nextId = 1;
  const state = { tasks: [], events: [], customSchedules: [] };
  sandbox.state = state;
  sandbox.currentView = 'test';
  sandbox.todayStr = () => todayStr;

  const calls = { addTask: 0, addEvent: 0, updateTask: 0, updateEvent: 0, deleteTask: 0, deleteEvent: 0, scheduleTask: 0 };
  sandbox.__calls = calls;
  sandbox.__lastUserPrompt = null;

  sandbox.addTask = async (data) => { calls.addTask++; state.tasks.push(Object.assign({ id: 't' + (nextId++), done: false, createdAt: 1 }, data)); };
  sandbox.addEvent = async (data) => { calls.addEvent++; state.events.push(Object.assign({ id: 'e' + (nextId++), createdAt: 1 }, data)); };
  sandbox.updateTask = async (id, data) => { calls.updateTask++; const t = state.tasks.find(x => x.id === id); if (t) Object.assign(t, data); };
  sandbox.updateEvent = async (id, data) => { calls.updateEvent++; const e = state.events.find(x => x.id === id); if (e) Object.assign(e, data); };
  sandbox.deleteTask = async (id) => { calls.deleteTask++; state.tasks = state.tasks.filter(t => t.id !== id); };
  sandbox.deleteEvent = async (id) => { calls.deleteEvent++; state.events = state.events.filter(e => e.id !== id); };
  sandbox.Scheduler = {
    scheduleTask: (task) => { calls.scheduleTask++; return { scheduledDate: task.dueDate || null, scheduledStart: '09:00', scheduledEnd: '09:30', estimatedMinutes: task.estimatedMinutes || 30, schedulingWarning: null }; },
    findConflicts: () => [],
    rescheduleTask: () => null,
  };
  sandbox.renderInicio = () => {};
  sandbox.parseAIJSON = (raw) => raw;
  sandbox.callAI = async (system, userPrompt) => { sandbox.__lastUserPrompt = userPrompt; return callAIImpl(system, userPrompt); };

  vm.createContext(sandbox);
  vm.runInContext(aiActionsSrc, sandbox, { filename: 'js/ai-actions.js' });
  return sandbox;
}

(async () => {
  const TODAY = '2026-09-17'; // jueves

  // =====================================================================
  section('0) Contrato público de AI-1 (ACTION_SCHEMA / ACTION_RULES / global.AIActions)');
  // =====================================================================
  {
    check('0. ACTION_SCHEMA sigue existiendo con la misma forma (5 tipos de "op", mismos nombres de campo)',
      /const ACTION_SCHEMA = `\{/.test(aiActionsSrc) &&
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      ['"title"', '"dueDate"', '"dueTime"', '"priority"', '"estimatedMinutes"', '"notes"', '"date"', '"endDate"', '"allDay"', '"startTime"', '"endTime"', '"location"', '"targetId"', '"targetKind"', '"newDate"', '"newTime"', '"newPriority"'].every(f => aiActionsSrc.includes(f)));
    check('0. ACTION_RULES sigue existiendo', /const ACTION_RULES = `/.test(aiActionsSrc));
    check('0. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES (ninguna clave de más ni de menos)',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0. buildActionContext() sigue presente sin tocar (misma LISTA DE ELEMENTOS EXISTENTES de siempre)',
      /function buildActionContext\(\)\s*\{/.test(aiActionsSrc) && /LISTA DE ELEMENTOS EXISTENTES/.test(aiActionsSrc));
    check('0. dedupeActions() sigue presente, una sola definición', (aiActionsSrc.match(/function dedupeActions\(actions\)\s*\{/g) || []).length === 1);
    check('0. helpers puros de AI-1.2/1.3/1.4/1.5 siguen presentes, una sola definición cada uno (nada eliminado ni duplicado)',
      ['resolveDateExpression', 'resolveTimeExpression', 'isHolidayMessage', 'isAppointmentMessage', 'isTaskMessage', 'isMoveMessage', 'isCancelMessage', 'isPriorityChangeMessage', 'buildTemporalHints', 'buildImplicitEventHints', 'buildImplicitTaskHints', 'buildModificationHints']
        .every(fn => (aiActionsSrc.match(new RegExp(`function ${fn}\\(`, 'g')) || []).length === 1));
    check('0. applyCreateTask/applyCreateEvent/applyMoveItem/applyCancelItem/applyUpdatePriority siguen presentes, una sola definición cada uno',
      ['applyCreateTask', 'applyCreateEvent', 'applyMoveItem', 'applyCancelItem', 'applyUpdatePriority']
        .every(fn => (aiActionsSrc.match(new RegExp(`async function ${fn}\\(`, 'g')) || []).length === 1));
    check('0. ai-actions.js sigue sin definir su propia lógica de Scheduler (solo la CONSUME vía global.Scheduler)',
      !/function\s+scheduleTask\s*\(/.test(aiActionsSrc) && /global\.Scheduler\.scheduleTask/.test(aiActionsSrc));
    {
      const sb = makeActionSandbox(async () => ({ answer: '', actions: [] }), TODAY);
      check('0b. runIAAction es una función async', typeof sb.AIActions.runIAAction === 'function');
      check('0c. buildActionContext es una función', typeof sb.AIActions.buildActionContext === 'function');
      check('0d. ACTION_SCHEMA/ACTION_RULES son strings no vacíos', typeof sb.AIActions.ACTION_SCHEMA === 'string' && sb.AIActions.ACTION_SCHEMA.length > 0 && typeof sb.AIActions.ACTION_RULES === 'string' && sb.AIActions.ACTION_RULES.length > 0);
    }
  }

  const sbHelp = makeHelperSandbox();

  // =====================================================================
  section('1) Intenciones (AI-1.1): create_task / create_event / move_item / cancel_item / sin acción');
  // =====================================================================
  {
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [{ op: 'create_task', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: null, priority: 'media', estimatedMinutes: 60, notes: null }] }), TODAY);
      await sb.AIActions.runIAAction('Mañana tengo que estudiar biología');
      check('1a. create_task funciona (1 tarea, 0 eventos)', sb.state.tasks.length === 1 && sb.state.events.length === 0);
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [{ op: 'create_event', title: 'Examen de biología', date: '2026-09-24', endDate: null, allDay: false, startTime: null, endTime: null, location: null }] }), TODAY);
      await sb.AIActions.runIAAction('Tengo parcial de biología el jueves');
      check('1b. create_event funciona (1 evento, 0 tareas)', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('1c. move_item funciona (no crea nada nuevo, actualiza lo existente)', sb.state.events.length === 1 && sb.state.events[0].date === '2026-09-18' && sb.__calls.addEvent === 0);
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Cancelado.', actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e1' }] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Cancela el examen');
      check('1d. cancel_item funciona (elemento eliminado)', sb.state.events.length === 0 && sb.__calls.deleteEvent === 1);
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [] }), TODAY);
      const result = await sb.AIActions.runIAAction('Vale, entendido');
      check('1e. sin acción funciona (actions: [] -> nada creado, applied vacío)', sb.state.tasks.length === 0 && sb.state.events.length === 0 && result.applied.length === 0);
    }
  }

  // =====================================================================
  section('2) Eventos implícitos (AI-1.3): festivo/allDay, citas por sustantivo, no confundir con tarea');
  // =====================================================================
  {
    check('2a. "El 24 es festivo" se reconoce como festivo (isHolidayMessage)', sbHelp.isHolidayMessage('El 24 es festivo') === true);
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Anotado.', actions: [{ op: 'create_event', title: 'Festivo', date: '2026-09-24', endDate: null, allDay: true, startTime: null, endTime: null, location: null }] }), TODAY);
      await sb.AIActions.runIAAction('El 24 es festivo');
      check('2b. festivo end-to-end produce evento allDay:true, startTime/endTime vacíos', sb.state.events[0].allDay === true && sb.state.events[0].startTime === '' && sb.state.events[0].endTime === '');
    }
    check('2c. médico/dentista/reunión/examen/clase/entreno se reconocen como cita (evento)',
      ['El jueves tengo médico', 'El martes tengo dentista', 'Mañana tengo reunión con Ana', 'El viernes tengo una cita', 'El miércoles tengo examen de matemáticas', 'Tengo clase mañana', 'Tengo entreno el lunes']
        .every(m => sbHelp.isAppointmentMessage(m) === true));
    check('2d. una tarea implícita NO se confunde con evento ("tengo que estudiar" no es una cita)', sbHelp.isAppointmentMessage('Tengo que estudiar biología') === false && sbHelp.isTaskMessage('Tengo que estudiar biología') === true);
  }

  // =====================================================================
  section('3) Tareas implícitas (AI-1.4): estudiar, entregar, comprar, llamar, preparar, revisar, terminar');
  // =====================================================================
  {
    check('3a. "tengo que estudiar" -> tarea', sbHelp.isTaskMessage('Tengo que estudiar biología') === true);
    check('3b. "tengo que entregar" -> tarea', sbHelp.isTaskMessage('Tengo que entregar el trabajo el lunes') === true);
    check('3c. "necesito comprar" -> tarea', sbHelp.isTaskMessage('Necesito comprar leche') === true);
    check('3d. "no olvidar llamar" -> tarea', sbHelp.isTaskMessage('No olvidar llamar a Ana') === true);
    check('3e. "quiero preparar" -> tarea', sbHelp.isTaskMessage('Quiero preparar el examen') === true);
    check('3f. "debo revisar" -> tarea', sbHelp.isTaskMessage('Debo revisar el informe') === true);
    check('3g. "necesito terminar" -> tarea', sbHelp.isTaskMessage('Necesito terminar el proyecto') === true);
  }

  // =====================================================================
  section('4) Fechas y horas (AI-1.2): hoy/mañana/pasado mañana/día de semana/numéricas/horas/franjas');
  // =====================================================================
  {
    check('4a. "hoy"', sbHelp.resolveDateExpression('hoy tengo médico', TODAY) === '2026-09-17');
    check('4b. "mañana"', sbHelp.resolveDateExpression('mañana tengo médico', TODAY) === '2026-09-18');
    check('4c. "pasado mañana"', sbHelp.resolveDateExpression('pasado mañana tengo médico', TODAY) === '2026-09-19');
    check('4d. día de la semana ("el lunes")', sbHelp.resolveDateExpression('el lunes tengo médico', TODAY) === '2026-09-21');
    check('4e. fecha numérica suelta ("el 24")', sbHelp.resolveDateExpression('el 24 tengo médico', TODAY) === '2026-09-24');
    check('4f. fecha con mes ("24 de octubre")', sbHelp.resolveDateExpression('el 24 de octubre tengo médico', TODAY) === '2026-10-24');
    check('4g. hora ("a las 17")', sbHelp.resolveTimeExpression('tengo médico a las 17') === '17:00');
    check('4h. franja del día ("por la tarde") no inventa una hora exacta', sbHelp.resolveTimeExpression('tengo médico por la tarde') === null);
    check('4i. "no inventar hora": mensaje sin ninguna referencia horaria -> null', sbHelp.resolveTimeExpression('tengo médico el jueves') === null);
  }

  // =====================================================================
  section('5) Modificaciones (AI-1.5): mover fecha, mover hora, mover fecha+hora, cancelar, prioridad, referencia existente, ambigüedad');
  // =====================================================================
  {
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24', startTime: '10:00' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('5a. mover solo fecha: newDate aplicado, hora original intacta', sb.state.events[0].date === '2026-09-18' && sb.state.events[0].startTime === '10:00');
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: null, newTime: '19:00' }] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Entrenamiento', date: '2026-09-17', startTime: '18:00' });
      await sb.AIActions.runIAAction('Pon el entrenamiento a las 19');
      check('5b. mover solo hora: newTime aplicado, fecha original intacta', sb.state.events[0].startTime === '19:00' && sb.state.events[0].date === '2026-09-17');
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-10-24', newTime: '17:00' }] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Parcial', date: '2026-09-24', startTime: '10:00' });
      await sb.AIActions.runIAAction('El parcial es el 24 de octubre a las 5 de la tarde');
      check('5c. mover fecha+hora combinadas: ambas aplicadas', sb.state.events[0].date === '2026-10-24' && sb.state.events[0].startTime === '17:00');
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Cancelado.', actions: [{ op: 'cancel_item', targetKind: 'task', targetId: 't1' }] }), TODAY);
      sb.state.tasks.push({ id: 't1', title: 'Estudiar', dueDate: '2026-09-18' });
      await sb.AIActions.runIAAction('Elimina la tarea de estudiar');
      check('5d. cancelar funciona (tarea eliminada)', sb.state.tasks.length === 0);
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Prioridad cambiada.', actions: [{ op: 'update_priority', targetKind: 'task', targetId: 't1', newPriority: 'alta' }] }), TODAY);
      sb.state.tasks.push({ id: 't1', title: 'Entregar informe', priority: 'media' });
      await sb.AIActions.runIAAction('Pon la tarea de entregar el informe como prioridad alta');
      check('5e. cambio de prioridad funciona (update_priority, esquema ya existente)', sb.state.tasks[0].priority === 'alta');
    }
    {
      // referencia a elemento existente: el mock usa el id REAL tomado de state (nunca inventado por el test).
      const sb = makeActionSandbox(async (system, userPrompt) => {
        const idMatch = /id:(\S+) \[evento\] "Examen de biología"/.exec(userPrompt);
        return { answer: 'Movido.', actions: idMatch ? [{ op: 'move_item', targetKind: 'event', targetId: idMatch[1], newDate: '2026-09-18', newTime: null }] : [] };
      }, TODAY);
      sb.state.events.push({ id: 'e-real-999', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
      check('5f. referencia a elemento existente: identificado por id real leído del contexto (LISTA DE ELEMENTOS EXISTENTES)', sb.state.events[0].id === 'e-real-999' && sb.state.events[0].date === '2026-09-18');
    }
    {
      // referencia ambigua: dos candidatos con el mismo título -> el mock (conservador) no elige ninguno.
      const sb = makeActionSandbox(async () => ({ answer: 'Hay dos exámenes de biología, ¿cuál quieres mover?', actions: [] }), TODAY);
      sb.state.events.push({ id: 'e-amb-1', title: 'Examen de biología', date: '2026-09-24' });
      sb.state.events.push({ id: 'e-amb-2', title: 'Examen de biología', date: '2026-10-05' });
      await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
      check('5g. referencia ambigua: ningún candidato se elige arbitrariamente (ambos quedan intactos)', sb.state.events.every(e => e.date === '2026-09-24' || e.date === '2026-10-05'));
    }
  }

  // =====================================================================
  section('6) Conversación/contexto: crear+mover, crear+cancelar, referencias como "ese/esa/cancélalo", evitar duplicados');
  // =====================================================================
  {
    // crear -> "ese examen" -> mover, usando el id real generado por el primer turno.
    {
      const sb = makeActionSandbox(async (system, userPrompt) => {
        if (/Tengo un examen de biología el jueves/.test(userPrompt)) {
          return { answer: 'Apuntado.', actions: [{ op: 'create_event', title: 'Examen de biología', date: '2026-09-24', endDate: null, allDay: true, startTime: null, endTime: null, location: null }] };
        }
        const idMatch = /id:(\S+) \[evento\] "Examen de biología"/.exec(userPrompt);
        return { answer: 'Movido.', actions: idMatch ? [{ op: 'move_item', targetKind: 'event', targetId: idMatch[1], newDate: '2026-09-18', newTime: null }] : [] };
      }, TODAY);
      await sb.AIActions.runIAAction('Tengo un examen de biología el jueves');
      const realId = sb.state.events[0].id;
      await sb.AIActions.runIAAction('mueve ese examen al viernes');
      check('6a. "ese examen" (contexto) mueve el MISMO evento creado antes, sin duplicarlo', sb.state.events.length === 1 && sb.state.events[0].id === realId && sb.state.events[0].date === '2026-09-18');
    }
    // crear -> "esa reunión"/"cancélalo" -> cancelar, usando el id real.
    {
      const sb = makeActionSandbox(async (system, userPrompt) => {
        if (/Mañana tengo reunión/.test(userPrompt)) {
          return { answer: 'Apuntada.', actions: [{ op: 'create_event', title: 'Reunión', date: '2026-09-18', endDate: null, allDay: true, startTime: null, endTime: null, location: null }] };
        }
        const idMatch = /id:(\S+) \[evento\] "Reunión"/.exec(userPrompt);
        return { answer: 'Cancelada.', actions: idMatch ? [{ op: 'cancel_item', targetKind: 'event', targetId: idMatch[1] }] : [] };
      }, TODAY);
      await sb.AIActions.runIAAction('Mañana tengo reunión');
      check('6b. primer turno crea la reunión', sb.state.events.length === 1);
      await sb.AIActions.runIAAction('cancélala');
      check('6c. "cancélala" (esa reunión, contexto) elimina la MISMA reunión creada antes', sb.state.events.length === 0);
    }
    // evitar duplicados: dos turnos idénticos ("mueve el examen al viernes" repetido con la misma acción) no deben duplicar el movimiento.
    {
      const moveAction = { op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null };
      const sb = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [moveAction, JSON.parse(JSON.stringify(moveAction))] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('6d. evitar duplicados: dos move_item idénticos en la misma respuesta -> solo se aplica 1 vez', sb.__calls.updateEvent === 1);
    }
  }

  // =====================================================================
  section('7) Conservadurismo: comentarios sin instrucción clara no producen ninguna acción');
  // =====================================================================
  {
    const noActionMsgs = ['Hoy estoy cansado', 'Qué día tan largo', 'Vale, entendido', 'Gracias', 'Quizá cambie el examen', 'Estoy estudiando mucho', 'Mañana quizá descanse'];
    for (const msg of noActionMsgs) {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [] }), TODAY);
      const result = await sb.AIActions.runIAAction(msg);
      check(`7. "${msg}" no produce ninguna acción`, sb.state.tasks.length === 0 && sb.state.events.length === 0 && result.applied.length === 0);
    }
  }

  // =====================================================================
  section('8) No invención: IDs, fechas, horas, prioridad, categoría, duración, recordatorio, notas, ubicación');
  // =====================================================================
  {
    const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [{ op: 'create_task', title: 'Comprar leche', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null }] }), TODAY);
    await sb.AIActions.runIAAction('Necesito comprar leche');
    const t = sb.state.tasks[0];
    check('8a. no inventa fecha (dueDate null)', t.dueDate === null);
    check('8b. no inventa hora (dueTime vacío)', t.dueTime === '');
    check('8c. no inventa prioridad distinta de la media por defecto', t.priority === 'media');
    check('8d. no inventa categoría', !('category' in t) && !('categoryId' in t));
    check('8e. no inventa notas', t.notes === '');
    check('8f. no inventa ubicación', !('location' in t));
    {
      let taskPassedToScheduler = null;
      const sb2 = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [{ op: 'create_task', title: 'Comprar pan', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null }] }), TODAY);
      sb2.Scheduler.scheduleTask = (task) => { taskPassedToScheduler = task; return { scheduledDate: null, scheduledStart: null, scheduledEnd: null, estimatedMinutes: task.estimatedMinutes, schedulingWarning: null }; };
      await sb2.AIActions.runIAAction('Necesito comprar pan');
      check('8g. no inventa duración (estimatedMinutes se pasa a Scheduler tal cual, sin fabricar un número)', taskPassedToScheduler && taskPassedToScheduler.estimatedMinutes === null);
    }
    {
      const sb3 = makeActionSandbox(async () => ({ answer: 'Cancelado.', actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e1' }] }), TODAY);
      sb3.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24' });
      const result3 = await sb3.AIActions.runIAAction('Cancela el examen');
      check('8h. no inventa recordatorio (nada relacionado con "reminder" en el mensaje aplicado)', !/reminder/i.test(result3.applied.join(' ')));
    }
    {
      // no inventa un ID: move_item/cancel_item sobre un targetId inexistente no crea ni modifica nada.
      const sb4 = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [{ op: 'move_item', targetKind: 'event', targetId: 'id-que-no-existe', newDate: '2026-09-18', newTime: null }] }), TODAY);
      await sb4.AIActions.runIAAction('Mueve algo');
      check('8i. no inventa un id: un targetId que no existe en state no crea ni actualiza nada', sb4.state.events.length === 0 && sb4.__calls.updateEvent === 0);
    }
  }

  // =====================================================================
  section('9) Dedupe (AI-1.1): protege contra duplicados exactos, y create_event+move_item nunca se sugieren a la vez para el mismo mensaje');
  // =====================================================================
  {
    const dupAction = { op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null };
    const sb = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [dupAction, JSON.parse(JSON.stringify(dupAction))] }), TODAY);
    sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24' });
    await sb.AIActions.runIAAction('Mueve el examen al viernes');
    check('9a. "Mueve el examen al viernes" no genera dos move_item equivalentes (dedupeActions los colapsa a 1)', sb.__calls.updateEvent === 1);

    // El contexto real que se le manda a la IA para un mensaje de
    // movimiento no sugiere "create_event": solo "move_item" — así el
    // propio contexto no anima a la IA a devolver ambas a la vez.
    const sb2 = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }] }), TODAY);
    sb2.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
    await sb2.AIActions.runIAAction('Mueve el examen de biología al viernes');
    check('9b. el contexto real de un mensaje de movimiento sugiere "move_item", no "create_event" (sin incitar a generar ambas)',
      /probablemente "move_item"/.test(sb2.__lastUserPrompt) && !/probablemente "create_event"/.test(sb2.__lastUserPrompt));

    // Si el modelo (mal comportado) devolviera a la vez un create_event Y
    // un move_item para el mismo hecho, dedupeActions NO los colapsa
    // (son objetos distintos: eso documenta su límite real, JSON.stringify
    // exacto, no semántico) — la responsabilidad de no generar ambas es
    // de ACTION_RULES/la IA, no de dedupeActions ni de un segundo sistema
    // de deduplicación semántica que AI-1 no implementa.
    const sb3 = makeActionSandbox(async () => ({
      answer: 'Vale.',
      actions: [
        { op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null },
        { op: 'create_event', title: 'Examen de biología', date: '2026-09-18', endDate: null, allDay: true, startTime: null, endTime: null, location: null },
      ],
    }), TODAY);
    sb3.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
    await sb3.AIActions.runIAAction('Mueve el examen de biología al viernes');
    check('9c. dedupeActions no confunde create_event con move_item (son acciones distintas, no duplicados exactos) — documenta que evitar esta combinación es responsabilidad de ACTION_RULES/la IA guiada por la pista de 9b, no de dedupeActions',
      sb3.__calls.updateEvent === 1 && sb3.__calls.addEvent === 1);
  }

  // =====================================================================
  section('10) Precedencia AI-1.5 (conflictos descubiertos durante AI-1.5, regresión explícita)');
  // =====================================================================
  {
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Cancelado.', actions: [{ op: 'cancel_item', targetKind: 'task', targetId: 't1' }] }), TODAY);
      sb.state.tasks.push({ id: 't1', title: 'Ir al médico', dueDate: '2026-09-21' });
      await sb.AIActions.runIAAction('No tengo que ir al médico finalmente');
      check('10a. "No tengo que ir al médico finalmente" se interpreta como cancelación, no como creación de un evento médico', sb.state.tasks.length === 0 && sb.state.events.length === 0 && sb.__calls.addEvent === 0);
      check('10a-bis. el contexto real de ese mensaje incluye la pista de CANCELAR de AI-1.5, no la de CITA de AI-1.3', /CANCELAR\/ELIMINAR/.test(sb.__lastUserPrompt) && !/CITA\/COMPROMISO/.test(sb.__lastUserPrompt));
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Cancelado.', actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e1' }] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Cancela el examen de biología');
      check('10b. "Cancela el examen de biología" no se convierte en create_event (0 addEvent, evento eliminado)', sb.__calls.addEvent === 0 && sb.state.events.length === 0);
    }
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Movido.', actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }] }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
      check('10c. "Mueve el examen de biología al viernes" no se convierte en create_event (0 addEvent, 1 evento actualizado)', sb.__calls.addEvent === 0 && sb.state.events.length === 1 && sb.state.events[0].date === '2026-09-18');
    }
  }

  // =====================================================================
  section('11) node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('11. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('11. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
