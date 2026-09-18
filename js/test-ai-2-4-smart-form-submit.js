/**
 * ORGANIZATOR — Tests de AI-2.4 (confirmar y crear la tarea/evento
 * usando el flujo normal)
 *
 * Suite Node pura, SIN navegador ni jsdom. A diferencia del resto de la
 * familia AI-2.x, aquí SÍ hace falta disparar de verdad el submit del
 * formulario (no solo inspeccionar el HTML generado) para comprobar que
 * usa los valores ACTUALES del formulario en el momento de guardar, no
 * los originales del prefill de AI-2.2. Para eso se construye un DOM
 * mínimo pero FUNCIONAL (un registro de elementos con `.value`/
 * `.checked`/`.addEventListener` reales, y un `FormData` propio que lee
 * de ese registro) — el resto del patrón es el mismo que el resto de la
 * suite: extraer literalmente por CONTENIDO el código REAL de
 * organizator.html (openTaskModal/openEventModal de UX-8, el bloque CRUD
 * real de R-1 con `addTask`/`updateTask`/`addEvent`/`updateEvent`, el
 * saneamiento/sanitizeRecurrence del que depende el CRUD, los bloques de
 * recordatorios Fase 1/Fase 3 con `syncReminderForTarget` real, y el
 * bloque de recurrencia R-5 con `readRecurrenceFromForm`/
 * `isRecurrenceEndDateValid` reales) y ejecutarlo tal cual, SIN
 * reimplementar ni duplicar ninguna de esas funciones.
 *
 * Uso:  node js/test-ai-2-4-smart-form-submit.js
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

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Fragmentos REALES de organizator.html — nada de esto se reimplementa,
// solo se extrae literalmente y se ejecuta tal cual (mismo patrón que el
// resto de la familia AI-1.x/AI-2.x).
// ---------------------------------------------------------------------
const escSrc = extractBetween(html, 'function esc(s){', '\n\n/* ==================================================================\n   FILAS DE TAREA', 'función esc()');
const dowConstsSrc = extractBetween(html, 'const DOW_NAMES = ', '\n\n/* ==================================================================\n   AJUSTES', 'constantes DOW_NAMES/...');
// Saneamiento (sanitizeRecurrence y helpers) — del que depende el CRUD real.
const sanitizeSrc = extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'bloque SANEAMIENTO (incluye sanitizeRecurrence, R-1)');
// CRUD real: addTask/updateTask/deleteTask/addEvent/updateEvent/deleteEvent.
const crudSrc = extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', 'bloque CRUD');
const remindersFase1Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', 'bloque RECORDATORIOS (Fase 1)');
// Fase 3: syncReminderForTarget real, usado tal cual por ambos submits.
const remindersFase3Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)', '\n\n/* ==================================================================\n   TOAST', 'bloque RECORDATORIOS (Fase 3, integración UI)');
const recurrenceUiSrc = extractBetween(html, '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)', '\n\n/* ==================================================================\n   MODAL: TAREA', 'bloque RECURRENCIA — UI compartida (Fase R-5)');
const modalCollapsibleSrc = extractBetween(html, 'function modalCollapsibleSection(id, label, contentHtml, open){', '\nfunction openTaskModal(', 'bloque UX-8 secciones desplegables');
const openTaskModalSrc = extractBetween(html, 'function openTaskModal({taskId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: MINUTOS REALES', 'función openTaskModal()');
const openEventModalSrc = extractBetween(html, 'function openEventModal({eventId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: HORARIO BLOQUEADO', 'función openEventModal()');
const openSmartFormFromChatSrc = extractBetween(html, 'function openSmartFormFromChat(intent){', '\n\n/* ---------- Chat con la IA', 'función openSmartFormFromChat() (AI-2.3)');
const runIAActionChatSrc = extractBetween(html, 'async function runIAActionChat(question){', '\n\n/* ---------- Wiring inicial del bloque IA', 'función runIAActionChat()');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Registro de elementos mínimo pero FUNCIONAL: cada id/name consultado
 * se crea de forma perezosa (una única vez, memoizado) con `.value`/
 * `.checked`/`.style`/`.addEventListener` reales — lo bastante para que
 * el código real de openTaskModal/openEventModal (wiring de listeners,
 * recurrencia R-5, secciones desplegables de UX-8) se ejecute sin
 * lanzar, y para poder simular de verdad "el usuario cambia un campo" y
 * "el usuario pulsa Guardar/Cancelar" disparando los listeners
 * REALMENTE registrados por el código real (no simulados aparte). */
