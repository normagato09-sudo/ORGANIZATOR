/**
 * ORGANIZATOR — Tests de AI-2.6 (aclaraciones inteligentes cuando falten
 * datos, antes de abrir el Smart Form)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que la familia
 * AI-2.x: extrae literalmente por CONTENIDO el bloque AI-2.6
 * (getSmartFormClarification y su único helper privado,
 * isVagueReferenceMessage) junto con los bloques de los que depende
 * (AI-1.2 resolución de fechas/horas, AI-1.3 eventos implícitos, AI-1.4
 * tareas implícitas, AI-1.5 mover/cancelar/repriorizar, y AI-2.1+AI-2.2
 * detección + prefill), y los ejecuta aislados en un sandbox `vm`, sin
 * mocks: son funciones puras, no leen `state`, no tocan el DOM, no
 * llaman a callAI, no llaman a Scheduler/reminders/recurrence/propuestas
 * IA, no crean tareas ni eventos.
 *
 * Dos niveles de prueba:
 *  a) Nivel FUNCIÓN PURA: getSmartFormClarification(intent, context)
 *     aislada, con `intent` construido a mano (igual que ya devolvería
 *     AIActions.detectSmartFormIntent) o con `intent` real producido por
 *     AIActions.detectSmartFormIntent para los casos de integración.
 *  b) Nivel INTEGRACIÓN (chat → aclaración / chat → formulario): extrae
 *     runIAActionChat() de organizator.html con `AIActions`/
 *     `openTaskModal`/`openEventModal`/`iaThreadAddPending`/
 *     `iaThreadResolve` MOCKEADOS (espías), para comprobar el flujo
 *     completo mensaje -> AI-2.1 -> AI-2.2 -> AI-2.6 -> (aclaración) o
 *     (AI-2.3 abre el formulario), sin volver a probar el contenido de
 *     los modales (ya cubierto por test-ai-2-3-smart-form-open.js).
 *
 * Uso:  node js/test-ai-2-6-smart-form-clarification.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
const AI_ACTIONS_PATH = path.join(ROOT, 'js', 'ai-actions.js');
// organizator.html/ai-actions.js se guardan con CRLF; se normaliza a LF
// solo para esta lectura en memoria (no se toca ningún archivo en disco)
// porque los marcadores de extractBetween de abajo usan '\n'.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Bloques AI-1.2/1.3/1.4/1.5 + AI-2.1+AI-2.2 + AI-2.6, literales de
// js/ai-actions.js (mismos marcadores que ya usan test-ai-2-1 y test-ai-2-3).
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
  '\n\n  /* ==================================================================\n     AI-2.6',
  'bloque AI-2.1+AI-2.2 (detección + normalización del prefill)'
);
const clarificationSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-2.6',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-2.6 (aclaraciones inteligentes cuando falten datos)'
);

// ---------------------------------------------------------------------
// Fragmentos reales de organizator.html: la conexión chat -> AI-2.1 ->
// AI-2.2 -> AI-2.6 -> (aclaración | AI-2.3), para el nivel INTEGRACIÓN.
// ---------------------------------------------------------------------
const openSmartFormFromChatSrc = extractBetween(html, 'function openSmartFormFromChat(intent){', '\n\n/* ---------- AI-2.6', 'función openSmartFormFromChat() (AI-2.3)');
const runIAActionChatSrc = extractBetween(html, '/* ---------- AI-2.6: aclaraciones pendientes del chat', '\n\n/* ---------- Wiring inicial del bloque IA', 'bloque AI-2.6 + función runIAActionChat() (con la integración AI-2.6)');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con los bloques puros AI-1.2+1.3+1.4+1.5+AI-2.1
 * +AI-2.2+AI-2.6 (sin `state`, sin DOM, sin callAI, sin Scheduler). */
