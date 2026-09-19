/**
 * ORGANIZATOR — Tests de AI-3.1 (definir intención de planificación)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que el resto del
 * proyecto: extrae literalmente por CONTENIDO el bloque AI-3.1
 * (detectPlanningIntent y sus helpers privados) de ai-actions.js, junto
 * con el bloque AI-1.5 del que depende por dentro (isCancelMessage/
 * isMoveMessage/isPriorityChangeMessage, para no robarle a AI-1.5 los
 * mensajes de mover/cancelar/repriorizar claros), y lo ejecuta aislado
 * en un sandbox `vm`, sin mocks: es una función PURA, no lee `state`, no
 * toca el DOM, no llama a callAI/Scheduler/reminders/recurrence/batches/
 * Smart Forms.
 *
 * detectPlanningIntent() NO forma parte de la línea principal de
 * `global.AIActions = { ... }` (mismo criterio que detectSmartFormIntent/
 * buildSmartFormPrefill/getSmartFormClarification/
 * findExistingSmartFormEquivalent): se expone como propiedad ADICIONAL
 * en una sentencia aparte — ver sección "Integración/export" más abajo.
 *
 * Uso:  node js/test-ai-3-1-planning-intent.js
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
// Bloque AI-1.5 (isCancelMessage/isMoveMessage/isPriorityChangeMessage),
// del que depende AI-3.1 por dentro (sección 6 del encargo: precedencia
// de AI-1.5 sobre planificación) — reutilizado tal cual, no reimplementado.
// ---------------------------------------------------------------------
const modificationSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.5',
  '\n\n  /* ==================================================================\n     AI-2.1',
  'bloque AI-1.5 (modificar/mover/cancelar naturalmente)'
);
// ---------------------------------------------------------------------
// Bloque AI-3.1 (detectPlanningIntent y sus helpers privados).
// ---------------------------------------------------------------------
const planningSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-3.1',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-3.1 (definir intención de planificación)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con los bloques puros AI-1.5+AI-3.1 (sin
 * `state`, sin DOM, sin callAI, sin Scheduler): si detectPlanningIntent
 * (o cualquier helper del que depende) intentara tocar cualquiera de
 * esos globals no definidos, lanzaría un ReferenceError — no se define
 * ningún stub a propósito, así una violación de "función pura" se
 * detecta como un fallo de ejecución, no en silencio. */