function makeElementRegistry() {
  const byId = {};
  const byName = {};
  function makeEl() {
    const el = {
      value: '', checked: false, disabled: false, style: {}, innerHTML: '', textContent: '',
      _listeners: {},
      addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); },
    };
    return el;
  }
  function get(map, key) { if (!map[key]) map[key] = makeEl(); return map[key]; }
  return {
    byIdEl(id) { return get(byId, id); },
    byNameEl(name) { return get(byName, name); },
    querySelector(sel) {
      let m;
      if ((m = /^#([\w-]+)$/.exec(sel))) return get(byId, m[1]);
      if ((m = /^\[name="([^"]+)"\]$/.exec(sel))) return get(byName, m[1]);
      // Cualquier otro selector (usado solo internamente por wiring que
      // no es el objeto de esta suite, p.ej. detalles de recurrencia/
      // secciones desplegables) recibe un elemento nuevo desechable: no
      // necesita persistir entre llamadas para no lanzar.
      return makeEl();
    },
    querySelectorAll() { return { forEach() {} }; },
  };
}

/** Dispara todos los listeners de `type` registrados en `el` (si hay
 * varios, todos — aunque en este código real solo se registra uno por
 * tipo y elemento). */
async function fire(el, type, evt) {
  for (const h of (el._listeners[type] || [])) await h(evt || {});
}

/** Sandbox con el flujo REAL de creación (CRUD + reminders + recurrencia
 * + ambos modales de UX-8) sobre un DOM mínimo pero funcional. `state`
 * es un objeto real que se puede inspeccionar tras disparar el submit. */
function makeFormSandbox() {
  const sandbox = {};
  sandbox.console = console;
  const registry = makeElementRegistry();
  const calls = { addTask: 0, updateTask: 0, addEvent: 0, updateEvent: 0, closeModal: 0, showToast: 0, renderCurrentView: 0, syncReminderForTarget: 0 };
  sandbox.__calls = calls;
  sandbox.__registry = registry;

  vm.createContext(sandbox);
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dowConstsSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/...)' });
  vm.runInContext(
    `let state = { tasks: [], events: [], eventCategories: [], reminders: [], customSchedules: [] };
     let window = {};
     let currentView = 'test';
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){}
     async function saveEvents(){}
     async function saveReminders(){}
     function showToast(){}
     function renderCurrentView(){}
     function renderInicio(){}
     function renderCalendar(){}
     function requestReminderNotificationPermission(){}
     const modalBox = {
       set innerHTML(v){ this._html = v; },
       get innerHTML(){ return this._html || ''; },
       querySelector: (sel) => __registry.querySelector(sel),
       querySelectorAll: (sel) => __registry.querySelectorAll(sel),
     };
     const overlay = { classList: { add(){}, remove(){} } };
     // closeModal() real vive fuera de openTaskModal/openEventModal en
     // organizator.html (justo antes de ambas, junto a overlay/modalBox) —
     // se reproduce aquí tal cual (misma línea exacta), no se reimplementa
     // ninguna lógica nueva.
     function closeModal(){ overlay.classList.remove('open'); modalBox.innerHTML=''; }
     const document = { getElementById: (id) => __registry.byIdEl(id) };
     class FormData {
       constructor(){}
       get(name){
         const el = __registry.byNameEl(name);
         if(!el) return null;
         if(el.__isCheckbox) return el.checked ? (el.__checkboxValue||'on') : null;
         return el.value;
       }
       getAll(name){
         const v = this.get(name);
         return v == null ? [] : [v];
       }
     }`,
    sandbox, { filename: 'dom-stub' }
  );
  // CRUD real (depende de sanitizeRecurrence, R-1) — mismo orden de
  // carga que ya usa test-recurrence-model.js (sanitizeSrc antes que
  // crudSrc), independientemente del orden en que aparecen en el archivo
  // (son function declarations, quedan hoisted igualmente).
  vm.runInContext(sanitizeSrc, sandbox, { filename: 'organizator.html (saneamiento + sanitizeRecurrence, R-1)' });
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD real)' });
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3, syncReminderForTarget real)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5, readRecurrenceFromForm real)' });
  vm.runInContext(modalCollapsibleSrc, sandbox, { filename: 'organizator.html (UX-8 modalCollapsibleSection)' });
  vm.runInContext(openTaskModalSrc, sandbox, { filename: 'organizator.html (openTaskModal real)' });
  vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal real)' });
  // Espías: envuelven las funciones reales SIN sustituir su comportamiento
  // (siguen siendo las mismas addTask/addEvent/... reales, solo se cuentan
  // las llamadas) — necesario para comprobar "se llama al flujo normal"
  // sin depender de inspeccionar `state` a ciegas.
  vm.runInContext(
    `this.openTaskModal = openTaskModal;
     this.openEventModal = openEventModal;
     this.state = state;
     this.closeModal = closeModal;
     const __realAddTask = addTask, __realUpdateTask = updateTask, __realAddEvent = addEvent, __realUpdateEvent = updateEvent, __realSync = syncReminderForTarget, __realShowToast = showToast, __realRenderCurrentView = renderCurrentView, __realCloseModal = closeModal;
     addTask = async (...a) => { __calls.addTask++; return __realAddTask(...a); };
     updateTask = async (...a) => { __calls.updateTask++; return __realUpdateTask(...a); };
     addEvent = async (...a) => { __calls.addEvent++; return __realAddEvent(...a); };
     updateEvent = async (...a) => { __calls.updateEvent++; return __realUpdateEvent(...a); };
     syncReminderForTarget = async (...a) => { __calls.syncReminderForTarget++; return __realSync(...a); };
     showToast = (...a) => { __calls.showToast++; return __realShowToast(...a); };
     renderCurrentView = (...a) => { __calls.renderCurrentView++; return __realRenderCurrentView(...a); };
     closeModal = (...a) => { __calls.closeModal++; return __realCloseModal(...a); };`,
    sandbox, { filename: 'expose-and-spy' }
  );
  return sandbox;
}

