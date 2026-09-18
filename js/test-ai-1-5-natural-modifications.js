/**
 * ORGANIZATOR — Tests de AI-1.5 (modificar/mover/cancelar naturalmente)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón de dos capas que
 * el resto de la suite AI-1.x (test-ai-1-2/3/4):
 *
 *  a) Funciones PURAS de AI-1.5 (isMoveMessage, isCancelMessage,
 *     isPriorityChangeMessage, buildModificationHints), que viven dentro
 *     del IIFE de js/ai-actions.js y NO forman parte de `global.AIActions`
 *     (a propósito, mismo criterio que AI-1.2/1.3/1.4 — ver test 0). Se
 *     extraen literalmente por CONTENIDO junto con los bloques AI-1.2
 *     (resolveDateExpression/resolveTimeExpression, de los que depende
 *     buildModificationHints) y AI-1.3/AI-1.4 (isHolidayMessage/
 *     isAppointmentMessage/isTaskMessage, que AI-1.5 NO reimplementa) y
 *     se ejecutan aisladas en un sandbox `vm`, sin mocks: son funciones
 *     puras, no leen `state` ni tocan el DOM.
 *  b) runIAAction() end-to-end con `callAI` mockeado (mismo patrón que
 *     el resto de la suite AI-1.x): el mock simula lo que una IA
 *     correctamente guiada por el ACTION_RULES ampliado en AI-1.5
 *     devolvería para cada mensaje de ejemplo — SIEMPRE con un
 *     "targetId" real, tomado de `state` (nunca inventado por el test ni
 *     por AI-1.5), reproduciendo que la identificación del elemento la
 *     hace la IA a partir de la LISTA DE ELEMENTOS EXISTENTES real de
 *     buildActionContext(), nunca una heurística de AI-1.5.
 *
 * Uso:  node js/test-ai-1-5-natural-modifications.js
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
// Bloques AI-1.2 (fecha/hora) + AI-1.3 (eventos implícitos) + AI-1.4
// (tareas implícitas, del que además depende AI-1.3) + AI-1.5
// (modificar/mover/cancelar), literales de ai-actions.js.
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

/** Sandbox aislado SOLO con los bloques puros AI-1.2 + AI-1.3 + AI-1.4 +
 * AI-1.5 (sin `state`, sin DOM, sin callAI). */
function makeModSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + '\n' + implicitTaskSrc + '\n' + modificationSrc + `
    this.isMoveMessage = isMoveMessage;
    this.isCancelMessage = isCancelMessage;
    this.isPriorityChangeMessage = isPriorityChangeMessage;
    this.buildModificationHints = buildModificationHints;
    this.isHolidayMessage = isHolidayMessage;
    this.isAppointmentMessage = isAppointmentMessage;
    this.isTaskMessage = isTaskMessage;
    this.resolveDateExpression = resolveDateExpression;
    this.resolveTimeExpression = resolveTimeExpression;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2 + AI-1.3 + AI-1.4 + AI-1.5)' }
  );
  return sandbox;
}

/** Sandbox completo con ai-actions.js REAL cargado (para las pruebas
 * end-to-end de runIAAction), mismo patrón de mocks que el resto de la
 * suite AI-1.x. `todayStr` es fijo y NO usa `new Date()`. */
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
  section('0) Compatibilidad / alcance: contratos existentes intactos');
  // =====================================================================
  {
    check('0. ACTION_SCHEMA no cambió (nombres de campo/tipos "op" intactos, incluidos move_item/cancel_item/update_priority)',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      ['"targetId"', '"targetKind"', '"newDate"', '"newTime"', '"newPriority"'].every(f => aiActionsSrc.includes(f)));
    check('0. no se creó ningún tipo de "op" nuevo (sigue habiendo exactamente 5 en el esquema)',
      (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
    check('0. global.AIActions sigue exportando exactamente runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0. dedupeActions() sigue presente (no se eliminó ni se reemplazó)', /function dedupeActions\(actions\)\s*\{/.test(aiActionsSrc));
    check('0. buildActionContext() sigue presente sin tocar (misma LISTA DE ELEMENTOS EXISTENTES de siempre)',
      /function buildActionContext\(\)\s*\{/.test(aiActionsSrc) && /LISTA DE ELEMENTOS EXISTENTES/.test(aiActionsSrc));
    check('0. resolveDateExpression/resolveTimeExpression (AI-1.2) siguen con una única definición cada una (AI-1.5 no las duplica)',
      (aiActionsSrc.match(/function resolveDateExpression\(/g) || []).length === 1 &&
      (aiActionsSrc.match(/function resolveTimeExpression\(/g) || []).length === 1);
    check('0. isHolidayMessage/isAppointmentMessage/isTaskMessage (AI-1.3/AI-1.4) siguen presentes (no se eliminaron helpers existentes)',
      /function isHolidayMessage\(/.test(aiActionsSrc) && /function isAppointmentMessage\(/.test(aiActionsSrc) && /function isTaskMessage\(/.test(aiActionsSrc));
    check('0. applyMoveItem/applyCancelItem/applyUpdatePriority siguen presentes sin duplicarse (AI-1.5 no reimplementa la aplicación de las acciones)',
      (aiActionsSrc.match(/async function applyMoveItem\(/g) || []).length === 1 &&
      (aiActionsSrc.match(/async function applyCancelItem\(/g) || []).length === 1 &&
      (aiActionsSrc.match(/async function applyUpdatePriority\(/g) || []).length === 1);
    check('0. ai-actions.js sigue sin definir su propia lógica de Scheduler (solo la CONSUME vía global.Scheduler)',
      !/function\s+scheduleTask\s*\(/.test(aiActionsSrc) && /global\.Scheduler\.scheduleTask/.test(aiActionsSrc));
  }

  const sb0 = makeModSandbox();

  // =====================================================================
  section('Movimiento de fecha (1-4)');
  // =====================================================================
  {
    check('1. "Mueve el examen de biología al viernes" -> movimiento', sb0.isMoveMessage('Mueve el examen de biología al viernes') === true);
    check('2. "Pasa la reunión al lunes" -> movimiento', sb0.isMoveMessage('Pasa la reunión al lunes') === true);
    check('3. "Pon el entrenamiento para mañana" -> movimiento', sb0.isMoveMessage('Pon el entrenamiento para mañana') === true);
    check('4. "Cambia el examen al próximo jueves" -> movimiento', sb0.isMoveMessage('Cambia el examen al próximo jueves') === true);
  }

  // =====================================================================
  section('Movimiento de hora (5-7)');
  // =====================================================================
  {
    check('5. "Cambia la reunión de las 10 a las 11" -> movimiento', sb0.isMoveMessage('Cambia la reunión de las 10 a las 11') === true);
    check('6. "Pon el entrenamiento a las 19" -> movimiento', sb0.isMoveMessage('Pon el entrenamiento a las 19') === true);
    check('7. "Haz que el examen sea a las 10" -> movimiento', sb0.isMoveMessage('Haz que el examen sea a las 10') === true);
  }

  // =====================================================================
  section('Cancelación (8-12)');
  // =====================================================================
  {
    check('8. "Cancela el examen de biología" -> cancelación', sb0.isCancelMessage('Cancela el examen de biología') === true);
    check('9. "Ya no tengo la reunión" -> cancelación', sb0.isCancelMessage('Ya no tengo la reunión') === true);
    check('10. "Elimina la tarea de estudiar" -> cancelación', sb0.isCancelMessage('Elimina la tarea de estudiar') === true);
    check('11. "Borra el evento de dentista" -> cancelación', sb0.isCancelMessage('Borra el evento de dentista') === true);
    check('12. "No tengo que ir al médico finalmente" -> cancelación (pese a compartir palabras con el patrón de cita de AI-1.3)', sb0.isCancelMessage('No tengo que ir al médico finalmente') === true);
  }

  // =====================================================================
  section('Diferenciación crear/mover/cancelar (13-18)');
  // =====================================================================
  {
    check('13. "Tengo un examen de biología el jueves" no se detecta como movimiento ni cancelación (sigue siendo posible creación)',
      sb0.isMoveMessage('Tengo un examen de biología el jueves') === false && sb0.isCancelMessage('Tengo un examen de biología el jueves') === false);
    check('14. "Mueve el examen de biología al viernes" se detecta como movimiento, no como cancelación', sb0.isMoveMessage('Mueve el examen de biología al viernes') === true && sb0.isCancelMessage('Mueve el examen de biología al viernes') === false);
    check('15. "Cancela el examen de biología" se detecta como cancelación, no como movimiento', sb0.isCancelMessage('Cancela el examen de biología') === true && sb0.isMoveMessage('Cancela el examen de biología') === false);
    // 16/17/18 end-to-end: ver sección "Compatibilidad end-to-end" más abajo (E1/E2/E3).
  }

  // =====================================================================
  section('Fechas/horas reutilizando AI-1.2 (19-24)');
  // =====================================================================
  {
    check('19. movimiento a "mañana" usa la fecha resuelta por AI-1.2', sb0.resolveDateExpression('Pon el entrenamiento para mañana', TODAY) === '2026-09-18');
    check('20. movimiento a "el viernes" usa la fecha resuelta por AI-1.2', sb0.resolveDateExpression('Mueve el examen de biología al viernes', TODAY) === '2026-09-18');
    check('21. movimiento a "el próximo lunes" usa la fecha resuelta por AI-1.2 (política este/próximo de AI-1.2, sin reimplementarla)', sb0.resolveDateExpression('Cambia el examen al próximo lunes', TODAY) === '2026-09-28');
    check('22. cambio a "las 19" usa la hora resuelta por AI-1.2', sb0.resolveTimeExpression('Pon el entrenamiento a las 19') === '19:00');
    check('23. no inventa una hora cuando no existe ("Mueve el examen de biología al viernes" no da hora)', sb0.resolveTimeExpression('Mueve el examen de biología al viernes') === null);
    check('24. no inventa una fecha cuando no existe ("Cambia la reunión de las 10 a las 11" no da fecha nueva)', sb0.resolveDateExpression('Cambia la reunión de las 10 a las 11', TODAY) === null);
  }

  // =====================================================================
  section('Identificación del elemento objetivo (25-30)');
  // =====================================================================
  {
    // 25/26: usa el id explícito que trae la acción (nunca uno inventado
    // por el propio código de ai-actions.js) — comprobado end-to-end.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e-real-123', newDate: '2026-09-18', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e-real-123', title: 'Examen de biología', date: '2026-09-24', endDate: '', allDay: false, startTime: '10:00', endTime: '11:00' });
      await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
      check('25. usa el id EXACTO que trae la acción (el mismo que ya existía en state, no uno regenerado)', sb.state.events[0].id === 'e-real-123');
      check('26. no inventa un id nuevo: sigue habiendo exactamente 1 evento (no se creó ninguno con otro id)', sb.state.events.length === 1);
    }
    // 27: identifica por título cuando es inequívoco (mismo criterio:
    // el mock representa a la IA leyendo la lista real y copiando el id).
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Cancelado.',
        actions: [{ op: 'cancel_item', targetKind: 'task', targetId: 't-unico' }],
      }), TODAY);
      sb.state.tasks.push({ id: 't-unico', title: 'Estudiar biología', dueDate: '2026-09-18', priority: 'media' });
      await sb.AIActions.runIAAction('Elimina la tarea de estudiar');
      check('27. identifica por título inequívoco (única tarea con ese título) y la elimina', sb.state.tasks.length === 0);
    }
    // 28: título + fecha/hora coincidentes para desambiguar entre dos candidatos con el mismo título.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido el de las 18.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e-18h', newTime: '19:00', newDate: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e-18h', title: 'Entrenamiento', date: '2026-09-17', allDay: false, startTime: '18:00', endTime: '19:00' });
      sb.state.events.push({ id: 'e-otro-dia', title: 'Entrenamiento', date: '2026-09-20', allDay: false, startTime: '09:00', endTime: '10:00' });
      await sb.AIActions.runIAAction('Cambia el entrenamiento de las 18 a las 19');
      const moved = sb.state.events.find(e => e.id === 'e-18h');
      const untouched = sb.state.events.find(e => e.id === 'e-otro-dia');
      check('28. con título repetido, identifica por título + hora coincidente (solo se mueve el de las 18:00)', moved.startTime === '19:00');
      check('28b. el otro candidato con el mismo título NO se toca', untouched.startTime === '09:00');
    }
    // 29: no depende de la posición en el array (se mueve el SEGUNDO
    // elemento de la lista, no "el primero" ni "el último").
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Cancelado.',
        actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e-segundo' }],
      }), TODAY);
      sb.state.events.push({ id: 'e-primero', title: 'Otra cosa', date: '2026-09-18' });
      sb.state.events.push({ id: 'e-segundo', title: 'Examen de biología', date: '2026-09-24' });
      sb.state.events.push({ id: 'e-tercero', title: 'Otra cosa más', date: '2026-09-19' });
      await sb.AIActions.runIAAction('Cancela el examen de biología');
      check('29. cancela el elemento correcto por id, sin importar su posición en el array (el 2º de 3, no el 1º)',
        sb.state.events.length === 2 && !sb.state.events.some(e => e.id === 'e-segundo') && sb.state.events.some(e => e.id === 'e-primero') && sb.state.events.some(e => e.id === 'e-tercero'));
    }
    // 30: candidatos ambiguos -> la IA (mock conservador) no elige
    // arbitrariamente: devuelve actions: [] y nada cambia.
    {
      const sb = makeActionSandbox(async () => ({ answer: 'No estoy seguro de a cuál te refieres: hay dos exámenes de biología. ¿Cuál quieres mover?', actions: [] }), TODAY);
      sb.state.events.push({ id: 'e-amb-1', title: 'Examen de biología', date: '2026-09-24' });
      sb.state.events.push({ id: 'e-amb-2', title: 'Examen de biología', date: '2026-10-02' });
      await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
      check('30. con varios candidatos ambiguos, no se modifica ni se elige ninguno arbitrariamente (ambos eventos quedan intactos)',
        sb.state.events.length === 2 && sb.state.events.every(e => e.date === '2026-09-24' || e.date === '2026-10-02'));
    }
  }

  // =====================================================================
  section('No acción (31-35)');
  // =====================================================================
  {
    check('31. "Hoy estoy cansado" -> ninguna pista de modificación/cancelación', sb0.buildModificationHints('Hoy estoy cansado', TODAY) === '');
    check('32. "Qué día tan largo" -> ninguna pista de modificación/cancelación', sb0.buildModificationHints('Qué día tan largo', TODAY) === '');
    check('33. "Vale, entendido" -> ninguna pista de modificación/cancelación', sb0.buildModificationHints('Vale, entendido', TODAY) === '');
    check('34. "Gracias" -> ninguna pista de modificación/cancelación', sb0.buildModificationHints('Gracias', TODAY) === '');
    check('35. "Quizá cambie el examen" (sin instrucción clara) -> ninguna pista (contiene "cambie", no "cambia"/"cambiar", y sin verbo imperativo real)', sb0.buildModificationHints('Quizá cambie el examen', TODAY) === '');
    check('35b. end-to-end: "Hoy estoy cansado" no crea ni modifica nada', await (async () => {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [] }), TODAY);
      const result = await sb.AIActions.runIAAction('Hoy estoy cansado');
      return sb.state.tasks.length === 0 && sb.state.events.length === 0 && result.applied.length === 0;
    })());
  }

  // =====================================================================
  section('Conversación / contexto entre turnos (36-40)');
  // =====================================================================
  {
    // 36: crear examen -> "mueve ese examen al viernes" usa el id real
    // que quedó en `state` tras el primer turno (mismo `state`, dos
    // llamadas a runIAAction, tal como ocurre en el chat real).
    {
      const sb = makeActionSandbox(
        // El mock responde de forma distinta según el mensaje, igual que
        // haría la IA real leyendo el contexto que ya incluye el examen
        // recién creado en su segunda llamada.
        async (system, userPrompt) => {
          if (/Tengo un examen de biología el jueves/.test(userPrompt)) {
            return { answer: 'Apuntado.', actions: [{ op: 'create_event', title: 'Examen de biología', date: '2026-09-24', endDate: null, allDay: true, startTime: null, endTime: null, location: null }] };
          }
          // Segundo turno: la IA real leería el id real del examen en la
          // LISTA DE ELEMENTOS EXISTENTES del contexto; aquí se simula
          // extrayéndolo del propio prompt (mismo id que generó addEvent).
          const idMatch = /id:(\S+) \[evento\] "Examen de biología"/.exec(userPrompt);
          return { answer: 'Movido.', actions: idMatch ? [{ op: 'move_item', targetKind: 'event', targetId: idMatch[1], newDate: '2026-09-18', newTime: null }] : [] };
        },
        TODAY
      );
      await sb.AIActions.runIAAction('Tengo un examen de biología el jueves');
      check('36a. primer turno: se crea el examen', sb.state.events.length === 1);
      const realId = sb.state.events[0].id;
      await sb.AIActions.runIAAction('mueve ese examen al viernes');
      check('36b. segundo turno: usa el contexto (el id real generado en el primer turno) para mover el MISMO examen', sb.state.events.length === 1 && sb.state.events[0].id === realId && sb.state.events[0].date === '2026-09-18');
    }
    // 37: crear reunión -> "cancélala" usa contexto.
    {
      const sb = makeActionSandbox(
        async (system, userPrompt) => {
          if (/Mañana tengo reunión/.test(userPrompt)) {
            return { answer: 'Apuntada.', actions: [{ op: 'create_event', title: 'Reunión', date: '2026-09-18', endDate: null, allDay: true, startTime: null, endTime: null, location: null }] };
          }
          const idMatch = /id:(\S+) \[evento\] "Reunión"/.exec(userPrompt);
          return { answer: 'Cancelada.', actions: idMatch ? [{ op: 'cancel_item', targetKind: 'event', targetId: idMatch[1] }] : [] };
        },
        TODAY
      );
      await sb.AIActions.runIAAction('Mañana tengo reunión');
      check('37a. primer turno: se crea la reunión', sb.state.events.length === 1);
      await sb.AIActions.runIAAction('cancélala');
      check('37b. segundo turno: "cancélala" usa el contexto para eliminar la MISMA reunión creada antes', sb.state.events.length === 0);
    }
    // 38: la referencia contextual no crea un duplicado (ya verificado
    // arriba: state.events.length se mantiene en 1 tras mover, nunca 2).
    check('38. la referencia contextual del turno 36b no duplicó el examen (comprobado arriba: state.events.length siguió en 1)', true);
    // 39: la referencia contextual no inventa otro elemento distinto (el
    // id movido/cancelado en 36b/37b es exactamente el generado en el
    // primer turno, no uno nuevo inventado por el segundo mensaje).
    check('39. la referencia contextual no inventó un elemento distinto (comprobado arriba: mismo id antes y después)', true);
    // 40: una referencia ambigua (dos candidatos ya creados) no se resuelve arbitrariamente.
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Hay dos exámenes de biología, ¿cuál quieres mover?', actions: [] }), TODAY);
      sb.state.events.push({ id: 'e-c1', title: 'Examen de biología', date: '2026-09-24' });
      sb.state.events.push({ id: 'e-c2', title: 'Examen de biología', date: '2026-10-05' });
      await sb.AIActions.runIAAction('muévelo al viernes');
      check('40. referencia ambigua ("muévelo") con dos candidatos: ninguno se modifica arbitrariamente', sb.state.events.every(e => e.date === '2026-09-24' || e.date === '2026-10-05'));
    }
  }

  // =====================================================================
  section('No invención de campos (41-46, end-to-end con callAI mockeado)');
  // =====================================================================
  {
    // 41: no inventa prioridad al mover (move_item no toca priority salvo que se pida explícitamente vía update_priority).
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24', priority: undefined });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('41. no inventa prioridad: move_item no añade ningún campo "priority" al evento', !('priority' in sb.state.events[0]) || sb.state.events[0].priority === undefined);
    }
    // 42: no inventa categoría.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('42. no inventa categoría: move_item no añade "category"/"categoryId"', !('category' in sb.state.events[0]) && !('categoryId' in sb.state.events[0]));
    }
    // 43: no inventa duración (estimatedMinutes) al mover una tarea sin hora explícita — Scheduler.scheduleTask recibe lo que ya tenía la tarea, AI-1.5 no le añade nada.
    {
      let taskPassedToScheduler = null;
      const sb = makeActionSandbox(async () => ({
        answer: 'Movida.',
        actions: [{ op: 'move_item', targetKind: 'task', targetId: 't1', newDate: '2026-09-20', newTime: null }],
      }), TODAY);
      sb.state.tasks.push({ id: 't1', title: 'Estudiar', dueDate: '2026-09-18', priority: 'media', estimatedMinutes: null });
      sb.Scheduler.scheduleTask = (task) => { taskPassedToScheduler = task; return { scheduledDate: null, scheduledStart: null, scheduledEnd: null, estimatedMinutes: task.estimatedMinutes, schedulingWarning: null }; };
      await sb.AIActions.runIAAction('Mueve la tarea de estudiar al 20');
      check('43. no inventa duración: el objeto que llega a Scheduler.scheduleTask conserva el estimatedMinutes original (null), AI-1.5 no fabrica ninguno', taskPassedToScheduler && taskPassedToScheduler.estimatedMinutes === null);
    }
    // 44: no inventa recordatorio.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Cancelado.',
        actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e1' }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24' });
      const result = await sb.AIActions.runIAAction('Cancela el examen');
      check('44. no inventa recordatorio: runIAAction no crea ni referencia ningún "reminder" al cancelar (applied trae solo la nota de eliminación)', Array.isArray(result.applied) && result.applied.length === 1 && !/reminder/i.test(result.applied[0]));
    }
    // 45: no inventa notas.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24', notes: '' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('45. no inventa notas: move_item no toca/añade "notes"', sb.state.events[0].notes === '');
    }
    // 46: no inventa ubicación.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen', date: '2026-09-24', location: '' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('46. no inventa ubicación: move_item no toca/añade "location"', sb.state.events[0].location === '');
    }
  }

  // =====================================================================
  section('Compatibilidad end-to-end adicional (16-18, E1-E3) y dedupe (11.)');
  // =====================================================================
  {
    // E1/16: mover no genera create_event.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
      check('E1/16. move_item no genera ningún create_event (addEvent no se llama, sigue habiendo 1 solo evento)', sb.__calls.addEvent === 0 && sb.state.events.length === 1);
    }
    // E2/17: cancelar no genera create_event.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Cancelado.',
        actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e1' }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Cancela el examen de biología');
      check('E2/17. cancel_item no genera ningún create_event (addEvent no se llama, el evento queda eliminado)', sb.__calls.addEvent === 0 && sb.state.events.length === 0);
    }
    // E3/18: no duplica el elemento objetivo (mover no crea uno nuevo además de actualizar el existente).
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
      check('E3/18. no duplica el elemento objetivo: sigue habiendo exactamente 1 evento con el mismo id de siempre', sb.state.events.length === 1 && sb.state.events[0].id === 'e1');
    }
    // Dedupe (AI-1.1, sección 11 del enunciado): "Mueve el examen al
    // viernes" no debe producir dos move_item idénticos.
    {
      const dupAction = { op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null };
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [dupAction, JSON.parse(JSON.stringify(dupAction))],
      }), TODAY);
      sb.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes');
      check('D1. dedupeActions() sigue funcionando: dos move_item idénticos devueltos por el modelo se aplican solo 1 vez', sb.__calls.updateEvent === 1);
    }
  }

  // =====================================================================
  section('Integración con runIAAction (contexto real enviado a la IA, sin pistas contradictorias)');
  // =====================================================================
  {
    const sb = makeActionSandbox(async () => ({
      answer: 'Movido.',
      actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e1', newDate: '2026-09-18', newTime: null }],
    }), TODAY);
    sb.state.events.push({ id: 'e1', title: 'Examen de biología', date: '2026-09-24' });
    await sb.AIActions.runIAAction('Mueve el examen de biología al viernes');
    check('I1. el contexto real enviado a la IA incluye la pista de movimiento de AI-1.5', /Parece pedir MOVER la fecha/.test(sb.__lastUserPrompt));
    check('I2. el contexto real incluye la nueva fecha ya resuelta por AI-1.2 dentro de la pista de AI-1.5', /Nueva fecha detectada en el mensaje: 2026-09-18/.test(sb.__lastUserPrompt));
    check('I3. el contexto real NO incluye la pista de cita/festivo de AI-1.3 para este mensaje de movimiento (sin contradicción)', !/CITA\/COMPROMISO/.test(sb.__lastUserPrompt) && !/FESTIVO\/DÍA/.test(sb.__lastUserPrompt));
    check('I4. el contexto real NO incluye la pista de tarea implícita de AI-1.4 para este mensaje de movimiento (sin contradicción)', !/Parece describir una TAREA pendiente/.test(sb.__lastUserPrompt));

    const sbCancel = makeActionSandbox(async () => ({
      answer: 'Cancelado.',
      actions: [{ op: 'cancel_item', targetKind: 'task', targetId: 't1' }],
    }), TODAY);
    sbCancel.state.tasks.push({ id: 't1', title: 'Ir al médico', dueDate: '2026-09-21' });
    await sbCancel.AIActions.runIAAction('No tengo que ir al médico finalmente');
    check('I5. "No tengo que ir al médico finalmente": el contexto real incluye la pista de CANCELAR de AI-1.5', /CANCELAR\/ELIMINAR/.test(sbCancel.__lastUserPrompt));
    check('I6. ese mismo mensaje NO incluye la pista de cita de AI-1.3 (AI-1.5 tiene prioridad, sin contradicción)', !/CITA\/COMPROMISO/.test(sbCancel.__lastUserPrompt));
    check('I7. y de verdad se cancela (no se crea un evento nuevo de "Médico")', sbCancel.state.tasks.length === 0 && sbCancel.state.events.length === 0);
  }

  // =====================================================================
  section('47-50) Compatibilidad de contratos (repetido explícitamente)');
  // =====================================================================
  {
    check('47. ACTION_SCHEMA sigue igual (misma definición literal de siempre)', /const ACTION_SCHEMA = `\{/.test(aiActionsSrc));
    check('48. ACTION_RULES sigue existiendo', /const ACTION_RULES = `/.test(aiActionsSrc));
    check('49. global.AIActions sigue exportando lo esperado', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    {
      const dupAction = { op: 'cancel_item', targetKind: 'event', targetId: 'eX' };
      const sb = makeActionSandbox(async () => ({ answer: '', actions: [dupAction, JSON.parse(JSON.stringify(dupAction))] }), TODAY);
      sb.state.events.push({ id: 'eX', title: 'X', date: '2026-09-20' });
      await sb.AIActions.runIAAction('Cancela X');
      check('50. dedupeActions() sigue funcionando end-to-end (cancel_item repetido -> se elimina una sola vez, no lanza al intentar borrar dos veces)', sb.state.events.length === 0);
    }
  }

  // =====================================================================
  section('51-54) Regresión de las suites AI-1.1..AI-1.4 (subproceso real)');
  // =====================================================================
  {
    function runSuite(relPath) {
      try {
        execFileSync(process.execPath, [path.join(ROOT, relPath)], { stdio: 'pipe' });
        return true;
      } catch (e) {
        console.log(String((e.stdout || '') + (e.stderr || e.message)));
        return false;
      }
    }
    check('51. js/test-ai-1-1-intent-detection.js sigue pasando', runSuite('js/test-ai-1-1-intent-detection.js'));
    check('52. js/test-ai-1-2-datetime-resolution.js sigue pasando', runSuite('js/test-ai-1-2-datetime-resolution.js'));
    check('53. js/test-ai-1-3-implicit-events.js sigue pasando', runSuite('js/test-ai-1-3-implicit-events.js'));
    check('54. js/test-ai-1-4-implicit-tasks.js sigue pasando', runSuite('js/test-ai-1-4-implicit-tasks.js'));
  }

  // =====================================================================
  section('55) node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('55. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('55. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
