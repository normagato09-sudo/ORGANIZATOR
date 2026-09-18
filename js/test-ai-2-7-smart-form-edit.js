/**
 * ORGANIZATOR — Tests de AI-2.7 (edición segura del prefill por el
 * usuario: el Smart Form es la fuente de verdad desde que se abre)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que
 * test-ai-2-4-smart-form-submit.js (del que hereda el enfoque, sin
 * importarlo — cada suite de esta familia es autocontenida): se
 * construye un DOM mínimo pero FUNCIONAL (registro de elementos con
 * `.value`/`.checked`/`.addEventListener` reales y un `FormData` propio
 * que lee de ese registro) y se ejecuta sobre él el código REAL de
 * organizator.html (openTaskModal/openEventModal de UX-8, el CRUD real
 * de R-1, recordatorios Fase 1/3, recurrencia R-5) — nada de esto se
 * reimplementa.
 *
 * Diferencia clave frente a test-ai-2-4: aquí el registro de elementos
 * se RESETEA cada vez que algo asigna `modalBox.innerHTML` (igual que en
 * un navegador real: sustituir innerHTML destruye los nodos hijos
 * anteriores y sus listeners) — necesario para probar honestamente el
 * caso "reabrir el formulario no reutiliza el DOM/los listeners de la
 * apertura anterior" (sección 8 del encargo AI-2.7). El resto de la
 * infraestructura (registro de elementos, FormData propio, fire()) es
 * el mismo patrón ya usado por test-ai-2-4.
 *
 * AI-2.7 NO modifica ningún código de producción: el objetivo de esta
 * fase es COMPROBAR (no crear) que, desde que se abre un Smart Form, es
 * el formulario — no `intent.fields` ni `prefill` — la fuente de verdad,
 * y que el submit sigue usando exclusivamente FormData del formulario
 * real en el momento de guardar.
 *
 * Uso:  node js/test-ai-2-7-smart-form-edit.js
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
// Fragmentos REALES de organizator.html — nada de esto se reimplementa,
// solo se extrae literalmente y se ejecuta tal cual (mismo patrón que el
// resto de la familia AI-1.x/AI-2.x).
// ---------------------------------------------------------------------
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
const openSmartFormFromChatSrc = extractBetween(html, 'function openSmartFormFromChat(intent){', '\n\n/* ---------- AI-2.6', 'función openSmartFormFromChat() (AI-2.3)');
const runIAActionChatSrc = extractBetween(html, '/* ---------- AI-2.6: aclaraciones pendientes del chat', '\n\n/* ---------- Wiring inicial del bloque IA', 'bloque AI-2.6 + función runIAActionChat()');

// AI-2.2 real (buildSmartFormPrefill), para el check de integridad 24
// (el contrato de AI-2.2 no cambia con AI-2.7).
const smartFormSrc = extractBetween(
  aiActionsSrc,
  '/* ==================================================================\n     AI-2.1',
  '\n\n  /* ==================================================================\n     AI-2.6',
  'bloque AI-2.1+AI-2.2 (detección + normalización del prefill)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Registro de elementos mínimo pero FUNCIONAL (mismo patrón que
 * test-ai-2-4-smart-form-submit.js), con un añadido: `reset()` vacía los
 * mapas byId/byName — se invoca desde el setter de `modalBox.innerHTML`
 * (ver dom-stub más abajo) para reproducir el comportamiento real de un
 * navegador: reasignar innerHTML destruye los nodos hijos anteriores (y
 * sus listeners), así que una reapertura del modal nunca puede heredar
 * por accidente el elemento/los listeners de la apertura previa. */
