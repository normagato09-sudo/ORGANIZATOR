/**
 * ORGANIZATOR — Tests de AI-2.8 (protección contra duplicados en Smart
 * Forms)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que el resto de
 * la familia AI-2.x: extrae literalmente por CONTENIDO el bloque AI-2.8
 * (findExistingSmartFormEquivalent y sus helpers privados de
 * ai-actions.js) y lo ejecuta aislado en un sandbox `vm`, sin mocks: es
 * una función pura, no lee `state` real, no toca el DOM, no llama a
 * callAI/Scheduler/reminders/recurrence.
 *
 * También comprueba la integración real con el submit de
 * openTaskModal/openEventModal (organizator.html, UX-8/AI-2.4): mismo
 * DOM mínimo pero funcional que ya usa test-ai-2-4-smart-form-submit.js
 * (registro de elementos con `.value`/`.checked`/`.addEventListener`
 * reales + un `FormData` propio), pero con `AIActions.findExistingSmartFormEquivalent`
 * REAL cargado (no un stub) para comprobar que el submit de un Smart
 * Form no crea un segundo elemento equivalente, y que si el usuario
 * edita el formulario de manera que ya no coincide con lo existente, sí
 * se crea.
 *
 * Uso:  node js/test-ai-2-8-smart-form-duplicates.js
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
// Bloque AI-2.8 (findExistingSmartFormEquivalent + helpers privados),
// literal de ai-actions.js — vive justo antes de "Contexto con IDs".
// ---------------------------------------------------------------------
const duplicateGuardSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-2.8',
  '\n\n  /* ---------------- Contexto con IDs',
  'bloque AI-2.8 (protección contra duplicados)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado SOLO con el bloque puro AI-2.8 (sin `state` real, sin
 * DOM, sin callAI): si findExistingSmartFormEquivalent (o cualquier
 * helper del que depende) intentara tocar cualquiera de esos globals no
 * definidos, lanzaría un ReferenceError — no se define ningún stub a
 * propósito, así una violación de "no debe tocar state/DOM" se detecta
 * como un fallo de ejecución, no en silencio. */
function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    duplicateGuardSrc + `
    this.findExistingSmartFormEquivalent = findExistingSmartFormEquivalent;
    this.normalizeSmartFormTitle = normalizeSmartFormTitle;
    `,
    sandbox, { filename: 'ai-actions.js (AI-2.8, bloque puro)' }
  );
  return sandbox;
}