function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  // Espía de `state`/DOM: si getSmartFormClarification (o cualquier
  // función de la que depende) intentara tocar cualquiera de estos
  // globals no definidos, lanzaría un ReferenceError — no se define
  // ningún stub a propósito, así una violación de "no debe tocar
  // state/DOM/addTask/addEvent" se detecta como un fallo de ejecución,
  // no en silencio.
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + '\n' + implicitTaskSrc + '\n' + modificationSrc + '\n' + smartFormSrc + '\n' + clarificationSrc + `
    this.detectSmartFormIntent = detectSmartFormIntent;
    this.getSmartFormClarification = getSmartFormClarification;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+1.3+1.4+1.5+AI-2.1+AI-2.2+AI-2.6, bloques puros)' }
  );
  return sandbox;
}

const sb = makeSandbox();
const TODAY = '2026-09-17'; // jueves

(async () => {

  // =====================================================================
  section('1) Evento sin fecha → aclaración field: "date"');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'Parcial de biología' }, missingFields: ['date'], sourceText: 'tengo un parcial de biología' };
    const r = sb.getSmartFormClarification(intent, {});
    check('1a. no es null', r !== null);
    check('1b. field: "date"', r && r.field === 'date');
    check('1c. question es una pregunta concreta sobre el día', r && /día/.test(r.question) && r.question.length < 60);
  }
  // Caso real de punta a punta: AI-2.1 real produce el intent para
  // "Tengo un parcial de biología" (sin fecha) y AI-2.6 sobre ESE intent
  // real pide la fecha.
  {
    const intent = sb.detectSmartFormIntent('Tengo un parcial de biología', { todayStr: TODAY });
    check('1d. (AI-2.1 real) "Tengo un parcial de biología" -> intent no null, tipo evento', intent && intent.type === 'event');
    const r = sb.getSmartFormClarification(intent, { message: 'Tengo un parcial de biología', todayStr: TODAY });
    check('1e. (AI-2.1 real -> AI-2.6) pide la fecha', r && r.field === 'date');
  }

  // =====================================================================
  section('2) Evento con fecha → null (no preguntar, ya la tiene)');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'Reunión con Juan', date: '2026-09-21' }, missingFields: [], sourceText: 'el lunes tengo una reunión con Juan' };
    const r = sb.getSmartFormClarification(intent, {});
    check('2a. null (la fecha ya está resuelta)', r === null);
  }
  {
    const intent = sb.detectSmartFormIntent('El lunes tengo una reunión con Juan', { todayStr: TODAY });
    check('2b. (AI-2.1 real) intent trae ya la fecha', intent && intent.type === 'event' && !!intent.fields.date);
    const r = sb.getSmartFormClarification(intent, { message: 'El lunes tengo una reunión con Juan', todayStr: TODAY });
    check('2c. (AI-2.1 real -> AI-2.6) null: no se pregunta por una fecha que ya se tiene', r === null);
  }

  // =====================================================================
  section('3) Tarea sin fecha → null (la fecha nunca es obligatoria para una tarea)');
  // =====================================================================
  {
    const intent = { type: 'task', fields: { title: 'Estudiar biología' }, missingFields: [], sourceText: 'tengo que estudiar biología' };
    const r = sb.getSmartFormClarification(intent, {});
    check('3a. null', r === null);
  }
  {
    const intent = sb.detectSmartFormIntent('Tengo que estudiar biología', { todayStr: TODAY });
    check('3b. (AI-2.1 real) intent tipo tarea, sin fecha', intent && intent.type === 'task' && !('date' in intent.fields));
    const r = sb.getSmartFormClarification(intent, { message: 'Tengo que estudiar biología', todayStr: TODAY });
    check('3c. (AI-2.1 real -> AI-2.6) null: se puede abrir el Smart Form sin fecha', r === null);
  }

  // =====================================================================
  section('4) Tarea con fecha → null (tampoco hace falta aclaración)');
  // =====================================================================
  {
    const intent = sb.detectSmartFormIntent('Mañana tengo que estudiar biología', { todayStr: TODAY });
    check('4a. (AI-2.1 real) intent tipo tarea, con fecha', intent && intent.type === 'task' && !!intent.fields.date);
    const r = sb.getSmartFormClarification(intent, { message: 'Mañana tengo que estudiar biología', todayStr: TODAY });
    check('4b. null', r === null);
  }

  // =====================================================================
  section('5) Evento sin hora → null (la hora nunca es obligatoria)');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'Reunión', date: '2026-09-24' }, missingFields: [], sourceText: 'tengo una reunión el jueves' };
    const r = sb.getSmartFormClarification(intent, {});
    check('5a. null (sin "time" en fields y aun así no se pregunta por la hora)', r === null && !('time' in intent.fields));
  }
  {
    const intent = sb.detectSmartFormIntent('Tengo una reunión el jueves', { todayStr: TODAY });
    check('5b. (AI-2.1 real) intent sin hora', intent && intent.type === 'event' && !('time' in intent.fields));
    const r = sb.getSmartFormClarification(intent, { message: 'Tengo una reunión el jueves', todayStr: TODAY });
    check('5c. (AI-2.1 real -> AI-2.6) null: nunca se pregunta "¿A qué hora?"', r === null);
  }

  // =====================================================================
  section('6) Mensaje ambiguo → no abre Smart Form (AI-2.1 = null) y AI-2.6 SÍ pide una aclaración útil');
  // =====================================================================
  {
    for (const msg of ['Lo de mañana', 'Eso del jueves', 'Apúntame lo de Juan']) {
      const intent = sb.detectSmartFormIntent(msg, { todayStr: TODAY });
      check(`6a. (AI-2.1) "${msg}" -> intent null (no se abre Smart Form directamente)`, intent === null);
      const r = sb.getSmartFormClarification(intent, { message: msg, todayStr: TODAY });
      check(`6b. (AI-2.6) "${msg}" -> SÍ pide aclaración (field: "target")`, r !== null && r.field === 'target');
    }
  }

  // =====================================================================
  section('7) Comentario/no acción → AI-2.6 NO genera aclaración');
  // =====================================================================
  {
    for (const msg of ['Estoy cansado hoy', 'Vale, entendido', 'Gracias', 'Qué día tan largo']) {
      const intent = sb.detectSmartFormIntent(msg, { todayStr: TODAY });
      check(`7a. (AI-2.1) "${msg}" -> intent null`, intent === null);
      const r = sb.getSmartFormClarification(intent, { message: msg, todayStr: TODAY });
      check(`7b. (AI-2.6) "${msg}" -> null (ningún dato que bloquee: no hay ninguna intención de crear)`, r === null);
    }
  }

  // =====================================================================
  section('8) Modificación → AI-2.6 no genera Smart Form ni aclaración (lo resuelve AI-1.5)');
  // =====================================================================
  {
    const msg = 'Mueve la reunión al viernes';
    const intent = sb.detectSmartFormIntent(msg, { todayStr: TODAY });
    check('8a. (AI-2.1) intent null', intent === null);
    const r = sb.getSmartFormClarification(intent, { message: msg, todayStr: TODAY });
    check('8b. (AI-2.6) null: nunca convierte una modificación en un Smart Form de creación', r === null);
  }

  // =====================================================================
  section('9) Cancelación → AI-2.6 no genera Smart Form ni aclaración');
  // =====================================================================
  {
    const msg = 'Finalmente cancela la reunión';
    const intent = sb.detectSmartFormIntent(msg, { todayStr: TODAY });
    check('9a. (AI-2.1) intent null', intent === null);
    const r = sb.getSmartFormClarification(intent, { message: msg, todayStr: TODAY });
    check('9b. (AI-2.6) null', r === null);
  }
  // Casos adicionales de AI-1.5 (cambio de prioridad) que tampoco deben
  // convertirse en un Smart Form.
  {
    const msg = 'Cambia la prioridad del trabajo a alta';
    const intent = sb.detectSmartFormIntent(msg, { todayStr: TODAY });
    const r = sb.getSmartFormClarification(intent, { message: msg, todayStr: TODAY });
    check('9c. cambio de prioridad -> null', intent === null && r === null);
  }

  // =====================================================================
  section('10) La pregunta generada es específica para el campo que falta (nunca genérica)');
  // =====================================================================
  {
    const rDate = sb.getSmartFormClarification({ type: 'event', fields: { title: 'X' }, missingFields: ['date'], sourceText: 'x' }, {});
    const rTarget = sb.getSmartFormClarification(null, { message: 'Lo de mañana', todayStr: TODAY });
    const rType = sb.getSmartFormClarification(null, { message: 'preparar la reunión con el médico', todayStr: TODAY });
    check('10a. la pregunta de "date" es distinta de la de "target"', rDate.question !== rTarget.question);
    check('10b. la pregunta de "target" es distinta de la de "type"', rTarget.question !== rType.question);
    check('10c. ninguna pregunta es el genérico "¿Puedes darme más información?"', ![rDate, rTarget, rType].some(r => /puedes darme más información/i.test(r.question)));
    check('10d. field "type" se usa cuando hay señal de evento Y de tarea a la vez (contradictorias)', rType && rType.field === 'type');
  }

  // =====================================================================
  section('11) El helper no modifica el "intent" que recibe');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'Parcial de biología' }, missingFields: ['date'], sourceText: 'x' };
    const snapshot = JSON.stringify(intent);
    sb.getSmartFormClarification(intent, {});
    check('11. intent sigue exactamente igual tras la llamada (mismo JSON)', JSON.stringify(intent) === snapshot);
  }

  // =====================================================================
  section('12) El helper devuelve un objeto NUEVO cuando hay aclaración');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'X' }, missingFields: ['date'], sourceText: 'x' };
    const r1 = sb.getSmartFormClarification(intent, {});
    const r2 = sb.getSmartFormClarification(intent, {});
    check('12a. cada llamada devuelve un objeto distinto por referencia (no reutiliza uno guardado)', r1 !== r2);
    check('12b. pero con contenido equivalente (determinista)', JSON.stringify(r1) === JSON.stringify(r2));
  }

  // =====================================================================
  section('13-16) Pureza: no modifica state, no toca DOM/persistencia, no llama a addTask/addEvent');
  // =====================================================================
  {
    // El propio sandbox no define `state`, `document`, `localStorage`,
    // `addTask` ni `addEvent`: si getSmartFormClarification (o
    // isVagueReferenceMessage) los tocara, esta llamada lanzaría un
    // ReferenceError en vez de devolver un resultado normal.
    let threw = false;
    try {
      sb.getSmartFormClarification({ type: 'event', fields: { title: 'X' }, missingFields: ['date'], sourceText: 'x' }, {});
      sb.getSmartFormClarification(null, { message: 'Lo de mañana', todayStr: TODAY });
      sb.getSmartFormClarification(null, { message: 'Mueve el examen al viernes', todayStr: TODAY });
    } catch (e) { threw = true; }
    check('13. no modifica `state` (no está definido en el sandbox y no lanza al no encontrarlo)', threw === false);
    check('14. no toca persistencia (`localStorage`/`document` no están definidos y no lanza)', threw === false);
    check('15. no llama a `addTask` (no está definido en el sandbox y no lanza)', threw === false);
    check('16. no llama a `addEvent` (no está definido en el sandbox y no lanza)', threw === false);
  }

  // =====================================================================
  section('Casos adicionales: datos opcionales nunca preguntados, mensajes vacíos/no-string');
  // =====================================================================
  {
    const intentTaskCompleto = { type: 'task', fields: { title: 'Estudiar biología', date: '2026-09-18', time: '17:00', priority: 'alta', estimatedMinutes: 60, categoryId: 'cat-1' }, missingFields: [], sourceText: 'x' };
    check('add1. tarea con TODOS los campos opcionales presentes -> null igualmente (nunca se pregunta por ellos)', sb.getSmartFormClarification(intentTaskCompleto, {}) === null);
    const intentEventoSinHora = { type: 'event', fields: { title: 'Examen', date: '2026-09-18' }, missingFields: [], sourceText: 'x' };
    check('add2. evento sin ubicación/notas/categoría -> null (esos campos nunca bloquean)', sb.getSmartFormClarification(intentEventoSinHora, {}) === null);
    check('add3. intent null sin `context.message` -> null (nunca inventa una pregunta de la nada)', sb.getSmartFormClarification(null, {}) === null);
    check('add4. intent null con message vacío -> null', sb.getSmartFormClarification(null, { message: '' }) === null);
    check('add5. intent null con message no-string -> null, sin lanzar', sb.getSmartFormClarification(null, { message: 42 }) === null);
    check('add6. context omitido por completo (segundo argumento undefined) -> null, sin lanzar', sb.getSmartFormClarification({ type: 'task', fields: { title: 'X' }, missingFields: [], sourceText: 'x' }) === null);
  }

  // =====================================================================
  section('Integración: mensaje -> AI-2.1 -> AI-2.2 -> AI-2.6 -> aclaración (no abre formulario, no persiste, no crea nada)');
  // =====================================================================
  {
    /** Sandbox de NIVEL INTEGRACIÓN: runIAActionChat real (con la
     * integración AI-2.6), AIActions/openTaskModal/openEventModal/
     * iaThread* MOCKEADOS (espías) — comprueba el ENRUTAMIENTO completo,
     * no vuelve a probar el contenido de los modales ni la detección en
     * sí (ya cubiertas por sus propias suites). */
    function makeChatSandbox({ smartFormIntentResult, clarificationResult, runIAActionResult }) {
      const sandbox = {};
      sandbox.console = console;
      const calls = { detectSmartFormIntent: 0, getSmartFormClarification: 0, buildSmartFormPrefill: 0, runIAAction: 0, openTaskModal: 0, openEventModal: 0, iaThreadResolve: 0, renderInicio: 0, renderCalendar: 0 };
      sandbox.__calls = calls;
      sandbox.AIActions = {
        detectSmartFormIntent: (msg, ctx) => { calls.detectSmartFormIntent++; sandbox.__lastIntentCtx = ctx; return smartFormIntentResult; },
        getSmartFormClarification: (intent, ctx) => { calls.getSmartFormClarification++; sandbox.__lastClarificationCtx = ctx; sandbox.__lastClarificationIntent = intent; return clarificationResult || null; },
        buildSmartFormPrefill: (intent) => { calls.buildSmartFormPrefill++; return intent ? Object.assign({ type: intent.type }, intent.fields) : null; },
        runIAAction: async () => { calls.runIAAction++; return runIAActionResult || { answer: 'ok', applied: [] }; },
      };
      sandbox.openTaskModal = (args) => { calls.openTaskModal++; sandbox.__lastTaskArgs = args; };
      sandbox.openEventModal = (args) => { calls.openEventModal++; sandbox.__lastEventArgs = args; };
      sandbox.iaThreadAddPending = () => ({ id: 'msg-1' });
      sandbox.iaThreadResolve = (el, htmlMsg) => { calls.iaThreadResolve++; sandbox.__lastResolveHtml = htmlMsg; };
      sandbox.esc = (s) => s;
      sandbox.currentView = 'inicio';
      sandbox.renderInicio = () => { calls.renderInicio++; };
      sandbox.renderCalendar = () => { calls.renderCalendar++; };
      sandbox.todayStr = () => TODAY;
      vm.createContext(sandbox);
      vm.runInContext(openSmartFormFromChatSrc + '\n' + runIAActionChatSrc + '\nthis.runIAActionChat = runIAActionChat;', sandbox, { filename: 'organizator.html (AI-2.6 chat wiring)' });
      return sandbox;
    }

    // Flujo A: AI-2.6 pide aclaración -> se detiene el turno.
    {
      const intent = { type: 'event', fields: { title: 'Parcial de biología' }, missingFields: ['date'], sourceText: 'tengo un parcial de biología' };
      const clarification = { field: 'date', question: '¿Qué día es el evento?' };
      const sb2 = makeChatSandbox({ smartFormIntentResult: intent, clarificationResult: clarification });
      await sb2.runIAActionChat('Tengo un parcial de biología');
      check('I1. AI-2.1 (detectSmartFormIntent) se consulta', sb2.__calls.detectSmartFormIntent === 1);
      check('I2. AI-2.6 (getSmartFormClarification) se consulta con el intent de AI-2.1', sb2.__calls.getSmartFormClarification === 1 && sb2.__lastClarificationIntent === intent);
      check('I3. con aclaración pendiente, NO se abre ningún formulario (ni de tarea ni de evento)', sb2.__calls.openTaskModal === 0 && sb2.__calls.openEventModal === 0);
      check('I4. con aclaración pendiente, NO se llama a AIActions.runIAAction (no se crea nada automáticamente)', sb2.__calls.runIAAction === 0);
      check('I5. la pregunta concreta se muestra en el chat', sb2.__lastResolveHtml === '¿Qué día es el evento?');
      check('I6. AI-2.2 (buildSmartFormPrefill) NUNCA se llega a consultar (el turno se detiene antes)', sb2.__calls.buildSmartFormPrefill === 0);
    }

    // Flujo B: AI-2.6 = null -> sigue el camino normal (AI-2.3 abre el formulario).
    {
      const intent = { type: 'task', fields: { title: 'Estudiar biología' }, missingFields: [], sourceText: 'estudiar biología' };
      const sb2 = makeChatSandbox({ smartFormIntentResult: intent, clarificationResult: null });
      await sb2.runIAActionChat('Tengo que estudiar biología');
      check('I7. AI-2.6 se consulta y devuelve null', sb2.__calls.getSmartFormClarification === 1);
      check('I8. con AI-2.6 = null, AI-2.3 abre el formulario correspondiente (tarea)', sb2.__calls.openTaskModal === 1 && sb2.__calls.openEventModal === 0);
      check('I9. sigue sin llamarse a AIActions.runIAAction (intención de creación válida, ver AI-2.3)', sb2.__calls.runIAAction === 0);
    }

    // Flujo C: AI-2.1 = null y AI-2.6 = null (comentario) -> sigue el camino normal de AI-1.
    {
      const sb2 = makeChatSandbox({ smartFormIntentResult: null, clarificationResult: null, runIAActionResult: { answer: 'Vale.', applied: [] } });
      await sb2.runIAActionChat('Hoy estoy cansado');
      check('I10. sin intención ni aclaración, se sigue llamando a AIActions.runIAAction (camino normal de AI-1 intacto)', sb2.__calls.runIAAction === 1);
      check('I11. no se abre ningún formulario', sb2.__calls.openTaskModal === 0 && sb2.__calls.openEventModal === 0);
    }

    // Flujo D: AI-2.1 = null pero AI-2.6 SÍ pide aclaración (mensaje ambiguo tipo "Lo de mañana").
    {
      const clarification = { field: 'target', question: '¿Qué quieres apuntar?' };
      const sb2 = makeChatSandbox({ smartFormIntentResult: null, clarificationResult: clarification });
      await sb2.runIAActionChat('Lo de mañana');
      check('I12. mensaje ambiguo: se pide la aclaración de "target"', sb2.__lastResolveHtml === '¿Qué quieres apuntar?');
      check('I13. mensaje ambiguo: no se abre ningún formulario', sb2.__calls.openTaskModal === 0 && sb2.__calls.openEventModal === 0);
      check('I14. mensaje ambiguo: no se llama a AIActions.runIAAction', sb2.__calls.runIAAction === 0);
    }

    // Compatibilidad: mensajes de movimiento/cancelación siguen sin abrir formulario ni pedir aclaración.
    {
      const sb2 = makeChatSandbox({ smartFormIntentResult: null, clarificationResult: null, runIAActionResult: { answer: 'Movido.', applied: ['He movido "Examen" a 2026-09-18.'] } });
      await sb2.runIAActionChat('Mueve el examen de biología al viernes');
      check('I15. movimiento: no se abre formulario ni se pide aclaración, sigue AI-1', sb2.__calls.openTaskModal === 0 && sb2.__calls.openEventModal === 0 && sb2.__calls.runIAAction === 1);
    }
  }

  // =====================================================================
  section('Reutiliza los helpers existentes (no duplica ningún parser de fechas/horas ni clasificación)');
  // =====================================================================
  {
    check('R0a. resolveDateExpression sigue con una única definición en todo el archivo (AI-2.6 no la duplica)', (aiActionsSrc.match(/function resolveDateExpression\(/g) || []).length === 1);
    check('R0b. resolveTimeExpression sigue con una única definición en todo el archivo (AI-2.6 no la duplica)', (aiActionsSrc.match(/function resolveTimeExpression\(/g) || []).length === 1);
    check('R0c. isCancelMessage/isMoveMessage/isPriorityChangeMessage (AI-1.5) siguen con una única definición cada una', (aiActionsSrc.match(/function isCancelMessage\(/g) || []).length === 1 && (aiActionsSrc.match(/function isMoveMessage\(/g) || []).length === 1 && (aiActionsSrc.match(/function isPriorityChangeMessage\(/g) || []).length === 1);
    check('R0d. el propio bloque AI-2.6 llama a esos helpers reutilizados (evidencia textual)', /isCancelMessage\(message\)/.test(clarificationSrc) && /isMoveMessage\(message\)/.test(clarificationSrc) && /isPriorityChangeMessage\(message\)/.test(clarificationSrc));
    check('R0e. ACTION_SCHEMA no se tocó (AI-2.6 no añade nuevos "op")', /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc));
  }

  // =====================================================================
  section('Regresión: suites AI-2.x y AI-1.x completas (subproceso real)');
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
    check('REG1. js/test-ai-2-1-smart-form-intent.js sigue pasando', runSuite('js/test-ai-2-1-smart-form-intent.js'));
    check('REG2. js/test-ai-2-2-smart-form-prefill.js sigue pasando', runSuite('js/test-ai-2-2-smart-form-prefill.js'));
    check('REG3. js/test-ai-2-3-smart-form-open.js sigue pasando', runSuite('js/test-ai-2-3-smart-form-open.js'));
    check('REG4. js/test-ai-2-4-smart-form-submit.js sigue pasando', runSuite('js/test-ai-2-4-smart-form-submit.js'));
    check('REG5. js/test-ai-2-regression.js sigue pasando', runSuite('js/test-ai-2-regression.js'));
    check('REG6. js/test-ai-1-1-intent-detection.js sigue pasando', runSuite('js/test-ai-1-1-intent-detection.js'));
    check('REG7. js/test-ai-1-2-datetime-resolution.js sigue pasando', runSuite('js/test-ai-1-2-datetime-resolution.js'));
    check('REG8. js/test-ai-1-3-implicit-events.js sigue pasando', runSuite('js/test-ai-1-3-implicit-events.js'));
    check('REG9. js/test-ai-1-4-implicit-tasks.js sigue pasando', runSuite('js/test-ai-1-4-implicit-tasks.js'));
    check('REG10. js/test-ai-1-5-natural-modifications.js sigue pasando', runSuite('js/test-ai-1-5-natural-modifications.js'));
    check('REG11. js/test-ai-1-regression.js sigue pasando', runSuite('js/test-ai-1-regression.js'));
  }

  // =====================================================================
  section('node --check de js/ai-actions.js y organizator.html (script principal)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('C1. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('C1. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
    {
      const startMarker = '\n<script>\n';
      const scriptStart = html.indexOf(startMarker);
      const scriptEnd = html.indexOf('\n</script>', scriptStart + startMarker.length);
      const scriptBlock = html.slice(scriptStart + startMarker.length, scriptEnd);
      const tmpPath = path.join(require('os').tmpdir(), `organizator-ai-2-6-check-${process.pid}.js`);
      fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
      try {
        execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
        check('C2. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
      } catch (e) {
        check('C2. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
        console.log(String(e.stderr || e.message));
      } finally {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
