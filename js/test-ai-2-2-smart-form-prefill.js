/**
 * ORGANIZATOR — Tests de AI-2.2 (construir el prefill normalizado)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que el resto de
 * la familia AI-2.x: extrae literalmente por CONTENIDO el bloque AI-2.2
 * (buildSmartFormPrefill y sus validadores privados) junto con el
 * bloque AI-2.1 del que depende (detectSmartFormIntent, para poder
 * encadenar AI-2.1 -> AI-2.2 en algún test), y lo ejecuta aislado en un
 * sandbox `vm`, sin mocks: es una función pura, no lee `state`, no toca
 * el DOM, no llama a callAI.
 *
 * buildSmartFormPrefill() NO forma parte de `global.AIActions` dentro
 * de la línea literal del export principal (mismo criterio que
 * detectSmartFormIntent y el resto de helpers de AI-1.2/1.3/1.4/1.5): se
 * expone como propiedad ADICIONAL en una sentencia aparte — ver test 0.
 *
 * También comprueba la integración con AI-2.3: que
 * openSmartFormFromChat() (organizator.html) ya consume
 * AIActions.buildSmartFormPrefill() en vez de leer intent.fields
 * directamente, y que el flujo AI-2.3 completo sigue funcionando tras
 * la integración (ejecutando su propia suite como subproceso).
 *
 * Uso:  node js/test-ai-2-2-smart-form-prefill.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AI_ACTIONS_PATH = path.join(ROOT, 'js', 'ai-actions.js');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// ai-actions.js/organizator.html se guardan con CRLF; se normaliza a LF
// solo para esta lectura en memoria (no se toca ningún archivo en disco)
// porque los marcadores de extractBetween de abajo usan '\n'.
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Bloque combinado AI-2.1 (detectSmartFormIntent) + AI-2.2
// (buildSmartFormPrefill), literal de ai-actions.js — viven uno a
// continuación del otro en el mismo archivo.
// ---------------------------------------------------------------------
const smartFormSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-2.1',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-2.1+AI-2.2 (detección + normalización del prefill)'
);
// AI-1.2/1.3/1.4/1.5, de los que depende detectSmartFormIntent (AI-2.1)
// por dentro (isHolidayMessage/isAppointmentMessage/isTaskMessage/
// isMoveMessage/isCancelMessage/isPriorityChangeMessage/
// resolveDateExpression/resolveTimeExpression) — solo hacen falta para
// encadenar detectSmartFormIntent -> buildSmartFormPrefill de verdad
// (sección "Encadenado real" más abajo); el resto de esta suite prueba
// buildSmartFormPrefill() aislado, sin necesitarlas.
const datetimeSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.2', '\n\n  /* ==================================================================\n     AI-1.3', 'bloque AI-1.2');
const implicitEventSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.3', '\n\n  /* ==================================================================\n     AI-1.4', 'bloque AI-1.3');
const implicitTaskSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.4', '\n\n  /* ==================================================================\n     AI-1.5', 'bloque AI-1.4');
const modificationSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.5', '\n\n  /* ==================================================================\n     AI-2.1', 'bloque AI-1.5');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con el bloque puro AI-2.1+AI-2.2 (sin `state`,
 * sin DOM, sin callAI). Suficiente para probar buildSmartFormPrefill()
 * aislado (no necesita AI-1.2/1.3/1.4/1.5). */
function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    smartFormSrc + `
    this.detectSmartFormIntent = detectSmartFormIntent;
    this.buildSmartFormPrefill = buildSmartFormPrefill;
    `,
    sandbox, { filename: 'ai-actions.js (AI-2.1+AI-2.2, bloque puro)' }
  );
  return sandbox;
}

/** Sandbox con la cadena COMPLETA AI-1.2+1.3+1.4+1.5+AI-2.1+AI-2.2, para
 * la sección "Encadenado real" (llama a detectSmartFormIntent de verdad,
 * que sí necesita esas dependencias por dentro). */
function makeFullChainSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + '\n' + implicitTaskSrc + '\n' + modificationSrc + '\n' + smartFormSrc + `
    this.detectSmartFormIntent = detectSmartFormIntent;
    this.buildSmartFormPrefill = buildSmartFormPrefill;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+1.3+1.4+1.5+AI-2.1+AI-2.2, cadena completa)' }
  );
  return sandbox;
}

const sb = makeSandbox();

(async () => {

  // =====================================================================
  section('0) Contrato público: buildSmartFormPrefill se expone como propiedad ADICIONAL (igual criterio que detectSmartFormIntent)');
  // =====================================================================
  {
    check('0a. la línea de export principal sigue siendo EXACTAMENTE la misma de siempre', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0b. buildSmartFormPrefill NO aparece dentro de esa línea de export', !/global\.AIActions = \{[^}]*buildSmartFormPrefill/.test(aiActionsSrc));
    check('0c. buildSmartFormPrefill se expone como propiedad adicional sobre global.AIActions (sentencia aparte)', /global\.AIActions\.buildSmartFormPrefill = buildSmartFormPrefill;/.test(aiActionsSrc));
    check('0d. detectSmartFormIntent (AI-2.1) sigue expuesto igual que antes (no se pisó al añadir AI-2.2)', /global\.AIActions\.detectSmartFormIntent = detectSmartFormIntent;/.test(aiActionsSrc));
    check('0e. ACTION_SCHEMA no cambió (mismos 5 tipos de "op")', /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc));
    check('0f. buildSmartFormPrefill tiene una única definición en todo el archivo', (aiActionsSrc.match(/function buildSmartFormPrefill\(/g) || []).length === 1);
  }

  // =====================================================================
  section('1) Evento con título → devuelve título');
  // =====================================================================
  {
    const r = sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'Parcial de biología' } });
    check('1. type: event', r.type === 'event');
    check('1. title conservado', r.title === 'Parcial de biología');
  }

  // =====================================================================
  section('2) Evento con título + fecha → conserva ambos');
  // =====================================================================
  {
    const r = sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18' } });
    check('2. title conservado', r.title === 'Parcial de biología');
    check('2. date conservada', r.date === '2026-09-18');
    check('2. sin "time" (el mensaje original no lo traía)', !('time' in r));
  }

  // =====================================================================
  section('3) Evento con título + fecha + hora → conserva los tres');
  // =====================================================================
  {
    const r = sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
    check('3. title conservado', r.title === 'Parcial de biología');
    check('3. date conservada', r.date === '2026-09-18');
    check('3. time conservada', r.time === '17:00');
  }

  // =====================================================================
  section('4) Evento sin fecha → no inventa fecha');
  // =====================================================================
  {
    const r = sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'Examen de matemáticas' } });
    check('4a. "date" no aparece (nunca "hoy" inventado)', !('date' in r));
    check('4b. "time" tampoco aparece', !('time' in r));
    check('4c. no inventa endDate/endTime/allDay/categoryId/location/notes/recurrence/reminder', ['endDate', 'endTime', 'allDay', 'categoryId', 'location', 'notes', 'recurrence', 'reminder'].every(k => !(k in r)));
  }

  // =====================================================================
  section('5) Tarea con título → devuelve título');
  // =====================================================================
  {
    const r = sb.buildSmartFormPrefill({ type: 'task', fields: { title: 'Estudiar biología' } });
    check('5. type: task', r.type === 'task');
    check('5. title conservado', r.title === 'Estudiar biología');
  }

  // =====================================================================
  section('6) Tarea con fecha/hora conocidas → las conserva');
  // =====================================================================
  {
    const r = sb.buildSmartFormPrefill({ type: 'task', fields: { title: 'Estudiar biología', date: '2026-09-18', time: '17:00' } });
    check('6. date conservada', r.date === '2026-09-18');
    check('6. time conservada', r.time === '17:00');
  }

  // =====================================================================
  section('7) Campos ausentes no aparecen artificialmente (ni "undefined" ni "null" como valor, ni claves fantasma)');
  // =====================================================================
  {
    const r = sb.buildSmartFormPrefill({ type: 'task', fields: { title: 'Estudiar biología' } });
    check('7a. "date" no aparece', !('date' in r));
    check('7b. "time" no aparece', !('time' in r));
    check('7c. "priority" no aparece (AI-2.1 no la da, y no se inventa)', !('priority' in r));
    check('7d. "estimatedMinutes" no aparece', !('estimatedMinutes' in r));
    check('7e. "categoryId" no aparece', !('categoryId' in r));
    check('7f. ningún valor del objeto es undefined/null (JSON.stringify no pierde ninguna clave "fantasma")', Object.values(r).every(v => v !== undefined && v !== null));
  }

  // =====================================================================
  section('8) intent === null → null');
  // =====================================================================
  {
    check('8a. null -> null', sb.buildSmartFormPrefill(null) === null);
    check('8b. undefined -> null', sb.buildSmartFormPrefill(undefined) === null);
    check('8c. string -> null (no es un objeto de intención)', sb.buildSmartFormPrefill('parcial de biología') === null);
  }

  // =====================================================================
  section('9) Tipo desconocido → null');
  // =====================================================================
  {
    check('9a. type: "foo" -> null', sb.buildSmartFormPrefill({ type: 'foo', fields: { title: 'x' } }) === null);
    check('9b. sin "type" -> null', sb.buildSmartFormPrefill({ fields: { title: 'x' } }) === null);
    check('9c. type: "move_item" (un op de AI-1, no un tipo de formulario) -> null', sb.buildSmartFormPrefill({ type: 'move_item', fields: { title: 'x' } }) === null);
  }

  // =====================================================================
  section('10) No modifica `intent` (ni el objeto ni su `fields` anidado)');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18' }, missingFields: [], sourceText: 'x' };
    const snapshot = JSON.stringify(intent);
    const originalFieldsRef = intent.fields;
    const result = sb.buildSmartFormPrefill(intent);
    check('10a. `intent` no cambió (mismo snapshot JSON antes/después)', JSON.stringify(intent) === snapshot);
    check('10b. `intent.fields` sigue siendo el MISMO objeto por referencia (no se reemplazó ni se mutó)', intent.fields === originalFieldsRef);
    check('10c. el resultado es un objeto NUEVO, no el mismo `intent.fields` por referencia', result !== intent.fields);
  }

  // =====================================================================
  section('11) No modifica `state` / 12) No toca DOM (pureza)');
  // =====================================================================
  {
    // El sandbox no define `state`, `document` ni `window`: si
    // buildSmartFormPrefill los tocara, lanzaría un ReferenceError en vez
    // de devolver un resultado normal.
    let threw = false;
    let result = null;
    try {
      result = sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'x', date: '2026-09-18', time: '17:00' } });
    } catch (e) { threw = true; }
    check('11. no modifica `state` (no está definido en el sandbox y no lanza al no encontrarlo)', threw === false);
    check('12. no toca el DOM (`document`/`window` no están definidos en el sandbox y no lanza)', threw === false && result !== null);
  }

  // =====================================================================
  section('13) No resuelve de nuevo fechas / 14) No resuelve de nuevo horas (no llama a ningún parser)');
  // =====================================================================
  {
    // resolveDateExpression/resolveTimeExpression (AI-1.2) ni siquiera
    // están cargadas en este sandbox (solo se extrajo el bloque AI-2.1+
    // AI-2.2): si buildSmartFormPrefill las llamara, lanzaría un
    // ReferenceError. Como no lanza, queda demostrado que no las invoca.
    let threw = false;
    try {
      sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'x', date: '2026-09-18', time: '17:00' } });
    } catch (e) { threw = true; }
    check('13/14. no llama a resolveDateExpression/resolveTimeExpression (ni siquiera están cargadas y no lanza)', threw === false);
    // El propio código fuente del bloque AI-2.2 tampoco las menciona.
    const ai22Only = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-2.2', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-2.2 en solitario');
    check('13b/14b. el código fuente de AI-2.2 no llama a resolveDateExpression ni resolveTimeExpression', !/resolveDateExpression\(/.test(ai22Only) && !/resolveTimeExpression\(/.test(ai22Only));
    check('13c. AI-2.2 valida el FORMATO de fecha ya resuelta (regex YYYY-MM-DD) en vez de recalcularla — fechas mal formadas se descartan, no se "arreglan"', sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'x', date: 'no-es-una-fecha' } }).date === undefined);
    check('14c. igual para horas: formato HH:MM inválido se descarta, no se "arregla"', sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'x', time: '25:99' } }).time === undefined);
  }

  // =====================================================================
  section('Encadenado real AI-2.1 -> AI-2.2 (detectSmartFormIntent + buildSmartFormPrefill juntos)');
  // =====================================================================
  {
    const chain = makeFullChainSandbox();
    const intent = chain.detectSmartFormIntent('parcial de biología el jueves', { todayStr: '2026-09-17' });
    const prefill = chain.buildSmartFormPrefill(intent);
    check('E1. AI-2.1 detecta la intención', intent !== null && intent.type === 'event');
    check('E2. AI-2.2 normaliza exactamente lo que AI-2.1 detectó (mismo título/fecha)', prefill.title === intent.fields.title && prefill.date === intent.fields.date);
    const intentNoAction = chain.detectSmartFormIntent('Vale, entendido', {});
    check('E3. AI-2.1 devuelve null para un comentario, y AI-2.2 lo respeta devolviendo null también', intentNoAction === null && chain.buildSmartFormPrefill(intentNoAction) === null);
  }

  // =====================================================================
  section('Contexto opcional: campos de tarea complementados SOLO si son válidos, nunca inventados');
  // =====================================================================
  {
    const r1 = sb.buildSmartFormPrefill({ type: 'task', fields: { title: 'Estudiar' } }, { priority: 'alta', estimatedMinutes: 45, categoryId: 'cat-estudio' });
    check('ctx1. prioridad válida del contexto se incluye', r1.priority === 'alta');
    check('ctx2. estimatedMinutes válido del contexto se incluye', r1.estimatedMinutes === 45);
    check('ctx3. categoryId válido del contexto se incluye', r1.categoryId === 'cat-estudio');

    const r2 = sb.buildSmartFormPrefill({ type: 'task', fields: { title: 'Estudiar' } }, { priority: 'urgentísimo', estimatedMinutes: -10, categoryId: '' });
    check('ctx4. prioridad inválida del contexto se descarta (no es alta/media/baja)', !('priority' in r2));
    check('ctx5. estimatedMinutes inválido (negativo) se descarta', !('estimatedMinutes' in r2));
    check('ctx6. categoryId vacío se descarta', !('categoryId' in r2));

    // Un evento NUNCA lleva priority/estimatedMinutes/categoryId, ni
    // siquiera si el contexto los trajera (fuera del esquema de evento).
    const r3 = sb.buildSmartFormPrefill({ type: 'event', fields: { title: 'Examen' } }, { priority: 'alta', estimatedMinutes: 30, categoryId: 'catX' });
    check('ctx7. un evento nunca lleva "priority" aunque el contexto lo traiga', !('priority' in r3));
    check('ctx8. un evento nunca lleva "estimatedMinutes" aunque el contexto lo traiga', !('estimatedMinutes' in r3));
    check('ctx9. un evento nunca lleva "categoryId" aunque el contexto lo traiga', !('categoryId' in r3));

    // intent.fields manda sobre el contexto si ambos traen el mismo campo.
    const r4 = sb.buildSmartFormPrefill({ type: 'task', fields: { title: 'Estudiar', date: '2026-09-18' } }, { date: '2099-01-01' });
    check('ctx10. si intent.fields ya trae un campo, el contexto NO lo sobreescribe', r4.date === '2026-09-18');
  }

  // =====================================================================
  section('15/16) AI-2.3 consume el resultado de buildSmartFormPrefill() y el flujo sigue funcionando (regresión, subproceso real)');
  // =====================================================================
  {
    check('15. openSmartFormFromChat() (organizator.html) llama a AIActions.buildSmartFormPrefill(intent)', /AIActions\.buildSmartFormPrefill\(intent\)/.test(html));
    check('15b. openSmartFormFromChat() ya NO lee intent.fields.title/date/time directamente', !/intent\.fields\.title/.test(html) && !/intent\.fields\.date/.test(html) && !/intent\.fields\.time/.test(html));
    function runSuite(relPath) {
      try {
        execFileSync(process.execPath, [path.join(ROOT, relPath)], { stdio: 'pipe' });
        return true;
      } catch (e) {
        console.log(String((e.stdout || '') + (e.stderr || e.message)));
        return false;
      }
    }
    check('16. js/test-ai-2-3-smart-form-open.js (flujo AI-2.3 completo, ya adaptado a AI-2.2) sigue pasando', runSuite('js/test-ai-2-3-smart-form-open.js'));
    check('16b. js/test-ai-2-1-smart-form-intent.js sigue pasando', runSuite('js/test-ai-2-1-smart-form-intent.js'));
    check('16c. js/test-ai-1-regression.js sigue pasando', runSuite('js/test-ai-1-regression.js'));
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
