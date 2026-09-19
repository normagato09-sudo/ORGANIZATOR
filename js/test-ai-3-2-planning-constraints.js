/**
 * ORGANIZATOR — Tests de AI-3.2 (recoger restricciones de planificación)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que el resto del
 * proyecto: extrae literalmente por CONTENIDO el bloque AI-3.2
 * (extractPlanningConstraints y sus helpers privados) de ai-actions.js,
 * junto con los bloques de los que depende por dentro —
 * AI-1.2 (resolveDateExpression/resolveWeekdayDate/resolveNumericDayOnly/
 * parseYMDLocal/addDaysLocal/isValidCalendarDate/pad2/WEEKDAY_NAMES_ES),
 * AI-1.5 (isPriorityChangeMessage) y AI-2.8 (normalizeSmartFormTitle) —
 * y lo ejecuta aislado en un sandbox `vm`, sin mocks: es una función
 * PURA, no lee `state`, no toca el DOM, no llama a callAI/Scheduler/
 * reminders/recurrence/batches/Smart Forms.
 *
 * extractPlanningConstraints() NO forma parte de la línea principal de
 * `global.AIActions = { ... }` (mismo criterio que detectPlanningIntent/
 * detectSmartFormIntent/etc.): se expone como propiedad ADICIONAL en una
 * sentencia aparte — ver sección 24/31 más abajo.
 *
 * Uso:  node js/test-ai-3-2-planning-constraints.js
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
// Bloques de los que depende AI-3.2 por dentro, reutilizados tal cual
// (nunca reimplementados) — mismo patrón de extracción que el resto de
// la suite AI-1.x/AI-2.x/AI-3.x.
// ---------------------------------------------------------------------
const datetimeSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.2', '\n\n  /* ==================================================================\n     AI-1.3', 'bloque AI-1.2 (fechas/horas)');
const modificationSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.5', '\n\n  /* ==================================================================\n     AI-2.1', 'bloque AI-1.5 (isPriorityChangeMessage)');
const duplicateGuardSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-2.8', '\n\n  /* ==================================================================\n     AI-3.1', 'bloque AI-2.8 (normalizeSmartFormTitle)');
const constraintsSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.2', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-3.2 (extractPlanningConstraints)');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con los bloques puros AI-1.2+AI-1.5+AI-2.8+AI-3.2
 * (sin `state`, sin DOM, sin callAI, sin Scheduler): si
 * extractPlanningConstraints (o cualquier helper del que depende)
 * intentara tocar cualquiera de esos globals no definidos, lanzaría un
 * ReferenceError — no se define ningún stub a propósito, así una
 * violación de "función pura" se detecta como un fallo de ejecución, no
 * en silencio. */