function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    modificationSrc + '\n' + planningSrc + `
    this.detectPlanningIntent = detectPlanningIntent;
    this.isCancelMessage = isCancelMessage;
    this.isMoveMessage = isMoveMessage;
    this.isPriorityChangeMessage = isPriorityChangeMessage;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.5+AI-3.1, bloques puros)' }
  );
  return sandbox;
}

const sb = makeSandbox();

/** Comprueba que un mensaje produce una intención de planificación
 * válida: no null, type 'planning', sourceText === message, confidence
 * uno de los dos valores permitidos, y NINGÚN campo inventado de más. */
function checkPlanning(name, message, context) {
  const r = sb.detectPlanningIntent(message, context);
  const ok = r !== null
    && r.type === 'planning'
    && r.sourceText === message
    && (r.confidence === 'high' || r.confidence === 'medium')
    && Object.keys(r).sort().join(',') === 'confidence,sourceText,type';
  check(name, ok);
  return r;
}
function checkNull(name, message, context) {
  check(name, sb.detectPlanningIntent(message, context) === null);
}

(async () => {

  // =====================================================================
  section('1-9) Mensajes que DEBEN detectar planificación (sección 2/4 del encargo)');
  // =====================================================================
  checkPlanning('1. "organízame la semana" → planning', 'organízame la semana');
  checkPlanning('2. "planifícame mañana" → planning', 'planifícame mañana');
  checkPlanning('3. "quiero organizar mi semana" → planning', 'quiero organizar mi semana');
  checkPlanning('4. "hazme un plan para estudiar" → planning', 'hazme un plan para estudiar');
  checkPlanning('5. "reparte estas tareas durante la semana" → planning', 'reparte estas tareas durante la semana');
  checkPlanning('6. "quiero sacar tiempo para estudiar" → planning', 'quiero sacar tiempo para estudiar');
  checkPlanning('7. "ayúdame a encontrar huecos para estudiar" → planning', 'ayúdame a encontrar huecos para estudiar');
  checkPlanning('8. "tengo cinco cosas que hacer esta semana, ayúdame a repartirlas" → planning', 'tengo cinco cosas que hacer esta semana, ayúdame a repartirlas');
  checkPlanning('9. "¿cómo puedo organizar todo lo que tengo?" → planning', '¿cómo puedo organizar todo lo que tengo?');

  // Cobertura adicional del resto de ejemplos de la sección 2, más allá
  // del mínimo pedido por la sección 10 (no está de más comprobarlos
  // también, ya que el encargo los lista explícitamente como mensajes
  // que "deben" detectarse).
  checkPlanning('2b. "organízame el día" → planning', 'organízame el día');
  checkPlanning('2c. "ayúdame a planificar esta semana" → planning', 'ayúdame a planificar esta semana');
  checkPlanning('2d. "quiero distribuir estas tareas" → planning', 'quiero distribuir estas tareas');
  checkPlanning('2e. "ponme un horario para estudiar" → planning', 'ponme un horario para estudiar');
  checkPlanning('2f. "distribuye el trabajo que tengo pendiente" → planning', 'distribuye el trabajo que tengo pendiente');
  checkPlanning('2g. "quiero planificar mis tareas" → planning', 'quiero planificar mis tareas');
  checkPlanning('4b. "tengo mucho trabajo pendiente, ¿cómo lo organizo?" → planning', 'tengo mucho trabajo pendiente, ¿cómo lo organizo?');
  checkPlanning('4c. "necesito sacar tiempo para estudiar esta semana" → planning', 'necesito sacar tiempo para estudiar esta semana');

  // =====================================================================
  section('10-12) Mensajes que NO deben detectar planificación (sección 4/5 del encargo)');
  // =====================================================================
  checkNull('10. "tengo mucho trabajo pendiente" → null', 'tengo mucho trabajo pendiente');
  checkNull('11. "tengo demasiadas cosas" → null', 'tengo demasiadas cosas');
  checkNull('12. "qué semana más larga" → null', 'qué semana más larga');

  // Cobertura adicional del resto de la sección 4/5.
  checkNull('4d. "tengo mucho trabajo" → null (sola, sin petición de ayuda)', 'tengo mucho trabajo');
  checkNull('4e. "esta semana tengo muchas cosas" → null', 'esta semana tengo muchas cosas');
  checkNull('5b. "voy fatal de tiempo" → null', 'voy fatal de tiempo');
  checkNull('5c. "¿crees que podré estudiar esta semana?" → null', '¿crees que podré estudiar esta semana?');

  // =====================================================================
  section('13-16) NO confundir con creación normal (sección 3 del encargo)');
  // =====================================================================
  checkNull('13. "mañana tengo que estudiar biología" → no planning (AI-1/AI-2 de siempre)', 'mañana tengo que estudiar biología');
  checkNull('14. "el lunes tengo médico" → no planning (evento)', 'el lunes tengo médico');
  checkNull('15. "añade estudiar matemáticas el martes" → no planning (creación normal)', 'añade estudiar matemáticas el martes');
  checkNull('16. "crea una tarea para estudiar dos horas" → no planning (creación normal)', 'crea una tarea para estudiar dos horas');

  // =====================================================================
  section('17-18) Entradas vacías/inválidas');
  // =====================================================================
  checkNull('17. mensaje vacío ("") → null', '');
  check('17b. mensaje solo con espacios en blanco → null', sb.detectPlanningIntent('   ', {}) === null);
  check('18. null → null (no lanza)', sb.detectPlanningIntent(null, {}) === null);
  check('18b. undefined → null (no lanza)', sb.detectPlanningIntent(undefined, {}) === null);
  check('18c. un número → null (no lanza, tipo inválido)', sb.detectPlanningIntent(42, {}) === null);
  check('18d. un objeto → null (no lanza, tipo inválido)', sb.detectPlanningIntent({}, {}) === null);
  check('18e. sin segundo argumento (context omitido) → sigue funcionando igual', sb.detectPlanningIntent('organízame la semana') !== null);

  // =====================================================================
  section('19-21) Planificación explícita con fecha / varias tareas / restricciones');
  // =====================================================================
  checkPlanning('19. planificación explícita con fecha ("organízame la semana que viene")', 'organízame la semana que viene');
  checkPlanning('19b. planificación explícita con fecha ("planifícame el lunes")', 'planifícame el lunes');
  checkPlanning('20. planificación explícita con varias tareas mencionadas', 'organízame la semana, tengo que estudiar biología, hacer la compra y llamar al médico');
  checkPlanning('21. planificación explícita junto con restricciones futuras', 'organízame la semana, tengo médico el jueves así que no me pongas nada ese día');
  {
    // Sección 6 del encargo: la intención de planificación debe poder
    // distinguirse de una creación inmediata — NUNCA debe "colarse" un
    // create_task por su cuenta (esta fase ni siquiera sabe qué es un
    // create_task: solo se comprueba que el resultado sigue siendo
    // exactamente el contrato { type: 'planning', sourceText,
    // confidence }, nada de campos de creación).
    const r = checkPlanning('21b. "organízame la semana y decide cuándo estudiar biología" → planning', 'organízame la semana y decide cuándo estudiar biología');
    check('21c. el resultado NUNCA incluye campos de creación (title/date/op/...)', r && !('title' in r) && !('op' in r) && !('date' in r) && !('actions' in r));
  }

  // =====================================================================
  section('22-23) Precedencia de AI-1.5 intacta (sección 6 del encargo)');
  // =====================================================================
  {
    // Control: isMoveMessage/isCancelMessage siguen clasificando estos
    // mensajes exactamente igual que antes (AI-3.1 no las reimplementa).
    check('22a. (control) "mueve el examen al viernes" sigue siendo isMoveMessage', sb.isMoveMessage('mueve el examen al viernes') === true);
    checkNull('22. "mueve el examen al viernes" → detectPlanningIntent NUNCA se lo roba a AI-1.5', 'mueve el examen al viernes');
    checkNull('22b. "cambia la reunión al lunes" → sigue siendo modificación, no planning', 'cambia la reunión al lunes');

    check('23a. (control) "cancela el examen de biología" sigue siendo isCancelMessage', sb.isCancelMessage('cancela el examen de biología') === true);
    checkNull('23. "cancela el examen de biología" → detectPlanningIntent NUNCA se lo roba a AI-1.5', 'cancela el examen de biología');
    checkNull('23b. "ya no tengo la reunión" → sigue siendo cancelación, no planning', 'ya no tengo la reunión');

    check('23c. (control) "cambia la prioridad del trabajo a alta" sigue siendo isPriorityChangeMessage', sb.isPriorityChangeMessage('cambia la prioridad del trabajo a alta') === true);
    checkNull('23d. cambio de prioridad claro tampoco se confunde con planning', 'cambia la prioridad del trabajo a alta');
  }

  // =====================================================================
  section('24-25) No se toca ACTION_SCHEMA ni el formato de las acciones existentes');
  // =====================================================================
  {
    check('24. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op" (ni más ni menos)',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
    check('24b. ACTION_SCHEMA no menciona "planning" como un "op" nuevo', !/"op":[^}]*planning/.test(aiActionsSrc));
    check('25. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES en su línea principal (sin tocar)',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('25b. detectPlanningIntent se expone como propiedad ADICIONAL, sin tocar esa línea principal',
      /global\.AIActions\.detectPlanningIntent = detectPlanningIntent;/.test(aiActionsSrc));
    check('25c. detectSmartFormIntent/buildSmartFormPrefill/getSmartFormClarification/findExistingSmartFormEquivalent (AI-2.x) siguen exportadas tal cual, sin cambios de formato',
      /global\.AIActions\.detectSmartFormIntent = detectSmartFormIntent;/.test(aiActionsSrc) &&
      /global\.AIActions\.buildSmartFormPrefill = buildSmartFormPrefill;/.test(aiActionsSrc) &&
      /global\.AIActions\.getSmartFormClarification = getSmartFormClarification;/.test(aiActionsSrc) &&
      /global\.AIActions\.findExistingSmartFormEquivalent = findExistingSmartFormEquivalent;/.test(aiActionsSrc));
    check('25d. AI-3.1 no define ningún "op" nuevo ni toca applyCreateTask/applyCreateEvent/applyMoveItem/applyCancelItem/applyUpdatePriority',
      !/function applyCreateTask/.test(planningSrc) && !/function applyCreateEvent/.test(planningSrc) && !/function applyMoveItem/.test(planningSrc) && !/function applyCancelItem/.test(planningSrc) && !/function applyUpdatePriority/.test(planningSrc));
  }

  // =====================================================================
  section('Determinismo: la misma entrada produce siempre la misma salida');
  // =====================================================================
  {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(JSON.stringify(sb.detectPlanningIntent('organízame la semana', {})));
    check('D1. cinco llamadas idénticas devuelven siempre el mismo objeto (misma forma/valores)', results.every(r => r === results[0]));
    const resultsNull = [];
    for (let i = 0; i < 5; i++) resultsNull.push(sb.detectPlanningIntent('tengo mucho trabajo', {}));
    check('D2. cinco llamadas idénticas sin planning devuelven siempre null', resultsNull.every(r => r === null));
    check('D3. no depende de `context` para el resultado booleano (con o sin context, mismo type/confidence)',
      sb.detectPlanningIntent('organízame la semana', { todayStr: '2026-09-17' }).confidence === sb.detectPlanningIntent('organízame la semana', {}).confidence);
  }

  // =====================================================================
  section('Pureza: no toca state/DOM/callAI/Scheduler (bloque aislado)');
  // =====================================================================
  {
    let threw = false;
    try { sb.detectPlanningIntent('organízame la semana, tengo que estudiar biología y médico el jueves', { todayStr: '2026-09-17' }); }
    catch (e) { threw = true; }
    check('P1. no lanza ReferenceError (no depende de `state`/`document`/`callAI`/Scheduler, no definidos en este sandbox)', threw === false);
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