function makeElementRegistry() {
  let byId = {};
  let byName = {};
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
    reset() { byId = {}; byName = {}; },
    querySelector(sel) {
      let m;
      if ((m = /^#([\w-]+)$/.exec(sel))) return get(byId, m[1]);
      if ((m = /^\[name="([^"]+)"\]$/.exec(sel))) return get(byName, m[1]);
      return makeEl();
    },
    querySelectorAll() { return { forEach() {} }; },
  };
}

/** Dispara todos los listeners de `type` registrados en `el`. */
async function fire(el, type, evt) {
  for (const h of (el._listeners[type] || [])) await h(evt || {});
}

/** Sandbox con el flujo REAL de creación (CRUD + reminders + recurrencia
 * + ambos modales de UX-8) sobre un DOM mínimo pero funcional, con
 * reset-on-innerHTML (ver makeElementRegistry). `state` es un objeto
 * real que se puede inspeccionar en cualquier momento. */
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
       // Reproduce el comportamiento real de innerHTML: sustituirlo
       // "destruye" los nodos hijos anteriores (aquí, vacía el registro
       // de elementos) antes de que el código real vuelva a poblarlo con
       // los nuevos querySelector/getElementById de este render.
       set innerHTML(v){ __registry.reset(); this._html = v; },
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
  vm.runInContext(
    `this.openTaskModal = openTaskModal;
     this.openEventModal = openEventModal;
     this.state = state;
     this.closeModal = closeModal;
     this.modalBox = modalBox;
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
  section('EVENTO (1-3): se abre con los valores iniciales del prefill (contenido HTML renderizado)');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openEventModal({ prefill: { type: 'event', title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
    const out = sb.modalBox.innerHTML;
    check('1. se abre con prefill de título', /name="title" required value="Parcial de biología"/.test(out));
    check('2. se abre con prefill de fecha', /name="date" required value="2026-09-18"/.test(out));
    check('3. se abre con prefill de hora', /name="startTime" value="17:00"/.test(out));
  }

  // =====================================================================
  section('EVENTO (4-9): el usuario edita título/fecha/hora y el submit usa SUS valores, nunca los del prefill');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openEventModal({ prefill: { type: 'event', title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
    // Simula que el navegador ya pintó el prefill (contenido ya
    // verificado arriba) y que el usuario edita varios campos a la vez,
    // dejando la fecha tal como la propuso la IA (mismo escenario que el
    // ejemplo de la sección 3 del encargo).
    seedEventDefaults(sb, { title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00' });
    sb.__registry.byNameEl('title').value = 'Parcial de biología — FINAL';
    check('4. el usuario cambia el título', sb.__registry.byNameEl('title').value === 'Parcial de biología — FINAL');
    sb.__registry.byNameEl('date').value = '2026-09-19';
    check('5. el usuario cambia la fecha', sb.__registry.byNameEl('date').value === '2026-09-19');
    sb.__registry.byNameEl('startTime').value = '18:00';
    check('6. el usuario cambia la hora', sb.__registry.byNameEl('startTime').value === '18:00');
    await submitEventForm(sb);
    check('7. el submit utiliza los valores MODIFICADOS (título, fecha y hora nuevos)',
      sb.state.events.length === 1 &&
      sb.state.events[0].title === 'Parcial de biología — FINAL' &&
      sb.state.events[0].date === '2026-09-19' &&
      sb.state.events[0].startTime === '18:00');
    check('8. se crea exactamente UN evento', sb.state.events.length === 1);
    check('9. los valores ORIGINALES del prefill no sobrescriben los nuevos (ni el título ni la hora propuestos por la IA quedan guardados)',
      sb.state.events[0].title !== 'Parcial de biología' && sb.state.events[0].startTime !== '17:00');
  }

  // =====================================================================
  section('TAREA (10): se abre con los valores iniciales del prefill');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openTaskModal({ prefill: { type: 'task', title: 'Estudiar biología', date: '2026-09-18', time: '17:00' } });
    const out = sb.modalBox.innerHTML;
    check('10a. se abre con prefill de título', /name="title" required value="Estudiar biología"/.test(out));
    check('10b. se abre con prefill de fecha', /name="dueDate" value="2026-09-18"/.test(out));
    check('10c. se abre con prefill de hora', /name="dueTime" value="17:00"/.test(out));
  }

  // =====================================================================
  section('TAREA (11-16): el usuario edita título/fecha/hora/prioridad y el submit usa SUS valores');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openTaskModal({ prefill: { type: 'task', title: 'Estudiar biología', date: '2026-09-18', time: '17:00' } });
    seedTaskDefaults(sb, { title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '17:00', priority: 'media' });
    sb.__registry.byNameEl('title').value = 'Estudiar biología — capítulo 4';
    check('11. el usuario cambia el título', sb.__registry.byNameEl('title').value === 'Estudiar biología — capítulo 4');
    sb.__registry.byNameEl('dueDate').value = '2026-09-20';
    check('12. el usuario cambia la fecha', sb.__registry.byNameEl('dueDate').value === '2026-09-20');
    sb.__registry.byNameEl('dueTime').value = '19:30';
    check('13. el usuario cambia la hora', sb.__registry.byNameEl('dueTime').value === '19:30');
    sb.__registry.byNameEl('priority').value = 'alta';
    check('14. el usuario cambia la prioridad', sb.__registry.byNameEl('priority').value === 'alta');
    await submitTaskForm(sb);
    check('15. el submit utiliza los valores MODIFICADOS (título, fecha, hora y prioridad nuevos)',
      sb.state.tasks.length === 1 &&
      sb.state.tasks[0].title === 'Estudiar biología — capítulo 4' &&
      sb.state.tasks[0].dueDate === '2026-09-20' &&
      sb.state.tasks[0].dueTime === '19:30' &&
      sb.state.tasks[0].priority === 'alta');
    check('16. se crea exactamente UNA tarea', sb.state.tasks.length === 1);
  }

  // =====================================================================
  section('PREFILL PARCIAL (17-20): campos que la IA no proporciona no se inventan, y el usuario puede rellenarlos');
  // =====================================================================
  {
    // 17-18: evento con prefill SIN hora.
    const sb = makeFormSandbox();
    sb.openEventModal({ prefill: { type: 'event', title: 'Reunión con Juan', date: '2026-09-18' } });
    check('17. prefill sin hora → el campo de hora queda vacío (no se inventa)', /name="startTime" value=""/.test(sb.modalBox.innerHTML));
    seedEventDefaults(sb, { title: 'Reunión con Juan', date: '2026-09-18' });
    sb.__registry.byNameEl('startTime').value = '09:00';
    await submitEventForm(sb);
    check('18. el usuario introduce una hora manualmente → se guarda esa hora', sb.state.events.length === 1 && sb.state.events[0].startTime === '09:00');

    // 19-20: tarea con prefill SIN prioridad.
    const sbT = makeFormSandbox();
    sbT.openTaskModal({ prefill: { type: 'task', title: 'Estudiar biología' } });
    check('19. prefill sin prioridad → el campo queda en el default normal ("media"), no una prioridad inventada por la IA', /<option value="media" selected>Media<\/option>/.test(sbT.modalBox.innerHTML));
    seedTaskDefaults(sbT, { title: 'Estudiar biología' });
    sbT.__registry.byNameEl('priority').value = 'baja';
    await submitTaskForm(sbT);
    check('20. el usuario selecciona una prioridad manualmente → se guarda esa prioridad', sbT.state.tasks.length === 1 && sbT.state.tasks[0].priority === 'baja');
  }

  // =====================================================================
  section('CANCELACIÓN (21-23): cancelar no persiste nada, y reabrir no recupera lo cancelado');
  // =====================================================================
  {
    // 21) Abrir y cancelar sin tocar nada.
    {
      const sb = makeFormSandbox();
      sb.openTaskModal({ prefill: { type: 'task', title: 'Estudiar biología', date: '2026-09-18' } });
      await clickCancel(sb, 'task-cancel-btn');
      check('21. abrir y cancelar (sin editar) no crea nada', sb.state.tasks.length === 0 && sb.__calls.addTask === 0);
    }
    // 22) Abrir, editar varios campos y cancelar.
    let editedTitleEl;
    {
      const sb = makeFormSandbox();
      sb.openEventModal({ prefill: { type: 'event', title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
      seedEventDefaults(sb, { title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00' });
      sb.__registry.byNameEl('title').value = 'Cambio que nunca debería guardarse';
      sb.__registry.byNameEl('startTime').value = '23:59';
      editedTitleEl = sb.__registry.byNameEl('title');
      await clickCancel(sb, 'event-cancel-btn');
      check('22a. cancelar cierra el modal (closeModal real invocado)', sb.__calls.closeModal === 1);
      check('22b. abrir, editar y cancelar no crea ningún evento', sb.state.events.length === 0 && sb.__calls.addEvent === 0);
      check('22c. tampoco modifica state.tasks', sb.state.tasks.length === 0);

      // 23) Reabrir: el prefill de la nueva apertura no debe arrastrar la
      // edición cancelada, y el DOM no debe ser el mismo nodo de antes
      // (registry.reset() en el innerHTML setter reproduce que un
      // navegador real destruye los nodos/listeners previos).
      sb.openEventModal({ prefill: { type: 'event', title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
      const reopenedTitleEl = sb.__registry.byNameEl('title');
      check('23a. reabrir usa un elemento de formulario NUEVO (no el mismo nodo editado y cancelado)', reopenedTitleEl !== editedTitleEl);
      check('23b. el nodo reabierto no arrastra el valor editado y cancelado ("Cambio que nunca debería guardarse")', reopenedTitleEl.value !== 'Cambio que nunca debería guardarse');
      check('23c. el HTML recién renderizado parte del prefill original correspondiente a esta nueva apertura, no de la edición cancelada', /name="title" required value="Parcial de biología"/.test(sb.modalBox.innerHTML) && !sb.modalBox.innerHTML.includes('Cambio que nunca debería guardarse'));
      check('23d. el formulario reabierto tiene exactamente UN listener de submit (no se acumulan los de la apertura anterior)', sb.__registry.byIdEl('event-form')._listeners.submit.length === 1);
    }
  }

  // =====================================================================
  section('INTEGRIDAD (24): AI-2.2 (buildSmartFormPrefill) no se modifica — mismo contrato de siempre');
  // =====================================================================
  {
    const bsandbox = {};
    vm.createContext(bsandbox);
    vm.runInContext(smartFormSrc + '\nthis.buildSmartFormPrefill = buildSmartFormPrefill;', bsandbox, { filename: 'ai-actions.js (AI-2.1+AI-2.2)' });
    const intent = { type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18' }, missingFields: [], sourceText: 'x' };
    const prefill = bsandbox.buildSmartFormPrefill(intent);
    check('24a. buildSmartFormPrefill sigue devolviendo únicamente los campos válidos presentes (contrato intacto)', JSON.stringify(Object.keys(prefill).sort()) === JSON.stringify(['date', 'title', 'type']));
    check('24b. buildSmartFormPrefill sigue sin inventar campos ausentes (sin "time")', !('time' in prefill));
    check('24c. buildSmartFormPrefill sigue sin modificar el intent recibido', JSON.stringify(intent) === JSON.stringify({ type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18' }, missingFields: [], sourceText: 'x' }));
  }

  // =====================================================================
  section('INTEGRIDAD (25-26): state.tasks/state.events no cambian mientras se edita, antes de guardar');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openTaskModal({ prefill: { type: 'task', title: 'Estudiar biología', date: '2026-09-18' } });
    seedTaskDefaults(sb, { title: 'Estudiar biología', dueDate: '2026-09-18' });
    sb.__registry.byNameEl('title').value = 'Editando sin guardar todavía';
    sb.__registry.byNameEl('priority').value = 'alta';
    check('25. editar campos del formulario (sin pulsar Guardar) no modifica state.tasks', sb.state.tasks.length === 0);
    check('26. tampoco modifica state.events', sb.state.events.length === 0);
  }

  // =====================================================================
  section('INTEGRIDAD (27-28): no hay llamada directa a addTask/addEvent desde el Smart Form antes del submit');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openTaskModal({ prefill: { type: 'task', title: 'Estudiar biología' } });
    sb.openEventModal({ prefill: { type: 'event', title: 'Parcial de biología', date: '2026-09-18' } });
    check('27. abrir un Smart Form de tarea no llama a addTask por sí solo', sb.__calls.addTask === 0);
    check('28. abrir un Smart Form de evento no llama a addEvent por sí solo', sb.__calls.addEvent === 0);
    // Comprobación estática adicional: el submit real de cada modal solo
    // llama a addTask/addEvent UNA vez (dentro del propio listener de
    // submit), sin una segunda vía de persistencia paralela.
    // Se cuentan solo INVOCACIONES reales ("await addTask("/"await addEvent(")
    // — no las apariciones de "addTask()"/"addEvent()" en comentarios de
    // prosa (p.ej. "se apoya en que addTask() usa el id..."), que no son
    // una segunda vía de creación, solo texto explicativo.
    check('27b. openTaskModal solo invoca addTask una vez en todo su código (una única vía de creación)', (openTaskModalSrc.match(/await addTask\(/g) || []).length === 1);
    check('28b. openEventModal solo invoca addEvent una vez en todo su código (una única vía de creación)', (openEventModalSrc.match(/await addEvent\(/g) || []).length === 1);
  }

  // =====================================================================
  section('INTEGRIDAD (29): no hay listeners de submit duplicados en una apertura normal (uno por formulario)');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openTaskModal({ prefill: { type: 'task', title: 'Estudiar biología' } });
    check('29a. el formulario de tarea tiene exactamente UN listener de submit', sb.__registry.byIdEl('task-form')._listeners.submit.length === 1);
    const sbE = makeFormSandbox();
    sbE.openEventModal({ prefill: { type: 'event', title: 'Examen', date: '2026-09-18' } });
    check('29b. el formulario de evento tiene exactamente UN listener de submit', sbE.__registry.byIdEl('event-form')._listeners.submit.length === 1);
  }

  // =====================================================================
  section('INTEGRIDAD (30): el flujo MANUAL (sin prefill, como abrir "Nueva tarea"/"Nuevo evento" a mano) sigue funcionando igual');
  // =====================================================================
  {
    const sb = makeFormSandbox();
    sb.openTaskModal({}); // sin prefill
    seedTaskDefaults(sb, { title: 'Comprar leche', dueDate: '2026-09-19' });
    await submitTaskForm(sb);
    check('30a. flujo manual de tarea (sin prefill) sigue creando con normalidad', sb.state.tasks.length === 1 && sb.state.tasks[0].title === 'Comprar leche');

    const sbE = makeFormSandbox();
    sbE.openEventModal({}); // sin prefill
    seedEventDefaults(sbE, { title: 'Reunión de equipo', date: '2026-09-22', startTime: '10:00' });
    await submitEventForm(sbE);
    check('30b. flujo manual de evento (sin prefill) sigue creando con normalidad', sbE.state.events.length === 1 && sbE.state.events[0].title === 'Reunión de equipo');
  }

  // =====================================================================
  section('Caso adicional: el submit real no lee `pre`/`prefill` dentro de su propio listener (fuente de verdad = FormData)');
  // =====================================================================
  {
    function extractSubmitBody(src, formName) {
      const marker = `#${formName}').addEventListener('submit',`;
      const start = src.indexOf(marker);
      if (start === -1) throw new Error(`No se encontró el listener de submit de "${formName}"`);
      const end = src.indexOf('\n  });', start);
      return src.slice(start, end);
    }
    const taskSubmitBody = extractSubmitBody(openTaskModalSrc, 'task-form');
    const eventSubmitBody = extractSubmitBody(openEventModalSrc, 'event-form');
    check('add1. el listener de submit de tarea no referencia "pre" ni "prefill" (solo lee `fd`/FormData)', !/\bpre\b/.test(taskSubmitBody) && !/\bprefill\b/.test(taskSubmitBody));
    check('add2. el listener de submit de evento no referencia "pre" ni "prefill" (solo lee `fd`/FormData)', !/\bpre\b/.test(eventSubmitBody) && !/\bprefill\b/.test(eventSubmitBody));
    check('add3. ambos listeners de submit sí usan `new FormData(e.target)` (la fuente de verdad es el formulario real, no el prefill)', /new FormData\(e\.target\)/.test(taskSubmitBody) && /new FormData\(e\.target\)/.test(eventSubmitBody));
  }

  // =====================================================================
  section('Caso adicional: campos históricos al EDITAR un elemento existente no se borran por no venir en el prefill (UX-8 intacto)');
  // =====================================================================
  {
    // El Smart Form (prefill) solo se aplica al CREAR (nunca al editar uno
    // existente, ver comentario "AI-2.3" en el propio código real) — se
    // comprueba aquí que editar un elemento con datos históricos que ya
    // NO viajan en `prefill` (categoría, prioridad no-default, minutos
    // estimados) los conserva intactos si el usuario no los toca.
    const sb = makeFormSandbox();
    sb.state.tasks.push({ id: 't-1', title: 'Tarea histórica', dueDate: '2026-09-10', dueTime: '', priority: 'alta', category: 'Estudio', estimatedMinutes: 45 });
    sb.openTaskModal({ taskId: 't-1', prefill: { type: 'task', title: 'Ignorado al editar' } });
    check('hist1. al editar, el prefill NUNCA se aplica (el título mostrado es el histórico, no el del prefill)', /name="title" required value="Tarea histórica"/.test(sb.modalBox.innerHTML));
    seedTaskDefaults(sb, { title: 'Tarea histórica', dueDate: '2026-09-10', priority: 'alta', category: 'Estudio', estimatedMinutes: 45 });
    await submitTaskForm(sb);
    const saved = sb.state.tasks.find(t => t.id === 't-1');
    check('hist2. la categoría histórica se conserva (no la borra el Smart Form)', saved.category === 'Estudio');
    check('hist3. los minutos estimados históricos se conservan', saved.estimatedMinutes === 45);
    check('hist4. la prioridad histórica se conserva', saved.priority === 'alta');
  }

  // =====================================================================
  section('Regresión (subprocesos reales)');
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
    check('REG1. js/test-ai-2-6-smart-form-clarification.js sigue pasando', runSuite('js/test-ai-2-6-smart-form-clarification.js'));
    check('REG2. js/test-ai-2-regression.js sigue pasando', runSuite('js/test-ai-2-regression.js'));
    check('REG3. js/test-ai-2-1-smart-form-intent.js sigue pasando', runSuite('js/test-ai-2-1-smart-form-intent.js'));
    check('REG4. js/test-ai-2-2-smart-form-prefill.js sigue pasando', runSuite('js/test-ai-2-2-smart-form-prefill.js'));
    check('REG5. js/test-ai-2-3-smart-form-open.js sigue pasando', runSuite('js/test-ai-2-3-smart-form-open.js'));
    check('REG6. js/test-ai-2-4-smart-form-submit.js sigue pasando', runSuite('js/test-ai-2-4-smart-form-submit.js'));
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
      const tmpPath = path.join(require('os').tmpdir(), `organizator-ai-2-7-check-${process.pid}.js`);
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
