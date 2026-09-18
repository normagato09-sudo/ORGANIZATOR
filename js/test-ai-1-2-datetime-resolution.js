/**
 * ORGANIZATOR — Tests de AI-1.2 (fechas y horas naturales del Chat IA)
 *
 * Suite Node pura, SIN navegador ni jsdom. Dos capas de prueba:
 *
 *  a) Funciones PURAS de resolución de fecha/hora (resolveRelativeDate,
 *     resolveWeekdayDate, resolveNumericDayMonth, resolveNumericDayOnly,
 *     resolveTimeExpression, resolveDayPart, buildTemporalHints), que
 *     viven dentro del IIFE de js/ai-actions.js y NO forman parte de
 *     `global.AIActions` (a propósito: ese export se deja byte a byte
 *     igual que antes de AI-1.2, porque js/test-event-categories.js ya
 *     comprueba esa línea exacta con una regex — ver test 0 más abajo).
 *     Se extraen literalmente por CONTENIDO (mismo patrón que usa el
 *     resto de la suite del proyecto para bloques internos de
 *     organizator.html: sanitizeRecurrence, recurrenceControlsHtml...) y
 *     se ejecutan aisladas en un sandbox `vm`, sin ningún mock: son
 *     funciones puras, no leen `state` ni tocan el DOM.
 *  b) runIAAction() end-to-end con `callAI` mockeado (mismo patrón que
 *     js/test-ai-1-1-intent-detection.js), para comprobar que el
 *     contexto que de verdad se le manda a la IA incluye las pistas
 *     temporales ya resueltas, y que las 5 intenciones de AI-1.1 siguen
 *     funcionando exactamente igual con AI-1.2 encima.
 *
 * Uso:  node js/test-ai-1-2-datetime-resolution.js
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
const aiActionsSrcRaw = fs.readFileSync(AI_ACTIONS_PATH, 'utf8');
const aiActionsSrc = aiActionsSrcRaw.replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en ai-actions.js — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en ai-actions.js — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Bloque AI-1.2 (funciones puras de fecha/hora), literal de ai-actions.js.
// ---------------------------------------------------------------------
const datetimeSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-1.2',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-1.2 (resolución determinista de fechas/horas)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con el bloque puro de AI-1.2 (sin `state`, sin
 * DOM, sin callAI): estas funciones no dependen de nada más. */
function makeDatetimeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + `
    this.resolveRelativeDate = resolveRelativeDate;
    this.resolveWeekdayDate = resolveWeekdayDate;
    this.resolveNumericDayMonth = resolveNumericDayMonth;
    this.resolveNumericDayOnly = resolveNumericDayOnly;
    this.resolveDateExpression = resolveDateExpression;
    this.resolveTimeExpression = resolveTimeExpression;
    this.resolveDayPart = resolveDayPart;
    this.buildTemporalHints = buildTemporalHints;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2 datetime)' }
  );
  return sandbox;
}

/** Sandbox completo con ai-actions.js REAL cargado (para las pruebas
 * end-to-end de runIAAction), mismo patrón de mocks que ya usa
 * test-ai-1-1-intent-detection.js. `todayStr` es fijo y NO usa
 * `new Date()` — así los tests no dependen de cuándo se ejecuten. */
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

  // =====================================================================
  section('0) Compatibilidad: ACTION_SCHEMA y el contrato de export de AIActions siguen intactos');
  // =====================================================================
  {
    check('0. AIActions sigue exportando exactamente runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES (misma línea literal que ya comprueba test-event-categories.js)',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0. buildActionContext() sigue presente y sin tocar (misma firma de siempre)', /function buildActionContext\(\)\s*\{/.test(aiActionsSrc));
    check('0b. no se cambiaron los nombres de campo de ACTION_SCHEMA (title/dueDate/dueTime/date/startTime/endTime/allDay siguen ahí)',
      ['"title"', '"dueDate"', '"dueTime"', '"date"', '"startTime"', '"endTime"', '"allDay"', '"newDate"', '"newTime"'].every(f => aiActionsSrc.includes(f)));
    check('0c. no se crearon nuevos tipos de "op" (siguen siendo exactamente los 5 de siempre)',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc));
  }

  const dt = makeDatetimeSandbox();

  // =====================================================================
  section('1) "hoy" → FECHA ACTUAL tal cual');
  // =====================================================================
  {
    check('1. "Tengo examen hoy" con FECHA ACTUAL 2026-09-17 -> 2026-09-17', dt.resolveRelativeDate('Tengo examen hoy', '2026-09-17') === '2026-09-17');
  }

  // =====================================================================
  section('2) "mañana" → FECHA ACTUAL + 1 día');
  // =====================================================================
  {
    check('2. "Mañana tengo que estudiar biología" con FECHA ACTUAL 2026-09-17 -> 2026-09-18', dt.resolveRelativeDate('Mañana tengo que estudiar biología', '2026-09-17') === '2026-09-18');
    // Cruce de mes: FECHA ACTUAL a fin de mes.
    check('2b. cruce de mes: FECHA ACTUAL 2026-09-30 + "mañana" -> 2026-10-01', dt.resolveRelativeDate('mañana', '2026-09-30') === '2026-10-01');
  }

  // =====================================================================
  section('3) "pasado mañana" → FECHA ACTUAL + 2 días');
  // =====================================================================
  {
    check('3. FECHA ACTUAL 2026-09-17 + "pasado mañana" -> 2026-09-19', dt.resolveRelativeDate('Tengo cita pasado mañana', '2026-09-17') === '2026-09-19');
    // Cruce de año.
    check('3b. cruce de año: FECHA ACTUAL 2026-12-30 + "pasado mañana" -> 2027-01-01', dt.resolveRelativeDate('pasado mañana', '2026-12-30') === '2027-01-01');
  }

  // =====================================================================
  section('4) Día de la semana suelto ("el lunes")');
  // =====================================================================
  {
    // FECHA ACTUAL 2026-09-17 es jueves (comprobado con Date real, no usado como fuente de verdad en la función).
    check('4. "El lunes tengo médico" con FECHA ACTUAL 2026-09-17 (jueves) -> 2026-09-21 (el lunes siguiente)', dt.resolveWeekdayDate('El lunes tengo médico', '2026-09-17') === '2026-09-21');
    check('4b. si HOY ya es el día pedido, "el X" resuelve a HOY mismo (política documentada, no la ocurrencia de la semana siguiente)', dt.resolveWeekdayDate('El jueves tengo clase', '2026-09-17') === '2026-09-17');
  }

  // =====================================================================
  section('5) "este viernes"');
  // =====================================================================
  {
    check('5. "Este viernes hay examen" con FECHA ACTUAL 2026-09-17 (jueves) -> 2026-09-18 (el viernes más próximo)', dt.resolveWeekdayDate('Este viernes hay examen', '2026-09-17') === '2026-09-18');
  }

  // =====================================================================
  section('6) "el próximo lunes" (política este/próximo, documentada aquí)');
  // =====================================================================
  {
    // Política AI-1.2 (ver comentario del bloque en ai-actions.js, y ya
    // descrita como texto en ACTION_RULES antes de esta fase): "el
    // próximo X" es SIEMPRE la ocurrencia de X de la semana siguiente a
    // la más próxima, nunca la más próxima en sí — se calcula sumando 7
    // días exactos a la ocurrencia más próxima (la que devolvería "el
    // lunes"/"este lunes"), nunca al revés ni contando semanas de
    // calendario Lun-Dom.
    check('6. "El próximo lunes hay reunión" con FECHA ACTUAL 2026-09-17 (jueves): el lunes más próximo es 2026-09-21, así que "el próximo lunes" es 2026-09-28 (+7)',
      dt.resolveWeekdayDate('El próximo lunes hay reunión', '2026-09-17') === '2026-09-28');
    check('6b. "el próximo lunes" es siempre 7 días después de "el lunes"/"este lunes" para la misma FECHA ACTUAL', (() => {
      const nearest = dt.resolveWeekdayDate('el lunes', '2026-09-17');
      const next = dt.resolveWeekdayDate('el próximo lunes', '2026-09-17');
      const diffDays = (new Date(next) - new Date(nearest)) / 86400000;
      return diffDays === 7;
    })());
    check('6c. "la semana que viene" + día también activa la política de "próximo" (no la ocurrencia más próxima)',
      dt.resolveWeekdayDate('la semana que viene tengo lunes libre', '2026-09-17') === '2026-09-28');
  }

  // =====================================================================
  section('7) Fecha numérica "el 24" (sin mes)');
  // =====================================================================
  {
    check('7. "El 24 es festivo" con FECHA ACTUAL 2026-09-17 -> 2026-09-24 (mismo mes, aún no ha pasado)', dt.resolveNumericDayOnly('El 24 es festivo', '2026-09-17') === '2026-09-24');
    check('7b. si el día ya pasó este mes, salta al mes siguiente: FECHA ACTUAL 2026-09-27 + "el 24" -> 2026-10-24', dt.resolveNumericDayOnly('El 24 es festivo', '2026-09-27') === '2026-10-24');
  }

  // =====================================================================
  section('8) Fecha numérica "el 24 de octubre" (día + mes, sin año)');
  // =====================================================================
  {
    check('8. "El parcial es el 24 de octubre" con FECHA ACTUAL 2026-09-17 -> 2026-10-24 (año en curso, aún no ha pasado)', dt.resolveNumericDayMonth('El parcial es el 24 de octubre', '2026-09-17') === '2026-10-24');
  }

  // =====================================================================
  section('9) Formato "24/10"');
  // =====================================================================
  {
    check('9. "Apunta 24/10" con FECHA ACTUAL 2026-09-17 -> 2026-10-24', dt.resolveNumericDayMonth('Apunta 24/10', '2026-09-17') === '2026-10-24');
  }

  // =====================================================================
  section('10) Formato "24-10"');
  // =====================================================================
  {
    check('10. "Apunta 24-10" con FECHA ACTUAL 2026-09-17 -> 2026-10-24', dt.resolveNumericDayMonth('Apunta 24-10', '2026-09-17') === '2026-10-24');
  }

  // =====================================================================
  section('11) Cambio de año al resolver una fecha sin año que ya pasó este año');
  // =====================================================================
  {
    // FECHA ACTUAL 2026-11-20: "24 de octubre" ya pasó este año -> año siguiente.
    check('11. FECHA ACTUAL 2026-11-20 + "el 24 de octubre" -> 2027-10-24 (ya pasó este año)', dt.resolveNumericDayMonth('el 24 de octubre', '2026-11-20') === '2027-10-24');
    check('11b. FECHA ACTUAL 2026-11-20 + "24/10" -> 2027-10-24 (mismo criterio en formato numérico)', dt.resolveNumericDayMonth('24/10', '2026-11-20') === '2027-10-24');
    // Si aún no ha pasado este año, se queda en el año en curso.
    check('11c. FECHA ACTUAL 2026-09-17 + "24/10" -> 2026-10-24 (todavía no ha pasado este año)', dt.resolveNumericDayMonth('24/10', '2026-09-17') === '2026-10-24');
  }

  // =====================================================================
  section('12) Fecha imposible ("31 de febrero") no genera una fecha inventada');
  // =====================================================================
  {
    check('12. "31 de febrero" -> null (nunca una fecha real distinta inventada)', dt.resolveNumericDayMonth('Nace el 31 de febrero', '2026-09-17') === null);
    check('12b. "31/02" (numérico) -> null también', dt.resolveNumericDayMonth('31/02', '2026-09-17') === null);
    check('12c. resolveDateExpression (el agregador) tampoco inventa nada para "31 de abril" (abril no tiene 31 días)', dt.resolveDateExpression('el 31 de abril', '2026-09-17') === null);
  }

  // =====================================================================
  section('13) "a las 17"');
  // =====================================================================
  {
    check('13. "a las 17" -> "17:00"', dt.resolveTimeExpression('Quedamos a las 17') === '17:00');
  }

  // =====================================================================
  section('14) "a las 17:30"');
  // =====================================================================
  {
    check('14. "a las 17:30" -> "17:30"', dt.resolveTimeExpression('Quedamos a las 17:30') === '17:30');
  }

  // =====================================================================
  section('15) "a las 5 de la tarde"');
  // =====================================================================
  {
    check('15. "a las 5 de la tarde" -> "17:00"', dt.resolveTimeExpression('a las 5 de la tarde') === '17:00');
  }

  // =====================================================================
  section('16) "a las 8 de la mañana"');
  // =====================================================================
  {
    check('16. "a las 8 de la mañana" -> "08:00"', dt.resolveTimeExpression('a las 8 de la mañana') === '08:00');
  }

  // =====================================================================
  section('17) "a las 9 de la noche"');
  // =====================================================================
  {
    check('17. "a las 9 de la noche" -> "21:00"', dt.resolveTimeExpression('a las 9 de la noche') === '21:00');
  }

  // =====================================================================
  section('18) Mensaje sin hora → no se inventa ninguna');
  // =====================================================================
  {
    check('18. "Tengo examen mañana" no da ninguna hora (resolveTimeExpression -> null)', dt.resolveTimeExpression('Tengo examen mañana') === null);
    check('18b. buildTemporalHints para "Tengo examen mañana" no menciona ninguna hora', !/Hora detectada/.test(dt.buildTemporalHints('Tengo examen mañana', '2026-09-17')));
  }

  // =====================================================================
  section('19) Mensaje sin fecha → no se inventa ninguna');
  // =====================================================================
  {
    check('19. "Tengo un examen" no da ninguna fecha (resolveDateExpression -> null)', dt.resolveDateExpression('Tengo un examen', '2026-09-17') === null);
    check('19b. "Tengo que estudiar" tampoco da fecha', dt.resolveDateExpression('Tengo que estudiar', '2026-09-17') === null);
    check('19c. buildTemporalHints devuelve cadena vacía cuando no hay NINGUNA referencia temporal (no añade nada al contexto)', dt.buildTemporalHints('Tengo un examen', '2026-09-17') === '');
  }

  // =====================================================================
  section('20) Fecha + hora combinadas');
  // =====================================================================
  {
    check('20. "Tengo examen mañana a las 17" con FECHA ACTUAL 2026-09-17: fecha 2026-09-18 + hora 17:00',
      dt.resolveDateExpression('Tengo examen mañana a las 17', '2026-09-17') === '2026-09-18' &&
      dt.resolveTimeExpression('Tengo examen mañana a las 17') === '17:00');
    check('20b. "Tengo médico el jueves a las 10:30" con FECHA ACTUAL 2026-09-17 (jueves): fecha 2026-09-17 + hora 10:30',
      dt.resolveDateExpression('Tengo médico el jueves a las 10:30', '2026-09-17') === '2026-09-17' &&
      dt.resolveTimeExpression('Tengo médico el jueves a las 10:30') === '10:30');
    check('20c. "El parcial es el 24 de octubre a las 5 de la tarde" con FECHA ACTUAL 2026-09-17: fecha 2026-10-24 + hora 17:00',
      dt.resolveDateExpression('El parcial es el 24 de octubre a las 5 de la tarde', '2026-09-17') === '2026-10-24' &&
      dt.resolveTimeExpression('El parcial es el 24 de octubre a las 5 de la tarde') === '17:00');
  }

  // =====================================================================
  section('20d) Fracciones del día ("por la mañana/tarde/noche") no fabrican una hora exacta');
  // =====================================================================
  {
    check('20d. "por la mañana" no da una hora exacta (resolveTimeExpression -> null)', dt.resolveTimeExpression('Voy por la mañana') === null);
    check('20d. "por la mañana" SÍ se detecta como franja del día (resolveDayPart)', dt.resolveDayPart('Voy por la mañana') === 'mañana');
    check('20d. "por la tarde" -> franja "tarde", sin hora exacta', dt.resolveDayPart('Iré por la tarde') === 'tarde' && dt.resolveTimeExpression('Iré por la tarde') === null);
    check('20d. "por la noche" -> franja "noche", sin hora exacta', dt.resolveDayPart('Vuelvo por la noche') === 'noche' && dt.resolveTimeExpression('Vuelvo por la noche') === null);
    check('20d. buildTemporalHints documenta la franja sin inventar hora ("no inventes ninguna hora")', /Franja horaria mencionada: tarde/.test(dt.buildTemporalHints('el jueves por la tarde tengo médico', '2026-09-17')) && !/Hora detectada/.test(dt.buildTemporalHints('el jueves por la tarde tengo médico', '2026-09-17')));
    check('20d-bis. "mañana" (día siguiente) NO se confunde con "por la mañana" (franja) en el mismo mensaje', dt.resolveRelativeDate('el jueves por la mañana', '2026-09-17') === null);
    check('20d-ter. "mañana" (día siguiente) NO se confunde con "de la mañana" dentro de una hora AM', dt.resolveRelativeDate('a las 8 de la mañana', '2026-09-17') === null);
  }

  // =====================================================================
  section('21) Evento all-day sigue siendo compatible (AI-1.2 no cambia esa regla)');
  // =====================================================================
  {
    const sb = makeActionSandbox(async () => ({
      answer: 'Anotado: el 24 es festivo.',
      actions: [{ op: 'create_event', title: 'Festivo', date: '2026-09-24', endDate: null, allDay: true, startTime: null, endTime: null, location: null }],
    }), '2026-09-17');
    await sb.AIActions.runIAAction('El 24 es festivo.');
    check('21. se crea un evento allDay como antes de AI-1.2 (comportamiento existente intacto)', sb.state.events.length === 1 && sb.state.events[0].allDay === true);
    check('21b. las pistas temporales incluyen la fecha resuelta de "el 24" en el contexto real enviado a la IA', /Fecha detectada en el mensaje: 2026-09-24/.test(sb.__lastUserPrompt));
  }

  // =====================================================================
  section('22) Sin desfase de zona horaria (parseo/formateo siempre en hora LOCAL, nunca UTC)');
  // =====================================================================
  {
    // "mañana" cerca de fin de mes/año: si hubiera un desfase de UTC, la
    // fecha resultante podría "perder" o "ganar" un día según el offset
    // horario del entorno donde corra el test.
    check('22. "mañana" con FECHA ACTUAL 2026-09-17 -> 2026-09-18 exacto (ni 16 ni 19)', dt.resolveRelativeDate('mañana', '2026-09-17') === '2026-09-18');
    check('22b. cruce de mes sin desfase: FECHA ACTUAL 2026-02-28 (no bisiesto) + "mañana" -> 2026-03-01', dt.resolveRelativeDate('mañana', '2026-02-28') === '2026-03-01');
    check('22c. cruce de año sin desfase: FECHA ACTUAL 2026-12-31 + "mañana" -> 2027-01-01', dt.resolveRelativeDate('mañana', '2026-12-31') === '2027-01-01');
    // "el lunes" alrededor de un cambio de mes también debe caer exacto.
    check('22d. día de la semana sin desfase: FECHA ACTUAL 2026-09-30 (miércoles) + "el viernes" -> 2026-10-02', dt.resolveWeekdayDate('el viernes', '2026-09-30') === '2026-10-02');
  }

  // =====================================================================
  section('23) Las referencias relativas usan la FECHA ACTUAL pasada como parámetro, no una fija ni la del sistema');
  // =====================================================================
  {
    // Misma expresión, dos FECHA ACTUAL bien distintas -> resultados bien distintos y correctos para cada una.
    check('23. "mañana" con FECHA ACTUAL 2020-01-01 -> 2020-01-02', dt.resolveRelativeDate('mañana', '2020-01-01') === '2020-01-02');
    check('23b. "mañana" con FECHA ACTUAL 2031-06-15 -> 2031-06-16', dt.resolveRelativeDate('mañana', '2031-06-15') === '2031-06-16');
  }

  // =====================================================================
  section('24) No se usa la fecha real del sistema como fuente de verdad');
  // =====================================================================
  {
    // FECHA ACTUAL deliberadamente muy alejada de "hoy" real: si el
    // código usara new Date() en vez del parámetro, esto fallaría.
    const farFuture = '2099-09-17'; // jueves real da igual: la función no debe mirar el reloj del sistema
    check('24. "hoy" con una FECHA ACTUAL absurdamente futura devuelve esa misma fecha, no la fecha real del sistema', dt.resolveRelativeDate('hoy', farFuture) === farFuture);
    check('24b. "mañana" con esa misma FECHA ACTUAL futura -> día siguiente de ESA fecha, no de la fecha real', dt.resolveRelativeDate('mañana', farFuture) === '2099-09-18');
    // Se quitan los comentarios /* ... */ antes de comprobar: el bloque
    // menciona "new Date()" solo en prosa explicativa (dentro de
    // comentarios), nunca como llamada real — el código en sí solo usa
    // `new Date(year, month, day)` con argumentos explícitos.
    const datetimeCodeOnly = datetimeSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    check('24c. el código (sin comentarios) de este bloque no llama a new Date() sin pasarle año/mes/día explícitos (ninguna llamada "new Date()" a secas)', !/new Date\(\)/.test(datetimeCodeOnly));
    check('24d. el código sí construye Date siempre con año/mes/día explícitos (new Date(...) con argumentos)', /new Date\([a-zA-Z]/.test(datetimeCodeOnly));
  }

  // =====================================================================
  section('25) Compatibilidad con las 5 intenciones de AI-1.1 (AI-1.2 solo mejora la resolución temporal)');
  // =====================================================================
  {
    // 25a) create_task
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_task', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: null, priority: 'media', estimatedMinutes: 60, notes: null }],
      }), '2026-09-17');
      await sb.AIActions.runIAAction('Mañana tengo que estudiar biología.');
      check('25a. create_task sigue funcionando (1 tarea creada, sin evento)', sb.state.tasks.length === 1 && sb.state.events.length === 0);
    }
    // 25b) create_event
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Vale.',
        actions: [{ op: 'create_event', title: 'Examen de biología', date: '2026-09-24', endDate: null, allDay: false, startTime: null, endTime: null, location: null }],
      }), '2026-09-17');
      await sb.AIActions.runIAAction('Tengo parcial de biología el jueves.');
      check('25b. create_event sigue funcionando (1 evento creado, sin tarea)', sb.state.events.length === 1 && sb.state.tasks.length === 0);
    }
    // 25c) move_item
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Movido.',
        actions: [{ op: 'move_item', targetKind: 'event', targetId: 'e-existente', newDate: '2026-09-25', newTime: null }],
      }), '2026-09-17');
      sb.state.events.push({ id: 'e-existente', title: 'Examen', date: '2026-09-24', endDate: '', allDay: false, startTime: '10:00', endTime: '11:00' });
      await sb.AIActions.runIAAction('Mueve el examen al viernes.');
      check('25c. move_item sigue funcionando (no crea nada nuevo, actualiza lo existente)', sb.state.events.length === 1 && sb.state.events[0].date === '2026-09-25' && sb.__calls.addEvent === 0);
    }
    // 25d) cancel_item
    {
      const sb = makeActionSandbox(async () => ({
        answer: 'Cancelado.',
        actions: [{ op: 'cancel_item', targetKind: 'event', targetId: 'e-cancelar' }],
      }), '2026-09-17');
      sb.state.events.push({ id: 'e-cancelar', title: 'Examen de biología', date: '2026-09-24' });
      await sb.AIActions.runIAAction('Cancela el examen de biología.');
      check('25d. cancel_item sigue funcionando (elemento eliminado)', sb.state.events.length === 0 && sb.__calls.deleteEvent === 1);
    }
    // 25e) sin acción
    {
      const sb = makeActionSandbox(async () => ({ answer: 'Vale.', actions: [] }), '2026-09-17');
      const result = await sb.AIActions.runIAAction('Hoy estoy cansado.');
      check('25e. mensaje sin acción sigue sin crear nada (actions: [])', sb.state.tasks.length === 0 && sb.state.events.length === 0 && result.applied.length === 0);
      // "Hoy" SÍ es una referencia temporal reconocible por AI-1.2 (aparece
      // en el contexto como pista), pero eso no debe generar ninguna acción:
      // AI-1.2 solo mejora la resolución de fecha/hora, nunca inventa intención.
      check('25e-bis. aunque "hoy" se detecte como pista temporal, NO se genera ninguna acción por sí sola', /Fecha detectada en el mensaje: 2026-09-17/.test(sb.__lastUserPrompt) && result.applied.length === 0);
    }
  }

  // =====================================================================
  section('26) node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('26. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('26. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
