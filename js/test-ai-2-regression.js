/**
 * ORGANIZATOR — AI-2.5: suite de regresión GLOBAL del bloque AI-2
 * (AI-2.1 detección de formulario inteligente, AI-2.2 prefill
 * normalizado, AI-2.3 apertura del formulario existente, AI-2.4
 * confirmación mediante el submit normal).
 *
 * Esto NO sustituye a las cuatro suites por fase (test-ai-2-1..4), que
 * siguen siendo la referencia detallada de cada una y deben seguir
 * ejecutándose por separado. Esta suite es el contrato CONJUNTO de AI-2:
 * comprueba, con el código REAL de organizator.html/ai-actions.js (nada
 * reimplementado), que las cuatro fases encajan sin contradecirse y que
 * la cadena completa mensaje -> detección -> prefill -> formulario ->
 * edición del usuario -> submit -> addTask/addEvent funciona de extremo
 * a extremo, sin ninguna vía alternativa de creación.
 *
 * A propósito, esta suite NO ejecuta las cuatro suites por fase como
 * subprocesos (a diferencia de como esas suites se prueban entre sí):
 * encadenarlas ya crea una cascada de subprocesos considerable
 * (test-ai-2-4 ya ejecuta test-ai-2-1/2/3, que a su vez ejecutan
 * test-ai-1-*), así que esta suite prueba el contrato conjunto
 * DIRECTAMENTE, con sus propios sandboxes — mismo criterio que ya usa
 * test-ai-1-regression.js frente a test-ai-1-1..5.
 *
 * Uso:  node js/test-ai-2-regression.js
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
// Fragmentos REALES de ai-actions.js (AI-1.2..1.5 + AI-2.1 + AI-2.2).
// ---------------------------------------------------------------------
const datetimeSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.2', '\n\n  /* ==================================================================\n     AI-1.3', 'bloque AI-1.2');
const implicitEventSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.3', '\n\n  /* ==================================================================\n     AI-1.4', 'bloque AI-1.3');
const implicitTaskSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.4', '\n\n  /* ==================================================================\n     AI-1.5', 'bloque AI-1.4');
const modificationSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.5', '\n\n  /* ==================================================================\n     AI-2.1', 'bloque AI-1.5');
const smartFormSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-2.1', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-2.1+AI-2.2');

// ---------------------------------------------------------------------
// Fragmentos REALES de organizator.html (mismo patrón que
// test-ai-2-3/4-smart-form-*.js).
// ---------------------------------------------------------------------
const escSrc = extractBetween(html, 'function esc(s){', '\n\n/* ==================================================================\n   FILAS DE TAREA', 'función esc()');
const dowConstsSrc = extractBetween(html, 'const DOW_NAMES = ', '\n\n/* ==================================================================\n   AJUSTES', 'constantes DOW_NAMES/...');
const sanitizeSrc = extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'bloque SANEAMIENTO (sanitizeRecurrence, R-1)');
const crudSrc = extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', 'bloque CRUD');
const remindersFase1Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)', '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', 'bloque RECORDATORIOS (Fase 1)');
const remindersFase3Src = extractBetween(html, '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)', '\n\n/* ==================================================================\n   TOAST', 'bloque RECORDATORIOS (Fase 3)');
const recurrenceUiSrc = extractBetween(html, '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)', '\n\n/* ==================================================================\n   MODAL: TAREA', 'bloque RECURRENCIA UI (R-5)');
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

/** Sandbox PURO con la cadena completa AI-1.2..1.5 + AI-2.1 + AI-2.2
 * (sin `state`, sin DOM). Usado para las secciones AI-2.1/AI-2.2. */
function makePureSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    datetimeSrc + '\n' + implicitEventSrc + '\n' + implicitTaskSrc + '\n' + modificationSrc + '\n' + smartFormSrc + `
    this.detectSmartFormIntent = detectSmartFormIntent;
    this.buildSmartFormPrefill = buildSmartFormPrefill;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2..1.5 + AI-2.1 + AI-2.2, puro)' }
  );
  return sandbox;
}

/** Registro de elementos DOM mínimo pero funcional (idéntico criterio
 * que test-ai-2-4-smart-form-submit.js): memoiza por id/name, expone
 * `.value`/`.checked`/`.addEventListener` reales para poder disparar el
 * submit/cancel real y leer con qué datos se llamó a addTask/addEvent. */
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

/** Sandbox COMPLETO: cadena AI-1.2..1.5 + AI-2.1 + AI-2.2 (detección +
 * prefill) + AI-2.3 (openSmartFormFromChat/runIAActionChat) + AI-2.4
 * (CRUD real, reminders/recurrencia reales, ambos modales de UX-8 reales)
 * sobre el DOM mínimo — usado para AI-2.3/AI-2.4/la cadena completa. */
function makeFullSandbox() {
  const sandbox = {};
  sandbox.console = console;
  const registry = makeElementRegistry();
  const calls = { addTask: 0, updateTask: 0, addEvent: 0, updateEvent: 0, closeModal: 0, runIAAction: 0, openTaskModal: 0, openEventModal: 0 };
  sandbox.__calls = calls;
  sandbox.__registry = registry;
  sandbox.__lastUserPrompt = null;

  vm.createContext(sandbox);
  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dowConstsSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/...)' });
  vm.runInContext(
    `let state = { tasks: [], events: [], eventCategories: [], reminders: [], customSchedules: [] };
     let window = {};
     let currentView = 'test';
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     function todayStr(){ return '2026-09-17'; }
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
  vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5)' });
  vm.runInContext(modalCollapsibleSrc, sandbox, { filename: 'organizator.html (UX-8 modalCollapsibleSection)' });
  vm.runInContext(openTaskModalSrc, sandbox, { filename: 'organizator.html (openTaskModal real)' });
  vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal real)' });
  // detectSmartFormIntent (AI-2.1) depende por dentro de isHolidayMessage/
  // isAppointmentMessage (AI-1.3), isTaskMessage (AI-1.4), isMoveMessage/
  // isCancelMessage/isPriorityChangeMessage (AI-1.5) y resolveDateExpression/
  // resolveTimeExpression (AI-1.2) — se cargan aquí también, no solo en
  // makePureSandbox(), para que la cadena completa (sección 3/6 más abajo)
  // funcione con el detectSmartFormIntent REAL, sin reimplementarlo.
  vm.runInContext(datetimeSrc, sandbox, { filename: 'ai-actions.js (AI-1.2)' });
  vm.runInContext(implicitEventSrc, sandbox, { filename: 'ai-actions.js (AI-1.3)' });
  vm.runInContext(implicitTaskSrc, sandbox, { filename: 'ai-actions.js (AI-1.4)' });
  vm.runInContext(modificationSrc, sandbox, { filename: 'ai-actions.js (AI-1.5)' });
  vm.runInContext(smartFormSrc, sandbox, { filename: 'ai-actions.js (AI-2.1+AI-2.2 real, dentro del sandbox de organizator.html)' });
  vm.runInContext(
    `const AIActions = {
       detectSmartFormIntent: detectSmartFormIntent,
       buildSmartFormPrefill: buildSmartFormPrefill,
       runIAAction: async (system, userPrompt) => { __calls.runIAAction++; __lastUserPrompt = userPrompt; return { answer: 'ok', applied: [] }; },
     };`,
    sandbox, { filename: 'AIActions-real' }
  );
  vm.runInContext(openSmartFormFromChatSrc, sandbox, { filename: 'organizator.html (openSmartFormFromChat real, AI-2.3)' });
  vm.runInContext(runIAActionChatSrc, sandbox, { filename: 'organizator.html (runIAActionChat real)' });
  vm.runInContext(
    `const __realOpenTaskModal = openTaskModal, __realOpenEventModal = openEventModal;
     // "this" es el objeto global de este contexto vm (mismo que
     // "sandbox" fuera): reasignar this.openTaskModal aquí también
     // actualiza el binding global que usa openSmartFormFromChat() por
     // dentro cuando llama a "openTaskModal(...)"/"openEventModal(...)"
     // sin cualificar — no hace falta reasignarlo dos veces.
     this.openTaskModal = function(...a){ __calls.openTaskModal++; return __realOpenTaskModal(...a); };
     this.openEventModal = function(...a){ __calls.openEventModal++; return __realOpenEventModal(...a); };
     this.openSmartFormFromChat = openSmartFormFromChat;
     this.runIAActionChat = runIAActionChat;
     this.state = state;
     this.modalBox = modalBox;
     this.closeModal = closeModal;
     this.AIActions = AIActions;
     const __realAddTask = addTask, __realUpdateTask = updateTask, __realAddEvent = addEvent, __realUpdateEvent = updateEvent, __realCloseModal = closeModal;
     addTask = async (...a) => { __calls.addTask++; return __realAddTask(...a); };
     updateTask = async (...a) => { __calls.updateTask++; return __realUpdateTask(...a); };
     addEvent = async (...a) => { __calls.addEvent++; return __realAddEvent(...a); };
     updateEvent = async (...a) => { __calls.updateEvent++; return __realUpdateEvent(...a); };
     closeModal = (...a) => { __calls.closeModal++; return __realCloseModal(...a); };
     this.iaThreadAddPending = () => ({ id: 'm1' });
     this.iaThreadResolve = () => {};
     iaThreadAddPending = () => ({ id: 'm1' });
     iaThreadResolve = () => {};`,
    sandbox, { filename: 'expose-and-spy' }
  );
  return sandbox;
}

function seedTaskDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  ['title', 'dueDate', 'dueTime', 'category', 'estimatedMinutes', 'repeatEndDate', 'reminderMinutes'].forEach(n => set(n, ''));
  set('priority', 'media'); set('repeatType', 'none'); set('repeatEnd', 'never');
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}
function seedEventDefaults(sb, overrides) {
  const r = sb.__registry;
  const set = (name, value) => { r.byNameEl(name).value = value; };
  ['title', 'categoryId', 'date', 'endDate', 'startTime', 'endTime', 'repeatEndDate', 'reminderMinutes'].forEach(n => set(n, ''));
  set('repeatType', 'none'); set('repeatEnd', 'never');
  const allDayEl = r.byNameEl('allDay'); allDayEl.__isCheckbox = true; allDayEl.__checkboxValue = 'on'; allDayEl.checked = false;
  Object.entries(overrides || {}).forEach(([k, v]) => set(k, v));
}
async function submitTaskForm(sb) { await fire(sb.__registry.byIdEl('task-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('task-form') }); }
async function submitEventForm(sb) { await fire(sb.__registry.byIdEl('event-form'), 'submit', { preventDefault() {}, target: sb.__registry.byIdEl('event-form') }); }
async function clickBtn(sb, id) { await fire(sb.__registry.byIdEl(id), 'click', {}); }

const TODAY = '2026-09-17';

(async () => {

  // =====================================================================
  section('0) Verificaciones de arquitectura (AI-2 no introduce vías paralelas)');
  // =====================================================================
  {
    check('0a. ACTION_SCHEMA no cambió (mismos 5 tipos de "op", mismos nombres de campo)',
      /"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc) &&
      (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
    check('0b. global.AIActions sigue exportando EXACTAMENTE runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES en su línea principal', /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('0c. detectSmartFormIntent/buildSmartFormPrefill se exponen como propiedades ADICIONALES, sin tocar esa línea', /global\.AIActions\.detectSmartFormIntent = detectSmartFormIntent;/.test(aiActionsSrc) && /global\.AIActions\.buildSmartFormPrefill = buildSmartFormPrefill;/.test(aiActionsSrc));
    check('0d. no hay una segunda definición de addTask/addEvent en organizator.html (una sola vía de creación)', (html.match(/async function addTask\(/g) || []).length === 1 && (html.match(/async function addEvent\(/g) || []).length === 1);
    check('0e. openSmartFormFromChat() no llama a addTask/addEvent directamente (no persiste desde el chat)', !/addTask\(/.test(openSmartFormFromChatSrc) && !/addEvent\(/.test(openSmartFormFromChatSrc));
    check('0f. runIAActionChat() no llama a addTask/addEvent directamente (la creación solo ocurre vía el submit del formulario)', !/\baddTask\(/.test(runIAActionChatSrc) && !/\baddEvent\(/.test(runIAActionChatSrc));
    check('0g. cada modal registra exactamente UN listener de submit (sin duplicar el listener)', (openTaskModalSrc.match(/task-form'\)\.addEventListener\('submit'/g) || []).length === 1 && (openEventModalSrc.match(/event-form'\)\.addEventListener\('submit'/g) || []).length === 1);
    check('0h. ai-actions.js sigue sin definir su propia lógica de Scheduler (solo la CONSUME)', !/function\s+scheduleTask\s*\(/.test(aiActionsSrc) && /global\.Scheduler\.scheduleTask/.test(aiActionsSrc));
    check('0i. no se creó ningún tipo de "op" nuevo (siguen siendo exactamente 5)', /"create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/.test(aiActionsSrc));
  }

  const pureSb = makePureSandbox();

  // =====================================================================
  section('AI-2.1 — detección');
  // =====================================================================
  {
    check('2.1a. detección de formulario para EVENTO ("examen de matemáticas")', pureSb.detectSmartFormIntent('examen de matemáticas', {}).type === 'event');
    check('2.1b. detección de formulario para TAREA ("estudiar biología")', pureSb.detectSmartFormIntent('estudiar biología', {}).type === 'task');
    const withDate = pureSb.detectSmartFormIntent('parcial de biología el jueves', { todayStr: TODAY });
    check('2.1c. fecha explícita detectada ("el jueves" -> 2026-09-17, hoy mismo)', withDate.fields.date === '2026-09-17');
    const withTime = pureSb.detectSmartFormIntent('parcial de biología a las 17:00', { todayStr: TODAY });
    check('2.1d. hora explícita detectada ("a las 17:00" -> 17:00)', withTime.fields.time === '17:00');
    const eventNoDate = pureSb.detectSmartFormIntent('examen de matemáticas', {});
    check('2.1e. evento sin fecha -> missingFields contiene "date"', eventNoDate.missingFields.includes('date'));
    const taskNoDate = pureSb.detectSmartFormIntent('estudiar biología', {});
    check('2.1f. tarea sin fecha -> puede quedar pendiente (missingFields NO exige "date" para tareas)', !taskNoDate.missingFields.includes('date') && !('date' in taskNoDate.fields));
    check('2.1g. comentario/no-acción no abre formulario ("Vale, entendido" -> null)', pureSb.detectSmartFormIntent('Vale, entendido', {}) === null);
    check('2.1h. mover no se convierte en Smart Form ("Mueve el examen al viernes" -> null)', pureSb.detectSmartFormIntent('Mueve el examen al viernes', {}) === null);
    check('2.1i. cancelar no se convierte en Smart Form ("Cancela el examen de biología" -> null)', pureSb.detectSmartFormIntent('Cancela el examen de biología', {}) === null);
  }

  // =====================================================================
  section('AI-2.2 — prefill normalizado');
  // =====================================================================
  {
    const rEvent = pureSb.buildSmartFormPrefill({ type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
    check('2.2a. evento -> prefill normalizado con type/title/date/time', rEvent.type === 'event' && rEvent.title === 'Parcial de biología' && rEvent.date === '2026-09-18' && rEvent.time === '17:00');
    const rTask = pureSb.buildSmartFormPrefill({ type: 'task', fields: { title: 'Estudiar biología' } });
    check('2.2b. tarea -> prefill normalizado con type/title', rTask.type === 'task' && rTask.title === 'Estudiar biología');
    const rInvalid = pureSb.buildSmartFormPrefill({ type: 'task', fields: { title: 'X' } }, { priority: 'urgentísimo', estimatedMinutes: -5, categoryId: '' });
    check('2.2c. conserva SOLO campos válidos (prioridad/duración/categoría inválidas del contexto se descartan)', !('priority' in rInvalid) && !('estimatedMinutes' in rInvalid) && !('categoryId' in rInvalid));
    const rNoInvent = pureSb.buildSmartFormPrefill({ type: 'event', fields: { title: 'Examen' } });
    check('2.2d. no inventa campos (sin date/time/allDay/categoryId/location/notes/recurrence/reminder)', ['date', 'time', 'allDay', 'categoryId', 'location', 'notes', 'recurrence', 'reminder'].every(k => !(k in rNoInvent)));
    const originalIntent = { type: 'event', fields: { title: 'X', date: '2026-09-18' }, missingFields: [], sourceText: 'x' };
    const snapshot = JSON.stringify(originalIntent);
    pureSb.buildSmartFormPrefill(originalIntent);
    check('2.2e. no modifica el intent original', JSON.stringify(originalIntent) === snapshot);
    const r1 = pureSb.buildSmartFormPrefill(originalIntent);
    check('2.2f. devuelve un objeto NUEVO (no el mismo intent.fields por referencia)', r1 !== originalIntent.fields && r1 !== originalIntent);
    check('2.2g. fechas inválidas no entran en el prefill ("32/13" con formato roto)', !('date' in pureSb.buildSmartFormPrefill({ type: 'event', fields: { title: 'X', date: '2026-13-40' } })));
    check('2.2h. horas inválidas no entran en el prefill ("25:99")', !('time' in pureSb.buildSmartFormPrefill({ type: 'event', fields: { title: 'X', time: '25:99' } })));
    check('2.2i. prioridades inválidas no entran en el prefill', !('priority' in pureSb.buildSmartFormPrefill({ type: 'task', fields: { title: 'X' } }, { priority: 'urgentísimo' })));
  }

  // =====================================================================
  section('AI-2.3 — apertura del formulario existente');
  // =====================================================================
  {
    check('2.3a. openSmartFormFromChat() llama a AIActions.buildSmartFormPrefill (evidencia en el código fuente)', /AIActions\.buildSmartFormPrefill\(intent\)/.test(openSmartFormFromChatSrc));

    const sbEvent = makeFullSandbox();
    sbEvent.openSmartFormFromChat({ type: 'event', fields: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' }, missingFields: [], sourceText: 'x' });
    check('2.3b. intención "event" abre el formulario de EVENTO', sbEvent.__calls.openEventModal === 1 && sbEvent.__calls.openTaskModal === 0);
    check('2.3c. los valores del prefill aparecen inicialmente en el HTML del formulario (título/fecha/hora)',
      /name="title" required value="Parcial de biología"/.test(sbEvent.modalBox.innerHTML) &&
      /name="date" required value="2026-09-18"/.test(sbEvent.modalBox.innerHTML) &&
      /name="startTime" value="17:00"/.test(sbEvent.modalBox.innerHTML));

    const sbTask = makeFullSandbox();
    sbTask.openSmartFormFromChat({ type: 'task', fields: { title: 'Estudiar biología' }, missingFields: [], sourceText: 'x' });
    check('2.3d. intención "task" abre el formulario de TAREA', sbTask.__calls.openTaskModal === 1 && sbTask.__calls.openEventModal === 0);

    check('2.3e. abrir el formulario no crea ninguna tarea ni evento', sbEvent.state.tasks.length === 0 && sbEvent.state.events.length === 0 && sbTask.state.tasks.length === 0 && sbTask.state.events.length === 0);
    check('2.3f. abrir el formulario no llama directamente a runIAAction/AIActions.runIAAction', sbEvent.__calls.runIAAction === 0 && sbTask.__calls.runIAAction === 0);

    const sbCancel = makeFullSandbox();
    sbCancel.openTaskModal({ prefill: { title: 'Estudiar biología' } });
    seedTaskDefaults(sbCancel, { title: 'Estudiar biología' });
    await clickBtn(sbCancel, 'task-cancel-btn');
    check('2.3g. cancelar no crea nada (closeModal invocado, 0 tareas creadas)', sbCancel.__calls.closeModal === 1 && sbCancel.state.tasks.length === 0);
  }

  // =====================================================================
  section('AI-2.4 — confirmación mediante el submit normal');
  // =====================================================================
  {
    // Evento: prefill 17:00, el usuario lo cambia a 18:00 antes de guardar.
    const sbE = makeFullSandbox();
    sbE.openEventModal({ prefill: { title: 'Parcial de biología', date: '2026-09-18', time: '17:00' } });
    seedEventDefaults(sbE, { title: 'Parcial de biología', date: '2026-09-18', startTime: '17:00' });
    sbE.__registry.byNameEl('startTime').value = '18:00'; // el usuario modifica la hora
    await submitEventForm(sbE);
    check('2.4a. el submit usa los valores ACTUALES del formulario (18:00), no el prefill original (17:00)', sbE.state.events[0].startTime === '18:00');
    check('2.4b. la modificación del usuario prevalece sobre el prefill', sbE.state.events[0].startTime !== '17:00');
    check('2.4c. el evento se crea mediante addEvent (real, espiado)', sbE.__calls.addEvent === 1 && sbE.__calls.addTask === 0);
    check('2.4d. exactamente UNA creación', sbE.state.events.length === 1);

    // Tarea: sin prioridad prellenada (default "media"), el usuario la sube a "alta".
    const sbT = makeFullSandbox();
    sbT.openTaskModal({ prefill: { title: 'Estudiar biología' } });
    seedTaskDefaults(sbT, { title: 'Estudiar biología' });
    sbT.__registry.byNameEl('priority').value = 'alta';
    await submitTaskForm(sbT);
    check('2.4e. la tarea se crea mediante addTask (real, espiado)', sbT.__calls.addTask === 1 && sbT.__calls.addEvent === 0);
    check('2.4f. exactamente UNA creación', sbT.state.tasks.length === 1);
    check('2.4g. el valor modificado por el usuario (prioridad "alta") prevalece', sbT.state.tasks[0].priority === 'alta');

    // Cancelar no crea.
    const sbC = makeFullSandbox();
    sbC.openEventModal({ prefill: { title: 'Examen', date: '2026-09-20' } });
    seedEventDefaults(sbC, { title: 'Examen', date: '2026-09-20' });
    await clickBtn(sbC, 'event-cancel-btn');
    check('2.4h. cancelar no crea nada', sbC.state.events.length === 0 && sbC.__calls.addEvent === 0);

    // Campo obligatorio ausente -> validación normal existente (sin añadir ninguna nueva).
    const sbInvalid = makeFullSandbox();
    sbInvalid.openEventModal({ prefill: { title: 'Examen' } }); // sin fecha
    seedEventDefaults(sbInvalid, { title: 'Examen', date: '' });
    await submitEventForm(sbInvalid);
    check('2.4i. campo obligatorio ausente (fecha de evento) sigue usando la validación normal (no se crea nada)', sbInvalid.state.events.length === 0);

    // Flujo manual (sin prefill) sigue funcionando exactamente igual.
    const sbManual = makeFullSandbox();
    sbManual.openTaskModal({});
    seedTaskDefaults(sbManual, { title: 'Comprar leche', dueDate: '2026-09-19' });
    await submitTaskForm(sbManual);
    check('2.4j. el flujo MANUAL de creación (sin prefill) sigue funcionando exactamente igual', sbManual.state.tasks.length === 1 && sbManual.state.tasks[0].title === 'Comprar leche');
  }

  // =====================================================================
  section('3) Cadena completa: mensaje -> detectSmartFormIntent -> buildSmartFormPrefill -> openSmartFormFromChat -> edición -> submit -> addEvent');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    const message = 'parcial de biología el jueves a las 17:00';

    // Etapa 1: detección — se comprueba que la etapa 2 recibe EXACTAMENTE
    // lo que produjo la etapa 1 (mismo objeto, no uno reconstruido aparte).
    const intent = sb.AIActions.detectSmartFormIntent(message, { todayStr: TODAY });
    check('3a. etapa 1 (detectSmartFormIntent) detecta un evento con título/fecha/hora', intent !== null && intent.type === 'event' && intent.fields.title === 'Parcial de biología' && intent.fields.date === '2026-09-17' && intent.fields.time === '17:00');

    // Etapa 2: prefill — recibe el intent tal cual de la etapa 1.
    const prefill = sb.AIActions.buildSmartFormPrefill(intent);
    check('3b. etapa 2 (buildSmartFormPrefill) recibe los datos de la etapa 1 y los normaliza igual', prefill.title === intent.fields.title && prefill.date === intent.fields.date && prefill.time === intent.fields.time);

    // Etapa 3: apertura del formulario — recibe el prefill tal cual de la etapa 2.
    sb.openSmartFormFromChat(intent); // reproduce el mismo camino que runIAActionChat (llama a buildSmartFormPrefill por dentro, no se salta ninguna etapa)
    check('3c. etapa 3 (openSmartFormFromChat) abrió el formulario de EVENTO (no de tarea, ni ninguna otra vía)', sb.__calls.openEventModal === 1 && sb.__calls.openTaskModal === 0);
    check('3c-bis. abrir el formulario NO creó nada todavía (ninguna "segunda creación" antes de que el usuario confirme)', sb.state.events.length === 0 && sb.__calls.addEvent === 0);

    // Etapa 4: el usuario modifica un campo (la hora) antes de guardar.
    seedEventDefaults(sb, { title: prefill.title, date: prefill.date, startTime: prefill.time });
    sb.__registry.byNameEl('startTime').value = '18:00';

    // Etapa 5: submit -> addEvent (flujo normal, sin saltárselo).
    await submitEventForm(sb);
    check('3d. etapa 5 (submit) crea EXACTAMENTE un evento, vía addEvent real', sb.state.events.length === 1 && sb.__calls.addEvent === 1);
    // Se comprueba por PROPIEDADES relevantes (título/fecha/hora), nunca
    // por posición de array ni por el valor exacto del id generado al
    // azar (uid()) — el propio id puede ser cualquiera, lo que importa es
    // que el título/fecha vienen de la detección original y la hora es
    // la que el usuario acabó dejando.
    const created = sb.state.events.find(e => e.title === 'Parcial de biología');
    check('3e. el evento creado se identifica por sus PROPIEDADES (título/fecha), no por posición ni por su id', !!created && created.date === prefill.date && created.startTime === '18:00');
    check('3f. no se llamó nunca a AIActions.runIAAction (no hay una segunda vía de creación vía IA para este mensaje)', sb.__calls.runIAAction === 0);
    check('3g. no se llamó a addTask (el mensaje era un evento, no una tarea — ninguna creación cruzada)', sb.__calls.addTask === 0);
  }

  // =====================================================================
  section('6) runIAActionChat(): puede abrir Smart Forms pero NO crea directamente la tarea/evento');
  // =====================================================================
  {
    const sb = makeFullSandbox();
    await sb.runIAActionChat('parcial de biología el jueves a las 17:00');
    check('6a. runIAActionChat() con una intención válida abre el formulario correspondiente', sb.__calls.openEventModal === 1);
    check('6b. runIAActionChat() NO crea directamente el evento (0 addEvent en este turno, pese a haber datos suficientes)', sb.__calls.addEvent === 0);
    check('6c. runIAActionChat() NO llama a AIActions.runIAAction cuando hay una intención de formulario válida', sb.__calls.runIAAction === 0);

    // Para un mensaje SIN intención de formulario, el camino normal de
    // AI-1 (AIActions.runIAAction) sigue intacto y funcionando.
    const sb2 = makeFullSandbox();
    await sb2.runIAActionChat('Mueve el examen de biología al viernes');
    check('6d. un mensaje de modificación (AI-1.5) sigue usando AIActions.runIAAction con normalidad, no abre ningún formulario', sb2.__calls.runIAAction === 1 && sb2.__calls.openEventModal === 0 && sb2.__calls.openTaskModal === 0);
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
      const tmpPath = path.join(require('os').tmpdir(), `organizator-ai-2-5-check-${process.pid}.js`);
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
