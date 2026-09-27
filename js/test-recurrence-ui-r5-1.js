/**
 * ORGANIZATOR — Tests de R-5.1 (selector de días específicos de
 * recurrencia semanal, en TAREAS y EVENTOS)
 *
 * Suite Node pura, SIN navegador ni jsdom. Dos sandboxes, mismo patrón
 * que el resto del proyecto:
 *
 *  a) sandbox PURO (idéntico al que ya usa test-recurrence-ui-r5.js):
 *     DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST + esc + utilidades de fecha +
 *     saneamiento/recurrencia R-1..R-4 + RECURRENCIA UI R-5
 *     (recurrenceControlsHtml/readRecurrenceFromForm/sanitizeRecurrence),
 *     usando el `FormData` NATIVO de Node (misma API que
 *     `new FormData(formElement)` en el navegador) — para probar
 *     readRecurrenceFromForm() y el HTML generado como funciones puras,
 *     sin necesidad de un DOM real.
 *
 *  b) sandbox COMPLETO (mismo patrón que test-ai-2-regression.js/
 *     test-ai-2-9-smart-form-e2e.js): CRUD real + reminders Fase 1/3
 *     (para que openTaskModal/openEventModal no lancen al renderizar) +
 *     ambos modales de UX-8 reales, sobre un DOM mínimo pero funcional
 *     — con soporte real para VARIAS casillas marcadas a la vez bajo el
 *     mismo `name="repeatDaysOfWeek"` (una casilla por día, id
 *     "${prefix}-repeat-day-${i}", igual que el HTML real) — para
 *     probar el flujo end-to-end completo: abrir -> marcar/desmarcar
 *     días -> enviar -> addTask/updateTask/addEvent/updateEvent reales,
 *     incluida la validación nueva de R-5.1 (semanal sin ningún día
 *     marcado no se guarda).
 *
 * A propósito, esta suite NO toca Smart Forms/IA: no carga
 * ai-actions.js, no usa `prefill`, no llama a openSmartFormFromChat ni a
 * runIAActionChat — abre los modales exactamente como al pulsar "Nueva
 * tarea"/"Nuevo evento" o al editar una fila existente.
 *
 * Uso:  node js/test-recurrence-ui-r5-1.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// organizator.html se guarda con CRLF; se normaliza a LF solo para esta
// lectura en memoria (no se toca el archivo en disco) porque los
// marcadores de extractBetween de abajo usan '\n'.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Fragmentos REALES de organizator.html (mismos marcadores que ya usan
// test-recurrence-ui-r5.js / test-ai-2-regression.js / test-ai-2-9-*).
// ---------------------------------------------------------------------
const dowNamesSrc = extractBetween(html, 'const DOW_NAMES = ', '\n\n/* ==================================================================\n   AJUSTES', 'constantes DOW_NAMES/...');
const escSrc = extractBetween(html, 'function esc(s){', '\n}\n\n/* ==================================================================\n   FILAS DE TAREA', 'función esc') + '\n}';
const dateUtilsSrc = extractBetween(html, '/* ==================================================================\n   UTILIDADES DE FECHA', '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS', 'bloque UTILIDADES DE FECHA');
const weekHelpersSrc = extractBetween(html, 'function dowOfDate(dateStr){', '\nfunction weekGoForward(){', 'helpers dowOfDate/getWeekMonday');
const recurrenceSrc = extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'bloque SANEAMIENTO (incluye RECURRENCIA R-1/R-2/R-3/R-4)');
const recurrenceUiSrc = extractBetween(html, '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)', '\n\n/* ==================================================================\n   MODAL: TAREA', 'bloque RECURRENCIA UI (R-5, con R-5.1)');
const crudSrc = extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', 'bloque CRUD');
const remindersFase1Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', 'bloque RECORDATORIOS (Fase 1)');
const remindersFase3Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)', '\n\n/* ==================================================================\n   TOAST', 'bloque RECORDATORIOS (Fase 3)');
const modalCollapsibleSrc = extractBetween(html, 'function modalCollapsibleSection(id, label, contentHtml, open){', '\nfunction openTaskModal(', 'bloque UX-8 secciones desplegables');
const openTaskModalSrc = extractBetween(html, 'function openTaskModal({taskId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: MINUTOS REALES', 'función openTaskModal()');
const openEventModalSrc = extractBetween(html, 'function openEventModal({eventId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: HORARIO BLOQUEADO', 'función openEventModal()');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/* ==================================================================
   a) Sandbox PURO — FormData nativo de Node, sin DOM.
   ================================================================== */
function makePureSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.FormData = FormData; // FormData nativo (Node >= 18)
  vm.createContext(sandbox);
  vm.runInContext(dowNamesSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/...)' });
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1..R-4)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5/R-5.1)' });
  vm.runInContext(
    `this.sanitizeRecurrence = sanitizeRecurrence;
     this.recurrenceControlsHtml = recurrenceControlsHtml;
     this.readRecurrenceFromForm = readRecurrenceFromForm;`,
    sandbox, { filename: 'expose-pure' }
  );
  return sandbox;
}
function makeFormData(fields) {
  const fd = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach(v => fd.append(key, v));
    else if (value !== undefined && value !== null) fd.append(key, value);
  });
  return fd;
}

/* ==================================================================
   b) Sandbox COMPLETO — DOM mínimo pero funcional, con soporte real
   para varias casillas de "repeatDaysOfWeek" marcadas a la vez.
   ================================================================== */
function makeElementRegistry() {
  const byId = {}; const byName = {};
  function makeEl(id) {
    return { id: id || null, value: '', checked: false, disabled: false, style: {}, innerHTML: '', textContent: '', _listeners: {}, addEventListener(type, h) { (this._listeners[type] = this._listeners[type] || []).push(h); } };
  }
  function get(map, key) { if (!map[key]) map[key] = makeEl(key); return map[key]; }
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
async function fire(el, type, evt) { for (const h of (el._listeners[type] || [])) await h(evt || {}); }

const TODAY = '2026-09-17';

function makeFullSandbox(seedState) {
  const sandbox = {};
  sandbox.console = console;
  const registry = makeElementRegistry();
  const calls = { addTask: 0, updateTask: 0, addEvent: 0, updateEvent: 0, closeModal: 0, showToast: 0 };
  sandbox.__calls = calls;
  sandbox.__registry = registry;
  sandbox.__toasts = [];

  const initialState = Object.assign({ tasks: [], events: [], eventCategories: [], reminders: [], customSchedules: [] }, seedState || {});

  vm.createContext(sandbox);
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dowNamesSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/...)' });
  vm.runInContext(
    `let state = ${JSON.stringify(initialState)};
     let window = {};
     let currentView = 'test';
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     function todayStr(){ return '${TODAY}'; }
     async function saveTasks(){}
     async function saveEvents(){}
     async function saveReminders(){}
     function showToast(msg){ __calls.showToast++; __toasts.push(msg); }
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
     // FormData con soporte real de VARIAS casillas "repeatDaysOfWeek"
     // marcadas a la vez, una por día (mismo id que el HTML real:
     // "\${prefix}-repeat-day-\${i}") — el prefijo (task/event) se deriva
     // del propio formulario que se le pasa al constructor, igual que
     // "new FormData(e.target)" hace en el navegador.
     class FormData {
       constructor(target){ this.__prefix = (target && target.id === 'event-form') ? 'event' : 'task'; }
       get(name){ const el = __registry.byNameEl(name); if(!el) return null; if(el.__isCheckbox) return el.checked ? (el.__checkboxValue||'on') : null; return el.value; }
       getAll(name){
         if(name === 'repeatDaysOfWeek'){
           const days = [];
           for(let i=0;i<7;i++){
             const el = __registry.byIdEl(this.__prefix + '-repeat-day-' + i);
             if(el.checked) days.push(String(i));
           }
           return days;
         }
         const v = this.get(name);
         return v == null ? [] : [v];
       }
     }
     async function callAI(){ throw new Error('callAI no debería llamarse: fuera de alcance de R-5.1'); }
     function parseAIJSON(raw){ return raw; }`,
    sandbox, { filename: 'dom-stub' }
  );
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1..R-4)' });
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD real)' });
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5/R-5.1 real)' });
  vm.runInContext(modalCollapsibleSrc, sandbox, { filename: 'organizator.html (UX-8 modalCollapsibleSection)' });
  vm.runInContext(openTaskModalSrc, sandbox, { filename: 'organizator.html (openTaskModal real)' });
  vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal real)' });
  vm.runInContext(
    `this.openTaskModal = openTaskModal;
     this.openEventModal = openEventModal;
     this.state = state;
     this.modalBox = modalBox;
     this.closeModal = closeModal;
     const __realAddTask = addTask, __realUpdateTask = updateTask, __realAddEvent = addEvent, __realUpdateEvent = updateEvent, __realCloseModal = closeModal;
     addTask = async (...a) => { __calls.addTask++; return __realAddTask(...a); };
     updateTask = async (...a) => { __calls.updateTask++; return __realUpdateTask(...a); };
     addEvent = async (...a) => { __calls.addEvent++; return __realAddEvent(...a); };
     updateEvent = async (...a) => { __calls.updateEvent++; return __realUpdateEvent(...a); };
     closeModal = (...a) => { __calls.closeModal++; return __realCloseModal(...a); };`,
    sandbox, { filename: 'expose-and-spy' }
  );
  return sandbox;
}

