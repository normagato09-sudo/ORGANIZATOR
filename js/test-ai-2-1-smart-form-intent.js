/**
 * ORGANIZATOR — Tests de AI-2.1 (detección de necesidad de formulario
 * inteligente desde el chat)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que la familia
 * AI-1.x: extrae literalmente por CONTENIDO el bloque AI-2.1
 * (detectSmartFormIntent y sus helpers privados) junto con los bloques
 * AI-1.2/1.3/1.4/1.5 de los que depende (resolveDateExpression/
 * resolveTimeExpression, isHolidayMessage/isAppointmentMessage,
 * isTaskMessage, isMoveMessage/isCancelMessage/isPriorityChangeMessage),
 * y los ejecuta aislados en un sandbox `vm`, sin mocks: son funciones
 * puras, no leen `state`, no tocan el DOM, no llaman a callAI.
 *
 * detectSmartFormIntent() NO forma parte de `global.AIActions` (a
 * propósito, mismo criterio que todos los helpers de AI-1.2/1.3/1.4/1.5:
 * ese export se deja exactamente igual — ver test 24/25).
 *
 * Uso:  node js/test-ai-2-1-smart-form-intent.js
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
// (tareas implícitas) + AI-1.5 (mover/cancelar/prioridad) + AI-2.1
// (formulario inteligente), literales de ai-actions.js.
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
  '\n\n  /* ==================================================================\n     AI-2.1',
  'bloque AI-1.5 (modificar/mover/cancelar naturalmente)'
);
const smartFormSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-2.1',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-2.1 (detección de necesidad de formulario inteligente)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con los bloques puros AI-1.2+1.3+1.4+1.5+AI-2.1
 * (sin `state`, sin DOM, sin callAI). */