/** Rellena los campos habituales de un formulario de TAREA con sus
 * defaults normales (los mismos que ya renderiza openTaskModal para una
 * tarea nueva) — el registro no parsea el HTML generado, así que estos
 * valores se fijan aquí explícitamente para que el submit real (que sí
 * lee del registro vía FormData) encuentre algo coherente. */
function seedTaskDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  set('title', '');
  set('dueDate', '');
  set('dueTime', '');
  set('priority', 'media');
  set('category', '');
  set('estimatedMinutes', '');
  set('repeatType', 'none');
  set('repeatEnd', 'never');
  set('repeatEndDate', '');
  set('reminderMinutes', '');
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}
function seedEventDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  set('title', '');
  set('categoryId', '');
  set('date', '');
  set('endDate', '');
  const allDayEl = r.byNameEl('allDay'); allDayEl.__isCheckbox = true; allDayEl.__checkboxValue = 'on'; allDayEl.checked = false;
  set('startTime', '');
  set('endTime', '');
  set('repeatType', 'none');
  set('repeatEnd', 'never');
  set('repeatEndDate', '');
  set('reminderMinutes', '');
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}

async function submitTaskForm(sb) {
  const formEl = sb.__registry.byIdEl('task-form');
  await fire(formEl, 'submit', { preventDefault() {}, target: formEl });
}
async function submitEventForm(sb) {
  const formEl = sb.__registry.byIdEl('event-form');
  await fire(formEl, 'submit', { preventDefault() {}, target: formEl });
}
async function clickCancel(sb, btnId) {
  const el = sb.__registry.byIdEl(btnId);
  await fire(el, 'click', {});
}