/** Desmarca las 7 casillas de día de un prefijo dado, luego marca
 * exactamente las de `days` (array de números 0-6). */
function setDaysChecked(registry, prefix, days) {
  for (let i = 0; i < 7; i++) registry.byIdEl(`${prefix}-repeat-day-${i}`).checked = false;
  (days || []).forEach(d => { registry.byIdEl(`${prefix}-repeat-day-${d}`).checked = true; });
}
function seedTaskDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  ['title', 'dueDate', 'dueTime', 'category', 'estimatedMinutes', 'repeatEndDate', 'reminderMinutes'].forEach(n => set(n, ''));
  set('priority', 'media'); set('repeatType', 'none'); set('repeatEnd', 'never'); set('repeatInterval', '1');
  setDaysChecked(r, 'task', []);
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}
function seedEventDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  ['title', 'categoryId', 'date', 'endDate', 'startTime', 'endTime', 'repeatEndDate', 'reminderMinutes'].forEach(n => set(n, ''));
  set('repeatType', 'none'); set('repeatEnd', 'never'); set('repeatInterval', '1');
  const allDayEl = r.byNameEl('allDay'); allDayEl.__isCheckbox = true; allDayEl.__checkboxValue = 'on'; allDayEl.checked = false;
  setDaysChecked(r, 'event', []);
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}
async function submitTaskForm(sb) { await fire(sb.__registry.byIdEl('task-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('task-form') }); }
async function submitEventForm(sb) { await fire(sb.__registry.byIdEl('event-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('event-form') }); }

(async () => {
  const sb = makePureSandbox();

  // =====================================================================
  section('1) weekly con UN día seleccionado');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['3'], repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('1. daysOfWeek con el único día marcado (miércoles, índice 3)', JSON.stringify(raw.daysOfWeek) === JSON.stringify([3]));
    check('1b. sanitizeRecurrence conserva ese único día', JSON.stringify(sb.sanitizeRecurrence(raw).daysOfWeek) === JSON.stringify([3]));
  }

  // =====================================================================
  section('2) weekly con VARIOS días seleccionados');
  // =====================================================================
  {
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['1', '3', '5'], repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('2. daysOfWeek recoge los TRES días marcados (lunes, miércoles, viernes)', JSON.stringify(raw.daysOfWeek) === JSON.stringify([1, 3, 5]));
  }

  // =====================================================================
  section('3) weekly devuelve daysOfWeek SIN duplicados');
  // =====================================================================
  {
    // Simula un FormData con el mismo valor repetido (no debería ocurrir
    // con casillas reales, pero readRecurrenceFromForm debe ser robusto
    // de todos modos: la sección 3 del encargo lo pide explícitamente).
    const fd = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['2', '2', '4', '4', '4'], repeatEnd: 'never', repeatEndDate: '' });
    const raw = sb.readRecurrenceFromForm(fd, '2026-09-18');
    check('3. daysOfWeek deduplicado (solo aparecen 2 y 4 una vez cada uno)', JSON.stringify(raw.daysOfWeek) === JSON.stringify([2, 4]));
  }

  // =====================================================================
  section('4) orden determinista de daysOfWeek');
  // =====================================================================
  {
    const fdUnordered = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['5', '0', '3'], repeatEnd: 'never', repeatEndDate: '' });
    const rawUnordered = sb.readRecurrenceFromForm(fdUnordered, '2026-09-18');
    check('4a. el resultado sale ordenado ascendente (0,3,5) aunque las casillas se marcaran en otro orden', JSON.stringify(rawUnordered.daysOfWeek) === JSON.stringify([0, 3, 5]));

    const fdOrdered = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['0', '3', '5'], repeatEnd: 'never', repeatEndDate: '' });
    const rawOrdered = sb.readRecurrenceFromForm(fdOrdered, '2026-09-18');
    check('4b. el mismo CONJUNTO de días, en orden distinto de entrada, produce el mismo array final', JSON.stringify(rawUnordered.daysOfWeek) === JSON.stringify(rawOrdered.daysOfWeek));

    const fdRepeat = makeFormData({ repeatType: 'weekly', repeatInterval: '1', repeatDaysOfWeek: ['5', '0', '3'], repeatEnd: 'never', repeatEndDate: '' });
    const rawRepeat = sb.readRecurrenceFromForm(fdRepeat, '2026-09-18');
    check('4c. llamar dos veces con la misma entrada da siempre el mismo resultado (determinista)', JSON.stringify(rawUnordered.daysOfWeek) === JSON.stringify(rawRepeat.daysOfWeek));
  }

  // =====================================================================
  section('5) weekly SIN ningún día → inválido (no se guarda, se avisa)');
  // =====================================================================
  {
    // Tarea.
    const sbT = makeFullSandbox();
    sbT.openTaskModal({});
    seedTaskDefaults(sbT, { title: 'Entreno', dueDate: '2026-09-18', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' }); // ningún día marcado
    await submitTaskForm(sbT);
    check('5a. tarea: weekly sin días marcados NO crea nada', sbT.state.tasks.length === 0 && sbT.__calls.addTask === 0);
    check('5b. tarea: se avisa del error con el mecanismo existente (showToast)', sbT.__toasts.some(t => /d[ií]a/i.test(t)));

    // Evento.
    const sbE = makeFullSandbox();
    sbE.openEventModal({});
    seedEventDefaults(sbE, { title: 'Entreno', date: '2026-09-18', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' }); // ningún día marcado
    await submitEventForm(sbE);
    check('5c. evento: weekly sin días marcados NO crea nada', sbE.state.events.length === 0 && sbE.__calls.addEvent === 0);
    check('5d. evento: se avisa del error con el mecanismo existente (showToast)', sbE.__toasts.some(t => /d[ií]a/i.test(t)));

    // El modelo (R-1) sigue SIN tocar: sanitizeRecurrence, aislado, sigue
    // aceptando daysOfWeek vacío para weekly (la validación nueva es solo
    // del formulario, nunca del modelo).
    const stillValidAtModelLevel = sb.sanitizeRecurrence({ type: 'weekly', interval: 1, daysOfWeek: [], startDate: '2026-09-18', endDate: null });
    check('5e. sanitizeRecurrence (R-1) sigue sin tocar: weekly con daysOfWeek vacío sigue siendo válida a ESE nivel', stillValidAtModelLevel !== null && stillValidAtModelLevel.type === 'weekly');
  }

  // =====================================================================
  section('6) daily NO muestra el selector de días');
  // =====================================================================
  {
    const html6 = sb.recurrenceControlsHtml('task', { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-18', endDate: null });
    check('6. el grupo de días queda oculto para "daily"', /id="task-repeat-days-group" style="display:none;"/.test(html6));
  }

  // =====================================================================
  section('7) monthly NO muestra el selector de días');
  // =====================================================================
  {
    const html7 = sb.recurrenceControlsHtml('event', { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-09-18', endDate: null });
    check('7. el grupo de días queda oculto para "monthly"', /id="event-repeat-days-group" style="display:none;"/.test(html7));
  }

  // =====================================================================
  section('8) "none" (sin recurrencia) NO muestra el selector de días');
  // =====================================================================
  {
    const html8 = sb.recurrenceControlsHtml('task', null);
    check('8. el grupo de días queda oculto cuando no hay recurrencia', /id="task-repeat-days-group" style="display:none;"/.test(html8));
    check('8b. el detalle completo también queda oculto (no solo los días)', /id="task-repeat-detail" style="display:none;"/.test(html8));
  }

  // =====================================================================
  section('9) Editar weekly con UN día → aparece seleccionado');
  // =====================================================================
  {
    const html9 = sb.recurrenceControlsHtml('task', { type: 'weekly', interval: 1, daysOfWeek: [2], startDate: '2026-01-01', endDate: null });
    check('9a. el grupo de días es VISIBLE para "weekly"', !/id="task-repeat-days-group" style="display:none;"/.test(html9));
    check('9b. la casilla del día 2 (miércoles) aparece marcada', /id="task-repeat-day-2"[^>]*checked/.test(html9));
    // Ninguna otra casilla debe quedar marcada.
    const otherChecked = [0, 1, 3, 4, 5, 6].some(i => new RegExp(`id="task-repeat-day-${i}"[^>]*checked`).test(html9));
    check('9c. ninguna otra casilla queda marcada', !otherChecked);
  }

  // =====================================================================
  section('10) Editar weekly con VARIOS días → TODOS aparecen seleccionados');
  // =====================================================================
  {
    const html10 = sb.recurrenceControlsHtml('event', { type: 'weekly', interval: 1, daysOfWeek: [1, 3, 5], startDate: '2026-01-01', endDate: null });
    [1, 3, 5].forEach(i => check(`10a. la casilla del día ${i} aparece marcada`, new RegExp(`id="event-repeat-day-${i}"[^>]*checked`).test(html10)));
    [0, 2, 4, 6].forEach(i => check(`10b. la casilla del día ${i} NO aparece marcada`, !new RegExp(`id="event-repeat-day-${i}"[^>]*checked`).test(html10)));
  }

  // =====================================================================
  section('11) Guardar una edición SIN cambiar los días conserva daysOfWeek');
  // =====================================================================
  {
    const sbT = makeFullSandbox({ tasks: [{ id: 'edit-t1', title: 'Gimnasio', dueDate: '2026-09-18', dueTime: '', priority: 'media', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1, 3, 5], startDate: '2026-09-18', endDate: null } }] });
    sbT.openTaskModal({ taskId: 'edit-t1' });
    // El usuario no toca los días: se dejan exactamente como estaban.
    seedTaskDefaults(sbT, { title: 'Gimnasio', dueDate: '2026-09-18', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' });
    setDaysChecked(sbT.__registry, 'task', [1, 3, 5]);
    await submitTaskForm(sbT);
    check('11a. se actualiza (updateTask), no se duplica', sbT.__calls.updateTask === 1 && sbT.__calls.addTask === 0 && sbT.state.tasks.length === 1);
    check('11b. daysOfWeek se conserva exactamente igual ([1,3,5])', JSON.stringify(sbT.state.tasks[0].recurrence.daysOfWeek) === JSON.stringify([1, 3, 5]));

    const sbE = makeFullSandbox({ events: [{ id: 'edit-e1', title: 'Clase de yoga', date: '2026-09-18', startTime: '18:00', endTime: '', allDay: false, recurrence: { type: 'weekly', interval: 1, daysOfWeek: [2, 4], startDate: '2026-09-18', endDate: null } }] });
    sbE.openEventModal({ eventId: 'edit-e1' });
    seedEventDefaults(sbE, { title: 'Clase de yoga', date: '2026-09-18', startTime: '18:00', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' });
    setDaysChecked(sbE.__registry, 'event', [2, 4]);
    await submitEventForm(sbE);
    check('11c. igual para eventos: daysOfWeek se conserva exactamente igual ([2,4])', JSON.stringify(sbE.state.events[0].recurrence.daysOfWeek) === JSON.stringify([2, 4]));
  }

  // =====================================================================
  section('12) Cambiar los días actualiza correctamente daysOfWeek');
  // =====================================================================
  {
    const sbT = makeFullSandbox({ tasks: [{ id: 'edit-t2', title: 'Piano', dueDate: '2026-09-18', dueTime: '', priority: 'media', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1, 3, 5], startDate: '2026-09-18', endDate: null } }] });
    sbT.openTaskModal({ taskId: 'edit-t2' });
    seedTaskDefaults(sbT, { title: 'Piano', dueDate: '2026-09-18', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' });
    // El usuario quita el miércoles (3) y añade el sábado (6).
    setDaysChecked(sbT.__registry, 'task', [1, 5, 6]);
    await submitTaskForm(sbT);
    check('12. daysOfWeek refleja el cambio del usuario ([1,5,6], ya sin el 3)', JSON.stringify(sbT.state.tasks[0].recurrence.daysOfWeek) === JSON.stringify([1, 5, 6]));
  }

  // =====================================================================
  section('13) Tarea y evento usan el MISMO comportamiento');
  // =====================================================================
  {
    const sbT = makeFullSandbox();
    sbT.openTaskModal({});
    seedTaskDefaults(sbT, { title: 'Correr', dueDate: '2026-09-18', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' });
    setDaysChecked(sbT.__registry, 'task', [0, 6]);
    await submitTaskForm(sbT);

    const sbE = makeFullSandbox();
    sbE.openEventModal({});
    seedEventDefaults(sbE, { title: 'Correr', date: '2026-09-18', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' });
    setDaysChecked(sbE.__registry, 'event', [0, 6]);
    await submitEventForm(sbE);

    check('13. tarea y evento, con las mismas casillas marcadas, producen el mismo daysOfWeek', JSON.stringify(sbT.state.tasks[0].recurrence.daysOfWeek) === JSON.stringify(sbE.state.events[0].recurrence.daysOfWeek));
    check('13b. ambos tipos crean exactamente un elemento', sbT.state.tasks.length === 1 && sbE.state.events.length === 1);
  }

  // =====================================================================
  section('14) Recurrencia existente SIN daysOfWeek no rompe el modal');
  // =====================================================================
  {
    const sbT = makeFullSandbox({ tasks: [{ id: 'legacy-t1', title: 'Tarea antigua', dueDate: '2026-09-18', dueTime: '', priority: 'media', recurrence: { type: 'weekly', interval: 1, startDate: '2026-09-18', endDate: null } }] }); // sin daysOfWeek
    let threw = false;
    try { sbT.openTaskModal({ taskId: 'legacy-t1' }); } catch (e) { threw = true; }
    check('14a. abrir una tarea "weekly" sin daysOfWeek no lanza', threw === false);
    check('14b. el HTML se generó (el modal se abrió con normalidad)', sbT.modalBox.innerHTML.includes('repeat-days-group'));
    check('14c. ninguna casilla de día aparece marcada por error', ![0, 1, 2, 3, 4, 5, 6].some(i => new RegExp(`id="task-repeat-day-${i}"[^>]*checked`).test(sbT.modalBox.innerHTML)));
  }

  // =====================================================================
  section('15) Cambiar los días no modifica otros campos de recurrence ni del elemento');
  // =====================================================================
  {
    const sbT = makeFullSandbox({ tasks: [{ id: 'edit-t3', title: 'Idiomas', dueDate: '2026-09-18', dueTime: '', priority: 'alta', category: 'Estudio', recurrence: { type: 'weekly', interval: 2, daysOfWeek: [1, 3], startDate: '2026-09-18', endDate: '2026-12-31' } }] });
    sbT.openTaskModal({ taskId: 'edit-t3' });
    seedTaskDefaults(sbT, { title: 'Idiomas', dueDate: '2026-09-18', priority: 'alta', category: 'Estudio', repeatType: 'weekly', repeatInterval: '2', repeatEnd: 'until', repeatEndDate: '2026-12-31' });
    setDaysChecked(sbT.__registry, 'task', [2, 4]); // solo cambia los días
    await submitTaskForm(sbT);
    const rec = sbT.state.tasks[0].recurrence;
    check('15a. interval no se modifica al cambiar solo los días', rec.interval === 2);
    check('15b. startDate no se modifica', rec.startDate === '2026-09-18');
    check('15c. endDate no se modifica', rec.endDate === '2026-12-31');
    check('15d. type sigue siendo "weekly"', rec.type === 'weekly');
    check('15e. daysOfWeek SÍ refleja el cambio pedido ([2,4])', JSON.stringify(rec.daysOfWeek) === JSON.stringify([2, 4]));
    check('15f. otros campos de la tarea (prioridad, categoría) no se alteran', sbT.state.tasks[0].priority === 'alta' && sbT.state.tasks[0].category === 'Estudio');
  }

  // =====================================================================
  section('Regresión: daily/monthly/none siguen funcionando (validación nueva no los afecta)');
  // =====================================================================
  {
    const sbDaily = makeFullSandbox();
    sbDaily.openTaskModal({});
    seedTaskDefaults(sbDaily, { title: 'Ducharse', dueDate: '2026-09-18', repeatType: 'daily', repeatInterval: '1', repeatEnd: 'never' });
    await submitTaskForm(sbDaily);
    check('R1. "daily" sigue creando con normalidad (sin exigir ningún día)', sbDaily.state.tasks.length === 1 && sbDaily.state.tasks[0].recurrence.type === 'daily' && sbDaily.__calls.addTask === 1);

    const sbMonthly = makeFullSandbox();
    sbMonthly.openEventModal({});
    seedEventDefaults(sbMonthly, { title: 'Pago alquiler', date: '2026-09-18', repeatType: 'monthly', repeatInterval: '1', repeatEnd: 'never' });
    await submitEventForm(sbMonthly);
    check('R2. "monthly" sigue creando con normalidad (sin exigir ningún día)', sbMonthly.state.events.length === 1 && sbMonthly.state.events[0].recurrence.type === 'monthly' && sbMonthly.__calls.addEvent === 1);

    const sbNone = makeFullSandbox();
    sbNone.openTaskModal({});
    seedTaskDefaults(sbNone, { title: 'Comprar pan', dueDate: '2026-09-18' }); // repeatType: 'none' por defecto
    await submitTaskForm(sbNone);
    check('R3. "No repetir" sigue creando con recurrence: null', sbNone.state.tasks.length === 1 && sbNone.state.tasks[0].recurrence === null);

    // Cancelar una recurrencia semanal existente (volver a "No repetir")
    // sigue funcionando con normalidad.
    const sbCancelRec = makeFullSandbox({ tasks: [{ id: 'cancel-t1', title: 'Yoga', dueDate: '2026-09-18', dueTime: '', priority: 'media', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1, 3], startDate: '2026-09-18', endDate: null } }] });
    sbCancelRec.openTaskModal({ taskId: 'cancel-t1' });
    seedTaskDefaults(sbCancelRec, { title: 'Yoga', dueDate: '2026-09-18', repeatType: 'none' });
    await submitTaskForm(sbCancelRec);
    check('R4. cambiar de "weekly" a "No repetir" al editar borra la recurrencia (recurrence: null)', sbCancelRec.state.tasks[0].recurrence === null);

    // Campos históricos de una tarea/evento que YA tenía datos de antes de
    // R-5.1 (sin tocar por este cambio) se conservan al editar solo la
    // recurrencia.
    const sbHist = makeFullSandbox({ events: [{ id: 'hist-e1', title: 'Reunión semanal', date: '2026-09-18', startTime: '09:00', endTime: '10:00', allDay: false, categoryId: 'cat-1', recurrence: null }] });
    sbHist.openEventModal({ eventId: 'hist-e1' });
    seedEventDefaults(sbHist, { title: 'Reunión semanal', date: '2026-09-18', startTime: '09:00', endTime: '10:00', categoryId: 'cat-1', repeatType: 'weekly', repeatInterval: '1', repeatEnd: 'never' });
    setDaysChecked(sbHist.__registry, 'event', [0]);
    await submitEventForm(sbHist);
    check('R5. añadir recurrencia semanal a un evento existente conserva sus campos históricos (hora fin, categoría)', sbHist.state.events[0].endTime === '10:00' && sbHist.state.events[0].categoryId === 'cat-1');
  }

  // =====================================================================
  section('node --check de organizator.html (script principal, sintaxis válida)');
  // =====================================================================
  {
    const startMarker = '\n<script>\n';
    const scriptStart = html.indexOf(startMarker);
    const scriptEnd = html.indexOf('\n</script>', scriptStart + startMarker.length);
    const scriptBlock = html.slice(scriptStart + startMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-r5-1-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('C1. node --check del <script> principal de organizator.html pasa', true);
    } catch (e) {
      check('C1. node --check del <script> principal de organizator.html pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
