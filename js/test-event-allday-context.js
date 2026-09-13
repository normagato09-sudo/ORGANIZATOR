/**
 * ORGANIZATOR — Tests de 6A-4.2 (eventos all-day como "contexto", sin
 * bloquear la planificación, frente a all-day que sigue bloqueando)
 *
 * Suite Node pura, SIN navegador ni jsdom — mismo patrón que
 * test-event-categories.js: carga js/scheduler.js REAL tal cual (sin
 * tocar ni un carácter) y extrae literalmente el bloque de CATEGORÍAS DE
 * EVENTOS de organizator.html (addEventCategory, resolveEventCategory,
 * resolveEventBlocksSchedule, resolveEventColor, eventsForScheduler),
 * porque es ahí donde vive la lógica real que decide si un evento all-day
 * bloquea el horario o queda como "evento-contexto" (blocksSchedule).
 *
 * IMPORTANTE — qué es "event-context" en el código actual:
 * Scheduler.js no conoce categorías ni tiene un campo/tipo llamado
 * "context": lo único que existe es `blocksSchedule` (resuelto en
 * organizator.html a partir de categoryId, vía resolveEventBlocksSchedule
 * / eventsForScheduler). Un evento all-day con blocksSchedule === false
 * es, en la práctica, un "evento-contexto": se guarda y se muestra en el
 * listado de eventos igual que cualquier otro, pero no genera intervalo
 * ocupado, no resta tiempo libre, no genera conflictos y no aparece como
 * bloque "busy" en buildDayBlocks (que es la señal que usan tanto el día
 * como las propuestas de la IA para saber qué hay ocupado). Esta suite
 * verifica exactamente ese comportamiento REAL, sin inventar un tipo de
 * dato, campo o función nuevos que no existan en el código.
 *
 * Uso:  node js/test-event-allday-context.js
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

// ---------------------------------------------------------------------
// Bloque real de "CATEGORÍAS DE EVENTOS (Fase 6A-3)" de organizator.html
// — mismo bloque del que depende resolveEventBlocksSchedule/eventsForScheduler,
// que es la lógica real que produce el comportamiento "event-context".
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
     this.deleteEventCategory = deleteEventCategory;
     this.resolveEventCategory = resolveEventCategory;
     this.resolveEventBlocksSchedule = resolveEventBlocksSchedule;
     this.resolveEventColor = resolveEventColor;
     this.eventsForScheduler = eventsForScheduler;
     this.state = state;
     this.Scheduler = window.Scheduler;`,
    sandbox, { filename: 'expose-6A-4.2' }
  );
  return sandbox;
}

function dowOf(y, m, d) {
  // Lunes=0…Domingo=6, igual que dowOfDate() de organizator.html/scheduler.js.
  const dt = new Date(y, m - 1, d);
  return (dt.getDay() + 6) % 7;
}

(async () => {

  // =====================================================================
  section('1) All-day con blocksSchedule=false vía categoría → se resuelve como evento-contexto');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cat = await sb.addEventCategory({ name: 'Cumpleaños', color: '#B23A48', blocksSchedule: false });
    sb.state.events.push({ id: 'ctx1', title: 'Cumple de Ana', date: '2026-11-03', allDay: true, categoryId: cat.id });
    const resolved = sb.eventsForScheduler();
    const ev = resolved.find(e => e.id === 'ctx1');
    check('1. el evento all-day con categoría no bloqueante resuelve blocksSchedule===false (es "evento-contexto")',
      ev.blocksSchedule === false);
    check('1. sigue siendo allDay:true (no se transforma en otro tipo de dato)', ev.allDay === true);
  }

  // =====================================================================
  section('2) event-context no genera intervalo ocupado (getBusyIntervals)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const ctx = {
      events: [{ id: 'ctx1', title: 'Cumple', date: '2026-11-03', allDay: true, blocksSchedule: false }],
      tasks: [], customSchedules: [],
    };
    const busy = sb.Scheduler._internal.getBusyIntervals('2026-11-03', ctx);
    check('2. getBusyIntervals no incluye ningún intervalo por un evento-contexto', busy.length === 0);
  }

  // =====================================================================
  section('3) event-context no reduce el tiempo libre (getFreeSlots)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const withoutCtx = { events: [], tasks: [], customSchedules: [] };
    const withCtx = { events: [{ id: 'ctx1', title: 'Cumple', date: '2026-11-03', allDay: true, blocksSchedule: false }], tasks: [], customSchedules: [] };
    const dateStr = '2026-11-03';
    const opts = { dayStart: '07:00', dayEnd: '23:00' };
    const freeWithout = sb.Scheduler.getFreeSlots(dateStr, withoutCtx, opts);
    const freeWith = sb.Scheduler.getFreeSlots(dateStr, withCtx, opts);
    check('3. getFreeSlots() da exactamente los mismos huecos con o sin el evento-contexto ese día',
      JSON.stringify(freeWithout) === JSON.stringify(freeWith));
  }

  // =====================================================================
  section('4) event-context no genera conflictos (findConflicts)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const dateStr = '2026-11-03';
    const ctx = {
      events: [{ id: 'ctx1', title: 'Cumple', date: dateStr, allDay: true, blocksSchedule: false }],
      tasks: [{ id: 't1', scheduledDate: dateStr, scheduledStart: '10:00', scheduledEnd: '11:00' }],
      customSchedules: [],
    };
    const conflicts = sb.Scheduler.findConflicts(dateStr, ctx);
    check('4. una tarea ya programada ese día NO aparece en conflicto por culpa del evento-contexto', conflicts.length === 0);
  }

  // =====================================================================
  section('5) All-day bloqueante (blocksSchedule=true) sigue bloqueando el día completo');
  // =====================================================================
  {
    const sb = makeSandbox();
    const ctx = {
      events: [{ id: 'ev1', title: 'Examen', date: '2026-11-04', allDay: true, blocksSchedule: true }],
      tasks: [], customSchedules: [],
    };
    const busy = sb.Scheduler._internal.getBusyIntervals('2026-11-04', ctx);
    check('5. all-day bloqueante genera intervalo [0, 1440] (todo el día ocupado)',
      busy.length === 1 && busy[0][0] === 0 && busy[0][1] === 24 * 60);
    const free = sb.Scheduler.getFreeSlots('2026-11-04', ctx, { dayStart: '07:00', dayEnd: '23:00' });
    check('5. no queda ningún hueco libre ese día', free.length === 0);
  }

  // =====================================================================
  section('6) All-day SIN blocksSchedule explícito sigue bloqueando (compatibilidad con eventos antiguos)');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('6. resolveEventBlocksSchedule(undefined) === true (evento sin categoría → sigue bloqueando)',
      sb.resolveEventBlocksSchedule(undefined) === true);
    const ctx = {
      // Evento antiguo, tal como existía antes de 6A-3: allDay sin categoryId ni blocksSchedule.
      events: [{ id: 'old1', title: 'Vacaciones (evento antiguo)', date: '2026-11-05', allDay: true }],
      tasks: [], customSchedules: [],
    };
    const busy = sb.Scheduler._internal.getBusyIntervals('2026-11-05', ctx);
    check('6. all-day sin blocksSchedule (undefined) sigue generando [0, 1440], igual que antes de 6A-3',
      busy.length === 1 && busy[0][0] === 0 && busy[0][1] === 24 * 60);
  }

  // =====================================================================
  section('7) Evento con hora fija (no all-day) no se ve afectado por blocksSchedule/contexto');
  // =====================================================================
  {
    const sb = makeSandbox();
    const ctx = {
      events: [{ id: 'ev2', title: 'Reunión', date: '2026-11-06', startTime: '09:00', endTime: '10:00', blocksSchedule: false }],
      tasks: [], customSchedules: [],
    };
    const busy = sb.Scheduler._internal.getBusyIntervals('2026-11-06', ctx);
    check('7. un evento con hora fija sigue generando su intervalo normal aunque blocksSchedule sea false (solo aplica a allDay)',
      busy.length === 1 && busy[0][0] === 9 * 60 && busy[0][1] === 10 * 60);
  }

  // =====================================================================
  section('8) Las tareas no cambian con esta fase');
  // =====================================================================
  {
    const sb = makeSandbox();
    const originalTask = { id: 't1', title: 'Estudiar', category: 'Cole', priority: 'media' };
    sb.state.tasks.push(originalTask);
    sb.state.events.push({ id: 'ctx1', title: 'Cumple', date: '2026-11-03', allDay: true, blocksSchedule: false });
    sb.eventsForScheduler(); // solo debe tocar events, nunca tasks
    check('8. eventsForScheduler() no toca ni copia state.tasks (misma referencia, sin campos nuevos)',
      sb.state.tasks[0] === originalTask && !('blocksSchedule' in sb.state.tasks[0]));
    check('8. task.category (texto libre) sigue intacto, sin relación con eventCategories', sb.state.tasks[0].category === 'Cole');
  }

  // =====================================================================
  section('9) customSchedules no cambian con esta fase');
  // =====================================================================
  {
    const sb = makeSandbox();
    const dateStr = '2026-11-09'; // lunes
    const ctx = {
      events: [{ id: 'ctx1', title: 'Cumple', date: dateStr, allDay: true, blocksSchedule: false }],
      tasks: [],
      customSchedules: [{ id: 's1', name: 'Escuela', days: [dowOf(2026, 11, 9)], startTime: '08:00', endTime: '14:00' }],
    };
    const busy = sb.Scheduler._internal.getBusyIntervals(dateStr, ctx);
    check('9. un horario fijo (customSchedules) sigue generando su intervalo normal, sin verse afectado por el evento-contexto',
      busy.length === 1 && busy[0][0] === 8 * 60 && busy[0][1] === 14 * 60);
  }

  // =====================================================================
  section('10) Evento-contexto + tarea con hora fija no genera falso conflicto');
  // =====================================================================
  {
    const sb = makeSandbox();
    const dateStr = '2026-11-10';
    // La tarea está programada justo "dentro" del rango del día completo que
    // ocuparía un all-day bloqueante — pero como este es evento-contexto,
    // no debe considerarse conflicto en absoluto.
    const ctx = {
      events: [{ id: 'ctx1', title: 'Cumple', date: dateStr, allDay: true, blocksSchedule: false }],
      tasks: [{ id: 't1', scheduledDate: dateStr, scheduledStart: '15:00', scheduledEnd: '16:00' }],
      customSchedules: [],
    };
    const conflicts = sb.Scheduler.findConflicts(dateStr, ctx);
    check('10. tarea con hora fija ese día + evento-contexto ese mismo día → ningún conflicto', conflicts.length === 0);
  }

  // =====================================================================
  section('11) Scheduler.js no contiene lógica de categorías (separación de responsabilidades)');
  // =====================================================================
  {
    // Se comprueba ausencia de LÓGICA de categorías (acceso a la propiedad,
    // p.ej. `e.categoryId` o `.categoryId`), no de menciones en comentarios:
    // scheduler.js SÍ explica en un comentario, en prosa, que no conoce
    // categorías — eso es documentación, no lógica, y es correcto que exista.
    check('11. scheduler.js no accede en ningún código a la propiedad ".categoryId"',
      !/\.categoryId\b/.test(schedulerSrc));
    check('11. scheduler.js no menciona "eventCategories" en ningún sitio (ni código ni comentarios)',
      !/eventCategories/.test(schedulerSrc));
    check('11. scheduler.js documenta explícitamente que no conoce categorías (comentario real, no lógica)',
      /Scheduler no conoce categor/.test(schedulerSrc));
    check('11. scheduler.js sí usa "blocksSchedule" (el único campo que conoce, ya resuelto por quien lo llama)',
      /blocksSchedule/.test(schedulerSrc));
  }

  // =====================================================================
  section('12) Eventos sin categoryId siguen funcionando');
  // =====================================================================
  {
    const sb = makeSandbox();
    sb.state.events.push({ id: 'ev1', title: 'Sin categoría', date: '2026-11-11', allDay: true });
    const resolved = sb.eventsForScheduler();
    const ev = resolved.find(e => e.id === 'ev1');
    check('12. evento sin categoryId resuelve blocksSchedule=true (sigue bloqueando, comportamiento por defecto)',
      ev.blocksSchedule === true);
  }

  // =====================================================================
  section('13) categoryId huérfano (categoría borrada) sigue funcionando');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cat = await sb.addEventCategory({ name: 'Temporal', color: '#333', blocksSchedule: false });
    sb.state.events.push({ id: 'ev1', title: 'Evento con categoría luego borrada', date: '2026-11-12', allDay: true, categoryId: cat.id });
    await sb.deleteEventCategory(cat.id);
    check('13. la categoría ya no existe en state.eventCategories', sb.state.eventCategories.length === 0);
    check('13. el evento sigue existiendo, con su categoryId ahora huérfano', sb.state.events[0].categoryId === cat.id);
    const resolved = sb.eventsForScheduler();
    const ev = resolved.find(e => e.id === 'ev1');
    check('13. categoryId huérfano resuelve blocksSchedule=true (vuelve al comportamiento por defecto, ya no es "contexto")',
      ev.blocksSchedule === true);
  }

  // =====================================================================
  section('14) Render contextual vs all-day bloqueante: señales distintas en buildDayBlocks');
  // =====================================================================
  {
    const sb = makeSandbox();
    const dateStr = '2026-11-13';
    const opts = { dayStart: '07:00', dayEnd: '23:00' };

    const ctxBlocking = {
      events: [{ id: 'ev1', title: 'Examen', date: dateStr, allDay: true, blocksSchedule: true }],
      tasks: [], customSchedules: [],
    };
    const blocksBlocking = sb.Scheduler.buildDayBlocks(dateStr, ctxBlocking, opts);
    check('14. all-day bloqueante SÍ produce un bloque "busy" de tipo evento en buildDayBlocks (señal: ocupa todo el día)',
      blocksBlocking.blocks.length === 1 && blocksBlocking.blocks[0].type === 'busy' &&
      blocksBlocking.blocks[0].kinds.includes('event'));

    const ctxContext = {
      events: [{ id: 'ctx1', title: 'Cumple', date: dateStr, allDay: true, blocksSchedule: false }],
      tasks: [], customSchedules: [],
    };
    const blocksContext = sb.Scheduler.buildDayBlocks(dateStr, ctxContext, opts);
    check('14. el evento-contexto NO produce ningún bloque "busy" en buildDayBlocks (señal distinta: el día queda libre)',
      !blocksContext.blocks.some(b => b.type === 'busy'));
    check('14. sin bloques "busy", buildDayBlocks describe el rango completo como libre/pasado (nunca oculta el día)',
      blocksContext.blocks.every(b => b.type === 'free' || b.type === 'past'));

    // Ambos eventos siguen existiendo igual en el listado de eventos (eventRowHTML
    // no distingue blocksSchedule): la diferencia de "señal" vive en el cálculo de
    // ocupación/planificación (buildDayBlocks), no en el listado de eventos.
    check('14. ambos eventos (bloqueante y contexto) siguen siendo eventos allDay normales, sin cambiar su forma de dato',
      ctxBlocking.events[0].allDay === true && ctxContext.events[0].allDay === true);
  }

  // =====================================================================
  section('15) Las propuestas de la IA siguen pudiendo usar los huecos libres');
  // =====================================================================
  {
    const sb = makeSandbox();
    const dateStr = '2026-11-14';
    const opts = { dayStart: '07:00', dayEnd: '23:00' };

    // 15a) getFreeSlotsFormatted (lo que buildContext ofrece a la IA como texto)
    // no pierde huecos por culpa de un evento-contexto ese día.
    const withoutCtx = sb.Scheduler.getFreeSlotsFormatted(dateStr, { events: [], tasks: [], customSchedules: [] }, opts);
    const withCtx = sb.Scheduler.getFreeSlotsFormatted(dateStr, { events: [{ id: 'ctx1', title: 'Cumple', date: dateStr, allDay: true, blocksSchedule: false }], tasks: [], customSchedules: [] }, opts);
    check('15. getFreeSlotsFormatted() ofrece los mismos huecos con o sin el evento-contexto',
      JSON.stringify(withoutCtx) === JSON.stringify(withCtx) && withCtx.length > 0);

    // 15b) schedulerContext() de ai-actions.js sigue resolviendo blocksSchedule
    // vía eventsForScheduler() cuando existe, tal como ya hacía en 6A-3.
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
      events: [{ id: 'ctx1', allDay: true, categoryId: 'catCtx' }],
      customSchedules: [],
    };
    sb2.eventsForScheduler = () => sb2.state.events.map(e => Object.assign({}, e, { blocksSchedule: e.categoryId === 'catCtx' ? false : true }));
    vm.runInContext(schedulerContextSrc + '\nthis.schedulerContext = schedulerContext;', sb2, { filename: 'ai-actions.js (schedulerContext)' });
    const built = sb2.schedulerContext();
    check('15. schedulerContext() entrega a la IA el evento-contexto con blocksSchedule=false ya resuelto (huecos siguen disponibles para proponer tareas)',
      built.events[0].blocksSchedule === false && built.tasks[0].id === 't1');
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