(async () => {

  // =====================================================================
  section('Flujo evento (1-6)');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openEventModal({ prefill: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
    check('1. el Smart Form de evento se abre (formulario "event-form" registrado con su submit real)', typeof sb.__registry.byIdEl('event-form')._listeners.submit !== 'undefined' && sb.__registry.byIdEl('event-form')._listeners.submit.length === 1);
    // Simula que el navegador ya pintó el prefill (ya probado end-to-end
    // en test-ai-2-3-smart-form-open.js) y que el usuario cambia la hora.
    seedEventDefaults(sb, { title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00' });
    check('2. el usuario modifica un campo antes de guardar (la hora, de 17:00 a 18:00)', true);
    sb.__registry.byNameEl('startTime').value = '18:00';
    await submitEventForm(sb);
    check('3. el submit usa el valor MODIFICADO (18:00), no el prefill original (17:00)', sb.state.events.length === 1 && sb.state.events[0].startTime === '18:00');
    check('4. se llamó al flujo normal de creación de evento (addEvent real, no una función paralela)', sb.__calls.addEvent === 1 && sb.__calls.addTask === 0);
    check('5. se crea exactamente UN evento', sb.state.events.length === 1);
    check('6. el estado final contiene el evento creado, con el título y fecha del prefill intactos', sb.state.events[0].title === 'Parcial de biología' && sb.state.events[0].date === '2026-09-18');
  }

  // =====================================================================
  section('Flujo tarea (7-12)');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openTaskModal({ prefill: { title: 'Estudiar biología', date: '2026-09-18', time: '17:00' } });
    check('7. el Smart Form de tarea se abre (formulario "task-form" registrado con su submit real)', sb.__registry.byIdEl('task-form')._listeners.submit && sb.__registry.byIdEl('task-form')._listeners.submit.length === 1);
    seedTaskDefaults(sb, { title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '17:00' });
    check('8. el usuario modifica un campo antes de guardar (la prioridad, de "media" a "alta")', true);
    sb.__registry.byNameEl('priority').value = 'alta';
    await submitTaskForm(sb);
    check('9. el submit usa el valor MODIFICADO (prioridad "alta"), no el default original ("media")', sb.state.tasks.length === 1 && sb.state.tasks[0].priority === 'alta');
    check('10. se llamó al flujo normal de creación de tarea (addTask real, no una función paralela)', sb.__calls.addTask === 1 && sb.__calls.addEvent === 0);
    check('11. se crea exactamente UNA tarea', sb.state.tasks.length === 1);
    check('12. el estado final contiene la tarea creada, con el título y fecha del prefill intactos', sb.state.tasks[0].title === 'Estudiar biología' && sb.state.tasks[0].dueDate === '2026-09-18');
  }

  // =====================================================================
  section('Confirmación / cancelación (13-16)');
  // =====================================================================
  {
    // 13) Abrir el formulario sin guardar no crea nada.
    {
      const sb = makeFormSandbox();
      sb.openEventModal({ prefill: { title: 'Examen', date: '2026-09-20' } });
      check('13. abrir el formulario (sin pulsar Guardar) no crea ningún evento', sb.state.events.length === 0 && sb.__calls.addEvent === 0);
    }
    // 14) Cancelar no crea nada.
    {
      const sb = makeFormSandbox();
      sb.openTaskModal({ prefill: { title: 'Estudiar biología', date: '2026-09-18' } });
      seedTaskDefaults(sb, { title: 'Estudiar biología', dueDate: '2026-09-18' });
      await clickCancel(sb, 'task-cancel-btn');
      check('14a. Cancelar cierra el modal (closeModal real invocado)', sb.__calls.closeModal === 1);
      check('14b. Cancelar no crea ninguna tarea', sb.state.tasks.length === 0 && sb.__calls.addTask === 0);
      check('14c. Cancelar no modifica state.events tampoco', sb.state.events.length === 0);
    }
    // 15) Campo obligatorio ausente -> sigue la validación normal (sin
    // añadir ninguna validación paralela de AI-2.4): el propio submit ya
    // existente corta con "return" antes de crear nada.
    {
      const sb = makeFormSandbox();
      sb.openEventModal({ prefill: { title: 'Examen de matemáticas' } }); // sin fecha
      seedEventDefaults(sb, { title: 'Examen de matemáticas', date: '' }); // fecha ausente a propósito
      await submitEventForm(sb);
      check('15. sin fecha (campo obligatorio del evento), la validación normal existente impide crear (0 eventos, addEvent no llamado)', sb.state.events.length === 0 && sb.__calls.addEvent === 0);

      const sbTask = makeFormSandbox();
      sbTask.openTaskModal({ prefill: {} }); // sin título
      seedTaskDefaults(sbTask, { title: '' }); // título ausente (obligatorio en tareas)
      await submitTaskForm(sbTask);
      check('15b. sin título (campo obligatorio de la tarea), la validación normal existente impide crear (0 tareas, addTask no llamado)', sbTask.state.tasks.length === 0 && sbTask.__calls.addTask === 0);
    }
    // 16) AI-2.4 no crea directamente desde runIAActionChat(): se
    // comprueba a nivel de código fuente (runIAActionChat + openSmartFormFromChat,
    // ya probado en detalle end-to-end por test-ai-2-3-smart-form-open.js)
    // que el camino "intención válida -> abrir formulario" NUNCA llama a
    // addTask/addEvent/AIActions.runIAAction en el mismo turno.
    {
      const sandbox = {};
      sandbox.console = console;
      const calls = { openTaskModal: 0, openEventModal: 0, runIAAction: 0, addTask: 0, addEvent: 0, buildSmartFormPrefill: 0 };
      sandbox.AIActions = {
        detectSmartFormIntent: () => ({ type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18' }, missingFields: [], sourceText: 'x' }),
        buildSmartFormPrefill: (intent) => { calls.buildSmartFormPrefill++; return intent ? Object.assign({ type: intent.type }, intent.fields) : null; },
        runIAAction: async () => { calls.runIAAction++; return { answer: 'ok', applied: [] }; },
      };
      sandbox.openTaskModal = () => { calls.openTaskModal++; };
      sandbox.openEventModal = () => { calls.openEventModal++; };
      sandbox.addTask = async () => { calls.addTask++; };
      sandbox.addEvent = async () => { calls.addEvent++; };
      sandbox.iaThreadAddPending = () => ({ id: 'm1' });
      sandbox.iaThreadResolve = () => {};
      sandbox.esc = (s) => s;
      sandbox.currentView = 'inicio';
      sandbox.renderInicio = () => {};
      sandbox.renderCalendar = () => {};
      sandbox.todayStr = () => '2026-09-17';
      vm.createContext(sandbox);
      vm.runInContext(openSmartFormFromChatSrc + '\n' + runIAActionChatSrc + '\nthis.runIAActionChat = runIAActionChat;', sandbox, { filename: 'organizator.html (chat wiring)' });
      await sandbox.runIAActionChat('parcial de biología el jueves');
      check('16a. con intención válida, se abre el formulario (openEventModal llamado)', calls.openEventModal === 1);
      check('16b. AI-2.4 no crea directamente: addTask/addEvent NUNCA se llaman desde runIAActionChat en este turno', calls.addTask === 0 && calls.addEvent === 0);
      check('16c. tampoco se llama a AIActions.runIAAction (no hay una segunda vía de creación vía IA en el mismo turno)', calls.runIAAction === 0);
    }
  }

  // =====================================================================
  section('Regresión (17-20)');
  // =====================================================================
  {
    // 17) El flujo MANUAL (sin prefill, exactamente como al pulsar "Nueva
    // tarea"/"Nuevo evento" a mano) sigue funcionando igual que siempre.
    {
      const sb = makeFormSandbox();
      sb.openTaskModal({}); // sin prefill, como una apertura manual normal
      seedTaskDefaults(sb, { title: 'Comprar leche', dueDate: '2026-09-19' });
      await submitTaskForm(sb);
      check('17a. flujo manual de tarea (sin prefill) sigue creando con normalidad', sb.state.tasks.length === 1 && sb.state.tasks[0].title === 'Comprar leche');

      const sbE = makeFormSandbox();
      sbE.openEventModal({});
      seedEventDefaults(sbE, { title: 'Reunión de equipo', date: '2026-09-22', startTime: '10:00' });
      await submitEventForm(sbE);
      check('17b. flujo manual de evento (sin prefill) sigue creando con normalidad', sbE.state.events.length === 1 && sbE.state.events[0].title === 'Reunión de equipo');
    }

    function runSuite(relPath) {
      try {
        execFileSync(process.execPath, [path.join(ROOT, relPath)], { stdio: 'pipe' });
        return true;
      } catch (e) {
        console.log(String((e.stdout || '') + (e.stderr || e.message)));
        return false;
      }
    }
    check('18. js/test-ai-2-1-smart-form-intent.js sigue pasando', runSuite('js/test-ai-2-1-smart-form-intent.js'));
    check('19. js/test-ai-2-2-smart-form-prefill.js sigue pasando', runSuite('js/test-ai-2-2-smart-form-prefill.js'));
    check('20. js/test-ai-2-3-smart-form-open.js sigue pasando', runSuite('js/test-ai-2-3-smart-form-open.js'));
  }

  // =====================================================================
  section('node --check de js/ai-actions.js y organizator.html (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('C1. node --check de js/ai-actions.js pasa', true);
    } catch (e) {
      check('C1. node --check de js/ai-actions.js pasa', false);
      console.log(String(e.stderr || e.message));
    }
    {
      const startMarker = '\n<script>\n';
      const scriptStart = html.indexOf(startMarker);
      const scriptEnd = html.indexOf('\n</script>', scriptStart + startMarker.length);
      const scriptBlock = html.slice(scriptStart + startMarker.length, scriptEnd);
      const tmpPath = path.join(require('os').tmpdir(), `organizator-ai-2-4-check-${process.pid}.js`);
      fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
      try {
        execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
        check('C2. node --check del <script> principal de organizator.html pasa', true);
      } catch (e) {
        check('C2. node --check del <script> principal de organizator.html pasa', false);
        console.log(String(e.stderr || e.message));
      } finally {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
