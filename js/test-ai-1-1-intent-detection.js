/**
 * ORGANIZATOR — Tests de AI-1.1 (intenciones naturales del Chat IA)
 *
 * Suite Node pura, SIN navegador ni jsdom: carga js/ai-actions.js REAL
 * (archivo standalone, sin necesidad de extraerlo de organizator.html) en
 * un sandbox con globals mínimos mockeados (state, addTask/addEvent/
 * updateTask/updateEvent/deleteTask/deleteEvent, un Scheduler mínimo,
 * callAI/parseAIJSON) — mismo patrón de mocks que ya usan
 * test-ia-week-anchor.js/test-ia-week-validation.js.
 *
 * IMPORTANTE — qué prueba esto y qué NO:
 * La clasificación real de una frase en lenguaje natural la hace el
 * modelo de IA externo (callAI), no código determinista de este
 * repositorio — por eso no se puede probar aquí "esta frase produce
 * este JSON" contra la IA real. Lo que SÍ es determinista y se prueba:
 *   a) que ACTION_RULES (el prompt que se le manda a la IA) instruye
 *      explícitamente a distinguir las 5 categorías de intención pedidas
 *      en AI-1.1, con ejemplos que cubren los casos del enunciado
 *      (incluido el caso "festivo"/día completo sin hora y los casos sin
 *      acción);
 *   b) que runIAAction(), dado un JSON de acciones que representa lo que
 *      una IA que SÍ clasificó correctamente devolvería para cada frase
 *      de ejemplo del enunciado, aplica exactamente la acción esperada
 *      (crea tarea / crea evento / modifica lo existente sin crear nada
 *      nuevo / cancela lo existente / no crea nada), sin inventar campos
 *      no proporcionados y sin duplicar altas cuando el modelo repite la
 *      misma acción dos veces.
 * No se toca ni se reimplementa ACTION_SCHEMA, runIAAction() ni ninguna
 * acción existente: se sigue usando el mismo sistema de siempre.
 *
 * Uso:  node js/test-ai-1-1-intent-detection.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AI_ACTIONS_PATH = path.join(ROOT, 'js', 'ai-actions.js');
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Crea un sandbox nuevo con state/CRUD/Scheduler mockeados y ai-actions.js
 * real cargado dentro. `callAIImpl` es el mock de callAI para este test
 * (simula lo que la IA real debería devolver para el mensaje probado). */
function makeSandbox(callAIImpl) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;

  let nextId = 1;
  const state = { tasks: [], events: [], customSchedules: [] };
  sandbox.state = state;
  sandbox.currentView = 'test'; // distinto de 'inicio': evita depender de renderInicio/DOM
  sandbox.todayStr = () => '2026-09-18';

  const calls = { addTask: 0, addEvent: 0, updateTask: 0, updateEvent: 0, deleteTask: 0, deleteEvent: 0, scheduleTask: 0 };
  sandbox.__calls = calls;

  sandbox.addTask = async (data) => {
    calls.addTask++;
    state.tasks.push(Object.assign({ id: 't' + (nextId++), done: false, createdAt: 1 }, data));
  };
  sandbox.addEvent = async (data) => {
    calls.addEvent++;
    state.events.push(Object.assign({ id: 'e' + (nextId++), createdAt: 1 }, data));
  };
  sandbox.updateTask = async (id, data) => {
    calls.updateTask++;
    const t = state.tasks.find(x => x.id === id);
    if (t) Object.assign(t, data);
  };
  sandbox.updateEvent = async (id, data) => {
    calls.updateEvent++;
    const e = state.events.find(x => x.id === id);
    if (e) Object.assign(e, data);
  };
  sandbox.deleteTask = async (id) => { calls.deleteTask++; state.tasks = state.tasks.filter(t => t.id !== id); };
  sandbox.deleteEvent = async (id) => { calls.deleteEvent++; state.events = state.events.filter(e => e.id !== id); };

  // Scheduler mínimo: no es el objeto de AI-1.1 (ya probado en
  // test-recurrence-*.js/scheduler.js real) — solo necesita no lanzar y
  // devolver una forma válida para que applyCreateTask/applyMoveItem no
  // fallen al llamarlo.
  sandbox.Scheduler = {
    scheduleTask: (task) => {
      calls.scheduleTask++;
      return { scheduledDate: task.dueDate || null, scheduledStart: '09:00', scheduledEnd: '09:30', estimatedMinutes: task.estimatedMinutes || 30, schedulingWarning: null };
    },
    findConflicts: () => [],
    rescheduleTask: () => null,
  };

  sandbox.renderInicio = () => {};
  sandbox.parseAIJSON = (raw) => raw; // el mock de callAI ya devuelve el objeto final
  sandbox.callAI = callAIImpl;

  vm.createContext(sandbox);
  vm.runInContext(aiActionsSrc, sandbox, { filename: 'js/ai-actions.js' });
  return sandbox;
}

