/**
 * ORGANIZATOR — Tests de 6A-3 (categorías configurables de eventos)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente el bloque
 * de CATEGORÍAS DE EVENTOS de organizator.html (addEventCategory,
 * updateEventCategory, deleteEventCategory, resolveEventCategory,
 * resolveEventBlocksSchedule, resolveEventColor, eventsForScheduler) y lo
 * ejecuta junto con el js/scheduler.js real del proyecto (cargado tal
 * cual, sin tocar ni un carácter) — mismo patrón que el resto de la suite
 * (test-ia-week-validation.js, test-ia-revalidate-before-apply.js, etc.).
 *
 * También comprueba, por separado, que schedulerContext() de
 * js/ai-actions.js (el único punto de ese archivo tocado en esta fase)
 * resuelve blocksSchedule igual que el resto de la app, sin afectar a
 * buildActionContext ni al resto del contrato público de AIActions.
 *
 * Uso:  node js/test-event-categories.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
const SCHEDULER_PATH = path.join(ROOT, 'js', 'scheduler.js');
const AI_ACTIONS_PATH = path.join(ROOT, 'js', 'ai-actions.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf8');
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}
function extractFn(source, signatureRegex, label) {
  const re = new RegExp(signatureRegex.source + '[\\s\\S]*?\\n\\}\\n', signatureRegex.flags);
  const m = source.match(re);
  if (!m) throw new Error(`No se encontró "${label}" — ¿cambió el código?`);
  return m[0];
}

// ---------------------------------------------------------------------
// Bloque real de "CATEGORÍAS DE EVENTOS (Fase 6A-3)" de organizator.html.
// ---------------------------------------------------------------------
const categoriesSrc = extractBetween(
  html,
  '/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  '\n/* ==================================================================\n   TOAST',
  'bloque CATEGORÍAS DE EVENTOS (6A-3)'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// ---------------- Storage en memoria (sustituye a window.storage) ----------------
function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    async get(key) {
      if (!map.has(key)) return null;
      return { key, value: map.get(key), shared: false };
    },
    async set(key, value) {
      map.set(key, value);
      return { key, value, shared: false };
    },
  };
}

function makeSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });
  vm.runInContext(
    `let state = { events: [], tasks: [], customSchedules: [], eventCategories: [] };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveEventCategories(){
       await window.storage.set('eventCategories', JSON.stringify(state.eventCategories), false);
     }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  vm.runInContext(categoriesSrc, sandbox, { filename: 'organizator.html (categorías de eventos, 6A-3)' });
  vm.runInContext(
    `this.addEventCategory = addEventCategory;
     this.updateEventCategory = updateEventCategory;
     this.deleteEventCategory = deleteEventCategory;
     this.resolveEventCategory = resolveEventCategory;
     this.resolveEventBlocksSchedule = resolveEventBlocksSchedule;
     this.resolveEventColor = resolveEventColor;
     this.eventsForScheduler = eventsForScheduler;
     this.state = state;
     this.Scheduler = window.Scheduler;`,
    sandbox, { filename: 'expose-6A-3' }
  );
  return sandbox;
}

(async () => {

  // =====================================================================
  section('1) Persistencia de eventCategories');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cat = await sb.addEventCategory({ name: 'Vacaciones', color: '#2E8B57', blocksSchedule: false });
    check('1. addEventCategory guarda en window.storage bajo la clave "eventCategories"', sb.storage._map.has('eventCategories'));
    const stored = JSON.parse(sb.storage._map.get('eventCategories'));
    check('1. el contenido guardado incluye la categoría creada (id, name, color, blocksSchedule)',
      Array.isArray(stored) && stored.length === 1 && stored[0].id === cat.id && stored[0].name === 'Vacaciones' &&
      stored[0].color === '#2E8B57' && stored[0].blocksSchedule === false);
    check('1. id de categoría estable y único (no vacío)', typeof cat.id === 'string' && cat.id.length > 0);
  }

  // =====================================================================
  section('2-3) blocksSchedule true / false en la categoría');
  // =====================================================================
  {
    const sb = makeSandbox();
    const blocking = await sb.addEventCategory({ name: 'Trabajo', color: '#1B1F23' }); // sin blocksSchedule explícito
    check('2. categoría nueva sin blocksSchedule explícito → true por defecto', blocking.blocksSchedule === true);
    const nonBlocking = await sb.addEventCategory({ name: 'Vacaciones', color: '#2E8B57', blocksSchedule: false });
    check('3. categoría creada con blocksSchedule:false → se guarda como false', nonBlocking.blocksSchedule === false);
  }

  // =====================================================================
  section('4) Evento sin categoryId conserva comportamiento actual');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('4. resolveEventBlocksSchedule(undefined) === true (evento sin categoría sigue bloqueando)', sb.resolveEventBlocksSchedule(undefined) === true);
    check('4. resolveEventBlocksSchedule("") === true', sb.resolveEventBlocksSchedule('') === true);
    check('4. resolveEventColor(undefined) === null (usa el color por defecto actual, no inventa uno)', sb.resolveEventColor(undefined) === null);
    check('4. resolveEventCategory(undefined) === null', sb.resolveEventCategory(undefined) === null);
  }

  // =====================================================================
  section('5-6) Evento con categoryId válido recibe color y blocksSchedule correctos');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cat = await sb.addEventCategory({ name: 'Deporte', color: '#D98E2C', blocksSchedule: false });
    sb.state.events.push({ id: 'ev1', title: 'Maratón', date: '2026-10-01', allDay: true, categoryId: cat.id });
    sb.state.events.push({ id: 'ev2', title: 'Sin categoría', date: '2026-10-02', allDay: true });
    check('5. resolveEventColor(categoryId válido) devuelve el color exacto de la categoría', sb.resolveEventColor(cat.id) === '#D98E2C');
    check('6. resolveEventBlocksSchedule(categoryId válido) devuelve el blocksSchedule de la categoría', sb.resolveEventBlocksSchedule(cat.id) === false);
    const resolved = sb.eventsForScheduler();
    const ev1 = resolved.find(e => e.id === 'ev1');
    const ev2 = resolved.find(e => e.id === 'ev2');
    check('6. eventsForScheduler() añade blocksSchedule=false al evento con esa categoría', ev1.blocksSchedule === false);
    check('4/6. eventsForScheduler() deja blocksSchedule=true al evento sin categoría', ev2.blocksSchedule === true);
    check('6. eventsForScheduler() no muta el state.events original (copias, no referencias)', sb.state.events[0].blocksSchedule === undefined);
  }

  // =====================================================================
  section('7) categoryId inexistente (huérfano) usa comportamiento por defecto');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('7. resolveEventBlocksSchedule("no-existe") === true', sb.resolveEventBlocksSchedule('no-existe') === true);
    check('7. resolveEventColor("no-existe") === null (color por defecto)', sb.resolveEventColor('no-existe') === null);
  }

  // =====================================================================
  section('8) Eliminar categoría no elimina eventos (quedan huérfanos, no rotos)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cat = await sb.addEventCategory({ name: 'Personal', color: '#333' });
    sb.state.events.push({ id: 'ev1', title: 'Cita', date: '2026-10-05', categoryId: cat.id });
    await sb.deleteEventCategory(cat.id);
    check('8. la categoría ya no está en state.eventCategories', sb.state.eventCategories.length === 0);
    check('8. el evento sigue existiendo en state.events (no se borra nada)', sb.state.events.length === 1 && sb.state.events[0].id === 'ev1');
    check('8. el categoryId huérfano ahora resuelve al comportamiento por defecto', sb.resolveEventBlocksSchedule(sb.state.events[0].categoryId) === true);
  }

  // =====================================================================
  section('9-10) Semántica allDay + blocksSchedule en Scheduler (getBusyIntervals)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const ctxBlocking = {
      events: [{ id: 'e1', title: 'Bloqueante', date: '2026-10-10', allDay: true, blocksSchedule: true }],
      tasks: [], customSchedules: [],
    };
    const busyBlocking = sb.Scheduler._internal.getBusyIntervals('2026-10-10', ctxBlocking);
    check('9. evento allDay con categoría bloqueante (blocksSchedule:true) genera intervalo [0, 1440]',
      busyBlocking.length === 1 && busyBlocking[0][0] === 0 && busyBlocking[0][1] === 24 * 60);

    const ctxNonBlocking = {
      events: [{ id: 'e2', title: 'No bloqueante', date: '2026-10-10', allDay: true, blocksSchedule: false }],
      tasks: [], customSchedules: [],
    };
    const busyNonBlocking = sb.Scheduler._internal.getBusyIntervals('2026-10-10', ctxNonBlocking);
    check('10. evento allDay con categoría NO bloqueante (blocksSchedule:false) NO genera ningún intervalo ocupado',
      busyNonBlocking.length === 0);

    // Mismo par de casos, pero contra buildDayBlocks (la segunda comprobación tocada en scheduler.js).
    const blocksBlocking = sb.Scheduler.buildDayBlocks('2026-10-10', ctxBlocking, { dayStart: '07:00', dayEnd: '23:00' });
    check('9b. buildDayBlocks también bloquea el día completo con blocksSchedule:true (todo el rango dayStart–dayEnd queda "busy")',
      blocksBlocking.blocks.length === 1 && blocksBlocking.blocks[0].type === 'busy' &&
      blocksBlocking.blocks[0].startTime === '07:00' && blocksBlocking.blocks[0].endTime === '23:00');
    const blocksNonBlocking = sb.Scheduler.buildDayBlocks('2026-10-10', ctxNonBlocking, { dayStart: '07:00', dayEnd: '23:00' });
    check('10b. buildDayBlocks no genera ningún bloque "busy" con blocksSchedule:false (todo queda libre)',
      !blocksNonBlocking.blocks.some(b => b.type === 'busy'));
  }

  // =====================================================================
  section('11) Evento normal con hora (no allDay) sigue funcionando exactamente igual');
  // =====================================================================
  {
    const sb = makeSandbox();
    const ctx = {
      events: [{ id: 'e3', title: 'Reunión', date: '2026-10-10', startTime: '10:00', endTime: '11:00' }],
      tasks: [], customSchedules: [],
    };
    const busy = sb.Scheduler._internal.getBusyIntervals('2026-10-10', ctx);
    check('11. evento con hora fija (sin allDay) genera su intervalo normal, sin verse afectado por blocksSchedule',
      busy.length === 1 && busy[0][0] === 10 * 60 && busy[0][1] === 11 * 60);
  }

  // =====================================================================
  section('12) customSchedules no se rompe');
  // =====================================================================
  {
    const sb = makeSandbox();
    const ctx = {
      events: [],
      tasks: [],
      customSchedules: [{ id: 's1', name: 'Escuela', days: [dowOf2026_10_12()], startTime: '08:00', endTime: '14:00' }],
    };
    const busy = sb.Scheduler._internal.getBusyIntervals('2026-10-12', ctx);
    check('12. un horario bloqueado (customSchedules) sigue generando su intervalo normal',
      busy.length === 1 && busy[0][0] === 8 * 60 && busy[0][1] === 14 * 60);
  }
  function dowOf2026_10_12() {
    // Lunes=0…Domingo=6, igual que dowOfDate() de organizator.html/scheduler.js.
    const d = new Date(2026, 9, 12);
    return (d.getDay() + 6) % 7;
  }

  // =====================================================================
  section('13) Las tareas no se modifican');
  // =====================================================================
  {
    const sb = makeSandbox();
    const originalTask = { id: 't1', title: 'Estudiar', category: 'Cole', priority: 'media' };
    sb.state.tasks.push(originalTask);
    sb.eventsForScheduler(); // solo debe tocar events, nunca tasks
    check('13. eventsForScheduler() no toca ni copia state.tasks (misma referencia, sin campos nuevos)',
      sb.state.tasks[0] === originalTask && !('blocksSchedule' in sb.state.tasks[0]));
    check('13. task.category (texto libre) sigue intacto, sin relación con eventCategories', sb.state.tasks[0].category === 'Cole');
  }

  // =====================================================================
  section('14) Propuestas IA / schedulerContext no rompen su contrato');
  // =====================================================================
  {
    // 14a) El único cambio de esta fase en ai-actions.js es schedulerContext();
    // buildActionContext (el texto que lee la IA) no debe mencionar categorías.
    const buildActionContextSrc = extractBetween(
      aiActionsSrc,
      'function buildActionContext() {',
      '\n  /* ---------------- Aplicar el resultado de la IA ---------------- */',
      'buildActionContext'
    );
    check('14. buildActionContext() no se ha tocado: no menciona categoryId/eventCategories',
      !/categoryId|eventCategories/.test(buildActionContextSrc));

    // 14b) schedulerContext() resuelve blocksSchedule vía eventsForScheduler()
    // cuando existe, y sigue funcionando (sin lanzar) cuando no existe.
    const schedulerContextSrc = extractBetween(
      aiActionsSrc,
      'function schedulerContext() {',
      '\n\n  async function applyCreateTask',
      'schedulerContext'
    );
    const sb2 = {};
    sb2.global = sb2;
    sb2.console = console;
    vm.createContext(sb2);
    sb2.state = {
      tasks: [{ id: 't1' }],
      events: [{ id: 'e1', allDay: true, categoryId: 'catA' }],
      customSchedules: [],
    };
    vm.runInContext(schedulerContextSrc + '\nthis.schedulerContext = schedulerContext;', sb2, { filename: 'ai-actions.js (schedulerContext)' });
    const ctxWithoutHelper = sb2.schedulerContext();
    check('14. sin eventsForScheduler() disponible, schedulerContext() no lanza y usa state.events tal cual (fallback seguro)',
      Array.isArray(ctxWithoutHelper.events) && ctxWithoutHelper.events[0].id === 'e1' && ctxWithoutHelper.tasks[0].id === 't1');

    sb2.eventsForScheduler = () => sb2.state.events.map(e => Object.assign({}, e, { blocksSchedule: e.categoryId === 'catA' ? false : true }));
    const ctxWithHelper = sb2.schedulerContext();
    check('14. con eventsForScheduler() disponible, schedulerContext() la usa y blocksSchedule llega resuelto',
      ctxWithHelper.events[0].blocksSchedule === false);

    // 14c) El contrato público de AIActions (runIAAction/buildActionContext/ACTION_SCHEMA/ACTION_RULES) sigue igual.
    check('14. ai-actions.js sigue exportando exactamente el mismo contrato público (AIActions)',
      /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
  }

  // =====================================================================
  section('15) Persistencia sobrevive a "recargar" el estado (loadState)');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addEventCategory({ name: 'Casa', color: '#7A5C3E', blocksSchedule: true });
    await sb.addEventCategory({ name: 'Ocio', color: '#4477AA', blocksSchedule: false });
    const persisted = sb.storage._map.get('eventCategories');

    // Simula loadState() leyendo la misma clave en un state fresco.
    const reloadedState = { eventCategories: JSON.parse(persisted) };
    check('15. tras "recargar", siguen existiendo las 2 categorías guardadas', reloadedState.eventCategories.length === 2);
    check('15. los nombres y colores sobreviven exactamente igual', reloadedState.eventCategories.some(c => c.name === 'Casa' && c.color === '#7A5C3E') &&
      reloadedState.eventCategories.some(c => c.name === 'Ocio' && c.color === '#4477AA' && c.blocksSchedule === false));
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