(async () => {
  const sb = makeSandbox();

  // =====================================================================
  section('1) Task idéntica a una existente → duplicado');
  // =====================================================================
  {
    const existing = { tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'task', title: 'Estudiar biología', date: '2026-09-18' }, existing);
    check('1. detecta la tarea existente como duplicado', r && r.id === 't1');
  }

  // =====================================================================
  section('2) Event idéntico a uno existente → duplicado');
  // =====================================================================
  {
    const existing = { tasks: [], events: [{ id: 'e1', title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00', allDay: false }] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'event', title: 'Parcial de biología', date: '2026-09-18', time: '17:00', allDay: false }, existing);
    check('2. detecta el evento existente como duplicado', r && r.id === 'e1');
  }

  // =====================================================================
  section('3) Mismo título, fecha diferente → NO duplicado');
  // =====================================================================
  {
    const existing = { tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'task', title: 'Estudiar biología', date: '2026-09-25' }, existing);
    check('3. fecha distinta → no es duplicado', r === null);
  }

  // =====================================================================
  section('4) Mismo título y fecha, hora diferente (ambas existen) → NO duplicado');
  // =====================================================================
  {
    const existing = { tasks: [], events: [{ id: 'e1', title: 'Reunión de equipo', date: '2026-09-20', startTime: '10:00', allDay: false }] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'event', title: 'Reunión de equipo', date: '2026-09-20', time: '11:00', allDay: false }, existing);
    check('4. hora distinta (ambas presentes) → no es duplicado', r === null);
  }

  // =====================================================================
  section('5) Task y event con mismo título/fecha → NO duplicado (tipos distintos)');
  // =====================================================================
  {
    const existing = { tasks: [{ id: 't1', title: 'Entrega proyecto', dueDate: '2026-09-20', dueTime: '' }], events: [] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'event', title: 'Entrega proyecto', date: '2026-09-20' }, existing);
    check('5. mismo título/fecha pero tipo distinto (task vs event) → no es duplicado', r === null);
  }

  // =====================================================================
  section('6) Diferencias de mayúsculas/minúsculas en el título → duplicado');
  // =====================================================================
  {
    const existing = { tasks: [{ id: 't1', title: 'Estudiar Biología', dueDate: '2026-09-18', dueTime: '' }], events: [] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'task', title: 'estudiar biología', date: '2026-09-18' }, existing);
    check('6. mayúsculas/minúsculas distintas → sigue siendo duplicado', r && r.id === 't1');
  }

  // =====================================================================
  section('7) Espacios repetidos / al principio / al final → duplicado');
  // =====================================================================
  {
    const existing = { tasks: [{ id: 't1', title: 'Estudiar   biología', dueDate: '2026-09-18', dueTime: '' }], events: [] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'task', title: '  Estudiar biología  ', date: '2026-09-18' }, existing);
    check('7. espacios repetidos/al borde → sigue siendo duplicado', r && r.id === 't1');
  }

  // =====================================================================
  section('8) Título diferente → NO duplicado');
  // =====================================================================
  {
    const existing = { tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'task', title: 'Estudiar química', date: '2026-09-18' }, existing);
    check('8. título realmente distinto → no es duplicado', r === null);
  }

  // =====================================================================
  section('9) Evento allDay equivalente → duplicado');
  // =====================================================================
  {
    const existing = { tasks: [], events: [{ id: 'e1', title: 'Festivo', date: '2026-10-12', startTime: '', allDay: true }] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'event', title: 'Festivo', date: '2026-10-12', allDay: true }, existing);
    check('9. dos eventos allDay equivalentes → duplicado', r && r.id === 'e1');
  }

  // =====================================================================
  section('10) Evento allDay frente a evento con hora → NO duplicado');
  // =====================================================================
  {
    const existing = { tasks: [], events: [{ id: 'e1', title: 'Cumpleaños de Ana', date: '2026-10-12', startTime: '', allDay: true }] };
    const r = sb.findExistingSmartFormEquivalent({ type: 'event', title: 'Cumpleaños de Ana', date: '2026-10-12', time: '18:00', allDay: false }, existing);
    check('10. allDay vs con hora (mismo título/fecha) → no es duplicado', r === null);
  }

  // =====================================================================
  section('11) Segundo procesamiento del mismo Smart Form no crea otro elemento equivalente');
  // =====================================================================
  {
    // Simula el escenario del encargo: el mismo mensaje de usuario genera
    // el mismo Smart Form dos veces. La primera vez, `existing` todavía
    // no tiene el elemento (se crea con normalidad). La segunda vez,
    // `existing` YA lo tiene (el usuario ya lo guardó la primera vez) —
    // el mismo candidato normalizado ahora sí encuentra el duplicado.
    const candidate = { type: 'task', title: 'Estudiar biología', date: '2026-09-18' };
    const beforeFirstSave = { tasks: [], events: [] };
    const firstRun = sb.findExistingSmartFormEquivalent(candidate, beforeFirstSave);
    check('11a. primera vez (nada guardado aún) → no es duplicado, puede crearse', firstRun === null);
    const afterFirstSave = { tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [] };
    const secondRun = sb.findExistingSmartFormEquivalent(candidate, afterFirstSave);
    check('11b. segunda vez (ya guardado) → se detecta como duplicado, no debe crear otro', secondRun && secondRun.id === 't1');
  }

  // =====================================================================
  section('12-14) El contenido del formulario manda: editar título/fecha/hora permite crear');
  // =====================================================================
  {
    const existing = { tasks: [], events: [{ id: 'e1', title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00', allDay: false }] };
    const originalCandidate = { type: 'event', title: 'Parcial de biología', date: '2026-09-18', time: '17:00', allDay: false };
    check('12a. sin editar, coincide con lo existente (control)', sb.findExistingSmartFormEquivalent(originalCandidate, existing) !== null);

    const editedTitle = Object.assign({}, originalCandidate, { title: 'Parcial de química' });
    check('12b. el usuario edita el TÍTULO → ya no coincide, puede crearse', sb.findExistingSmartFormEquivalent(editedTitle, existing) === null);

    const editedDate = Object.assign({}, originalCandidate, { date: '2026-09-25' });
    check('13. el usuario edita la FECHA → ya no coincide, puede crearse', sb.findExistingSmartFormEquivalent(editedDate, existing) === null);

    const editedTime = Object.assign({}, originalCandidate, { time: '18:00' });
    check('14. el usuario edita la HORA → ya no coincide, puede crearse', sb.findExistingSmartFormEquivalent(editedTime, existing) === null);
  }

  // =====================================================================
  section('15) Elemento inexistente (listas vacías) → NO duplicado');
  // =====================================================================
  {
    const r1 = sb.findExistingSmartFormEquivalent({ type: 'task', title: 'Cualquier cosa', date: '2026-09-18' }, { tasks: [], events: [] });
    check('15a. sin tareas/eventos existentes → nunca es duplicado', r1 === null);
    const r2 = sb.findExistingSmartFormEquivalent({ type: 'event', title: 'Cualquier cosa', date: '2026-09-18' }, {});
    check('15b. `existing` sin tasks/events definidos tampoco lanza y devuelve null', r2 === null);
  }

  // =====================================================================
  section('16) No modifica ningún task/event existente durante la comprobación');
  // =====================================================================
  {
    const taskItem = { id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' };
    const eventItem = { id: 'e1', title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00', allDay: false };
    const existing = { tasks: [taskItem], events: [eventItem] };
    const beforeTask = JSON.stringify(taskItem);
    const beforeEvent = JSON.stringify(eventItem);
    sb.findExistingSmartFormEquivalent({ type: 'task', title: 'Estudiar biología', date: '2026-09-18' }, existing);
    sb.findExistingSmartFormEquivalent({ type: 'event', title: 'Parcial de biología', date: '2026-09-18', time: '17:00', allDay: false }, existing);
    check('16. ni la tarea ni el evento existentes cambian tras la comprobación', JSON.stringify(taskItem) === beforeTask && JSON.stringify(eventItem) === beforeEvent);
  }

  // =====================================================================
  section('17) No depende del orden de los arrays');
  // =====================================================================
  {
    const a = { id: 'a', title: 'Comprar leche', dueDate: '2026-09-19', dueTime: '' };
    const b = { id: 'b', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' };
    const c = { id: 'c', title: 'Llamar al médico', dueDate: '2026-09-20', dueTime: '' };
    const order1 = { tasks: [a, b, c], events: [] };
    const order2 = { tasks: [c, a, b], events: [] };
    const order3 = { tasks: [b, c, a], events: [] };
    const candidate = { type: 'task', title: 'Estudiar biología', date: '2026-09-18' };
    const r1 = sb.findExistingSmartFormEquivalent(candidate, order1);
    const r2 = sb.findExistingSmartFormEquivalent(candidate, order2);
    const r3 = sb.findExistingSmartFormEquivalent(candidate, order3);
    check('17. el resultado (encuentra "b") es el mismo sin importar el orden del array', r1 && r1.id === 'b' && r2 && r2.id === 'b' && r3 && r3.id === 'b');
  }

  // =====================================================================
  section('18) Resultado siempre determinista (misma entrada -> mismo resultado)');
  // =====================================================================
  {
    const existing = { tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [] };
    const candidate = { type: 'task', title: 'Estudiar biología', date: '2026-09-18' };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(sb.findExistingSmartFormEquivalent(candidate, existing));
    check('18. cinco llamadas idénticas devuelven siempre el mismo elemento', results.every(r => r && r.id === 't1'));
    const noMatch = sb.findExistingSmartFormEquivalent({ type: 'task', title: 'Otra cosa', date: '2026-09-18' }, existing);
    const noMatch2 = sb.findExistingSmartFormEquivalent({ type: 'task', title: 'Otra cosa', date: '2026-09-18' }, existing);
    check('18b. dos llamadas idénticas sin match devuelven ambas null', noMatch === null && noMatch2 === null);
  }

  // =====================================================================
  section('19) Aislamiento: no lee `state`/DOM/callAI reales (bloque puro)');
  // =====================================================================
  {
    let threw = false;
    try {
      sb.findExistingSmartFormEquivalent({ type: 'task', title: 'x', date: '2026-09-18' }, { tasks: [{ title: 'x', dueDate: '2026-09-18' }], events: [] });
    } catch (e) { threw = true; }
    check('19. no lanza ReferenceError (no depende de `state`/`document`/`callAI`, no definidos en este sandbox)', threw === false);
  }

  // =====================================================================
  section('20) Normalización de título tolera whitespace variado sin cambiar el significado');
  // =====================================================================
  {
    check('20a. tabs/saltos de línea se colapsan igual que espacios', sb.normalizeSmartFormTitle('Estudiar\t\nbiología') === sb.normalizeSmartFormTitle('Estudiar biología'));
    check('20b. no elimina palabras ni cambia el contenido semántico', sb.normalizeSmartFormTitle('Examen de biología') === 'examen de biología');
  }

  // =====================================================================
  section('Integración real con el submit de openTaskModal/openEventModal (UX-8/AI-2.4)');
  // =====================================================================
  {
    // Mismo patrón EXACTO que test-ai-2-4-smart-form-submit.js: extrae
    // literalmente el flujo real de creación (CRUD + reminders +
    // recurrencia + ambos modales de UX-8) sobre un DOM mínimo pero
    // funcional, pero aquí con AIActions.findExistingSmartFormEquivalent
    // REAL cargado (no un stub) para comprobar la integración de AI-2.8.
    const escSrc = extractBetween(html, 'function esc(s){', '\n\n/* ==================================================================\n   FILAS DE TAREA', 'función esc()');
    const dowConstsSrc = extractBetween(html, 'const DOW_NAMES = ', '\n\n/* ==================================================================\n   AJUSTES', 'constantes DOW_NAMES/...');
    const sanitizeSrc = extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'bloque SANEAMIENTO (incluye sanitizeRecurrence, R-1)');
    const crudSrc = extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', 'bloque CRUD');
    const remindersFase1Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', 'bloque RECORDATORIOS (Fase 1)');
    const remindersFase3Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)', '\n\n/* ==================================================================\n   TOAST', 'bloque RECORDATORIOS (Fase 3, integración UI)');
    const recurrenceUiSrc = extractBetween(html, '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)', '\n\n/* ==================================================================\n   MODAL: TAREA', 'bloque RECURRENCIA — UI compartida (Fase R-5)');
    const modalCollapsibleSrc = extractBetween(html, 'function modalCollapsibleSection(id, label, contentHtml, open){', '\nfunction openTaskModal(', 'bloque UX-8 secciones desplegables');
    const openTaskModalSrc = extractBetween(html, 'function openTaskModal({taskId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: MINUTOS REALES', 'función openTaskModal()');
    const openEventModalSrc = extractBetween(html, 'function openEventModal({eventId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: HORARIO BLOQUEADO', 'función openEventModal()');

    function makeElementRegistry() {
      const byId = {};
      const byName = {};
      function makeEl() {
        return {
          value: '', checked: false, disabled: false, style: {}, innerHTML: '', textContent: '',
          _listeners: {},
          addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); },
        };
      }
      function get(map, key) { if (!map[key]) map[key] = makeEl(); return map[key]; }
      return {
        byIdEl(id) { return get(byId, id); },
        byNameEl(name) { return get(byName, name); },
        querySelector(sel) {
          let m;
          if ((m = /^#([\w-]+)$/.exec(sel))) return get(byId, m[1]);
          if ((m = /^\[name="([^"]+)"\]$/.exec(sel))) return get(byName, m[1]);
          return makeEl();
        },
        querySelectorAll() { return { forEach() {} }; },
      };
    }
    async function fire(el, type, evt) {
      for (const h of (el._listeners[type] || [])) await h(evt || {});
    }

    function makeFormSandbox(seedState) {
      const sandbox = {};
      sandbox.console = console;
      const registry = makeElementRegistry();
      const calls = { addTask: 0, addEvent: 0, closeModal: 0, showToast: 0 };
      sandbox.__calls = calls;
      sandbox.__registry = registry;
      sandbox.__toasts = [];

      vm.createContext(sandbox);
      vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
      vm.runInContext(dowConstsSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/...)' });
      vm.runInContext(
        `let state = ${JSON.stringify(seedState)};
         let window = {};
         let currentView = 'test';
         function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
         async function saveTasks(){}
         async function saveEvents(){}
         async function saveReminders(){}
         function showToast(msg){ __toasts.push(msg); }
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
      vm.runInContext(sanitizeSrc, sandbox, { filename: 'organizator.html (saneamiento + sanitizeRecurrence, R-1)' });
      vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD real)' });
      vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
      vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3, syncReminderForTarget real)' });
      vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5, readRecurrenceFromForm real)' });
      vm.runInContext(modalCollapsibleSrc, sandbox, { filename: 'organizator.html (UX-8 modalCollapsibleSection)' });
      vm.runInContext(openTaskModalSrc, sandbox, { filename: 'organizator.html (openTaskModal real)' });
      vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal real)' });
      // AI-2.8: AIActions REAL (mismo bloque puro que el resto de esta
      // suite ya probó por separado más arriba), expuesto tal como lo
      // expone ai-actions.js de verdad (global.AIActions.findExistingSmartFormEquivalent).
      vm.runInContext(
        duplicateGuardSrc + `
        this.AIActions = { findExistingSmartFormEquivalent: findExistingSmartFormEquivalent };
        `,
        sandbox, { filename: 'ai-actions.js (AI-2.8 real, expuesto como AIActions)' }
      );
      vm.runInContext(
        `this.openTaskModal = openTaskModal;
         this.openEventModal = openEventModal;
         this.state = state;
         this.closeModal = closeModal;
         const __realAddTask = addTask, __realAddEvent = addEvent, __realShowToast = showToast, __realCloseModal = closeModal;
         addTask = async (...a) => { __calls.addTask++; return __realAddTask(...a); };
         addEvent = async (...a) => { __calls.addEvent++; return __realAddEvent(...a); };
         showToast = (...a) => { __calls.showToast++; return __realShowToast(...a); };
         closeModal = (...a) => { __calls.closeModal++; return __realCloseModal(...a); };`,
        sandbox, { filename: 'expose-and-spy' }
      );
      return sandbox;
    }

    function seedTaskDefaults(sb, overrides) {
      const r = sb.__registry;
      const set = (name, value) => { r.byNameEl(name).value = value; };
      set('title', ''); set('dueDate', ''); set('dueTime', ''); set('priority', 'media');
      set('category', ''); set('estimatedMinutes', '');
      set('repeatType', 'none'); set('repeatEnd', 'never'); set('repeatEndDate', ''); set('reminderMinutes', '');
      Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
    }
    function seedEventDefaults(sb, overrides) {
      const r = sb.__registry;
      const set = (name, value) => { r.byNameEl(name).value = value; };
      set('title', ''); set('categoryId', ''); set('date', ''); set('endDate', '');
      const allDayEl = r.byNameEl('allDay'); allDayEl.__isCheckbox = true; allDayEl.__checkboxValue = 'on'; allDayEl.checked = false;
      set('startTime', ''); set('endTime', '');
      set('repeatType', 'none'); set('repeatEnd', 'never'); set('repeatEndDate', ''); set('reminderMinutes', '');
      Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
    }
    async function submitTaskForm(sb) { await fire(sb.__registry.byIdEl('task-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('task-form') }); }
    async function submitEventForm(sb) { await fire(sb.__registry.byIdEl('event-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('event-form') }); }

    // --- I1: Smart Form de tarea con un duplicado ya existente: el submit
    //     NO crea una segunda tarea, y avisa mediante showToast.
    {
      const sb = makeFormSandbox({ tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openTaskModal({ prefill: { title: 'Estudiar biología', date: '2026-09-18' } });
      seedTaskDefaults(sb, { title: 'Estudiar biología', dueDate: '2026-09-18' });
      await submitTaskForm(sb);
      check('I1a. el submit de un Smart Form de tarea duplicado NO crea una segunda tarea', sb.state.tasks.length === 1 && sb.__calls.addTask === 0);
      check('I1b. se informa del duplicado (showToast llamado)', sb.__calls.showToast === 1 && sb.__toasts.length === 1);
    }

    // --- I2: Smart Form de evento con un duplicado ya existente: el
    //     submit NO crea un segundo evento.
    {
      const sb = makeFormSandbox({ tasks: [], events: [{ id: 'e1', title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00', allDay: false }], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openEventModal({ prefill: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
      seedEventDefaults(sb, { title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00' });
      await submitEventForm(sb);
      check('I2a. el submit de un Smart Form de evento duplicado NO crea un segundo evento', sb.state.events.length === 1 && sb.__calls.addEvent === 0);
      check('I2b. se informa del duplicado (showToast llamado)', sb.__calls.showToast === 1);
    }

    // --- I3: el usuario EDITA el título en el formulario antes de guardar
    //     → ya no coincide con lo existente → SÍ se crea (fuente de
    //     verdad = lo que hay en el formulario, sección 8 del encargo).
    {
      const sb = makeFormSandbox({ tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openTaskModal({ prefill: { title: 'Estudiar biología', date: '2026-09-18' } });
      seedTaskDefaults(sb, { title: 'Estudiar química', dueDate: '2026-09-18' }); // usuario edita el título
      await submitTaskForm(sb);
      check('I3. título editado (ya no coincide) → SÍ se crea la nueva tarea', sb.state.tasks.length === 2 && sb.__calls.addTask === 1);
    }

    // --- I4: el usuario EDITA la fecha → ya no coincide → SÍ se crea.
    {
      const sb = makeFormSandbox({ tasks: [], events: [{ id: 'e1', title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00', allDay: false }], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openEventModal({ prefill: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
      seedEventDefaults(sb, { title: 'Parcial de biología', date: '2026-09-25', startTime: '17:00' }); // usuario edita la fecha
      await submitEventForm(sb);
      check('I4. fecha editada (ya no coincide) → SÍ se crea el nuevo evento', sb.state.events.length === 2 && sb.__calls.addEvent === 1);
    }

    // --- I5: el usuario EDITA la hora → ya no coincide → SÍ se crea.
    {
      const sb = makeFormSandbox({ tasks: [], events: [{ id: 'e1', title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00', allDay: false }], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openEventModal({ prefill: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
      seedEventDefaults(sb, { title: 'Parcial de biología', date: '2026-09-18', startTime: '19:00' }); // usuario edita la hora
      await submitEventForm(sb);
      check('I5. hora editada (ya no coincide) → SÍ se crea el nuevo evento', sb.state.events.length === 2 && sb.__calls.addEvent === 1);
    }

    // --- I6: apertura del formulario (AI-2.3) sigue intacta: abrir con
    //     prefill duplicado no crea nada por sí solo (nunca se crea al
    //     abrir, solo al enviar) — la protección no rompe la apertura.
    {
      const sb = makeFormSandbox({ tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '' }], events: [], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openTaskModal({ prefill: { title: 'Estudiar biología', date: '2026-09-18' } });
      check('I6. abrir el formulario (sin enviar) no crea ni bloquea nada por sí solo', sb.state.tasks.length === 1 && sb.__calls.addTask === 0 && sb.__calls.showToast === 0);
    }

    // --- I7: flujo MANUAL (sin prefill) con un item idéntico ya existente
    //     sigue creando con normalidad — AI-2.8 está fuera de alcance del
    //     "envío normal" manual (sección 7 del encargo).
    {
      const sb = makeFormSandbox({ tasks: [{ id: 't1', title: 'Comprar leche', dueDate: '2026-09-19', dueTime: '' }], events: [], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openTaskModal({}); // sin prefill: apertura manual normal, como pulsar "Nueva tarea"
      seedTaskDefaults(sb, { title: 'Comprar leche', dueDate: '2026-09-19' });
      await submitTaskForm(sb);
      check('I7. el flujo manual (sin prefill) NO se ve afectado por AI-2.8 y sigue creando con normalidad', sb.state.tasks.length === 2 && sb.__calls.addTask === 1);
    }

    // --- I8: edición de un elemento EXISTENTE (taskId dado) tampoco se ve
    //     afectada por AI-2.8 (smartFormOrigin es siempre false al editar).
    {
      const sb = makeFormSandbox({ tasks: [{ id: 't1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '', priority: 'media' }], events: [], eventCategories: [], reminders: [], customSchedules: [] });
      sb.openTaskModal({ taskId: 't1', prefill: { title: 'Estudiar biología', date: '2026-09-18' } }); // prefill se ignora al editar, igual que siempre
      seedTaskDefaults(sb, { title: 'Estudiar biología', dueDate: '2026-09-18', priority: 'alta' });
      await submitTaskForm(sb);
      check('I8. editar un elemento existente sigue funcionando con normalidad (no se bloquea, no se duplica)', sb.state.tasks.length === 1 && sb.state.tasks[0].priority === 'alta' && sb.__calls.addTask === 0);
    }
  }

  // NOTA: la regresión cruzada con el resto de la suite AI-2.x
  // (test-ai-2-1 .. test-ai-2-7) y con AI-1.x se ejecuta como comandos
  // SEPARADOS (ver encargo original), no encadenada aquí dentro: varios
  // de esos archivos (test-ai-2-3, test-ai-2-6, test-ai-2-7) ya tienen su
  // propia sección de regresión que relanza subprocesos de toda la
  // suite — encadenarlos también desde aquí multiplicaba el árbol de
  // subprocesos anidados hasta hacer la ejecución de este archivo
  // impracticablemente lenta (varios minutos) sin aportar cobertura
  // nueva sobre AI-2.8 (los tests 1-20 + I1-I8 de arriba ya cubren el
  // alcance completo del encargo).

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
      const tmpPath = path.join(require('os').tmpdir(), `organizator-ai-2-8-check-${process.pid}.js`);
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
