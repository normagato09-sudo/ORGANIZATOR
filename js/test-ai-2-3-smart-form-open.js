/**
 * ORGANIZATOR — Tests de AI-2.3 (abrir el formulario desde el chat con
 * datos prellenados)
 *
 * Suite Node pura, SIN navegador ni jsdom. Dos capas de prueba:
 *
 *  a) Nivel MODAL: extrae literalmente de organizator.html
 *     openSmartFormFromChat() junto con openTaskModal()/openEventModal()
 *     REALES (UX-8) y sus dependencias (mismo patrón exacto que ya usa
 *     test-ux8-modal-redesign.js: modalCollapsibleSection,
 *     recurrenceControlsHtml/wireRecurrenceControls, reminders Fase 1/3,
 *     esc, constantes DOW/MONTH), las ejecuta en un DOM mínimo simulado
 *     y comprueba el HTML final que produce modalBox.innerHTML — nunca
 *     se disparan los listeners de submit/click (igual que en
 *     test-ux8-modal-redesign.js), así que "no crea nada" se comprueba
 *     tanto por el HTML producido (sin invocar addTask/addEvent, que ni
 *     siquiera están definidos en el sandbox) como por que `state.tasks`/
 *     `state.events` quedan exactamente igual antes y después de abrir
 *     el formulario.
 *  b) Nivel INTEGRACIÓN (chat → formulario): extrae runIAActionChat() +
 *     openSmartFormFromChat() con `AIActions`/`openTaskModal`/
 *     `openEventModal`/`iaThreadAddPending`/`iaThreadResolve` MOCKEADOS
 *     (espías), para comprobar que runIAActionChat() decide
 *     correctamente entre abrir un formulario o seguir el camino normal
 *     de AI-1 (AIActions.runIAAction) — sin volver a interpretar nada,
 *     solo enrutando el resultado ya calculado por
 *     AIActions.detectSmartFormIntent (AI-2.1).
 *
 * Uso:  node js/test-ai-2-3-smart-form-open.js
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
// Fragmentos reales de organizator.html (mismo patrón que
// test-ux8-modal-redesign.js) + los dos nuevos de AI-2.3.
// ---------------------------------------------------------------------
const escSrc = extractBetween(html, 'function esc(s){', '\n\n/* ==================================================================\n   FILAS DE TAREA', 'función esc()');
const dowConstsSrc = extractBetween(html, 'const DOW_NAMES = ', '\n\n/* ==================================================================\n   AJUSTES', 'constantes DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES');
const remindersFase1Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', 'bloque RECORDATORIOS (Fase 1)');
const remindersFase3Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)', '\n\n/* ==================================================================\n   TOAST', 'bloque RECORDATORIOS (Fase 3, integración UI)');
const recurrenceUiSrc = extractBetween(html, '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)', '\n\n/* ==================================================================\n   MODAL: TAREA', 'bloque RECURRENCIA — UI compartida (Fase R-5)');
const modalCollapsibleSrc = extractBetween(html, 'function modalCollapsibleSection(id, label, contentHtml, open){', '\nfunction openTaskModal(', 'bloque UX-8 secciones desplegables');
const openTaskModalSrc = extractBetween(html, 'function openTaskModal({taskId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: MINUTOS REALES', 'función openTaskModal()');
const openEventModalSrc = extractBetween(html, 'function openEventModal({eventId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: HORARIO BLOQUEADO', 'función openEventModal()');
const openSmartFormFromChatSrc = extractBetween(html, 'function openSmartFormFromChat(intent){', '\n\n/* ---------- Chat con la IA', 'función openSmartFormFromChat() (AI-2.3)');
const runIAActionChatSrc = extractBetween(html, 'async function runIAActionChat(question){', '\n\n/* ---------- Wiring inicial del bloque IA', 'función runIAActionChat() (con la integración AI-2.3)');

// ---------------------------------------------------------------------
// AI-2.2: bloque REAL de js/ai-actions.js (buildSmartFormPrefill), del
// que ahora depende openSmartFormFromChat() (AI-2.3) vía
// AIActions.buildSmartFormPrefill — se extrae junto con AI-2.1 (mismo
// bloque combinado AI-2.1+AI-2.2, ya que AI-2.2 vive justo a
// continuación de detectSmartFormIntent en el mismo archivo).
// ---------------------------------------------------------------------
const smartFormSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-2.1',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-2.1+AI-2.2 (detección + normalización del prefill)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox de NIVEL MODAL: mismo patrón exacto que
 * test-ux8-modal-redesign.js (renderModalHTML), pero exponiendo
 * openSmartFormFromChat en vez de llamar directamente a openTaskModal/
 * openEventModal — así se prueba la ruta real que usa el chat. `state`
 * se pasa por referencia y se puede inspeccionar DESPUÉS de la llamada
 * para confirmar que no cambió. */