(async () => {

  // =====================================================================
  section('0) ACTION_RULES distingue explícitamente las 5 categorías de intención (AI-1.1)');
  // =====================================================================
  {
    // Sandbox "de lectura": solo para inspeccionar el ACTION_RULES/ACTION_SCHEMA
    // reales tal como los exporta el módulo, sin ejecutar ninguna acción.
    const sb = makeSandbox(async () => ({ answer: '', actions: [] }));
    const rules = sb.AIActions.ACTION_RULES;
    check('0. menciona explícitamente CREAR TAREA (create_task)', /CREAR TAREA \(create_task\)/.test(rules));
    check('0. menciona explícitamente CREAR EVENTO (create_event)', /CREAR EVENTO \(create_event\)/.test(rules));
    check('0. menciona explícitamente MOVER\\/MODIFICAR (move_item)', /MOVER\/MODIFICAR \(move_item\)/.test(rules));
    check('0. menciona explícitamente CANCELAR\\/ELIMINAR (cancel_item)', /CANCELAR\/ELIMINAR \(cancel_item\)/.test(rules));
    check('0. menciona explícitamente SIN ACCIÓN (actions: [])', /SIN ACCIÓN \(actions: \[\]\)/.test(rules));
    check('0. cubre el caso "festivo"/día completo sin hora como create_event, no como tarea', /festivo/.test(rules) && /allDay/.test(rules));
    check('0. cubre ejemplos de mensajes sin acción (estado de ánimo / confirmaciones cortas)', /cansado/.test(rules) && /(vale, entendido|entendido)/i.test(rules));
    check('0. advierte explícitamente contra duplicar la misma acción', /No generes más de una acción para un mismo hecho/.test(rules));
    check('0. sigue sin usar inglés en el prompt (regla de idioma intacta)', /Responde SIEMPRE en español/.test(rules));
  }

  // =====================================================================
  section('0b) ACTION_SCHEMA y el contrato público de AIActions no cambiaron (compatibilidad)');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({ answer: '', actions: [] }));
    const EXPECTED_SCHEMA = `{
  "answer": string,
  "actions": [
    {
      "op": "create_task" | "create_event" | "move_item" | "cancel_item" | "update_priority",

      // create_task — para algo sin hora fija que hay que HACER antes de una fecha:
      "title": string,
      "dueDate": "YYYY-MM-DD" | null,
      "dueTime": "HH:MM" | null,
      "priority": "alta" | "media" | "baja",
      "estimatedMinutes": number | null,
      "notes": string | null,

      // create_event — para algo con fecha/hora YA fija (examen, reunión, entreno):
      "date": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD" | null,
      "allDay": boolean,
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "location": string | null,

      // move_item / cancel_item / update_priority — sobre algo que YA EXISTE:
      "targetId": string,
      "targetKind": "task" | "event",
      "newDate": "YYYY-MM-DD" | null,
      "newTime": "HH:MM" | null,
      "newPriority": "alta" | "media" | "baja" | null
    }
  ]
}`;
    check('0b. ACTION_SCHEMA es byte a byte el mismo de antes de AI-1.1 (mismo contrato de campos)', sb.AIActions.ACTION_SCHEMA === EXPECTED_SCHEMA);
    check('0b. AIActions sigue exportando exactamente runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0b. runIAAction sigue siendo una función', typeof sb.AIActions.runIAAction === 'function');
    check('0b. buildActionContext sigue siendo una función', typeof sb.AIActions.buildActionContext === 'function');
  }

  // =====================================================================
  section('1) "Tengo parcial de biología el jueves." → intención create_event');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Apuntado: examen de biología el jueves.',
      actions: [{ op: 'create_event', title: 'Examen de biología', date: '2026-09-24', endDate: null, allDay: false, startTime: null, endTime: null, location: null }],
    }));
    const result = await sb.AIActions.runIAAction('Tengo parcial de biología el jueves.');
    check('1. se creó exactamente 1 evento y ninguna tarea', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    check('1. el evento tiene el título correcto', sb.state.events[0].title === 'Examen de biología');
    check('1. el evento tiene la fecha dada por la IA', sb.state.events[0].date === '2026-09-24');
    check('1. no se inventó ubicación (location vacío, no null ni texto inventado)', sb.state.events[0].location === '');
    check('1. "answer" se devuelve tal cual', result.answer === 'Apuntado: examen de biología el jueves.');
  }

  // =====================================================================
  section('2) "El 24 es festivo." → intención create_event de día completo (allDay)');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Anotado: el 24 es festivo.',
      actions: [{ op: 'create_event', title: 'Festivo', date: '2026-09-24', endDate: null, allDay: true, startTime: null, endTime: null, location: null }],
    }));
    await sb.AIActions.runIAAction('El 24 es festivo.');
    check('2. se creó exactamente 1 evento y ninguna tarea', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    check('2. el evento queda marcado como todo el día (allDay: true)', sb.state.events[0].allDay === true);
    check('2. no se inventó ninguna hora (startTime vacío)', sb.state.events[0].startTime === '');
  }

  // =====================================================================
  section('2b) "El lunes tengo médico." → intención create_event');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Vale, médico el lunes.',
      actions: [{ op: 'create_event', title: 'Médico', date: '2026-09-21', endDate: null, allDay: true, startTime: null, endTime: null, location: null }],
    }));
    await sb.AIActions.runIAAction('El lunes tengo médico.');
    check('2b. se creó exactamente 1 evento y ninguna tarea', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    check('2b. el evento tiene el título correcto', sb.state.events[0].title === 'Médico');
  }

  // =====================================================================
  section('3) "Mañana tengo que estudiar biología." → intención create_task');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Vale, la anoto para mañana.',
      actions: [{ op: 'create_task', title: 'Estudiar biología', dueDate: '2026-09-19', dueTime: null, priority: 'media', estimatedMinutes: 60, notes: null }],
    }));
    await sb.AIActions.runIAAction('Mañana tengo que estudiar biología.');
    check('3. se creó exactamente 1 tarea y ningún evento', sb.state.tasks.length === 1 && sb.state.events.length === 0);
    check('3. la tarea tiene el título correcto', sb.state.tasks[0].title === 'Estudiar biología');
    check('3. la tarea tiene la fecha límite dada por la IA', sb.state.tasks[0].dueDate === '2026-09-19');
    check('3. sin hora fija (dueTime vacío): el sistema decide el hueco por su cuenta', sb.state.tasks[0].dueTime === '' && sb.__calls.scheduleTask === 1);
    check('3. no se inventaron notas (notes vacío)', sb.state.tasks[0].notes === '');
  }

  // =====================================================================
  section('4) "Tengo que hacer el trabajo de historia." → intención create_task (sin fecha inventada)');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Anotado el trabajo de historia.',
      actions: [{ op: 'create_task', title: 'Trabajo de historia', dueDate: null, dueTime: null, priority: 'media', estimatedMinutes: 90, notes: null }],
    }));
    await sb.AIActions.runIAAction('Tengo que hacer el trabajo de historia.');
    check('4. se creó exactamente 1 tarea y ningún evento', sb.state.tasks.length === 1 && sb.state.events.length === 0);
    check('4. como el usuario no dio fecha, dueDate se queda en null (no se inventa una)', sb.state.tasks[0].dueDate === null);
  }

  // =====================================================================
  section('5) "Mueve el examen al viernes." → modificación de lo existente, NO creación');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Movido al viernes.',
      actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e-existente', newDate: '2026-09-25', newTime: null }],
    }));
    sb.state.events.push({ id: 'e-existente', title: 'Examen de biología', date: '2026-09-24', endDate: '', allDay: false, startTime: '10:00', endTime: '11:00' });
    await sb.AIActions.runIAAction('Mueve el examen al viernes.');
    check('5. NO se crea ningún evento ni tarea nuevos (sigue habiendo exactamente 1 evento)', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    check('5. el evento existente se actualiza a la nueva fecha', sb.state.events[0].date === '2026-09-25');
    check('5. el evento existente conserva su identidad (mismo id, no uno nuevo)', sb.state.events[0].id === 'e-existente');
    check('5. addEvent no se llamó ni una vez (no es una creación)', sb.__calls.addEvent === 0);
  }

  // =====================================================================
  section('6) "Cancela el examen de biología." → cancelación de lo existente');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Cancelado.',
      actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e-cancelar' }],
    }));
    sb.state.events.push({ id: 'e-cancelar', title: 'Examen de biología', date: '2026-09-24' });
    await sb.AIActions.runIAAction('Cancela el examen de biología.');
    check('6. el evento ya no existe', sb.state.events.length === 0);
    check('6. no se creó ninguna tarea ni ningún otro evento', sb.state.tasks.length === 0);
    check('6. deleteEvent se llamó exactamente 1 vez', sb.__calls.deleteEvent === 1);
  }

  // =====================================================================
  section('7) Mensajes sin acción: "Hoy estoy cansado." / "Vale, entendido." → actions: []');
  // =====================================================================
  {
    for (const msg of ['Hoy estoy cansado.', 'Vale, entendido.']) {
      const sb = makeSandbox(async () => ({ answer: 'Vale.', actions: [] }));
      const result = await sb.AIActions.runIAAction(msg);
      check(`7. "${msg}" no crea ninguna tarea`, sb.state.tasks.length === 0);
      check(`7. "${msg}" no crea ningún evento`, sb.state.events.length === 0);
      check(`7. "${msg}" no aplica ninguna acción (applied vacío)`, Array.isArray(result.applied) && result.applied.length === 0);
      check(`7. "${msg}" no llama a ningún CRUD`, sb.__calls.addTask === 0 && sb.__calls.addEvent === 0 && sb.__calls.updateTask === 0 && sb.__calls.updateEvent === 0 && sb.__calls.deleteTask === 0 && sb.__calls.deleteEvent === 0);
    }
  }

  // =====================================================================
  section('8) No se crean acciones duplicadas cuando el modelo repite la misma acción');
  // =====================================================================
  {
    const dupAction = { op: 'create_task', title: 'Repasar apuntes', dueDate: '2026-09-19', dueTime: null, priority: 'media', estimatedMinutes: 30, notes: null };
    const sb = makeSandbox(async () => ({
      answer: 'Anotado.',
      actions: [dupAction, JSON.parse(JSON.stringify(dupAction))], // misma acción devuelta 2 veces por el modelo
    }));
    await sb.AIActions.runIAAction('Tengo que repasar apuntes mañana.');
    check('8. solo se crea UNA tarea aunque el modelo devolviera la acción repetida', sb.state.tasks.length === 1);
    check('8. addTask solo se llamó 1 vez', sb.__calls.addTask === 1);

    // Dos acciones DISTINTAS (mismo op, distinto título) no deben confundirse con duplicados.
    const sb2 = makeSandbox(async () => ({
      answer: 'Anotadas las dos.',
      actions: [
        { op: 'create_task', title: 'Tarea A', dueDate: '2026-09-19', dueTime: null, priority: 'media', estimatedMinutes: 30, notes: null },
        { op: 'create_task', title: 'Tarea B', dueDate: '2026-09-19', dueTime: null, priority: 'media', estimatedMinutes: 30, notes: null },
      ],
    }));
    await sb2.AIActions.runIAAction('Tengo dos tareas: A y B.');
    check('8b. dos acciones distintas (no duplicadas) SÍ se aplican ambas', sb2.state.tasks.length === 2);
  }

  // =====================================================================
  section('9) No se inventan campos que el usuario no proporcionó (create_event con solo título+fecha)');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Vale.',
      actions: [{ op: 'create_event', title: 'Reunión', date: '2026-09-22', endDate: null, allDay: false, startTime: null, endTime: null, location: null }],
    }));
    await sb.AIActions.runIAAction('Tengo una reunión el 22.');
    const ev = sb.state.events[0];
    check('9. sin hora dada, startTime queda vacío (no inventada)', ev.startTime === '');
    check('9. sin hora dada, endTime queda vacío (no inventada)', ev.endTime === '');
    check('9. sin ubicación dada, location queda vacío (no inventada)', ev.location === '');
    check('9. endDate no dado se guarda como cadena vacía, no como una fecha inventada', ev.endDate === '');
  }

  // =====================================================================
  section('10) Compatibilidad: update_priority (acción existente, no parte de los ejemplos de AI-1.1) sigue funcionando');
  // =====================================================================
  {
    const sb = makeSandbox(async () => ({
      answer: 'Prioridad subida.',
      actions: [{ op: 'update_priority', targetKind: 'task', targetId: 't-existente', newPriority: 'alta' }],
    }));
    sb.state.tasks.push({ id: 't-existente', title: 'Entregar informe', priority: 'media' });
    await sb.AIActions.runIAAction('Sube la prioridad del informe.');
    check('10. la prioridad de la tarea existente se actualiza', sb.state.tasks[0].priority === 'alta');
    check('10. no se creó ninguna tarea nueva', sb.__calls.addTask === 0 && sb.state.tasks.length === 1);
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
