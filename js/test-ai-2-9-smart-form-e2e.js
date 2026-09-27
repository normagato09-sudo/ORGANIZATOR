/**
 * ORGANIZATOR — AI-2.9: QA end-to-end de Smart Forms
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que
 * test-ai-2-regression.js (AI-2.5): extrae literalmente por CONTENIDO
 * el código REAL de ai-actions.js/organizator.html (nada reimplementado)
 * y lo ejecuta en sandboxes `vm` con un DOM mínimo pero funcional, para
 * comprobar la cadena COMPLETA de extremo a extremo:
 *
 *   mensaje del usuario
 *   -> detectSmartFormIntent (AI-2.1)
 *   -> buildSmartFormPrefill (AI-2.2)
 *   -> openSmartFormFromChat -> openTaskModal/openEventModal (AI-2.3)
 *   -> edición manual del usuario en el formulario
 *   -> submit -> addTask/addEvent (AI-2.4)
 *   -> findExistingSmartFormEquivalent (AI-2.8, protección de duplicados)
 *
 * más su integración con getSmartFormClarification (AI-2.6), recordatorios
 * (Fase 1/2/3) y recurrencia (R-1/R-5).
 *
 * A propósito, esta suite NO relanza ninguna de las suites anteriores
 * como subproceso (a diferencia de cómo esas suites ya se prueban entre
 * sí — test-ai-2-4 ya ejecuta test-ai-2-1/2/3, test-ai-2-8 hace lo
 * mismo, etc.): encadenar aquí también esas cascadas ya demostró ser
 * impracticablemente lento (ver AI-2.8). Esta suite prueba el flujo
 * end-to-end DIRECTAMENTE, con sus propios sandboxes — mismo criterio
 * que ya usan test-ai-1-regression.js y test-ai-2-regression.js frente a
 * las suites por fase. La regresión cruzada con AI-1/AI-2.1→2.8/UX-8/
 * recurrencia/recordatorios/categorías se ejecuta como comandos
 * SEPARADOS (ver informe final), no desde aquí dentro.
 *
 * Uso:  node js/test-ai-2-9-smart-form-e2e.js
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
// Fragmentos REALES de ai-actions.js: AI-1.2..1.5 (de los que depende
// detectSmartFormIntent por dentro) + AI-2.1/2.2/2.6/2.8 — este último
// tramo (desde el marcador "AI-2.1" hasta "Contexto con IDs") ya incluye
// los CUATRO bloques seguidos tal como viven en el archivo real
// (detectSmartFormIntent, buildSmartFormPrefill, getSmartFormClarification,
// findExistingSmartFormEquivalent), sin necesidad de extraerlos por
// separado ni de reimplementar nada.
// ---------------------------------------------------------------------
const datetimeSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.2', '\n\n  /* ==================================================================\n     AI-1.3', 'bloque AI-1.2');
const implicitEventSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.3', '\n\n  /* ==================================================================\n     AI-1.4', 'bloque AI-1.3');
const implicitTaskSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.4', '\n\n  /* ==================================================================\n     AI-1.5', 'bloque AI-1.4');
const modificationSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.5', '\n\n  /* ==================================================================\n     AI-2.1', 'bloque AI-1.5');
const smartFormSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-2.1', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-2.1+AI-2.2+AI-2.6+AI-2.8');

// ---------------------------------------------------------------------
// Fragmentos REALES de organizator.html.
// ---------------------------------------------------------------------
const escSrc = extractBetween(html, 'function esc(s){', '\n\n/* ==================================================================\n   FILAS DE TAREA', 'función esc()');
const dowConstsSrc = extractBetween(html, 'const DOW_NAMES = ', '\n\n/* ==================================================================\n   AJUSTES', 'constantes DOW_NAMES/...');
const sanitizeSrc = extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'bloque SANEAMIENTO (sanitizeRecurrence, R-1)');
const crudSrc = extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', 'bloque CRUD');
const remindersFase1Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', 'bloque RECORDATORIOS (Fase 1)');
// AI-2.9 (escenario 10, recordatorios): además de Fase 1/Fase 3 (ya
// usadas por el resto de la suite AI-2.x), aquí hace falta también la
// Fase 2 (calculateReminderAt/createReminderForTarget) para que
// syncReminderForTarget pueda CREAR un recordatorio real de verdad
// cuando el usuario elige una anticipación en el formulario — las demás
// suites AI-2.x nunca seleccionan un recordatorio real, por eso no la
// necesitaban.
const remindersFase2Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt (Fase 2', '\n\n/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3', 'bloque RECORDATORIOS (Fase 2, cálculo de remindAt)');
const remindersFase3Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)', '\n\n/* ==================================================================\n   TOAST', 'bloque RECORDATORIOS (Fase 3)');
const recurrenceUiSrc = extractBetween(html, '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)', '\n\n/* ==================================================================\n   MODAL: TAREA', 'bloque RECURRENCIA UI (R-5)');
const modalCollapsibleSrc = extractBetween(html, 'function modalCollapsibleSection(id, label, contentHtml, open){', '\nfunction openTaskModal(', 'bloque UX-8 secciones desplegables');
const openTaskModalSrc = extractBetween(html, 'function openTaskModal({taskId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: MINUTOS REALES', 'función openTaskModal()');
const openEventModalSrc = extractBetween(html, 'function openEventModal({eventId=null, date=null, prefill=null}={}){', '\n\n/* ==================================================================\n   MODAL: HORARIO BLOQUEADO', 'función openEventModal()');
const openSmartFormFromChatSrc = extractBetween(html, 'function openSmartFormFromChat(intent){', '\n\n/* ---------- AI-2.6', 'función openSmartFormFromChat() (AI-2.3)');
const runIAActionChatSrc = extractBetween(html, '/* ---------- AI-2.6: aclaraciones pendientes del chat', '\n\n/* ---------- Wiring inicial del bloque IA', 'bloque AI-2.6 + función runIAActionChat()');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Registro de elementos DOM mínimo pero funcional (mismo criterio que
 * test-ai-2-4/test-ai-2-8/test-ai-2-regression): memoiza por id/name,
 * expone `.value`/`.checked`/`.addEventListener` reales. */