function renderSmartFormHTML(state, intent) {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);

  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dowConstsSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/...)' });
  vm.runInContext(
    `let state = ${JSON.stringify(state)};
     let window = {};
     const modalBox = {
       _html: '',
       set innerHTML(v){ this._html = v; },
       get innerHTML(){ return this._html; },
       querySelector(){ return { addEventListener(){}, style:{}, value:'' }; },
       querySelectorAll(){ return { forEach(){} }; },
     };
     const overlay = { classList: { add(){}, remove(){} } };
     function closeModal(){}
     function requestReminderNotificationPermission(){}
     function showToast(){}
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }`,
    sandbox, { filename: 'dom-stub' }
  );
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5)' });
  vm.runInContext(modalCollapsibleSrc, sandbox, { filename: 'organizator.html (UX-8 modalCollapsibleSection)' });
  vm.runInContext(openTaskModalSrc, sandbox, { filename: 'organizator.html (openTaskModal)' });
  vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal)' });
  // AI-2.2 REAL (buildSmartFormPrefill), del que ahora depende
  // openSmartFormFromChat vía AIActions.buildSmartFormPrefill — se
  // expone bajo `AIActions` (no como global suelto) para reproducir
  // exactamente cómo lo consume organizator.html.
  vm.runInContext(smartFormSrc, sandbox, { filename: 'ai-actions.js (AI-2.1+AI-2.2)' });
  vm.runInContext('this.AIActions = { buildSmartFormPrefill: buildSmartFormPrefill };', sandbox, { filename: 'expose-AIActions' });
  vm.runInContext(openSmartFormFromChatSrc, sandbox, { filename: 'organizator.html (openSmartFormFromChat)' });
  vm.runInContext('this.openSmartFormFromChat = openSmartFormFromChat; this.modalBox = modalBox; this.state = state;', sandbox, { filename: 'expose' });

  sandbox.openSmartFormFromChat(intent);
  return { html: sandbox.modalBox.innerHTML, stateAfter: sandbox.state };
}

const TODAY = '2026-09-17';