function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + '\n' + modificationSrc + '\n' + duplicateGuardSrc + '\n' + constraintsSrc + `
    this.extractPlanningConstraints = extractPlanningConstraints;
    this.resolveDateExpression = resolveDateExpression;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+AI-1.5+AI-2.8+AI-3.2, bloques puros)' }
  );
  return sandbox;
}

const sb = makeSandbox();
const TODAY = '2026-09-17'; // jueves

const EMPTY_RESULT = {
  dateFrom: null, dateTo: null, timeFrom: null, timeTo: null,
  daysOfWeek: [], preferredDayParts: [], availableMinutesPerDay: null,
  maxSessionMinutes: null, priority: null, taskIds: [], excludedDates: [], notes: [],
};
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

(async () => {

  // =====================================================================
  section('1) Mensaje sin restricciones → objeto vacío estable (nunca null)');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('organízame la semana', { today: TODAY });
    check('1a. no devuelve null para un mensaje válido', r !== null);
    check('1b. devuelve exactamente el objeto vacío estable (los 12 campos, todos en su valor vacío)', deepEq(r, EMPTY_RESULT));
    check('1c. tiene exactamente 12 campos, ni más ni menos', Object.keys(r).length === 12);
  }

  // =====================================================================
  section('2) Fecha única');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('mañana', { today: TODAY });
    check('2a. dateFrom = fecha de mañana', r.dateFrom === '2026-09-18');
    check('2b. dateTo = misma fecha (dateFrom === dateTo para una fecha única)', r.dateTo === '2026-09-18');
  }

  // =====================================================================
  section('3) Rango de fechas');
  // =====================================================================
  {
    const r1 = sb.extractPlanningConstraints('esta semana', { today: TODAY });
    check('3a. "esta semana" → dateFrom es el lunes de la semana actual', r1.dateFrom === '2026-09-14');
    check('3b. "esta semana" → dateTo es el domingo de esa misma semana', r1.dateTo === '2026-09-20');
    const r2 = sb.extractPlanningConstraints('la semana que viene', { today: TODAY });
    check('3c. "la semana que viene" → lunes de la semana SIGUIENTE', r2.dateFrom === '2026-09-21');
    check('3d. "la semana que viene" → domingo de esa semana siguiente', r2.dateTo === '2026-09-27');
    const r3 = sb.extractPlanningConstraints('del 10 al 15', { today: TODAY });
    check('3e. "del 10 al 15" → dateFrom/dateTo en el mismo mes', r3.dateFrom === '2026-10-10' && r3.dateTo === '2026-10-15');
  }

  // =====================================================================
  section('4) "mañana por la tarde"');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('mañana por la tarde', { today: TODAY });
    check('4a. dateFrom/dateTo = fecha de mañana', r.dateFrom === '2026-09-18' && r.dateTo === '2026-09-18');
    check('4b. preferredDayParts = ["afternoon"] (nunca también "morning")', deepEq(r.preferredDayParts, ['afternoon']));
  }

  // =====================================================================
  section('5) Días de la semana');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('lunes y miércoles', { today: TODAY });
    check('5. "lunes y miércoles" → daysOfWeek [0,2] (convención 0=lunes..6=domingo)', deepEq(r.daysOfWeek, [0, 2]));
  }

  // =====================================================================
  section('6) Rango lunes-viernes');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('de lunes a viernes', { today: TODAY });
    check('6a. "de lunes a viernes" → daysOfWeek [0,1,2,3,4] (patrón recurrente semanal)', deepEq(r.daysOfWeek, [0, 1, 2, 3, 4]));
    const rLab = sb.extractPlanningConstraints('todos los días laborables', { today: TODAY });
    check('6b. "todos los días laborables" → mismo resultado [0,1,2,3,4]', deepEq(rLab.daysOfWeek, [0, 1, 2, 3, 4]));
  }

  // =====================================================================
  section('7) Varias preferencias de parte del día');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('por la mañana y por la noche', { today: TODAY });
    check('7. preferredDayParts contiene ambas franjas, sin duplicados, en orden determinista', deepEq(r.preferredDayParts, ['morning', 'night']));
  }

  // =====================================================================
  section('8) Horas → minutos');
  // =====================================================================
  {
    check('8a. "2 horas al día" → 120', sb.extractPlanningConstraints('tengo 2 horas al día', { today: TODAY }).availableMinutesPerDay === 120);
    check('8b. "90 minutos al día" (diarios) → 90', sb.extractPlanningConstraints('puedo dedicar 90 minutos diarios', { today: TODAY }).availableMinutesPerDay === 90);
    check('8c. "una hora al día" (cada tarde) → 60', sb.extractPlanningConstraints('solo tengo una hora cada tarde', { today: TODAY }).availableMinutesPerDay === 60);
  }

  // =====================================================================
  section('9) Minutos diarios');
  // =====================================================================
  {
    check('9. "30 min al día" → 30', sb.extractPlanningConstraints('tengo 30 min al día', { today: TODAY }).availableMinutesPerDay === 30);
  }

  // =====================================================================
  section('10) Duración máxima de sesión');
  // =====================================================================
  {
    check('10a. "máximo 45 minutos por tarea" → 45', sb.extractPlanningConstraints('máximo 45 minutos por tarea', { today: TODAY }).maxSessionMinutes === 45);
    check('10b. "no quiero sesiones de más de una hora" → 60', sb.extractPlanningConstraints('no quiero sesiones de más de una hora', { today: TODAY }).maxSessionMinutes === 60);
    check('10c. "bloques de 30 minutos como máximo" → 30', sb.extractPlanningConstraints('bloques de 30 minutos como máximo', { today: TODAY }).maxSessionMinutes === 30);
  }

  // =====================================================================
  section('11-14) Prioridad');
  // =====================================================================
  {
    check('11. "prioriza lo urgente" → priority "urgent"', sb.extractPlanningConstraints('prioriza lo urgente', { today: TODAY }).priority === 'urgent');
    check('11b. "quiero quitarme primero las tareas más urgentes" → "urgent"', sb.extractPlanningConstraints('quiero quitarme primero las tareas más urgentes', { today: TODAY }).priority === 'urgent');
    check('11c. "prioridad alta" → "urgent"', sb.extractPlanningConstraints('prioridad alta', { today: TODAY }).priority === 'urgent');
    check('12. "haz primero lo importante" → priority "important"', sb.extractPlanningConstraints('haz primero lo importante', { today: TODAY }).priority === 'important');
    check('13. "lo más corto primero" → priority "shortest"', sb.extractPlanningConstraints('lo más corto primero', { today: TODAY }).priority === 'shortest');
    check('13b. "tareas cortas primero" → "shortest"', sb.extractPlanningConstraints('tareas cortas primero', { today: TODAY }).priority === 'shortest');
    check('14. "lo antes posible" → priority "earliest"', sb.extractPlanningConstraints('lo antes posible', { today: TODAY }).priority === 'earliest');
    check('14b. "quiero acabar cuanto antes" → "earliest" (sin inventar ninguna fecha)', sb.extractPlanningConstraints('quiero acabar cuanto antes', { today: TODAY }).priority === 'earliest' && sb.extractPlanningConstraints('quiero acabar cuanto antes', { today: TODAY }).dateFrom === null);
  }

  // =====================================================================
  section('15) Exclusión de una fecha concreta');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('excepto el 15', { today: TODAY });
    check('15a. excludedDates contiene la fecha resuelta', deepEq(r.excludedDates, ['2026-10-15']));
    check('15b. NO se cuela también como dateFrom/dateTo (es una exclusión, no una petición)', r.dateFrom === null && r.dateTo === null);
  }

  // =====================================================================
  section('16) Exclusión de día de semana sin inventar fecha');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('no puedo el martes', { today: TODAY });
    check('16a. excludedDates queda vacío (nunca se inventa una fecha concreta)', deepEq(r.excludedDates, []));
    check('16b. notes conserva la restricción en formato estructurado ("exclude weekday: Tuesday")', deepEq(r.notes, ['exclude weekday: Tuesday']));
    check('16c. tampoco se cuela como dateFrom/dateTo ni como daysOfWeek', r.dateFrom === null && r.dateTo === null && deepEq(r.daysOfWeek, []));
  }

  // =====================================================================
  section('17-19) Tareas referenciadas mediante context.tasks');
  // =====================================================================
  {
    const tasks = [
      { id: 't-leche', title: 'Comprar leche' },
      { id: 't-biologia', title: 'Estudiar biología' },
      { id: 't-informe', title: 'Terminar el informe' },
    ];
    const r = sb.extractPlanningConstraints('organízame la semana, tengo que estudiar biología', { today: TODAY, tasks });
    check('17. identifica la tarea cuyo título aparece claramente en el mensaje', deepEq(r.taskIds, ['t-biologia']));

    const rNone = sb.extractPlanningConstraints('organízame la semana', { today: TODAY, tasks });
    check('18. sin ninguna correspondencia clara → taskIds vacío (nunca se inventa un id)', deepEq(rNone.taskIds, []));

    const r2msg = 'organízame la semana: estudiar biología y terminar el informe';
    const idsOrderA = sb.extractPlanningConstraints(r2msg, { today: TODAY, tasks }).taskIds;
    const idsOrderB = sb.extractPlanningConstraints(r2msg, { today: TODAY, tasks: [...tasks].reverse() }).taskIds;
    check('19. taskIds no depende del orden de context.tasks (mismo resultado con el array invertido)', deepEq(idsOrderA, idsOrderB) && idsOrderA.length === 2);
  }

  // =====================================================================
  section('20-22) No modifica context.tasks / context.events / state');
  // =====================================================================
  {
    const tasks = [{ id: 't1', title: 'Estudiar biología' }];
    const events = [{ id: 'e1', title: 'Parcial de biología', date: '2026-09-18' }];
    const tasksSnapshot = JSON.stringify(tasks);
    const eventsSnapshot = JSON.stringify(events);
    sb.extractPlanningConstraints('organízame la semana, tengo que estudiar biología', { today: TODAY, tasks, events });
    check('20. context.tasks no se modifica', JSON.stringify(tasks) === tasksSnapshot);
    check('21. context.events no se modifica (ni siquiera se lee: esta fase no usa eventos todavía)', JSON.stringify(events) === eventsSnapshot);

    let threw = false;
    try { sb.extractPlanningConstraints('organízame la semana', { today: TODAY }); }
    catch (e) { threw = true; }
    check('22. no lanza ReferenceError (no depende de `state`, no definido en este sandbox — nunca lo lee)', threw === false);
  }

  // =====================================================================
  section('23) Determinismo');
  // =====================================================================
  {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(JSON.stringify(sb.extractPlanningConstraints('organízame la semana, tengo 2 horas al día, máximo 45 minutos, prioriza lo urgente', { today: TODAY })));
    check('23. cinco llamadas idénticas devuelven siempre el mismo resultado (misma forma/valores)', results.every(r => r === results[0]));
  }

  // =====================================================================
  section('24) Entrada vacía');
  // =====================================================================
  {
    check('24a. mensaje vacío ("") → objeto vacío estable', deepEq(sb.extractPlanningConstraints('', { today: TODAY }), EMPTY_RESULT));
    check('24b. mensaje solo con espacios → objeto vacío estable', deepEq(sb.extractPlanningConstraints('   ', { today: TODAY }), EMPTY_RESULT));
  }

  // =====================================================================
  section('25) Entrada no string');
  // =====================================================================
  {
    check('25a. null → objeto vacío estable (no lanza)', deepEq(sb.extractPlanningConstraints(null, { today: TODAY }), EMPTY_RESULT));
    check('25b. undefined → objeto vacío estable (no lanza)', deepEq(sb.extractPlanningConstraints(undefined, { today: TODAY }), EMPTY_RESULT));
    check('25c. un número → objeto vacío estable (no lanza)', deepEq(sb.extractPlanningConstraints(42, { today: TODAY }), EMPTY_RESULT));
    check('25d. un objeto → objeto vacío estable (no lanza)', deepEq(sb.extractPlanningConstraints({}, { today: TODAY }), EMPTY_RESULT));
    check('25e. sin `context` en absoluto → sigue funcionando (objeto vacío estable, mismo criterio "debe funcionar sin context")', deepEq(sb.extractPlanningConstraints('organízame la semana'), EMPTY_RESULT));
  }

  // =====================================================================
  section('26) Diferencia entre "mañana" (fecha) y "por la mañana" (day part)');
  // =====================================================================
  {
    const rDate = sb.extractPlanningConstraints('mañana', { today: TODAY });
    check('26a. "mañana" sola → SOLO fecha, nunca preferredDayParts', rDate.dateFrom === '2026-09-18' && deepEq(rDate.preferredDayParts, []));
    const rPart = sb.extractPlanningConstraints('por la mañana', { today: TODAY });
    check('26b. "por la mañana" sola → SOLO day part, nunca una fecha (no hay ninguna otra referencia temporal en el mensaje)', rPart.dateFrom === null && rPart.dateTo === null && deepEq(rPart.preferredDayParts, ['morning']));
  }

  // =====================================================================
  section('27) "tengo 2 horas al día y máximo 45 minutos por sesión"');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('tengo 2 horas al día y máximo 45 minutos por sesión', { today: TODAY });
    check('27a. availableMinutesPerDay = 120', r.availableMinutesPerDay === 120);
    check('27b. maxSessionMinutes = 45 (ambos extraídos del mismo mensaje, sin interferirse)', r.maxSessionMinutes === 45);
  }

  // =====================================================================
  section('28) Varias restricciones simultáneas');
  // =====================================================================
  {
    const message = 'organízame de lunes a viernes por la tarde, tengo 2 horas al día, máximo 45 minutos por sesión, prioriza lo urgente, no puedo el martes';
    const r = sb.extractPlanningConstraints(message, { today: TODAY });
    check('28a. daysOfWeek [0,1,2,3,4]', deepEq(r.daysOfWeek, [0, 1, 2, 3, 4]));
    check('28b. preferredDayParts ["afternoon"]', deepEq(r.preferredDayParts, ['afternoon']));
    check('28c. availableMinutesPerDay 120', r.availableMinutesPerDay === 120);
    check('28d. maxSessionMinutes 45', r.maxSessionMinutes === 45);
    check('28e. priority "urgent"', r.priority === 'urgent');
    check('28f. notes con la exclusión del martes', deepEq(r.notes, ['exclude weekday: Tuesday']));
    check('28g. excludedDates vacío (día de semana suelto, sin inventar fecha)', deepEq(r.excludedDates, []));
  }

  // =====================================================================
  section('29) No duplicar daysOfWeek');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('lunes, lunes y lunes otra vez, y también el lunes', { today: TODAY });
    check('29. "lunes" repetido varias veces → daysOfWeek solo tiene un 0', deepEq(r.daysOfWeek, [0]));
  }

  // =====================================================================
  section('30) No duplicar preferredDayParts');
  // =====================================================================
  {
    const r = sb.extractPlanningConstraints('por la tarde, tardes, y también por la tarde otra vez', { today: TODAY });
    check('30. varias menciones de "tarde" → preferredDayParts solo tiene un "afternoon"', deepEq(r.preferredDayParts, ['afternoon']));
  }

  // =====================================================================
  section('31) No se modifica ACTION_SCHEMA');
  // =====================================================================
  {
    check('31a. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op" (ni más ni menos)',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
    check('31b. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES en su línea principal (sin tocar)',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('31c. extractPlanningConstraints se expone como propiedad ADICIONAL, sin tocar esa línea principal',
      /global\.AIActions\.extractPlanningConstraints = extractPlanningConstraints;/.test(aiActionsSrc));
  }

  // =====================================================================
  section('32) No se modifican los helpers existentes de AI-1.2');
  // =====================================================================
  {
    // Cada función de AI-1.2 sigue teniendo exactamente UNA declaración
    // en todo el archivo (AI-3.2 las REUTILIZA por nombre, nunca las
    // redefine ni las sombrea con una segunda función del mismo nombre).
    ['resolveDateExpression', 'resolveRelativeDate', 'resolveWeekdayDate', 'resolveNumericDayMonth', 'resolveNumericDayOnly', 'resolveTimeExpression', 'resolveDayPart', 'parseYMDLocal', 'formatYMDLocal', 'addDaysLocal', 'isValidCalendarDate', 'pad2'].forEach(name => {
      const count = (aiActionsSrc.match(new RegExp(`function ${name}\\(`, 'g')) || []).length;
      check(`32. función "${name}" (AI-1.2) sigue teniendo una única declaración en el archivo`, count === 1);
    });
    check('32b. WEEKDAY_NAMES_ES (AI-1.2) sigue teniendo una única declaración', (aiActionsSrc.match(/const WEEKDAY_NAMES_ES = /g) || []).length === 1);
    check('32c. el bloque AI-3.2 no redefine ninguna de esas funciones (evidencia textual: ni un solo "function resolve" dentro de su propio bloque)', !/function\s+resolve/.test(constraintsSrc));
  }

  // =====================================================================
  section('33) No se modifica detectPlanningIntent (AI-3.1)');
  // =====================================================================
  {
    check('33a. detectPlanningIntent (AI-3.1) sigue teniendo una única declaración en el archivo', (aiActionsSrc.match(/function detectPlanningIntent\(/g) || []).length === 1);
    check('33b. su export sigue intacto, sin tocar', /global\.AIActions\.detectPlanningIntent = detectPlanningIntent;/.test(aiActionsSrc));
    // La cabecera de AI-3.2 SÍ menciona "detectPlanningIntent" en prosa,
    // entre paréntesis, solo para explicar en qué fase encaja este
    // bloque (ver comentario de cabecera) — lo que de verdad importa
    // para la sección 12 del encargo ("AI-3.2 debe poder funcionar
    // independientemente") es que nunca la LLAME como función: se
    // comprueba el patrón de LLAMADA real ("detectPlanningIntent(", el
    // nombre seguido de paréntesis de apertura), que la mención en
    // prosa "(detectPlanningIntent)" no produce (ahí el paréntesis de
    // apertura va ANTES del nombre, no después).
    check('33c. el bloque AI-3.2 no LLAMA a detectPlanningIntent (son independientes — sección 12 del encargo)', !/detectPlanningIntent\(/.test(constraintsSrc));
    // Control funcional: detectPlanningIntent sigue funcionando exactamente
    // igual que antes de AI-3.2 (se prueba en detalle en
    // test-ai-3-1-planning-intent.js; aquí solo se confirma que sigue
    // cargando y respondiendo sin haber sido tocada).
    const sandbox2 = {};
    vm.createContext(sandbox2);
    const planningIntentSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.1', '\n\n  /* ==================================================================\n     AI-3.2', 'bloque AI-3.1 (detectPlanningIntent)');
    vm.runInContext(modificationSrc + '\n' + planningIntentSrc + '\nthis.detectPlanningIntent = detectPlanningIntent;', sandbox2, { filename: 'ai-actions.js (AI-3.1 aislado, control)' });
    check('33d. detectPlanningIntent("organízame la semana") sigue devolviendo planning/high', sandbox2.detectPlanningIntent('organízame la semana', {}) && sandbox2.detectPlanningIntent('organízame la semana', {}).confidence === 'high');
  }

  // =====================================================================
  section('Pureza adicional: no toca DOM/callAI/Scheduler/batches/reminders');
  // =====================================================================
  {
    let threw = false;
    try {
      sb.extractPlanningConstraints('organízame la semana, tengo 2 horas al día, prioriza lo urgente, no puedo el martes, máximo 45 minutos', { today: TODAY, tasks: [{ id: 't1', title: 'Estudiar biología' }] });
    } catch (e) { threw = true; }
    check('P1. no lanza ReferenceError (no depende de `document`/`callAI`/Scheduler/batches/reminders, ninguno definido en este sandbox)', threw === false);
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
