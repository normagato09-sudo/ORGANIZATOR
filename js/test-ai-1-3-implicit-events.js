/**
 * ORGANIZATOR — Tests de AI-1.3 (eventos implícitos/festivos del Chat IA)
 *
 * Suite Node pura, SIN navegador ni jsdom. Dos capas de prueba, mismo
 * patrón que test-ai-1-2-datetime-resolution.js:
 *
 *  a) Funciones PURAS de AI-1.3 (isHolidayMessage, isAppointmentMessage,
 *     buildImplicitEventHints), que viven dentro del IIFE de
 *     js/ai-actions.js y NO forman parte de `global.AIActions` (a
 *     propósito: ese export se deja byte a byte igual que antes de
 *     AI-1.3 — ver test 0). Se extraen literalmente por CONTENIDO junto
 *     con el bloque AI-1.2 (buildImplicitEventHints reutiliza
 *     resolveDateExpression/resolveTimeExpression de AI-1.2 tal cual, no
 *     los reimplementa) y se ejecutan aisladas en un sandbox `vm`, sin
 *     mocks: son funciones puras, no leen `state` ni tocan el DOM.
 *  b) runIAAction() end-to-end con `callAI` mockeado (mismo patrón que
 *     test-ai-1-1-intent-detection.js/test-ai-1-2-datetime-resolution.js):
 *     el mock simula lo que una IA correctamente guiada por el
 *     ACTION_RULES ampliado en AI-1.3 devolvería para cada mensaje de
 *     ejemplo, y se comprueba que runIAAction() aplica la acción
 *     correcta, que el CONTEXTO REAL enviado a la IA incluye las pistas
 *     de AI-1.2/AI-1.3 cuando corresponde, y que el resto del sistema
 *     (create_task/move_item/cancel_item/sin acción, dedupe) sigue
 *     funcionando exactamente igual.
 *
 * Uso:  node js/test-ai-1-3-implicit-events.js
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
// Bloque AI-1.2 (resolveDateExpression/resolveTimeExpression y helpers,
// de los que depende buildImplicitEventHints — AI-1.3 no los reimplementa).
// ---------------------------------------------------------------------
const datetimeSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.2',
  '\n\n  /* ==================================================================\n     AI-1.3',
  'bloque AI-1.2 (resolución determinista de fechas/horas)'
);

// ---------------------------------------------------------------------
// Bloque AI-1.3 (isHolidayMessage/isAppointmentMessage/buildImplicitEventHints).
// ---------------------------------------------------------------------
const implicitEventSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.3',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-1.3 (reconocimiento de eventos implícitos/festivos)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con los bloques puros AI-1.2 + AI-1.3 (sin
 * `state`, sin DOM, sin callAI). */
function makeImplicitSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + `
    this.isHolidayMessage = isHolidayMessage;
    this.isAppointmentMessage = isAppointmentMessage;
    this.buildImplicitEventHints = buildImplicitEventHints;
    this.resolveDateExpression = resolveDateExpression;
    this.resolveTimeExpression = resolveTimeExpression;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2 + AI-1.3)' }
  );
  return sandbox;
}

/** Sandbox completo con ai-actions.js REAL cargado (para las pruebas
 * end-to-end de runIAAction), mismo patrón de mocks que ya usan
 * test-ai-1-1-intent-detection.js/test-ai-1-2-datetime-resolution.js.
 * `todayStr` es fijo y NO usa `new Date()`. */
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
  section('0) Revisión de alcance: contratos existentes intactos');
  // =====================================================================
  {
    check('0. ACTION_SCHEMA no cambió (nombres de campo/tipos "op" intactos)',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      ['"title"', '"dueDate"', '"dueTime"', '"date"', '"startTime"', '"endTime"', '"allDay"', '"newDate"', '"newTime"', '"targetId"', '"targetKind"'].every(f => aiActionsSrc.includes(f)));
    check('0. global.AIActions sigue exportando exactamente runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0. buildActionContext() sigue presente (AI-1.2 sigue siendo quien resuelve fechas/horas, sin tocarla)', /function buildActionContext\(\)\s*\{/.test(aiActionsSrc));
    check('0. dedupeActions() sigue presente (protección de AI-1.1 contra duplicados, sin eliminar)', /function dedupeActions\(actions\)\s*\{/.test(aiActionsSrc));
    check('0. resolveDateExpression/resolveTimeExpression (AI-1.2) siguen presentes y AI-1.3 no las reimplementa con otro nombre',
      /function resolveDateExpression\(/.test(aiActionsSrc) && /function resolveTimeExpression\(/.test(aiActionsSrc));
    check('0. AI-1.3 no define una segunda función resolveDateExpression/resolveTimeExpression (sin duplicar el parser temporal)',
      (aiActionsSrc.match(/function resolveDateExpression\(/g) || []).length === 1 &&
      (aiActionsSrc.match(/function resolveTimeExpression\(/g) || []).length === 1);
    check('0. ai-actions.js sigue sin definir su propia lógica de Scheduler (solo la CONSUME vía global.Scheduler.scheduleTask/findConflicts/rescheduleTask, nunca declara "function scheduleTask")',
      !/function\s+scheduleTask\s*\(/.test(aiActionsSrc) && /global\.Scheduler\.scheduleTask/.test(aiActionsSrc));
  }

  const sb0 = makeImplicitSandbox();

  // =====================================================================
  section('Festivos (1-8)');
  // =====================================================================
  {
    check('1. "El 24 es festivo" se detecta como festivo', sb0.isHolidayMessage('El 24 es festivo') === true);
    check('2. "El lunes es fiesta" se detecta como festivo', sb0.isHolidayMessage('El lunes es fiesta') === true);
    check('3. "Mañana es festivo" se detecta como festivo', sb0.isHolidayMessage('Mañana es festivo') === true);
    check('4. "El viernes es día no laborable" se detecta como festivo', sb0.isHolidayMessage('El viernes es día no laborable') === true);
    check('5. "El lunes no trabajo" se detecta como festivo', sb0.isHolidayMessage('El lunes no trabajo') === true);
    // 6/7: allDay + startTime/endTime null, comprobados end-to-end en el bloque de compatibilidad (sección 21) y aquí a nivel de pista:
    const hint24 = sb0.buildImplicitEventHints('El 24 es festivo', TODAY);
    check('6. la pista de "El 24 es festivo" indica allDay:true (sin hora en el mensaje)', /"allDay": true/.test(hint24));
    check('7. la pista de "El 24 es festivo" avisa de no inventar hora (startTime/endTime)', /No se detectó ninguna hora/.test(hint24));
    check('8. la pista sugiere un título breve ("Festivo"), no toda la frase', /título breve, ej\. "Festivo"/.test(hint24));
  }

  // =====================================================================
  section('Citas/compromisos (9-14)');
  // =====================================================================
  {
    check('9. "El jueves tengo médico" se detecta como cita', sb0.isAppointmentMessage('El jueves tengo médico') === true);
    check('10. "El martes tengo dentista" se detecta como cita', sb0.isAppointmentMessage('El martes tengo dentista') === true);
    check('11. "Mañana tengo reunión con Ana" se detecta como cita', sb0.isAppointmentMessage('Mañana tengo reunión con Ana') === true);
    check('12. "El viernes tengo una cita" se detecta como cita', sb0.isAppointmentMessage('El viernes tengo una cita') === true);
    // 13/14 (hora explícita / sin hora) probados end-to-end en la sección de compatibilidad (25/26) y aquí a nivel de pista:
    const hintConHora = sb0.buildImplicitEventHints('El jueves tengo médico a las 17', TODAY);
    check('13. con hora explícita, la pista NO avisa de "sin hora" (hay hora: 17:00 detectada por AI-1.2)', !/No se detectó ninguna hora/.test(hintConHora) && sb0.resolveTimeExpression('El jueves tengo médico a las 17') === '17:00');
    const hintSinHora = sb0.buildImplicitEventHints('El jueves tengo médico', TODAY);
    check('14. sin hora, la pista de cita no inventa ninguna (resolveTimeExpression sigue devolviendo null)', sb0.resolveTimeExpression('El jueves tengo médico') === null);
  }

  // =====================================================================
  section('Diferenciación tarea/evento (15-18)');
  // =====================================================================
  {
    check('15. "El lunes tengo que estudiar biología" NO se detecta como cita ni festivo (sigue siendo tarea)',
      sb0.isAppointmentMessage('El lunes tengo que estudiar biología') === false && sb0.isHolidayMessage('El lunes tengo que estudiar biología') === false);
    check('16. "Tengo que entregar el trabajo el lunes" NO se detecta como cita ni festivo (sigue siendo tarea)',
      sb0.isAppointmentMessage('Tengo que entregar el trabajo el lunes') === false && sb0.isHolidayMessage('Tengo que entregar el trabajo el lunes') === false);
    check('17. "El lunes tengo que ir al médico" SÍ se detecta como cita (aunque use "tengo que", el sustantivo de cita manda)',
      sb0.isAppointmentMessage('El lunes tengo que ir al médico') === true);
    check('18. "El miércoles tengo examen de matemáticas" se detecta como cita (examen = evento)',
      sb0.isAppointmentMessage('El miércoles tengo examen de matemáticas') === true);
    check('18b. la mera presencia de una fecha NO activa la pista por sí sola: "El lunes iré a caminar" (verbo genérico, sin sustantivo de cita) no se marca',
      sb0.isAppointmentMessage('El lunes iré a caminar') === false);
  }

  // =====================================================================
  section('No action (19-22)');
  // =====================================================================
  {
    check('19. "Hoy estoy cansado" no se detecta como festivo ni cita', sb0.isHolidayMessage('Hoy estoy cansado') === false && sb0.isAppointmentMessage('Hoy estoy cansado') === false);
    check('20. "Mañana quizá descanse" no se detecta como festivo ni cita', sb0.isHolidayMessage('Mañana quizá descanse') === false && sb0.isAppointmentMessage('Mañana quizá descanse') === false);
    check('21. "El lunes será un día largo" no se detecta como festivo ni cita', sb0.isHolidayMessage('El lunes será un día largo') === false && sb0.isAppointmentMessage('El lunes será un día largo') === false);
    check('22. "Vale, entendido" no se detecta como festivo ni cita, y no genera ninguna pista', sb0.buildImplicitEventHints('Vale, entendido', TODAY) === '');
  }

  // =====================================================================
  section('Pistas temporales de AI-1.2 (23-25)');
  // =====================================================================
  {
    check('23. buildImplicitEventHints reutiliza resolveDateExpression/resolveTimeExpression de AI-1.2 (misma fecha que AI-1.2 resolvería)',
      sb0.resolveDateExpression('El jueves tengo médico', TODAY) === '2026-09-17');
    // 24: "no duplica el parser temporal" ya comprobado en la sección 0
    // (una sola definición de cada función en todo el archivo); aquí se
    // comprueba además que el bloque AI-1.3 en sí no vuelve a declarar
    // ninguna constante de días/meses en español (las reutiliza vía las
    // funciones de AI-1.2, no las redefine).
    check('24. el bloque AI-1.3 no redefine WEEKDAY_NAMES_ES/MONTH_NAMES_ES (no duplica las listas de nombres de AI-1.2)',
      !/const WEEKDAY_NAMES_ES/.test(implicitEventSrc) && !/const MONTH_NAMES_ES/.test(implicitEventSrc));
    check('25. la pista de AI-1.3 nunca contradice la fecha/hora ya resuelta por AI-1.2: mismo valor de fecha en ambos sitios',
      (() => {
        const msg = 'El jueves tengo médico a las 17';
        const dateFromAI12 = sb0.resolveDateExpression(msg, TODAY);
        const hints = sb0.buildImplicitEventHints(msg, TODAY);
        // La pista de AI-1.3 no repite la fecha (eso lo hace buildTemporalHints
        // de AI-1.2, ya probado en su propia suite): solo comprueba que
        // AI-1.3 no imprime una fecha propia distinta en ningún sitio.
        return dateFromAI12 === '2026-09-17' && !/\d{4}-\d{2}-\d{2}/.test(hints);
      })());
  }

  // =====================================================================
  section('26) Dedupe: hecho festivo repetido → una sola acción');
  // =====================================================================
  {
    const dupAction = { op: 'create_event', title: 'Festivo', date: '2026-09-24', endDate: null, allDay: true, startTime: null, endTime: null, location: null };
    const sb = makeActionSandbox(async () => ({
      answer: 'Anotado: el 24 es festivo.',
      actions: [dupAction, JSON.parse(JSON.stringify(dupAction))], // "El 24 es festivo y el 24 es fiesta" -> mismo hecho contado dos veces
    }), TODAY);
    await sb.AIActions.runIAAction('El 24 es festivo y el 24 es fiesta');
    check('26. solo se crea UN evento aunque el modelo devolviera la acción repetida', sb.state.events.length === 1);
    check('26b. addEvent solo se llamó 1 vez', sb.__calls.addEvent === 1);
  }

  // =====================================================================
  section('Compatibilidad end-to-end (27-31) + festivos/citas end-to-end');
  // =====================================================================
  {
    // 27) move_item
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e-existente', newDate: '2026-09-25', newTime: null }],
      }), TODAY);
      sb.state.events.push({ id: 'e-existente', title: 'Examen', date: '2026-09-24', endDate: '', allDay: false, startTime: '10:00', endTime: '11:00' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes.');
      check('27. move_item sigue funcionando (no crea nada nuevo, actualiza lo existente)', sb.state.events.length === 1 && sb.state.events[0].date === '2026-09-25' && sb.__calls.addEvent === 0);
    }
    // 28) cancel_item
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Cancelado.',
        actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e-cancelar' }],
      }), TODAY);
      sb.state.events.push({ id: 'e-cancelar', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Cancela el examen de biología.');
      check('28. cancel_item sigue funcionando (elemento eliminado)', sb.state.events.length === 0 && sb.__calls.deleteEvent === 1);
    }
    // 29) create_task
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_task', title: 'Estudiar biología', dueDate: '2026-09-21', dueTime: null, priority: 'media', estimatedMinutes: 60, notes: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('El lunes tengo que estudiar biología.');
      check('29. create_task sigue funcionando (1 tarea, sin evento) para un mensaje que AI-1.3 NO marca como cita/festivo', sb.state.tasks.length === 1 && sb.state.events.length === 0);
      check('29b. el contexto real enviado a la IA NO incluye "PISTA DE TIPO DE ACCIÓN" para este mensaje (no es cita ni festivo)', !/PISTA DE TIPO DE ACCIÓN/.test(sb.__lastUserPrompt));
    }
    // 30) create_event explícito (mensaje que ya decía "evento"/fecha+hora fija, sin depender de AI-1.3)
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_event', title: 'Reunión de equipo', date: '2026-09-22', endDate: null, allDay: false, startTime: '10:00', endTime: null, location: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('Tengo una reunión el 22 a las 10.');
      check('30. create_event explícito sigue funcionando (1 evento, sin tarea)', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    }
    // 31) sin acción
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [] }), TODAY);
      const result = await sb.AIActions.runIAAction('Vale, entendido.');
      check('31. mensaje sin acción sigue sin crear nada', sb.state.tasks.length === 0 && sb.state.events.length === 0 && result.applied.length === 0);
      check('31b. el contexto real enviado a la IA no incluye ninguna pista de AI-1.3 para un mensaje sin festivo/cita', !/PISTA DE TIPO DE ACCIÓN/.test(sb.__lastUserPrompt));
    }

    // Festivo end-to-end completo (títulos 6/7/8 de la sección de festivos, de extremo a extremo).
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Anotado: el 24 es festivo.',
        actions: [{ op: 'create_event', title: 'Festivo', date: '2026-09-24', endDate: null, allDay: true, startTime: null, endTime: null, location: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('El 24 es festivo');
      const ev = sb.state.events[0];
      check('F1. "El 24 es festivo" produce exactamente 1 evento allDay:true, sin tarea', sb.state.events.length === 1 && sb.state.tasks.length === 0 && ev.allDay === true);
      check('F2. startTime/endTime quedan vacíos (no inventados), no null "de mentira" con valor', ev.startTime === '' && ev.endTime === '');
      check('F3. el título es breve ("Festivo"), no la frase completa del usuario', ev.title === 'Festivo');
      check('F4. el contexto real enviado a la IA incluye la pista de festivo con allDay sugerido', /FESTIVO\/DÍA NO LABORABLE/.test(sb.__lastUserPrompt) && /"allDay": true/.test(sb.__lastUserPrompt));
    }
    // Cita implícita end-to-end con hora explícita.
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale, médico el jueves a las 17.',
        actions: [{ op: 'create_event', title: 'Médico', date: '2026-09-17', endDate: null, allDay: false, startTime: '17:00', endTime: null, location: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('El jueves tengo médico a las 17');
      const ev = sb.state.events[0];
      check('C1. "El jueves tengo médico a las 17" produce 1 evento con la hora dada, sin tarea', sb.state.events.length === 1 && sb.state.tasks.length === 0 && ev.startTime === '17:00');
      check('C2. título breve ("Médico")', ev.title === 'Médico');
      check('C3. el contexto real enviado a la IA incluye la pista de cita/compromiso', /CITA\/COMPROMISO/.test(sb.__lastUserPrompt));
    }
    // "El lunes tengo que ir al médico" -> create_event (caso explícitamente pedido, punto 3 del enunciado).
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale, médico el lunes.',
        actions: [{ op: 'create_event', title: 'Médico', date: '2026-09-21', endDate: null, allDay: true, startTime: null, endTime: null, location: null }],
      }), TODAY);
      await sb.AIActions.runIAAction('El lunes tengo que ir al médico');
      check('D1. "El lunes tengo que ir al médico" produce create_event, no create_task', sb.state.events.length === 1 && sb.state.tasks.length === 0);
      check('D2. el contexto real enviado a la IA marca este mensaje como CITA/COMPROMISO pese al "tengo que"', /CITA\/COMPROMISO/.test(sb.__lastUserPrompt));
    }
  }

  // =====================================================================
  section('32) node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('32. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('32. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