function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  // Espía de `state`/DOM: si detectSmartFormIntent (o cualquier función
  // de la que depende) intentara tocar cualquiera de estos globals no
  // definidos, lanzaría un ReferenceError — no se define ningún stub a
  // propósito, así una violación de "no debe tocar state/DOM" se detecta
  // como un fallo de ejecución, no en silencio.
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + '\n' + implicitTaskSrc + '\n' + modificationSrc + '\n' + smartFormSrc + `
    this.detectSmartFormIntent = detectSmartFormIntent;
    this.resolveDateExpression = resolveDateExpression;
    this.resolveTimeExpression = resolveTimeExpression;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+1.3+1.4+1.5+AI-2.1, bloques puros)' }
  );
  return sandbox;
}

const sb = makeSandbox();
const TODAY = '2026-09-17'; // jueves

(async () => {

  // =====================================================================
  section('1) "parcial de biología" → formulario de evento');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('parcial de biología');
    check('1. no es null', r !== null);
    check('1. type: event', r && r.type === 'event');
  }

  // =====================================================================
  section('2) "examen de matemáticas" → evento');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('examen de matemáticas');
    check('2. type: event', r && r.type === 'event');
  }

  // =====================================================================
  section('3) "cita con el médico" → evento');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('cita con el médico');
    check('3. type: event', r && r.type === 'event');
  }

  // =====================================================================
  section('4) "reunión con Juan" → evento');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('reunión con Juan');
    check('4. type: event', r && r.type === 'event');
  }

  // =====================================================================
  section('5) "estudiar biología" → tarea');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('estudiar biología');
    check('5. type: task', r && r.type === 'task');
  }

  // =====================================================================
  section('6) "hacer la compra" → tarea');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('hacer la compra');
    check('6. type: task', r && r.type === 'task');
  }

  // =====================================================================
  section('7) "terminar el trabajo" → tarea');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('terminar el trabajo');
    check('7. type: task', r && r.type === 'task');
  }

  // =====================================================================
  section('8) Título preservado (sin inventar ni resumir)');
  // =====================================================================
  {
    check('8a. "parcial de biología" -> title "Parcial de biología"', sb.detectSmartFormIntent('parcial de biología').fields.title === 'Parcial de biología');
    check('8b. "examen de matemáticas" -> title "Examen de matemáticas"', sb.detectSmartFormIntent('examen de matemáticas').fields.title === 'Examen de matemáticas');
    check('8c. "cita con el médico" -> title "Cita con el médico" (no se acorta a "Médico")', sb.detectSmartFormIntent('cita con el médico').fields.title === 'Cita con el médico');
    check('8d. "reunión con Juan" -> title "Reunión con Juan"', sb.detectSmartFormIntent('reunión con Juan').fields.title === 'Reunión con Juan');
    check('8e. "estudiar biología" -> title "Estudiar biología"', sb.detectSmartFormIntent('estudiar biología').fields.title === 'Estudiar biología');
    check('8f. "hacer la compra" -> title "Hacer la compra"', sb.detectSmartFormIntent('hacer la compra').fields.title === 'Hacer la compra');
    check('8g. "terminar el trabajo" -> title "Terminar el trabajo"', sb.detectSmartFormIntent('terminar el trabajo').fields.title === 'Terminar el trabajo');
  }

  // =====================================================================
  section('9) Fecha explícita detectada (reutilizando AI-1.2, sin reimplementarla)');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('parcial de biología el jueves', { todayStr: TODAY });
    check('9a. no es null', r !== null);
    check('9b. la fecha detectada coincide EXACTAMENTE con resolveDateExpression (misma función, no una copia)', r.fields.date === sb.resolveDateExpression('parcial de biología el jueves', TODAY));
    check('9c. el título queda limpio, sin el fragmento de fecha ("el jueves") dentro', r.fields.title === 'Parcial de biología');
    check('9d. con fecha resuelta, "date" ya no aparece en missingFields', !r.missingFields.includes('date'));
  }

  // =====================================================================
  section('10) Hora explícita detectada (reutilizando AI-1.2, sin reimplementarla)');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('estudiar biología a las 17');
    check('10a. no es null', r !== null);
    check('10b. la hora detectada coincide EXACTAMENTE con resolveTimeExpression (misma función, no una copia)', r.fields.time === sb.resolveTimeExpression('estudiar biología a las 17'));
    check('10c. el título queda limpio, sin el fragmento de hora ("a las 17") dentro', r.fields.title === 'Estudiar biología');
  }

  // =====================================================================
  section('11) Fecha ausente → permanece ausente (nunca se inventa "hoy")');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('examen de matemáticas');
    check('11a. "date" no aparece en fields', !('date' in r.fields));
    check('11b. "date" sí aparece en missingFields (evento: campo obligatorio ausente)', r.missingFields.includes('date'));
    // Aunque se pase contexto con todayStr, sin ninguna referencia
    // temporal en el mensaje tampoco se inventa una fecha.
    const r2 = sb.detectSmartFormIntent('examen de matemáticas', { todayStr: TODAY });
    check('11c. con todayStr en el contexto pero SIN referencia temporal en el mensaje, tampoco se inventa fecha', !('date' in r2.fields));
  }

  // =====================================================================
  section('12) Hora ausente → permanece ausente');
  // =====================================================================
  {
    const r = sb.detectSmartFormIntent('estudiar biología');
    check('12. "time" no aparece en fields cuando el mensaje no da ninguna hora', !('time' in r.fields));
  }

  // =====================================================================
  section('13-17) No inventar categoría/prioridad/duración/ubicación/notas');
  // =====================================================================
  {
    const rEvent = sb.detectSmartFormIntent('cita con el médico el jueves', { todayStr: TODAY });
    const rTask = sb.detectSmartFormIntent('estudiar biología a las 17');
    for (const [label, r] of [['evento', rEvent], ['tarea', rTask]]) {
      check(`13. (${label}) no inventa categoría (categoryId ausente)`, !('categoryId' in r.fields));
      check(`14. (${label}) no inventa prioridad (priority ausente)`, !('priority' in r.fields));
      check(`15. (${label}) no inventa duración (estimatedMinutes ausente)`, !('estimatedMinutes' in r.fields));
      check(`16. (${label}) no inventa ubicación (location ausente)`, !('location' in r.fields));
      check(`17. (${label}) no inventa notas (notes ausente)`, !('notes' in r.fields));
    }
  }

  // =====================================================================
  section('18) Mensaje de comentario → null');
  // =====================================================================
  {
    for (const msg of ['Hoy estoy cansado', 'Qué día tan largo', 'Vale, entendido', 'Gracias', 'Estoy estudiando mucho', 'Mañana quizá descanse']) {
      check(`18. "${msg}" -> null`, sb.detectSmartFormIntent(msg) === null);
    }
  }

  // =====================================================================
  section('19) Mensaje ambiguo → null (sin clasificación arbitraria)');
  // =====================================================================
  {
    check('19a. "Quizá cambie el examen" (incertidumbre explícita, pese a contener "examen") -> null', sb.detectSmartFormIntent('Quizá cambie el examen') === null);
    // Mensaje deliberadamente construido con señal de evento Y de tarea a
    // la vez (sustantivo de cita + verbo de tarea): no se puede decidir
    // razonablemente entre los dos -> null, nunca una elección arbitraria.
    check('19b. mensaje con señal de evento Y de tarea a la vez -> null (no elige arbitrariamente)', sb.detectSmartFormIntent('preparar la reunión con el médico') === null);
    // No confundir con algo que ya existe: mover/cancelar/repriorizar NO
    // es una intención de CREAR (eso lo resuelve AI-1.5, no un formulario).
    check('19c. "Mueve el examen de biología al viernes" -> null (es modificar algo existente, no crear)', sb.detectSmartFormIntent('Mueve el examen de biología al viernes') === null);
    check('19d. "Cancela el examen de biología" -> null (es cancelar algo existente, no crear)', sb.detectSmartFormIntent('Cancela el examen de biología') === null);
    check('19e. "Cambia la prioridad del trabajo a alta" -> null (es repriorizar algo existente, no crear)', sb.detectSmartFormIntent('Cambia la prioridad del trabajo a alta') === null);
  }

  // =====================================================================
  section('20-23) Pureza: no modifica state, no toca DOM, no crea tareas/eventos');
  // =====================================================================
  {
    // El propio sandbox no define `state`, `document`, `addTask` ni
    // `addEvent`: si detectSmartFormIntent los tocara, esta llamada
    // lanzaría un ReferenceError en vez de devolver un resultado normal.
    let threw = false;
    let result = null;
    try {
      result = sb.detectSmartFormIntent('parcial de biología el jueves a las 17', { todayStr: TODAY });
    } catch (e) {
      threw = true;
    }
    check('20. no modifica `state` (no está definido en el sandbox y no lanza al no encontrarlo)', threw === false);
    check('21. no toca el DOM (`document`/`window.document` no están definidos en el sandbox y no lanza)', threw === false);
    check('22. no crea tareas: no hay ningún `addTask` en el sandbox y aun así no lanza (nunca se invoca)', threw === false && result !== null);
    check('23. no crea eventos: no hay ningún `addEvent` en el sandbox y aun así no lanza (nunca se invoca)', threw === false && result !== null);
    // Llamando la función varias veces con el mismo mensaje se obtiene
    // siempre el mismo resultado (función pura, sin efectos colaterales
    // que vayan acumulando estado entre llamadas).
    const again = sb.detectSmartFormIntent('parcial de biología el jueves a las 17', { todayStr: TODAY });
    check('20b. es determinista: dos llamadas idénticas devuelven el mismo resultado', JSON.stringify(result) === JSON.stringify(again));
  }

  // =====================================================================
  section('24) No cambia ACTION_SCHEMA');
  // =====================================================================
  {
    check('24. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op" y los mismos nombres de campo',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      ['"title"', '"dueDate"', '"dueTime"', '"date"', '"startTime"', '"endTime"', '"allDay"', '"targetId"', '"targetKind"', '"newDate"', '"newTime"', '"newPriority"'].every(f => aiActionsSrc.includes(f)));
  }

  // =====================================================================
  section('25) No cambia global.AIActions (detectSmartFormIntent NO se exporta, igual criterio que AI-1.2/1.3/1.4/1.5)');
  // =====================================================================
  {
    check('25. la línea de export sigue siendo EXACTAMENTE la misma de siempre', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('25b. detectSmartFormIntent no aparece dentro de esa línea de export', !/global\.AIActions = \{[^}]*detectSmartFormIntent/.test(aiActionsSrc));
  }

  // =====================================================================
  section('26) Reutiliza los helpers temporales existentes (no duplica el parser de fechas/horas)');
  // =====================================================================
  {
    check('26a. resolveDateExpression sigue con una única definición en todo el archivo (AI-2.1 no la duplica)', (aiActionsSrc.match(/function resolveDateExpression\(/g) || []).length === 1);
    check('26b. resolveTimeExpression sigue con una única definición en todo el archivo (AI-2.1 no la duplica)', (aiActionsSrc.match(/function resolveTimeExpression\(/g) || []).length === 1);
    check('26c. IMPLICIT_EVENT_NOUNS (AI-1.3) sigue con una única definición (AI-2.1 la reutiliza, no la copia)', (aiActionsSrc.match(/const IMPLICIT_EVENT_NOUNS = /g) || []).length === 1);
    check('26d. IMPLICIT_TASK_VERBS (AI-1.4) sigue con una única definición (AI-2.1 la reutiliza, no la copia)', (aiActionsSrc.match(/const IMPLICIT_TASK_VERBS = /g) || []).length === 1);
    check('26e. el propio bloque AI-2.1 llama a resolveDateExpression/resolveTimeExpression (evidencia textual de que las reutiliza)', /resolveDateExpression\(message, todayStr\)/.test(smartFormSrc) && /resolveTimeExpression\(message\)/.test(smartFormSrc));
  }

  // =====================================================================
  section('Casos adicionales: allDay/festivo, sustantivos de cita variados, verbos de tarea variados, contexto sin todayStr');
  // =====================================================================
  {
    check('add1. "El 24 es festivo" (frase completa, AI-1.3) también produce un formulario de evento', (() => { const r = sb.detectSmartFormIntent('El 24 es festivo'); return r && r.type === 'event'; })());
    check('add2. "dentista" suelto -> evento', sb.detectSmartFormIntent('dentista mañana').type === 'event');
    check('add3. "clase" suelto -> evento', sb.detectSmartFormIntent('clase de piano').type === 'event');
    check('add4. "entreno" suelto -> evento', sb.detectSmartFormIntent('entreno de fútbol').type === 'event');
    check('add5. "revisar" suelto -> tarea', sb.detectSmartFormIntent('revisar el informe').type === 'task');
    check('add6. "llamar" suelto -> tarea', sb.detectSmartFormIntent('llamar a Ana').type === 'task');
    check('add7. "preparar" suelto -> tarea', sb.detectSmartFormIntent('preparar la presentación').type === 'task');
    check('add8. "entregar" suelto -> tarea', sb.detectSmartFormIntent('entregar el trabajo').type === 'task');
    check('add9. sin contexto (segundo argumento omitido) no lanza y no inventa fecha', (() => { const r = sb.detectSmartFormIntent('parcial de biología el jueves'); return r !== null && !('date' in r.fields); })());
    check('add10. mensaje vacío -> null', sb.detectSmartFormIntent('') === null);
    check('add11. mensaje solo espacios -> null', sb.detectSmartFormIntent('   ') === null);
    check('add12. mensaje no-string (null) -> null, sin lanzar', sb.detectSmartFormIntent(null) === null);
    check('add13. sourceText conserva el mensaje original tal cual', sb.detectSmartFormIntent('parcial de biología').sourceText === 'parcial de biología');
    check('add14. "estudiar biología" con estimatedMinutes NUNCA presente (AI-2.1 no estima duración, a diferencia de AI-1.1)', !('estimatedMinutes' in sb.detectSmartFormIntent('estudiar biología').fields));
  }

  // =====================================================================
  section('27) Regresión AI-1.1 → AI-1.6 (subproceso real)');
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
    check('27a. js/test-ai-1-1-intent-detection.js sigue pasando', runSuite('js/test-ai-1-1-intent-detection.js'));
    check('27b. js/test-ai-1-2-datetime-resolution.js sigue pasando', runSuite('js/test-ai-1-2-datetime-resolution.js'));
    check('27c. js/test-ai-1-3-implicit-events.js sigue pasando', runSuite('js/test-ai-1-3-implicit-events.js'));
    check('27d. js/test-ai-1-4-implicit-tasks.js sigue pasando', runSuite('js/test-ai-1-4-implicit-tasks.js'));
    check('27e. js/test-ai-1-5-natural-modifications.js sigue pasando', runSuite('js/test-ai-1-5-natural-modifications.js'));
    check('27f. js/test-ai-1-regression.js sigue pasando', runSuite('js/test-ai-1-regression.js'));
  }

  // =====================================================================
  section('28) node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('28. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('28. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