function makeElementRegistry() {
  const byId = {}; const byName = {};
  function makeEl() {
    return { value: '', checked: false, disabled: false, style: {}, innerHTML: '', textContent: '', _listeners: {}, addEventListener(type, h) { (this._listeners[type] = this._listeners[type] || []).push(h); } };
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
async function fire(el, type, evt) { for (const h of (el._listeners[type] || [])) await h(evt || {}); }

const TODAY = '2026-09-17'; // jueves

/** Sandbox COMPLETO: AI-1.2..1.5 + AI-2.1/2.2/2.6/2.8 + AI-2.3/2.4 (CRUD
 * real, reminders Fase 1/2/3 reales, recurrencia R-5 real, ambos
 * modales de UX-8 reales) sobre el DOM mínimo. `seedState` (opcional)
 * permite partir de tasks/events YA existentes (necesario para los
 * escenarios de duplicados — 6, 7, 8, 9). */
function makeFullSandbox(seedState) {
  const sandbox = {};
  sandbox.console = console;
  const registry = makeElementRegistry();
  const calls = { addTask: 0, updateTask: 0, addEvent: 0, updateEvent: 0, closeModal: 0, runIAAction: 0, openTaskModal: 0, openEventModal: 0, showToast: 0 };
  sandbox.__calls = calls;
  sandbox.__registry = registry;
  sandbox.__toasts = [];

  const initialState = Object.assign({ tasks: [], events: [], eventCategories: [], reminders: [], customSchedules: [] }, seedState || {});

  vm.createContext(sandbox);
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dowConstsSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/...)' });
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
     class FormData {
       constructor(){}
       get(name){ const el = __registry.byNameEl(name); if(!el) return null; if(el.__isCheckbox) return el.checked ? (el.__checkboxValue||'on') : null; return el.value; }
       getAll(name){ const v = this.get(name); return v == null ? [] : [v]; }
     }
     async function callAI(){ throw new Error('callAI no debería llamarse en el flujo Smart Form'); }
     function parseAIJSON(raw){ return raw; }`,
    sandbox, { filename: 'dom-stub' }
  );
  vm.runInContext(sanitizeSrc, sandbox, { filename: 'organizator.html (saneamiento + sanitizeRecurrence, R-1)' });
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD real)' });
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase2Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 2, cálculo remindAt)' });
  vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5)' });
  vm.runInContext(modalCollapsibleSrc, sandbox, { filename: 'organizator.html (UX-8 modalCollapsibleSection)' });
  vm.runInContext(openTaskModalSrc, sandbox, { filename: 'organizator.html (openTaskModal real)' });
  vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal real)' });
  vm.runInContext(datetimeSrc, sandbox, { filename: 'ai-actions.js (AI-1.2)' });
  vm.runInContext(implicitEventSrc, sandbox, { filename: 'ai-actions.js (AI-1.3)' });
  vm.runInContext(implicitTaskSrc, sandbox, { filename: 'ai-actions.js (AI-1.4)' });
  vm.runInContext(modificationSrc, sandbox, { filename: 'ai-actions.js (AI-1.5)' });
  vm.runInContext(smartFormSrc, sandbox, { filename: 'ai-actions.js (AI-2.1+AI-2.2+AI-2.6+AI-2.8 real)' });
  vm.runInContext(
    `const AIActions = {
       detectSmartFormIntent: detectSmartFormIntent,
       buildSmartFormPrefill: buildSmartFormPrefill,
       getSmartFormClarification: getSmartFormClarification,
       findExistingSmartFormEquivalent: findExistingSmartFormEquivalent,
       runIAAction: async (system, userPrompt) => { __calls.runIAAction++; return { answer: 'ok', applied: [] }; },
     };`,
    sandbox, { filename: 'AIActions-real' }
  );
  vm.runInContext(openSmartFormFromChatSrc, sandbox, { filename: 'organizator.html (openSmartFormFromChat real, AI-2.3)' });
  vm.runInContext(runIAActionChatSrc, sandbox, { filename: 'organizator.html (bloque AI-2.6 + runIAActionChat real)' });
  vm.runInContext(
    `const __realOpenTaskModal = openTaskModal, __realOpenEventModal = openEventModal;
     this.openTaskModal = function(...a){ __calls.openTaskModal++; return __realOpenTaskModal(...a); };
     this.openEventModal = function(...a){ __calls.openEventModal++; return __realOpenEventModal(...a); };
     this.openSmartFormFromChat = openSmartFormFromChat;
     this.runIAActionChat = runIAActionChat;
     this.state = state;
     this.modalBox = modalBox;
     this.closeModal = closeModal;
     this.AIActions = AIActions;
     this.calculateReminderAt = calculateReminderAt;
     const __realAddTask = addTask, __realUpdateTask = updateTask, __realAddEvent = addEvent, __realUpdateEvent = updateEvent, __realCloseModal = closeModal;
     addTask = async (...a) => { __calls.addTask++; return __realAddTask(...a); };
     updateTask = async (...a) => { __calls.updateTask++; return __realUpdateTask(...a); };
     addEvent = async (...a) => { __calls.addEvent++; return __realAddEvent(...a); };
     updateEvent = async (...a) => { __calls.updateEvent++; return __realUpdateEvent(...a); };
     closeModal = (...a) => { __calls.closeModal++; return __realCloseModal(...a); };
     this.iaThreadAddPending = () => ({ id: 'm1' });
     this.iaThreadResolve = (el, html) => { __lastChatAnswer = html; };
     iaThreadAddPending = () => ({ id: 'm1' });
     iaThreadResolve = (el, html) => { __lastChatAnswer = html; };
     var __lastChatAnswer = null;
     this.__getLastChatAnswer = () => __lastChatAnswer;`,
    sandbox, { filename: 'expose-and-spy' }
  );
  return sandbox;
}

// El FormData stub de esta suite (mismo criterio que test-ai-2-4/
// test-ai-2-regression) solo soporta UN valor por nombre — suficiente
// para 'daily'/'monthly' (nunca marcan ningún día de la semana), pero
// `repeatDaysOfWeek` debe comportarse como una casilla SIN marcar por
// defecto (getAll -> []), nunca como un campo de texto con valor '' (que
// el stub, al no ser null, devolvería como [''] -> [NaN] al parsear,
// haciendo que sanitizeRecurrence rechace la recurrencia entera). Los
// escenarios de recurrencia de AI-2.9 (11) no marcan ningún día, así que
// esto basta sin tener que reproducir aquí el soporte multi-checkbox
// completo que sí usa test-recurrence-ui-r5.js para 'weekly'.
function seedRepeatDaysOfWeekUnchecked(r) {
  const el = r.byNameEl('repeatDaysOfWeek');
  el.__isCheckbox = true; el.__checkboxValue = ''; el.checked = false;
}
function seedTaskDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  ['title', 'dueDate', 'dueTime', 'category', 'estimatedMinutes', 'repeatEndDate', 'reminderMinutes'].forEach(n => set(n, ''));
  set('priority', 'media'); set('repeatType', 'none'); set('repeatEnd', 'never'); set('repeatInterval', '1');
  seedRepeatDaysOfWeekUnchecked(r);
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}
function seedEventDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  ['title', 'categoryId', 'date', 'endDate', 'startTime', 'endTime', 'repeatEndDate', 'reminderMinutes'].forEach(n => set(n, ''));
  set('repeatType', 'none'); set('repeatEnd', 'never'); set('repeatInterval', '1');
  seedRepeatDaysOfWeekUnchecked(r);
  const allDayEl = r.byNameEl('allDay'); allDayEl.__isCheckbox = true; allDayEl.__checkboxValue = 'on'; allDayEl.checked = false;
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}
async function submitTaskForm(sb) { await fire(sb.__registry.byIdEl('task-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('task-form') }); }
async function submitEventForm(sb) { await fire(sb.__registry.byIdEl('event-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('event-form') }); }
async function clickBtn(sb, id) { await fire(sb.__registry.byIdEl(id), 'click', {}); }

(async () => {

  // =====================================================================
  section('1) CREACIÓN DE TAREA — "mañana tengo que estudiar biología"');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    const message = 'mañana tengo que estudiar biología';

    const intent = sb.AIActions.detectSmartFormIntent(message, { todayStr: TODAY });
    check('1a. detectSmartFormIntent devuelve type "task"', intent !== null && intent.type === 'task');

    const prefill = sb.AIActions.buildSmartFormPrefill(intent);
    check('1b. buildSmartFormPrefill produce el prefill esperado (título/fecha)', prefill.type === 'task' && prefill.title === 'Tengo que estudiar biología' && prefill.date === '2026-09-18');

    sb.openSmartFormFromChat(intent);
    check('1c. se abre el formulario de TAREA (openTaskModal llamado, openEventModal no)', sb.__calls.openTaskModal === 1 && sb.__calls.openEventModal === 0);
    check('1d. el título/fecha detectados aparecen en el HTML del formulario',
      sb.modalBox.innerHTML.includes(`value="${prefill.title}"`) && sb.modalBox.innerHTML.includes(`value="${prefill.date}"`));

    seedTaskDefaults(sb, { title: prefill.title, dueDate: prefill.date });
    await submitTaskForm(sb);
    check('1e. al enviar se crea EXACTAMENTE una tarea', sb.state.tasks.length === 1 && sb.__calls.addTask === 1);
    check('1f. la tarea creada conserva el título/fecha detectados', sb.state.tasks[0].title === prefill.title && sb.state.tasks[0].dueDate === prefill.date);
    check('1g. no se crea ningún evento de paso', sb.state.events.length === 0 && sb.__calls.addEvent === 0);
  }

  // =====================================================================
  section('2) CREACIÓN DE EVENTO — "el lunes tengo médico"');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    const message = 'el lunes tengo médico';

    const intent = sb.AIActions.detectSmartFormIntent(message, { todayStr: TODAY });
    check('2a. detectSmartFormIntent devuelve type "event"', intent !== null && intent.type === 'event');

    const prefill = sb.AIActions.buildSmartFormPrefill(intent);
    check('2b. buildSmartFormPrefill produce el prefill esperado (título/fecha)', prefill.type === 'event' && prefill.title === 'Tengo médico' && prefill.date === '2026-09-21');

    sb.openSmartFormFromChat(intent);
    check('2c. se abre el formulario de EVENTO (openEventModal llamado, openTaskModal no)', sb.__calls.openEventModal === 1 && sb.__calls.openTaskModal === 0);
    check('2d. la fecha/título aparecen correctamente en el HTML del formulario',
      sb.modalBox.innerHTML.includes(`value="${prefill.title}"`) && sb.modalBox.innerHTML.includes(`value="${prefill.date}"`));

    seedEventDefaults(sb, { title: prefill.title, date: prefill.date });
    await submitEventForm(sb);
    check('2e. al enviar se crea EXACTAMENTE un evento', sb.state.events.length === 1 && sb.__calls.addEvent === 1);
    check('2f. el evento creado conserva el título/fecha detectados', sb.state.events[0].title === prefill.title && sb.state.events[0].date === prefill.date);
    check('2g. no se crea ninguna tarea de paso', sb.state.tasks.length === 0 && sb.__calls.addTask === 0);
  }

  // =====================================================================
  section('3) EDICIÓN DEL PREFILL — el valor FINAL del usuario manda, no el original de la IA');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    const message = 'mañana tengo que estudiar biología';
    const intent = sb.AIActions.detectSmartFormIntent(message, { todayStr: TODAY });
    const prefill = sb.AIActions.buildSmartFormPrefill(intent); // { title: 'Tengo que estudiar biología', date: '2026-09-18' }, sin hora
    sb.openSmartFormFromChat(intent);

    // El usuario cambia TÍTULO, FECHA y añade una HORA que la IA no detectó.
    seedTaskDefaults(sb, { title: 'Estudiar química', dueDate: '2026-09-25', dueTime: '18:00' });
    await submitTaskForm(sb);

    check('3a. se crea la tarea con el TÍTULO final del usuario, no el de la IA', sb.state.tasks[0].title === 'Estudiar química' && sb.state.tasks[0].title !== prefill.title);
    check('3b. se crea la tarea con la FECHA final del usuario, no la de la IA', sb.state.tasks[0].dueDate === '2026-09-25' && sb.state.tasks[0].dueDate !== prefill.date);
    check('3c. se crea la tarea con la HORA que el usuario añadió (la IA no había detectado ninguna)', sb.state.tasks[0].dueTime === '18:00');
    check('3d. exactamente una tarea creada', sb.state.tasks.length === 1 && sb.__calls.addTask === 1);
  }

  // =====================================================================
  section('4) CANCELAR — no crea nada ni modifica el estado existente');
  // =====================================================================
  {
    const existingTask = { id: 'keep-1', title: 'Tarea ya existente', dueDate: '2026-09-19', dueTime: '', priority: 'media' };
    const sb = makeFullSandbox({ tasks: [existingTask] });
    const snapshotBefore = JSON.stringify(sb.state.tasks);

    const intent = sb.AIActions.detectSmartFormIntent('mañana tengo que estudiar biología', { todayStr: TODAY });
    sb.openSmartFormFromChat(intent);
    check('4a. el formulario se abrió antes de cancelar', sb.__calls.openTaskModal === 1);

    seedTaskDefaults(sb, { title: 'Tengo que estudiar biología', dueDate: '2026-09-18' });
    await clickBtn(sb, 'task-cancel-btn');

    check('4b. cancelar no crea ninguna tarea nueva', sb.state.tasks.length === 1 && sb.__calls.addTask === 0);
    check('4c. cancelar no crea ningún evento', sb.state.events.length === 0 && sb.__calls.addEvent === 0);
    check('4d. el estado existente (la tarea que ya había) no se modifica', JSON.stringify(sb.state.tasks) === snapshotBefore);
    check('4e. closeModal se invocó (el modal se cierra al cancelar)', sb.__calls.closeModal === 1);
  }

  // =====================================================================
  section('5) DATOS INCOMPLETOS — pide aclaración, no crea nada hasta completarlos');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    const message = 'Tengo examen'; // cita reconocida (AI-1.3) pero sin ninguna fecha
    const intent = sb.AIActions.detectSmartFormIntent(message, { todayStr: TODAY });
    check('5a. detectSmartFormIntent detecta un evento con la fecha como campo que falta', intent !== null && intent.type === 'event' && intent.missingFields.includes('date'));

    const clarification = sb.AIActions.getSmartFormClarification(intent, { message, todayStr: TODAY });
    check('5b. getSmartFormClarification pide la fecha (field: "date")', clarification !== null && clarification.field === 'date');

    // Flujo real completo vía runIAActionChat: con aclaración pendiente,
    // NUNCA se abre el formulario ni se crea nada en este turno.
    await sb.runIAActionChat(message);
    check('5c. con datos incompletos, NO se abre ningún formulario', sb.__calls.openEventModal === 0 && sb.__calls.openTaskModal === 0);
    check('5d. con datos incompletos, no se crea ninguna tarea/evento', sb.state.tasks.length === 0 && sb.state.events.length === 0);
    check('5e. no se llama a addTask/addEvent ni a AIActions.runIAAction (el turno se detiene en la pregunta)', sb.__calls.addTask === 0 && sb.__calls.addEvent === 0 && sb.__calls.runIAAction === 0);
    check('5f. la pregunta concreta llega al chat', typeof sb.__getLastChatAnswer() === 'string' && sb.__getLastChatAnswer().includes('día'));
  }

  // =====================================================================
  section('6) DUPLICADO — Smart Form equivalente a un elemento ya existente');
  // =====================================================================
  {
    // --- Tarea ---
    const existingTask = { id: 'dup-task-1', title: 'Tengo que estudiar biología', dueDate: '2026-09-18', dueTime: '', priority: 'media' };
    const sbTask = makeFullSandbox({ tasks: [existingTask] });
    const messageTask = 'mañana tengo que estudiar biología';
    const intentTask = sbTask.AIActions.detectSmartFormIntent(messageTask, { todayStr: TODAY });
    sbTask.openSmartFormFromChat(intentTask);
    check('6a. el formulario de tarea puede abrirse aunque ya exista una equivalente', sbTask.__calls.openTaskModal === 1);
    const prefillTask = sbTask.AIActions.buildSmartFormPrefill(intentTask);
    seedTaskDefaults(sbTask, { title: prefillTask.title, dueDate: prefillTask.date });
    await submitTaskForm(sbTask);
    check('6b. al enviar NO se crea una segunda tarea equivalente', sbTask.state.tasks.length === 1 && sbTask.__calls.addTask === 0);
    check('6c. se mantiene la tarea existente, sin modificar', sbTask.state.tasks[0].id === 'dup-task-1' && sbTask.state.tasks[0].title === existingTask.title);
    check('6d. se informa del duplicado (showToast llamado)', sbTask.__calls.showToast === 1);

    // --- Evento ---
    const existingEvent = { id: 'dup-event-1', title: 'Tengo médico', date: '2026-09-21', startTime: '', endTime: '', allDay: false };
    const sbEvent = makeFullSandbox({ events: [existingEvent] });
    const messageEvent = 'el lunes tengo médico';
    const intentEvent = sbEvent.AIActions.detectSmartFormIntent(messageEvent, { todayStr: TODAY });
    sbEvent.openSmartFormFromChat(intentEvent);
    check('6e. el formulario de evento puede abrirse aunque ya exista uno equivalente', sbEvent.__calls.openEventModal === 1);
    const prefillEvent = sbEvent.AIActions.buildSmartFormPrefill(intentEvent);
    seedEventDefaults(sbEvent, { title: prefillEvent.title, date: prefillEvent.date });
    await submitEventForm(sbEvent);
    check('6f. al enviar NO se crea un segundo evento equivalente', sbEvent.state.events.length === 1 && sbEvent.__calls.addEvent === 0);
    check('6g. se mantiene el evento existente, sin modificar', sbEvent.state.events[0].id === 'dup-event-1' && sbEvent.state.events[0].title === existingEvent.title);
  }

  // =====================================================================
  section('7) CAMBIO MANUAL EVITA EL BLOQUEO DE DUPLICADO');
  // =====================================================================
  {
    const existingTask = { id: 'dup-task-2', title: 'Tengo que estudiar biología', dueDate: '2026-09-18', dueTime: '', priority: 'media' };

    // 7a. el usuario cambia el TÍTULO -> ya no coincide -> se crea.
    {
      const sb = makeFullSandbox({ tasks: [JSON.parse(JSON.stringify(existingTask))] });
      const intent = sb.AIActions.detectSmartFormIntent('mañana tengo que estudiar biología', { todayStr: TODAY });
      sb.openSmartFormFromChat(intent);
      seedTaskDefaults(sb, { title: 'Estudiar química', dueDate: '2026-09-18' }); // título editado
      await submitTaskForm(sb);
      check('7a. título editado (ya no coincide) → SÍ se crea la nueva tarea', sb.state.tasks.length === 2 && sb.__calls.addTask === 1);
    }
    // 7b. el usuario cambia la FECHA -> ya no coincide -> se crea.
    {
      const sb = makeFullSandbox({ tasks: [JSON.parse(JSON.stringify(existingTask))] });
      const intent = sb.AIActions.detectSmartFormIntent('mañana tengo que estudiar biología', { todayStr: TODAY });
      sb.openSmartFormFromChat(intent);
      seedTaskDefaults(sb, { title: 'Tengo que estudiar biología', dueDate: '2026-09-30' }); // fecha editada
      await submitTaskForm(sb);
      check('7b. fecha editada (ya no coincide) → SÍ se crea la nueva tarea', sb.state.tasks.length === 2 && sb.__calls.addTask === 1);
    }
    // 7c. el usuario añade una HORA -> ya no coincide -> se crea.
    {
      const sb = makeFullSandbox({ tasks: [JSON.parse(JSON.stringify(existingTask))] });
      const intent = sb.AIActions.detectSmartFormIntent('mañana tengo que estudiar biología', { todayStr: TODAY });
      sb.openSmartFormFromChat(intent);
      seedTaskDefaults(sb, { title: 'Tengo que estudiar biología', dueDate: '2026-09-18', dueTime: '09:00' }); // hora añadida
      await submitTaskForm(sb);
      check('7c. hora añadida (ya no coincide) → SÍ se crea la nueva tarea', sb.state.tasks.length === 2 && sb.__calls.addTask === 1);
    }
  }

  // =====================================================================
  section('8) CREACIÓN MANUAL NO AFECTADA por AI-2.8');
  // =====================================================================
  {
    const existingTask = { id: 'manual-1', title: 'Comprar leche', dueDate: '2026-09-19', dueTime: '', priority: 'media' };
    const sb = makeFullSandbox({ tasks: [existingTask] });
    // Apertura MANUAL (sin prefill, como pulsar "Nueva tarea"), con datos
    // idénticos a un elemento ya existente.
    sb.openTaskModal({});
    seedTaskDefaults(sb, { title: 'Comprar leche', dueDate: '2026-09-19' });
    await submitTaskForm(sb);
    check('8a. la creación manual SÍ se permite aunque exista una tarea parecida', sb.state.tasks.length === 2 && sb.__calls.addTask === 1);
    // showToast SÍ se llama en toda creación con éxito (el toast normal
    // "Añadido", ajeno a AI-2.8) — lo que no debe pasar es el aviso
    // ESPECÍFICO de duplicado (AI-2.8 no aplica fuera de Smart Forms).
    check('8b. no se avisa de duplicado en la creación manual (AI-2.8 no aplica fuera de Smart Forms)', !sb.__toasts.some(t => /duplicado/i.test(t)));

    const existingEvent = { id: 'manual-2', title: 'Reunión de equipo', date: '2026-09-22', startTime: '10:00', endTime: '', allDay: false };
    const sbE = makeFullSandbox({ events: [existingEvent] });
    sbE.openEventModal({});
    seedEventDefaults(sbE, { title: 'Reunión de equipo', date: '2026-09-22', startTime: '10:00' });
    await submitEventForm(sbE);
    check('8c. igual para eventos: la creación manual SÍ se permite aunque exista uno parecido', sbE.state.events.length === 2 && sbE.__calls.addEvent === 1);
  }

  // =====================================================================
  section('9) EDICIÓN DE UN ELEMENTO EXISTENTE — AI-2.8 no la trata como duplicado');
  // =====================================================================
  {
    const existingTask = { id: 'edit-task-1', title: 'Estudiar biología', dueDate: '2026-09-18', dueTime: '', priority: 'media' };
    const sb = makeFullSandbox({ tasks: [existingTask] });
    // Se abre para EDITAR (taskId dado) — aunque se le pase también un
    // prefill (nunca debería importar al editar), smartFormOrigin sigue
    // siendo false porque `editing` manda.
    sb.openTaskModal({ taskId: 'edit-task-1', prefill: { title: 'Estudiar biología', date: '2026-09-18' } });
    seedTaskDefaults(sb, { title: 'Estudiar biología', dueDate: '2026-09-18', priority: 'alta' });
    await submitTaskForm(sb);
    check('9a. editar un elemento existente sigue funcionando (updateTask llamado, no addTask)', sb.__calls.updateTask === 1 && sb.__calls.addTask === 0);
    // Igual que en 8b: showToast SÍ se llama (el toast normal "Guardado"
    // de toda edición con éxito) — lo que no debe pasar es el aviso de
    // duplicado ni una segunda tarea.
    check('9b. no se bloquea como "duplicado de sí misma" (no se avisa de duplicado, no se duplica)', !sb.__toasts.some(t => /duplicado/i.test(t)) && sb.state.tasks.length === 1);
    check('9c. el cambio del usuario (prioridad "alta") se aplica de verdad', sb.state.tasks[0].priority === 'alta');

    const existingEvent = { id: 'edit-event-1', title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00', endTime: '', allDay: false };
    const sbE = makeFullSandbox({ events: [existingEvent] });
    sbE.openEventModal({ eventId: 'edit-event-1' });
    seedEventDefaults(sbE, { title: 'Parcial de biología', date: '2026-09-18', startTime: '19:00' });
    await submitEventForm(sbE);
    check('9d. igual para eventos: editar sigue funcionando (updateEvent, no addEvent, sin duplicar)', sbE.__calls.updateEvent === 1 && sbE.__calls.addEvent === 0 && sbE.state.events.length === 1 && sbE.state.events[0].startTime === '19:00');
  }

  // =====================================================================
  section('10) RECORDATORIOS desde el Smart Form');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    const intent = sb.AIActions.detectSmartFormIntent('mañana tengo que estudiar biología', { todayStr: TODAY });
    const prefill = sb.AIActions.buildSmartFormPrefill(intent);
    sb.openSmartFormFromChat(intent);
    // El usuario añade una hora y elige un recordatorio de 30 minutos antes.
    seedTaskDefaults(sb, { title: prefill.title, dueDate: prefill.date, dueTime: '10:00', reminderMinutes: '30' });
    await submitTaskForm(sb);
    check('10a. se crea la tarea', sb.state.tasks.length === 1);
    const created = sb.state.tasks[0];
    check('10b. el valor de recordatorio elegido por el usuario se conserva (se crea un recordatorio pending)', sb.state.reminders.length === 1 && sb.state.reminders[0].targetType === 'task' && sb.state.reminders[0].targetId === created.id && sb.state.reminders[0].status === 'pending');
    const expectedRemindAt = sb.calculateReminderAt(`${created.dueDate}T${created.dueTime}:00`, 30);
    check('10c. el recordatorio creado corresponde a la anticipación elegida (30 min antes)', sb.state.reminders[0].remindAt === expectedRemindAt);

    // El usuario vuelve a editar la MISMA tarea y guarda de nuevo con el
    // mismo recordatorio (p.ej. solo cambia otro campo) — no debe crear
    // un segundo recordatorio para el mismo target.
    sb.openTaskModal({ taskId: created.id });
    seedTaskDefaults(sb, { title: created.title, dueDate: created.dueDate, dueTime: created.dueTime, reminderMinutes: '30', priority: 'alta' });
    await submitTaskForm(sb);
    check('10d. reeditar y guardar de nuevo con el MISMO recordatorio no crea uno duplicado', sb.state.reminders.length === 1);
    check('10e. la tarea se actualizó (no se duplicó) al reeditar', sb.state.tasks.length === 1 && sb.state.tasks[0].priority === 'alta');
  }

  // =====================================================================
  section('11) RECURRENCIA desde el Smart Form');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    const intent = sb.AIActions.detectSmartFormIntent('mañana tengo que estudiar biología', { todayStr: TODAY });
    const prefill = sb.AIActions.buildSmartFormPrefill(intent);
    sb.openSmartFormFromChat(intent);
    // El usuario elige "Cada 2 días", sin fecha de fin.
    seedTaskDefaults(sb, { title: prefill.title, dueDate: prefill.date, repeatType: 'daily', repeatInterval: '2', repeatEnd: 'never' });
    await submitTaskForm(sb);
    check('11a. se crea la tarea', sb.state.tasks.length === 1);
    const created = sb.state.tasks[0];
    check('11b. la recurrencia elegida por el usuario se conserva tal cual (type/interval)', !!created.recurrence && created.recurrence.type === 'daily' && created.recurrence.interval === 2);
    check('11c. no se recalcula ni se sobrescribe: startDate coincide con la fecha de la propia tarea, endDate null (sin fin elegido)', created.recurrence.startDate === created.dueDate && created.recurrence.endDate === null);

    // Evento con recurrencia "Cada 1 mes" hasta una fecha concreta.
    const sbE = makeFullSandbox();
    const intentE = sbE.AIActions.detectSmartFormIntent('el lunes tengo médico', { todayStr: TODAY });
    const prefillE = sbE.AIActions.buildSmartFormPrefill(intentE);
    sbE.openSmartFormFromChat(intentE);
    seedEventDefaults(sbE, { title: prefillE.title, date: prefillE.date, repeatType: 'monthly', repeatInterval: '1', repeatEnd: 'until', repeatEndDate: '2027-01-01' });
    await submitEventForm(sbE);
    const createdE = sbE.state.events[0];
    check('11d. recurrencia mensual con fecha de fin elegida por el usuario se conserva tal cual', !!createdE.recurrence && createdE.recurrence.type === 'monthly' && createdE.recurrence.endDate === '2027-01-01');
  }

  // =====================================================================
  section('12) Regresión puntual AI-2.7 x AI-2.8: el listener de submit sigue sin referenciar "pre"/"prefill"');
  // =====================================================================
  {
    // AI-2.7 (test-ai-2-7-smart-form-edit.js, checks "add1"/"add2") ya
    // comprobaba por CONTENIDO que el cuerpo del listener de submit de
    // cada modal nunca menciona "pre"/"prefill" (ni en código NI en
    // comentarios): la fuente de verdad al guardar es siempre el
    // FormData real, nunca el prefill original de la IA. AI-2.8 rompió
    // momentáneamente esa garantía al añadir, dentro del propio listener
    // de submit de la tarea, un comentario que mencionaba literalmente
    // "el prefill original" — un fallo real detectado por AI-2.9 y ya
    // corregido (solo el texto del comentario, sin tocar ninguna
    // lógica). Este bloque deja el caso cubierto aquí también, con el
    // código REAL, para que una futura fase no reintroduzca la misma
    // mención por accidente.
    function extractSubmitBody(src, formName) {
      const marker = `#${formName}').addEventListener('submit',`;
      const start = src.indexOf(marker);
      if (start === -1) throw new Error(`No se encontró el listener de submit de "${formName}"`);
      const end = src.indexOf('\n  });', start);
      return src.slice(start, end);
    }
    const taskSubmitBody = extractSubmitBody(openTaskModalSrc, 'task-form');
    const eventSubmitBody = extractSubmitBody(openEventModalSrc, 'event-form');
    check('12a. el listener de submit de tarea no referencia "pre" ni "prefill" (ni en código ni en comentarios)', !/\bpre\b/.test(taskSubmitBody) && !/\bprefill\b/.test(taskSubmitBody));
    check('12b. el listener de submit de evento no referencia "pre" ni "prefill" (ni en código ni en comentarios)', !/\bpre\b/.test(eventSubmitBody) && !/\bprefill\b/.test(eventSubmitBody));
    check('12c. el bloque de protección de duplicados (AI-2.8) sigue presente dentro del listener de submit de tarea', /findExistingSmartFormEquivalent/.test(taskSubmitBody));
    check('12d. el bloque de protección de duplicados (AI-2.8) sigue presente dentro del listener de submit de evento', /findExistingSmartFormEquivalent/.test(eventSubmitBody));
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
      const tmpPath = path.join(require('os').tmpdir(), `organizator-ai-2-9-check-${process.pid}.js`);
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