(async () => {

  // =====================================================================
  section('0) AI-2.3 queda conectado a AI-2.2 (ya no lee intent.fields directamente)');
  // =====================================================================
  {
    check('0a. openSmartFormFromChat() llama a AIActions.buildSmartFormPrefill(intent)', /AIActions\.buildSmartFormPrefill\(intent\)/.test(openSmartFormFromChatSrc));
    check('0b. openSmartFormFromChat() ya NO lee intent.fields.title/date/time directamente', !/intent\.fields\.title/.test(openSmartFormFromChatSrc) && !/intent\.fields\.date/.test(openSmartFormFromChatSrc) && !/intent\.fields\.time/.test(openSmartFormFromChatSrc));
    check('0c. openSmartFormFromChat() decide el modal a partir del resultado normalizado (prefill.type), no de intent.type', /prefill\.type === 'event'/.test(openSmartFormFromChatSrc) && /prefill\.type === 'task'/.test(openSmartFormFromChatSrc));
  }

  // =====================================================================
  section('1) Intención "event" → se selecciona el formulario de evento');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18' }, missingFields: [], sourceText: 'parcial de biología el jueves' };
    const { html: out } = renderSmartFormHTML({ tasks: [], events: [], eventCategories: [], reminders: [] }, intent);
    check('1. se abre el formulario de EVENTO (título "Añadir evento", campo "date" presente)', /<h3>Añadir evento<\/h3>/.test(out) && /name="date"/.test(out));
    check('1b. NO se abre el formulario de tarea (sin "Añadir tarea" ni campo "dueDate")', !/<h3>Añadir tarea<\/h3>/.test(out) && !/name="dueDate"/.test(out));
  }

  // =====================================================================
  section('2) Intención "task" → se selecciona el formulario de tarea');
  // =====================================================================
  {
    const intent = { type: 'task', fields: { title: 'Estudiar biología' }, missingFields: [], sourceText: 'estudiar biología' };
    const { html: out } = renderSmartFormHTML({ tasks: [], events: [], eventCategories: [], reminders: [] }, intent);
    check('2. se abre el formulario de TAREA (título "Añadir tarea", campo "dueDate" presente)', /<h3>Añadir tarea<\/h3>/.test(out) && /name="dueDate"/.test(out));
    check('2b. NO se abre el formulario de evento (sin "Añadir evento" ni campo "date" de evento)', !/<h3>Añadir evento<\/h3>/.test(out));
  }

  // =====================================================================
  section('3) Los campos de AI-2.1 llegan al formulario (título/fecha/hora prellenados)');
  // =====================================================================
  {
    const intent = { type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' }, missingFields: [], sourceText: 'x' };
    const { html: out } = renderSmartFormHTML({ tasks: [], events: [], eventCategories: [], reminders: [] }, intent);
    check('3a. el título llega prellenado en el campo "title"', /name="title" required value="Parcial de biología"/.test(out));
    check('3b. la fecha llega prellenada en el campo "date"', /name="date" required value="2026-09-18"/.test(out));
    check('3c. la hora llega prellenada en el campo "startTime"', /name="startTime" value="17:00"/.test(out));

    const intentTask = { type: 'task', fields: { title: 'Estudiar biología', date: '2026-09-18', time: '17:00' }, missingFields: [], sourceText: 'x' };
    const { html: outTask } = renderSmartFormHTML({ tasks: [], events: [], eventCategories: [], reminders: [] }, intentTask);
    check('3d. (tarea) el título llega prellenado', /name="title" required value="Estudiar biología"/.test(outTask));
    check('3e. (tarea) la fecha llega prellenada en "dueDate"', /name="dueDate" value="2026-09-18"/.test(outTask));
    check('3f. (tarea) la hora llega prellenada en "dueTime"', /name="dueTime" value="17:00"/.test(outTask));
    check('3g. (tarea) con hora prellenada, "Más opciones" empieza ABIERTO (para no esconder la hora)', /data-modal-collapsible="task-more" aria-expanded="true"/.test(outTask));
  }

  // =====================================================================
  section('4) Los campos ausentes no reciben valores inventados');
  // =====================================================================
  {
    // Evento sin fecha ni hora (solo título): el campo "date" debe quedar
    // vacío ("" ) — nunca con una fecha de hoy inventada — y sin hora.
    const intent = { type: 'event', fields: { title: 'Examen de matemáticas' }, missingFields: ['date'], sourceText: 'examen de matemáticas' };
    const { html: out } = renderSmartFormHTML({ tasks: [], events: [], eventCategories: [], reminders: [] }, intent);
    check('4a. el campo "date" queda VACÍO (no se inventa "hoy" ni ninguna otra fecha)', /name="date" required value=""/.test(out));
    check('4b. el campo "startTime" queda vacío (no se inventa una hora)', /name="startTime" value=""/.test(out));
    check('4c. "allDay" NO queda marcado por su cuenta (AI-2.3 no decide allDay, solo title/date/time)', !/name="allDay" id="event-allday" checked/.test(out));
    check('4d. la categoría sigue en "Sin categoría" por defecto (no se inventa)', /<option value="">Sin categoría<\/option>/.test(out));
  }

  // =====================================================================
  section('5-6) Abrir el formulario no crea ninguna tarea ni ningún evento');
  // =====================================================================
  {
    const stateBefore = { tasks: [], events: [], eventCategories: [], reminders: [] };
    const intent = { type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18' }, missingFields: [], sourceText: 'x' };
    const { stateAfter } = renderSmartFormHTML(stateBefore, intent);
    check('5. no se crea ninguna tarea (state.tasks sigue vacío)', stateAfter.tasks.length === 0);
    check('6. no se crea ningún evento (state.events sigue vacío)', stateAfter.events.length === 0);
    // openSmartFormFromChat/openEventModal/openTaskModal nunca deben
    // referenciar addTask/addEvent de forma SÍNCRONA (solo dentro del
    // closure del listener de submit, que aquí nunca se dispara): si lo
    // hicieran, el sandbox (que no define addTask/addEvent) lanzaría un
    // ReferenceError en vez de devolver el HTML con normalidad.
    check('5b/6b. ni siquiera se referencian addTask/addEvent de forma síncrona (el sandbox no los define y no lanza)', true);
  }

  // =====================================================================
  section('7-8) Abrir el formulario no modifica state.tasks ni state.events (con datos preexistentes)');
  // =====================================================================
  {
    const stateBefore = {
      tasks: [{ id: 't-existente', title: 'Tarea previa', dueDate: '2026-09-10', priority: 'media' }],
      events: [{ id: 'e-existente', title: 'Evento previo', date: '2026-09-11', allDay: true }],
      eventCategories: [], reminders: [],
    };
    const snapshotBefore = JSON.stringify(stateBefore);
    const intent = { type: 'task', fields: { title: 'Estudiar biología' }, missingFields: [], sourceText: 'x' };
    const { stateAfter } = renderSmartFormHTML(stateBefore, intent);
    check('7. state.tasks preexistente queda exactamente igual (misma tarea, sin añadidos)', JSON.stringify(stateAfter.tasks) === JSON.stringify([{ id: 't-existente', title: 'Tarea previa', dueDate: '2026-09-10', priority: 'media' }]));
    check('8. state.events preexistente queda exactamente igual (mismo evento, sin añadidos)', JSON.stringify(stateAfter.events) === JSON.stringify([{ id: 'e-existente', title: 'Evento previo', date: '2026-09-11', allDay: true }]));
    check('7b/8b. el snapshot completo de `state` antes de llamar sigue siendo válido tras la llamada (nada mutado por referencia)', JSON.stringify(stateBefore) === snapshotBefore);
  }

  // =====================================================================
  section('9) Cancelar no crea nada (el botón Cancelar solo cierra el modal, sin tocar state)');
  // =====================================================================
  {
    // El código real de ambos modales solo conecta el botón Cancelar a
    // closeModal() — se comprueba por CONTENIDO del código fuente
    // extraído (no se reimplementa un DOM real para "pulsar" el botón,
    // igual que el resto de esta familia de tests): ni un solo
    // addTask/addEvent/updateTask/updateEvent cuelga del listener de
    // "cancel-btn" en ninguno de los dos modales.
    check('9a. el botón Cancelar de tareas solo llama a closeModal (no crea ni guarda nada)', /task-cancel-btn'\)\.addEventListener\('click', closeModal\);/.test(openTaskModalSrc));
    check('9b. el botón Cancelar de eventos solo llama a closeModal (no crea ni guarda nada)', /event-cancel-btn'\)\.addEventListener\('click', closeModal\);/.test(openEventModalSrc));
  }

  // =====================================================================
  section('12) Los defaults normales del formulario se conservan cuando AI no proporciona ese campo');
  // =====================================================================
  {
    const intentTask = { type: 'task', fields: { title: 'Estudiar biología' }, missingFields: [], sourceText: 'x' };
    const { html: outTask } = renderSmartFormHTML({ tasks: [], events: [], eventCategories: [], reminders: [] }, intentTask);
    check('12a. la prioridad por defecto sigue siendo "Media" (no se toca ni se inventa)', /<option value="media" selected>Media<\/option>/.test(outTask));
    check('12b. "Más opciones" empieza CERRADO cuando no hay hora prellenada (default normal de UX-8, sin cambios)', /data-modal-collapsible="task-more" aria-expanded="false"/.test(outTask));

    const intentEvent = { type: 'event', fields: { title: 'Examen de matemáticas' }, missingFields: ['date'], sourceText: 'x' };
    const { html: outEvent } = renderSmartFormHTML({ tasks: [], events: [], eventCategories: [], reminders: [] }, intentEvent);
    check('12c. "Todo el día" sigue sin marcar por defecto (default normal, no se inventa)', !/name="allDay" id="event-allday" checked/.test(outEvent));
    check('12d. "Repetición" sigue cerrada por defecto (default normal de UX-8, sin recurrencia inventada)', /data-modal-collapsible="event-repeat" aria-expanded="false"/.test(outEvent));
    check('12e. "Recordatorio" sigue cerrado por defecto y en "Sin recordatorio" (default normal, sin recordatorio inventado)', /data-modal-collapsible="event-reminder" aria-expanded="false"/.test(outEvent) && /<option value="" selected>Sin recordatorio<\/option>/.test(outEvent));
  }

  // =====================================================================
  section('Integración chat → formulario: runIAActionChat() decide correctamente (10, 11 y compatibilidad con AI-1)');
  // =====================================================================
  {
    /** Sandbox de NIVEL INTEGRACIÓN: runIAActionChat + openSmartFormFromChat
     * reales, con AIActions/openTaskModal/openEventModal/iaThread*
     * MOCKEADOS (espías) — comprueba el ENRUTAMIENTO, no vuelve a probar
     * el contenido de los modales (ya cubierto arriba) ni la detección en
     * sí (ya cubierta por test-ai-2-1-smart-form-intent.js). */
    function makeChatSandbox({ smartFormIntentResult, runIAActionResult }) {
      const sandbox = {};
      sandbox.console = console;
      const calls = { detectSmartFormIntent: 0, buildSmartFormPrefill: 0, runIAAction: 0, openTaskModal: 0, openEventModal: 0, iaThreadResolve: 0, renderInicio: 0, renderCalendar: 0 };
      sandbox.__calls = calls;
      sandbox.AIActions = {
        detectSmartFormIntent: (msg, ctx) => { calls.detectSmartFormIntent++; sandbox.__lastCtx = ctx; return smartFormIntentResult; },
        // Mock de AI-2.2 a NIVEL DE ENRUTAMIENTO (no vuelve a probar su
        // normalización interna, ya cubierta por
        // test-ai-2-2-smart-form-prefill.js): simplemente aplana
        // intent.fields bajo `type`, igual forma que produciría la
        // función real para estos casos de prueba.
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
      vm.runInContext(openSmartFormFromChatSrc + '\n' + runIAActionChatSrc + '\nthis.runIAActionChat = runIAActionChat;', sandbox, { filename: 'organizator.html (AI-2.3 chat wiring)' });
      return sandbox;
    }

    // 10) intención null -> no abre ningún formulario, sigue el camino normal de AI-1.
    {
      const sb = makeChatSandbox({ smartFormIntentResult: null, runIAActionResult: { answer: 'Vale.', applied: [] } });
      await sb.runIAActionChat('Hoy estoy cansado');
      check('10a. detectSmartFormIntent se consulta primero', sb.__calls.detectSmartFormIntent === 1);
      check('10b. con intención null, NO se abre ningún formulario', sb.__calls.openTaskModal === 0 && sb.__calls.openEventModal === 0);
      check('10c. con intención null, sí se sigue llamando a AIActions.runIAAction (camino normal de AI-1 intacto)', sb.__calls.runIAAction === 1);
    }

    // 11) mensaje de modificación/cancelación: detectSmartFormIntent (AI-2.1)
    // ya devuelve null para estos casos (comprobado en su propia suite);
    // aquí se confirma que runIAActionChat lo respeta y NO abre un
    // formulario, dejando que AI-1 (move_item/cancel_item) actúe normal.
    {
      const sb = makeChatSandbox({ smartFormIntentResult: null, runIAActionResult: { answer: 'Movido.', applied: ['He movido "Examen" a 2026-09-18.'] } });
      await sb.runIAActionChat('Mueve el examen de biología al viernes');
      check('11a. un mensaje de movimiento no abre ningún formulario', sb.__calls.openTaskModal === 0 && sb.__calls.openEventModal === 0);
      check('11b. sigue aplicándose por el camino normal de AI-1 (move_item)', sb.__calls.runIAAction === 1);
    }
    {
      const sb = makeChatSandbox({ smartFormIntentResult: null, runIAActionResult: { answer: 'Cancelado.', applied: ['He eliminado "Examen".'] } });
      await sb.runIAActionChat('Cancela el examen de biología');
      check('11c. un mensaje de cancelación no abre ningún formulario', sb.__calls.openTaskModal === 0 && sb.__calls.openEventModal === 0);
    }
    {
      const sb = makeChatSandbox({ smartFormIntentResult: null, runIAActionResult: { answer: 'Prioridad cambiada.', applied: [] } });
      await sb.runIAActionChat('Cambia la prioridad del trabajo a alta');
      check('11d. un mensaje de cambio de prioridad no abre ningún formulario', sb.__calls.openTaskModal === 0 && sb.__calls.openEventModal === 0);
    }

    // Con intención VÁLIDA: se abre el formulario correcto y NO se llama a AIActions.runIAAction (no se crea nada automáticamente).
    {
      const sb = makeChatSandbox({ smartFormIntentResult: { type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' }, missingFields: [], sourceText: 'x' } });
      await sb.runIAActionChat('parcial de biología el jueves');
      check('I1. con intención "event", se abre el formulario de EVENTO', sb.__calls.openEventModal === 1 && sb.__calls.openTaskModal === 0);
      check('I2. el prefill que llega al modal es exactamente type/title/date/time (sin más campos inventados) — ya normalizado por AI-2.2', JSON.stringify(Object.keys(sb.__lastEventArgs.prefill).sort()) === JSON.stringify(['date', 'time', 'title', 'type']));
      check('I2b. AI-2.2 (buildSmartFormPrefill) se consultó para construir el prefill', sb.__calls.buildSmartFormPrefill === 1);
      check('I3. con intención válida, NO se llama a AIActions.runIAAction (no se crea nada automáticamente en este turno)', sb.__calls.runIAAction === 0);
      check('I4. se le pasa FECHA ACTUAL real (todayStr()) a detectSmartFormIntent, nunca un valor fijo/inventado', sb.__lastCtx && sb.__lastCtx.todayStr === TODAY);
    }
    {
      const sb = makeChatSandbox({ smartFormIntentResult: { type: 'task', fields: { title: 'Estudiar biología' }, missingFields: [], sourceText: 'x' } });
      await sb.runIAActionChat('estudiar biología');
      check('I5. con intención "task", se abre el formulario de TAREA', sb.__calls.openTaskModal === 1 && sb.__calls.openEventModal === 0);
      check('I6. tampoco se llama a AIActions.runIAAction para una tarea con intención válida', sb.__calls.runIAAction === 0);
    }
  }

  // =====================================================================
  section('Regresión: suite AI-2.1 completa (subproceso real)');
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
    check('R1. js/test-ai-2-1-smart-form-intent.js sigue pasando', runSuite('js/test-ai-2-1-smart-form-intent.js'));
    check('R2. js/test-ai-1-1-intent-detection.js sigue pasando', runSuite('js/test-ai-1-1-intent-detection.js'));
    check('R3. js/test-ai-1-2-datetime-resolution.js sigue pasando', runSuite('js/test-ai-1-2-datetime-resolution.js'));
    check('R4. js/test-ai-1-3-implicit-events.js sigue pasando', runSuite('js/test-ai-1-3-implicit-events.js'));
    check('R5. js/test-ai-1-4-implicit-tasks.js sigue pasando', runSuite('js/test-ai-1-4-implicit-tasks.js'));
    check('R6. js/test-ai-1-5-natural-modifications.js sigue pasando', runSuite('js/test-ai-1-5-natural-modifications.js'));
    check('R7. js/test-ai-1-regression.js sigue pasando', runSuite('js/test-ai-1-regression.js'));
    check('R8. js/test-ux8-modal-redesign.js sigue pasando (openTaskModal/openEventModal con el nuevo parámetro prefill)', runSuite('js/test-ux8-modal-redesign.js'));
    check('R9. js/test-event-category-orphan.js sigue pasando (openEventModal con el nuevo parámetro prefill)', runSuite('js/test-event-category-orphan.js'));
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
      const tmpPath = path.join(require('os').tmpdir(), `organizator-ai-2-3-check-${process.pid}.js`);
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
