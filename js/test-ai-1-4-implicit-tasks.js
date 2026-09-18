/**
 * ORGANIZATOR — Tests de AI-1.4 (tareas implícitas del Chat IA)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón de dos capas que
 * test-ai-1-2-datetime-resolution.js/test-ai-1-3-implicit-events.js:
 *
 *  a) Funciones PURAS de AI-1.4 (isTaskMessage, buildImplicitTaskHints),
 *     que viven dentro del IIFE de js/ai-actions.js y NO forman parte de
 *     `global.AIActions` (a propósito, mismo criterio que AI-1.2/AI-1.3:
 *     ese export se deja byte a byte igual — ver test 0). Se extraen
 *     literalmente por CONTENIDO junto con los bloques AI-1.2 (de los
 *     que depende resolveDateExpression/resolveTimeExpression) y AI-1.3
 *     (de los que depende isHolidayMessage/isAppointmentMessage, para
 *     que buildImplicitTaskHints no contradiga una pista de evento ya
 *     puesta por AI-1.3) y se ejecutan aisladas en un sandbox `vm`, sin
 *     mocks: son funciones puras, no leen `state` ni tocan el DOM.
 *  b) runIAAction() end-to-end con `callAI` mockeado (mismo patrón que
 *     el resto de la suite AI-1.x): el mock simula lo que una IA
 *     correctamente guiada por el ACTION_RULES ampliado en AI-1.4
 *     devolvería para cada mensaje de ejemplo, y se comprueba que
 *     runIAAction() aplica la acción correcta, que el CONTEXTO REAL
 *     enviado a la IA incluye la pista de AI-1.4 cuando corresponde, y
 *     que no se inventa ningún campo (fecha/hora/prioridad/duración/
 *     categoría/recordatorio/notas/ubicación) más allá de lo que el
 *     mock (que representa la respuesta de la IA) trae explícitamente.
 *
 * Uso:  node js/test-ai-1-4-implicit-tasks.js
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
// Bloques AI-1.2 (fecha/hora) + AI-1.3 (eventos implícitos, del que
// depende buildImplicitTaskHints para no contradecirlo) + AI-1.4 (tareas
// implícitas), literales de ai-actions.js.
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
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-1.4 (reconocimiento de tareas implícitas)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con los bloques puros AI-1.2 + AI-1.3 + AI-1.4
 * (sin `state`, sin DOM, sin callAI). */
function makeTaskSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + '\n' + implicitTaskSrc + `
    this.isTaskMessage = isTaskMessage;
    this.buildImplicitTaskHints = buildImplicitTaskHints;
    this.isHolidayMessage = isHolidayMessage;
    this.isAppointmentMessage = isAppointmentMessage;
    this.resolveDateExpression = resolveDateExpression;
    this.resolveTimeExpression = resolveTimeExpression;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2 + AI-1.3 + AI-1.4)' }
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
    check('0. ACTION_SCHEMA no cambió (nombres de campo/tipos "op" intactos)',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      ['"title"', '"dueDate"', '"dueTime"', '"priority"', '"estimatedMinutes"', '"notes"', '"date"', '"startTime"', '"endTime"', '"allDay"', '"location"'].every(f => aiActionsSrc.includes(f)));
    check('0. ACTION_RULES sigue existiendo (contiene el bloque de reglas estrictas de siempre)', /Reglas estrictas, sin excepción:/.test(aiActionsSrc));
    check('0. global.AIActions sigue exportando exactamente runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0. dedupeActions() sigue presente (no se eliminó ni se reemplazó)', /function dedupeActions\(actions\)\s*\{/.test(aiActionsSrc));
    check('0. buildActionContext() sigue presente sin tocar', /function buildActionContext\(\)\s*\{/.test(aiActionsSrc));
    check('0. resolveDateExpression/resolveTimeExpression (AI-1.2) siguen con una única definición cada una (AI-1.4 no las duplica)',
      (aiActionsSrc.match(/function resolveDateExpression\(/g) || []).length === 1 &&
      (aiActionsSrc.match(/function resolveTimeExpression\(/g) || []).length === 1);
    check('0. isHolidayMessage/isAppointmentMessage (AI-1.3) siguen presentes (no se eliminaron helpers existentes)',
      /function isHolidayMessage\(/.test(aiActionsSrc) && /function isAppointmentMessage\(/.test(aiActionsSrc));
    check('0. ai-actions.js sigue sin definir su propia lógica de Scheduler (solo la CONSUME vía global.Scheduler)',
      !/function\s+scheduleTask\s*\(/.test(aiActionsSrc) && /global\.Scheduler\.scheduleTask/.test(aiActionsSrc));
  }

  const sb0 = makeTaskSandbox();

  // =====================================================================
  section('Tareas implícitas (1-8)');
  // =====================================================================
  {
    check('1. "Mañana tengo que estudiar" -> tarea', sb0.isTaskMessage('Mañana tengo que estudiar') === true);
    check('2. "Tengo que entregar el trabajo el lunes" -> tarea', sb0.isTaskMessage('Tengo que entregar el trabajo el lunes') === true);
    check('3. "Necesito comprar leche" -> tarea', sb0.isTaskMessage('Necesito comprar leche') === true);
    check('4. "No olvidar llamar a Ana" -> tarea', sb0.isTaskMessage('No olvidar llamar a Ana') === true);
    check('5. "Quiero preparar el examen" -> tarea', sb0.isTaskMessage('Quiero preparar el examen') === true);
    check('6. "Debo revisar el informe" -> tarea', sb0.isTaskMessage('Debo revisar el informe') === true);
    check('7. "Tengo que enviar el correo" -> tarea', sb0.isTaskMessage('Tengo que enviar el correo') === true);
    check('8. "Necesito terminar el proyecto" -> tarea', sb0.isTaskMessage('Necesito terminar el proyecto') === true);
    check('8b. "Tengo que revisar el informe mañana por la tarde" -> tarea', sb0.isTaskMessage('Tengo que revisar el informe mañana por la tarde') === true);
  }

  // =====================================================================
  section('Fechas/horas reutilizando AI-1.2 (9-13)');
  // =====================================================================
  {
    check('9. "Mañana tengo que estudiar" usa la fecha resuelta por AI-1.2 (FECHA ACTUAL + 1 día)',
      sb0.resolveDateExpression('Mañana tengo que estudiar', TODAY) === '2026-09-18');
    check('10. "Tengo que estudiar a las 17" usa la hora resuelta por AI-1.2', sb0.resolveTimeExpression('Tengo que estudiar a las 17') === '17:00');
    check('11. "Tengo que estudiar mañana por la tarde" no inventa una hora concreta (resolveTimeExpression -> null)',
      sb0.resolveTimeExpression('Tengo que estudiar mañana por la tarde') === null);
    check('11b. esa misma frase SÍ resuelve la fecha ("mañana") sin problema', sb0.resolveDateExpression('Tengo que estudiar mañana por la tarde', TODAY) === '2026-09-18');
    check('12. "Necesito estudiar" no inventa fecha (resolveDateExpression -> null)', sb0.resolveDateExpression('Necesito estudiar', TODAY) === null);
    check('13. "Necesito estudiar" no inventa hora (resolveTimeExpression -> null)', sb0.resolveTimeExpression('Necesito estudiar') === null);
    check('13b. "Necesito estudiar" sigue detectándose como tarea aunque no traiga fecha ni hora', sb0.isTaskMessage('Necesito estudiar') === true);
  }

  // =====================================================================
  section('Diferenciación con eventos (14-19, sin romper AI-1.3)');
  // =====================================================================
  {
    check('14. "Tengo médico mañana" sigue siendo evento (isAppointmentMessage), no tarea', sb0.isAppointmentMessage('Tengo médico mañana') === true && sb0.isTaskMessage('Tengo médico mañana') === false);
    check('15. "El jueves tengo examen" sigue siendo evento, no tarea', sb0.isAppointmentMessage('El jueves tengo examen') === true && sb0.isTaskMessage('El jueves tengo examen') === false);
    check('16. "Mañana tengo reunión" sigue siendo evento, no tarea', sb0.isAppointmentMessage('Mañana tengo reunión') === true && sb0.isTaskMessage('Mañana tengo reunión') === false);
    check('17. "Mañana tengo que estudiar" es tarea, no evento', sb0.isTaskMessage('Mañana tengo que estudiar') === true && sb0.isAppointmentMessage('Mañana tengo que estudiar') === false);
    check('18. "Tengo que preparar la reunión" es tarea (preparar algo, no la cita en sí), no evento', sb0.isTaskMessage('Tengo que preparar la reunión') === true && sb0.isAppointmentMessage('Tengo que preparar la reunión') === false);
    check('19. "Tengo que llamar al médico" es tarea (hacer una llamada, no la cita en sí), no evento', sb0.isTaskMessage('Tengo que llamar al médico') === true && sb0.isAppointmentMessage('Tengo que llamar al médico') === false);
    check('19b. "El lunes tengo que ir al médico" sigue siendo evento (AI-1.3, la cita en sí), y AI-1.4 no lo contradice marcándolo también como tarea',
      sb0.isAppointmentMessage('El lunes tengo que ir al médico') === true && sb0.isTaskMessage('El lunes tengo que ir al médico') === false);
    check('19c. buildImplicitTaskHints no genera nada para ese mismo mensaje (AI-1.3 ya lo cubre, sin pistas contradictorias)',
      sb0.buildImplicitTaskHints('El lunes tengo que ir al médico', TODAY) === '');
  }

  // =====================================================================
  section('No acción (20-23)');
  // =====================================================================
  {
    check('20. "Hoy estoy cansado" -> ninguna pista de tarea', sb0.isTaskMessage('Hoy estoy cansado') === false && sb0.buildImplicitTaskHints('Hoy estoy cansado', TODAY) === '');
    check('21. "Mañana quizá descanse" -> ninguna pista de tarea', sb0.isTaskMessage('Mañana quizá descanse') === false && sb0.buildImplicitTaskHints('Mañana quizá descanse', TODAY) === '');
    check('22. "Vale, entendido" -> ninguna pista de tarea', sb0.isTaskMessage('Vale, entendido') === false && sb0.buildImplicitTaskHints('Vale, entendido', TODAY) === '');
    check('23. "Qué día tan largo" -> ninguna pista de tarea', sb0.isTaskMessage('Qué día tan largo') === false && sb0.buildImplicitTaskHints('Qué día tan largo', TODAY) === '');
    check('23b. "Estoy estudiando mucho" -> ninguna pista de tarea (verbo en gerundio, no infinitivo; y sin marcador de obligación)', sb0.isTaskMessage('Estoy estudiando mucho') === false);
    check('23c. detección conservadora: "Necesito ayuda" (marcador sin verbo de la lista) no se marca como tarea', sb0.isTaskMessage('Necesito ayuda') === false);
    check('23d. detección conservadora: "Quiero mucho a mi familia" (marcador sin verbo de la lista) no se marca como tarea', sb0.isTaskMessage('Quiero mucho a mi familia') === false);
  }

  // =====================================================================
  section('26) Dedupe de AI-1.1 sigue funcionando (dos tareas idénticas -> una sola)');
  // =====================================================================
  {
    const dupAction = { op: 'create_task', title: 'Comprar leche', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: 30, notes: null };
    const sb = makeActionSandbox(async () => ({
      answer: 'Anotado.',
      actions: [dupAction, JSON.parse(JSON.stringify(dupAction))],
    }), TODAY);
    await sb.AIActions.runIAAction('Necesito comprar leche, no quiero olvidarlo, necesito comprar leche');
    check('D1. solo se crea UNA tarea aunque el modelo devolviera la acción repetida', sb.state.tasks.length === 1);
    check('D2. addTask solo se llamó 1 vez', sb.__calls.addTask === 1);
  }

  // =====================================================================
  section('Título / no invención de campos (24-31, end-to-end con callAI mockeado)');
  // =====================================================================
  {
    // 24/25: título basado en el hecho descrito, sin información añadida.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale, apuntado.',
        actions: [{ op: 'create_task', title: 'Comprar leche', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('Necesito comprar leche');
      const t = sb.state.tasks[0];
      check('24. el título de "Necesito comprar leche" contiene el contenido indicado ("Comprar leche")', t.title === 'Comprar leche');
      check('25. no añade información inexistente: dueDate se queda en null (el usuario no dio fecha)', t.dueDate === null);
      check('25b. no añade información inexistente: dueTime se queda vacío (el usuario no dio hora)', t.dueTime === '');
    }
    // 26/27: no inventa prioridad ni categoría.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_task', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: null, priority: 'media', estimatedMinutes: 60, notes: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('Mañana tengo que estudiar biología');
      const t = sb.state.tasks[0];
      check('24b. el título de "Mañana tengo que estudiar biología" es "Estudiar biología" (basado en el hecho, sin la palabra "mañana")', t.title === 'Estudiar biología');
      check('26. no inventa prioridad distinta de la que trae la acción (queda "media", el valor por defecto de siempre, no una inventada por AI-1.4)', t.priority === 'media');
      check('27. la tarea no tiene ningún campo "category"/"categoryId" añadido por AI-1.4 (el modelo de datos de tareas no lo trae salvo que el usuario lo diera)', !('category' in t) && !('categoryId' in t));
    }
    // 28: no inventa duración (estimatedMinutes) cuando la IA no la da.
    // NOTA: cuando la tarea no tiene dueTime, applyCreateTask() (ya
    // existente, fuera del alcance de AI-1.4) delega en Scheduler para
    // decidir un hueco — y Scheduler SÍ puede asignar una duración por
    // defecto ahí, algo legítimo y anterior a AI-1.4 ("el sistema
    // decidirá el hueco... a partir de estimatedMinutes"). Lo que prueba
    // este test es que AI-1.4/ai-actions.js NO fabrica un número antes
    // de eso: el propio objeto que se le pasa a Scheduler.scheduleTask()
    // conserva null tal cual venía de la acción.
    {
      let taskPassedToScheduler = null;
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_task', title: 'Comprar leche', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null }],
      }), TODAY);
      sb.Scheduler.scheduleTask = (task) => { taskPassedToScheduler = task; return { scheduledDate: null, scheduledStart: '09:00', scheduledEnd: '09:30', estimatedMinutes: task.estimatedMinutes, schedulingWarning: null }; };
      await sb.AIActions.runIAAction('Necesito comprar leche');
      check('28. no inventa duración: el objeto que llega a Scheduler.scheduleTask conserva estimatedMinutes: null (AI-1.4 no fabrica ningún número)', taskPassedToScheduler && taskPassedToScheduler.estimatedMinutes === null);
    }
    // 29: no inventa recordatorio (AI-1.4 no toca reminders: runIAAction no llama a ningún syncReminder para create_task).
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_task', title: 'Comprar leche', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null }],
      }), TODAY);
      const result = await sb.AIActions.runIAAction('Necesito comprar leche');
      check('29. no inventa recordatorio: la tarea creada no tiene ningún campo "reminder"/"reminderMinutes" añadido', !('reminder' in sb.state.tasks[0]) && !('reminderMinutes' in sb.state.tasks[0]));
      check('29b. runIAAction no lanza ni falla al no haber reminders de por medio (applied trae la nota de creación)', Array.isArray(result.applied) && result.applied.length === 1);
    }
    // 30: no inventa notas.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_task', title: 'Comprar leche', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('Necesito comprar leche');
      check('30. no inventa notas: notes queda vacío ("" — la acción no traía ninguna)', sb.state.tasks[0].notes === '');
    }
    // 31: no inventa ubicación (create_task ni siquiera tiene campo location en el esquema; se confirma que no aparece).
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_task', title: 'Comprar leche', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('Necesito comprar leche');
      check('31. no inventa ubicación: la tarea creada no tiene ningún campo "location"', !('location' in sb.state.tasks[0]));
    }
  }

  // =====================================================================
  section('Integración con runIAAction (contexto real enviado a la IA)');
  // =====================================================================
  {
    const sb = makeActionSandbox(async () => ({
      answer: 'Vale.',
      actions: [{ op: 'create_task', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: null, priority: 'media', estimatedMinutes: 60, notes: null }],
    }), TODAY);
    await sb.AIActions.runIAAction('Mañana tengo que estudiar biología');
    check('I1. el contexto real enviado a la IA incluye la pista de tarea implícita de AI-1.4', /Parece describir una TAREA pendiente/.test(sb.__lastUserPrompt));
    check('I2. el contexto real enviado a la IA también incluye la fecha ya resuelta por AI-1.2 (mismo mensaje, mismo contexto)', /Fecha detectada en el mensaje: 2026-09-18/.test(sb.__lastUserPrompt));
    check('I3. el contexto real NO incluye una pista de evento/festivo de AI-1.3 para este mensaje (no hay contradicción)', !/CITA\/COMPROMISO/.test(sb.__lastUserPrompt) && !/FESTIVO/.test(sb.__lastUserPrompt));

    const sbEvent = makeActionSandbox(async () => ({
      answer: 'Vale.',
      actions: [{ op: 'create_event', title: 'Médico', date: '2026-09-18', endDate: null, allDay: true, startTime: null, endTime: null, location: null }],
    }), TODAY);
    await sbEvent.AIActions.runIAAction('Tengo médico mañana');
    check('I4. para un mensaje de cita (AI-1.3), el contexto real NO incluye la pista de tarea de AI-1.4 (sin pistas contradictorias)', !/Parece describir una TAREA pendiente/.test(sbEvent.__lastUserPrompt));
  }

  // =====================================================================
  section('Compatibilidad end-to-end adicional (create_event/move_item/cancel_item/sin acción siguen intactos)');
  // =====================================================================
  {
    // move_item
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e-existente', newDate: '2026-09-25', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e-existente', title: 'Examen', date: '2026-09-24', endDate: '', allDay: false, startTime: '10:00', endTime: '11:00' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes.');
      check('M1. move_item sigue funcionando (no crea nada nuevo, actualiza lo existente)', sb.state.events.length === 1 && sb.state.events[0].date === '2026-09-25' && sb.__calls.addEvent === 0);
    }
    // cancel_item
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Cancelado.',
        actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e-cancelar' }],
      }), TODAY);
      sb.state.events.push({ id: 'e-cancelar', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Cancela el examen de biología.');
      check('M2. cancel_item sigue funcionando (elemento eliminado)', sb.state.events.length === 0 && sb.__calls.deleteEvent === 1);
    }
    // create_event explícito
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_event', title: 'Reunión de equipo', date: '2026-09-22', endDate: null, allDay: false, startTime: '10:00', endTime: null, location: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('Tengo una reunión el 22 a las 10.');
      check('M3. create_event explícito sigue funcionando (1 evento, sin tarea)', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    }
    // sin acción
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [] }), TODAY);
      const result = await sb.AIActions.runIAAction('Vale, entendido.');
      check('M4. mensaje sin acción sigue sin crear nada', sb.state.tasks.length === 0 && sb.state.events.length === 0 && result.applied.length === 0);
    }
  }

  // =====================================================================
  section('32-35) Compatibilidad de contratos (ya cubiertos en la sección 0, se repite explícitamente aquí)');
  // =====================================================================
  {
    check('32. ACTION_SCHEMA sigue existiendo', /const ACTION_SCHEMA = `\{/.test(aiActionsSrc));
    check('33. ACTION_RULES sigue existiendo', /const ACTION_RULES = `/.test(aiActionsSrc));
    check('34. global.AIActions sigue exportando lo esperado (runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES)',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    {
      const dupAction = { op: 'create_task', title: 'X', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: null, notes: null };
      const sb = makeActionSandbox(async () => ({ answer: '', actions: [dupAction, JSON.parse(JSON.stringify(dupAction))] }), TODAY);
      await sb.AIActions.runIAAction('X');
      check('35. dedupeActions() sigue funcionando end-to-end (misma acción repetida -> una sola tarea)', sb.state.tasks.length === 1);
    }
  }

  // =====================================================================
  section('36-38) Regresión de las suites anteriores (subproceso real, mismo patrón que test-reminders-ui.js)');
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
    check('36. js/test-ai-1-1-intent-detection.js sigue pasando', runSuite('js/test-ai-1-1-intent-detection.js'));
    check('37. js/test-ai-1-2-datetime-resolution.js sigue pasando', runSuite('js/test-ai-1-2-datetime-resolution.js'));
    check('38. js/test-ai-1-3-implicit-events.js sigue pasando', runSuite('js/test-ai-1-3-implicit-events.js'));
  }

  // =====================================================================
  section('39) node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('39. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('39. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
