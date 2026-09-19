/**
 * ORGANIZATOR — Tests de AI-3.3 (analizar huecos disponibles del
 * calendario)
 *
 * Suite Node pura, SIN navegador ni jsdom. Mismo patrón que el resto del
 * proyecto: extrae literalmente por CONTENIDO el bloque AI-3.3
 * (analyzePlanningAvailability y sus helpers privados) de ai-actions.js,
 * junto con el bloque AI-1.2 del que depende por dentro (parseYMDLocal/
 * addDaysLocal, para iterar y validar fechas), y carga js/scheduler.js
 * REAL y COMPLETO (sin tocar ni un carácter) como `window.Scheduler`,
 * exactamente como se carga en producción (organizator.html carga
 * scheduler.js antes que ai-actions.js) — analyzePlanningAvailability
 * consume Scheduler.DEFAULTS/Scheduler._internal de verdad, nunca un
 * mock.
 *
 * Es una función PURA: no lee `state`, no toca el DOM, no llama a
 * callAI, no llama a ninguna pieza de Scheduler que dependa de la hora
 * real (getFreeSlots/buildDayBlocks/scheduleTask/autoSchedule/
 * rescheduleTask/findConflicts quedan fuera a propósito — ver cabecera
 * del bloque AI-3.3 en ai-actions.js), no toca reminders/batches/Smart
 * Forms/recurrencia/ACTION_SCHEMA.
 *
 * Uso:  node js/test-ai-3-3-planning-availability.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AI_ACTIONS_PATH = path.join(ROOT, 'js', 'ai-actions.js');
const SCHEDULER_PATH = path.join(ROOT, 'js', 'scheduler.js');
// ai-actions.js se guarda con CRLF; se normaliza a LF solo para esta
// lectura en memoria (no se toca el archivo en disco) porque los
// marcadores de extractBetween de abajo usan '\n'. scheduler.js se
// carga tal cual, sin normalizar ni tocar nada (no se extrae ningún
// fragmento suyo, se ejecuta completo).
const aiActionsSrc = fs.readFileSync(AI_ACTIONS_PATH, 'utf8').replace(/\r\n/g, '\n');
const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en ai-actions.js — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en ai-actions.js — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Bloques de los que depende AI-3.3 por dentro, reutilizados tal cual.
// ---------------------------------------------------------------------
const datetimeSrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-1.2', '\n\n  /* ==================================================================\n     AI-1.3', 'bloque AI-1.2 (parseYMDLocal/addDaysLocal)');
const availabilitySrc = extractBetween(aiActionsSrc, '/* ==================================================================\n     AI-3.3', '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-3.3 (analyzePlanningAvailability)');

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Sandbox aislado con AI-1.2 (puro) + AI-3.3 (puro) + js/scheduler.js
 * REAL como `window.Scheduler`/`Scheduler` — si analyzePlanningAvailability
 * (o cualquier helper del que depende) intentara tocar `state`/DOM/
 * callAI/batches/reminders, no definidos aquí, lanzaría un
 * ReferenceError — no se define ningún stub de esos a propósito. */
function makeSandbox() {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);
  // `global` es el nombre del parámetro de la IIFE en ai-actions.js real
  // ((function(global){...})(window)) — al extraer solo el bloque AI-3.3
  // como fragmento suelto (no la IIFE completa) hay que darle ese mismo
  // significado aquí: apunta a `window` (== Scheduler ya cargado abajo),
  // igual que en producción.
  vm.runInContext('let window = this; let global = this;', sandbox, { filename: 'window-self' });
  vm.runInContext(schedulerSrc, sandbox, { filename: 'scheduler.js (real, completo)' });
  vm.runInContext(
    datetimeSrc + '\n' + availabilitySrc + `
    this.analyzePlanningAvailability = analyzePlanningAvailability;
    `,
    sandbox, { filename: 'ai-actions.js (AI-1.2+AI-3.3, bloques puros)' }
  );
  return sandbox;
}

const sb = makeSandbox();
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
const EMPTY = { dateFrom: null, dateTo: null, availableSlots: [], occupiedSlots: [], excludedDates: [], skippedDates: [], totalAvailableMinutes: 0, notes: [] };
// 2026-09-17 es jueves -> dow (convención 0=lunes..6=domingo) = 3.
const THU = '2026-09-17';
const FRI = '2026-09-18';
const SAT = '2026-09-19';
const SUN = '2026-09-20';
const MON = '2026-09-14';
const TUE = '2026-09-15';
const WED = '2026-09-16';

/** Valida la forma exacta de un availableSlot/occupiedSlot: fechas
 * YYYY-MM-DD, horas HH:MM (incluye "24:00" como caso límite legítimo —
 * heredado literalmente de Scheduler._internal.minToTime, reutilizado
 * tal cual, nunca reimplementado aquí — para un intervalo que llega
 * hasta exactamente medianoche, p.ej. un evento allDay). */
function isYMD(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isHHMM(s) { return typeof s === 'string' && /^([01]\d|2[0-3]|24):[0-5]\d$/.test(s) && s !== '24:01'; }
function isValidAvailableSlot(slot) {
  return slot && isYMD(slot.date) && isHHMM(slot.start) && isHHMM(slot.end) &&
    typeof slot.minutes === 'number' && slot.minutes > 0 &&
    Object.keys(slot).sort().join(',') === 'date,end,minutes,start';
}
function isValidOccupiedSlot(slot) {
  return slot && isYMD(slot.date) && isHHMM(slot.start) && isHHMM(slot.end) &&
    (slot.sourceType === 'task' || slot.sourceType === 'event' || slot.sourceType === 'blocked') &&
    (slot.sourceId === null || typeof slot.sourceId === 'string') &&
    Object.keys(slot).sort().join(',') === 'date,end,sourceId,sourceType,start';
}

(async () => {

  // =====================================================================
  section('1) Rango de un día');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU });
    check('1a. dateFrom/dateTo devueltos tal cual', r.dateFrom === THU && r.dateTo === THU);
    check('1b. un único availableSlot para ese día (jornada completa, sin nada que lo ocupe)', r.availableSlots.length === 1 && r.availableSlots[0].date === THU);
    check('1c. la forma del slot es exactamente la pedida (date/start/end/minutes)', isValidAvailableSlot(r.availableSlots[0]));
    check('1d. start < end y minutes coincide EXACTAMENTE con la diferencia', r.availableSlots[0].start < r.availableSlots[0].end);
  }

  // =====================================================================
  section('2) Rango de varios días');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: SAT });
    const dates = [...new Set(r.availableSlots.map(s => s.date))];
    check('2. se analizan las 3 fechas del rango, inclusive', deepEq(dates, [THU, FRI, SAT]));
  }

  // =====================================================================
  section('3) Fecha excluida');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: FRI, excludedDates: [THU] });
    check('3a. la fecha excluida aparece en excludedDates', deepEq(r.excludedDates, [THU]));
    check('3b. no genera ningún availableSlot/occupiedSlot para ese día', !r.availableSlots.some(s => s.date === THU) && !r.occupiedSlots.some(s => s.date === THU));
    check('3c. el resto del rango se sigue analizando con normalidad', r.availableSlots.some(s => s.date === FRI));
  }

  // =====================================================================
  section('4) daysOfWeek');
  // =====================================================================
  {
    // Lunes(0)..Domingo(6): solo se piden martes(1) y jueves(3).
    const r = sb.analyzePlanningAvailability({}, { dateFrom: MON, dateTo: SUN, daysOfWeek: [1, 3] });
    const dates = [...new Set(r.availableSlots.map(s => s.date))].sort();
    check('4a. solo se analizan las fechas de los días pedidos (martes y jueves)', deepEq(dates, [TUE, THU]));
    check('4b. las fechas fuera de daysOfWeek no aparecen ni como excluidas ni como saltadas (no se pidieron, no falta información)', !r.excludedDates.includes(MON) && !r.skippedDates.includes(MON));
  }

  // =====================================================================
  section('5) Evento normal bloqueante');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ events: [{ id: 'e1', date: THU, startTime: '10:00', endTime: '11:00' }] }, { dateFrom: THU, dateTo: THU });
    check('5a. genera un occupiedSlot con sourceType "event" y el id real', deepEq(r.occupiedSlots, [{ date: THU, start: '10:00', end: '11:00', sourceType: 'event', sourceId: 'e1' }]));
    check('5b. availableSlots rodea el hueco ocupado (antes y después)', r.availableSlots.length === 2 && r.availableSlots[0].end === '10:00' && r.availableSlots[1].start === '11:00');
    check('5c. availableSlots nunca se solapa con occupiedSlots', r.availableSlots.every(a => a.end <= '10:00' || a.start >= '11:00'));
  }

  // =====================================================================
  section('6) Evento allDay bloqueante');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ events: [{ id: 'e2', date: THU, allDay: true }] }, { dateFrom: THU, dateTo: THU });
    check('6a. bloquea el día completo (0 availableSlots)', r.availableSlots.length === 0);
    check('6b. occupiedSlots refleja el bloqueo de día completo con sourceType "event"', r.occupiedSlots.length === 1 && r.occupiedSlots[0].sourceType === 'event' && r.occupiedSlots[0].sourceId === 'e2');
  }

  // =====================================================================
  section('7) Evento allDay con blocksSchedule:false');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ events: [{ id: 'e3', date: THU, allDay: true, blocksSchedule: false }] }, { dateFrom: THU, dateTo: THU });
    check('7a. NO bloquea disponibilidad (jornada completa sigue libre)', r.availableSlots.length === 1 && r.availableSlots[0].minutes === r.availableSlots[0].minutes);
    check('7b. no genera ningún occupiedSlot para este evento', r.occupiedSlots.length === 0);
  }

  // =====================================================================
  section('8) Evento con categoría eliminada/orphan categoryId');
  // =====================================================================
  {
    // AI-3.3 nunca resuelve categoryId por su cuenta (igual que
    // Scheduler.js): si el evento llega SIN blocksSchedule ya resuelto
    // (como pasaría con una categoría huérfana/borrada, que
    // resolveEventBlocksSchedule() de organizator.html resolvería a
    // `true`), debe seguir bloqueando por defecto — mismo criterio
    // "blocksSchedule !== false" que ya usa Scheduler.getBusyIntervals.
    const r = sb.analyzePlanningAvailability({ events: [{ id: 'e4', date: THU, allDay: true, categoryId: 'categoria-borrada' }] }, { dateFrom: THU, dateTo: THU });
    check('8. evento allDay con categoryId huérfano (sin blocksSchedule resuelto) sigue bloqueando por defecto', r.availableSlots.length === 0 && r.occupiedSlots.length === 1 && r.occupiedSlots[0].sourceId === 'e4');
  }

  // =====================================================================
  section('9) Tarea con hora + duración');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ tasks: [{ id: 't1', dueDate: THU, dueTime: '09:00', estimatedMinutes: 30 }] }, { dateFrom: THU, dateTo: THU });
    check('9. genera un occupiedSlot con sourceType "task" y el id real, minutos exactos', deepEq(r.occupiedSlots, [{ date: THU, start: '09:00', end: '09:30', sourceType: 'task', sourceId: 't1' }]));
  }

  // =====================================================================
  section('10) Tarea sin hora');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ tasks: [{ id: 't2', dueDate: THU, estimatedMinutes: 30 }] }, { dateFrom: THU, dateTo: THU });
    check('10a. una tarea sin hora NUNCA bloquea disponibilidad (sección 6/15 del encargo)', r.occupiedSlots.length === 0);
    check('10b. el día sigue con su jornada completa disponible', r.availableSlots.length === 1);
  }

  // =====================================================================
  section('11) Tarea sin duración');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ tasks: [{ id: 't3', dueDate: THU, dueTime: '09:00' }] }, { dateFrom: THU, dateTo: THU });
    check('11a. una tarea con hora pero sin duración NUNCA bloquea disponibilidad (no se inventa un bloqueo arbitrario)', r.occupiedSlots.length === 0);
    check('11b. el día sigue con su jornada completa disponible', r.availableSlots.length === 1);
  }

  // =====================================================================
  section('12) Bloqueo existente (customSchedules)');
  // =====================================================================
  {
    // THU (2026-09-17) es jueves -> dow=3 en la convención 0=lunes..6=domingo.
    const r = sb.analyzePlanningAvailability({ customSchedules: [{ id: 'cs1', name: 'Clase', days: [3], startTime: '08:00', endTime: '14:00' }] }, { dateFrom: THU, dateTo: THU });
    check('12a. genera un occupiedSlot con sourceType "blocked" y el id real', deepEq(r.occupiedSlots, [{ date: THU, start: '08:00', end: '14:00', sourceType: 'blocked', sourceId: 'cs1' }]));
    const rNoId = sb.analyzePlanningAvailability({ customSchedules: [{ name: 'Sin id', days: [3], startTime: '08:00', endTime: '09:00' }] }, { dateFrom: THU, dateTo: THU });
    check('12b. un bloqueo sin id -> sourceId: null (nunca se inventa uno)', rNoId.occupiedSlots[0].sourceId === null);
  }

  // =====================================================================
  section('13) timeFrom');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU, timeFrom: '09:00' });
    check('13. recorta el hueco disponible al límite inferior indicado', r.availableSlots.length === 1 && r.availableSlots[0].start === '09:00');
  }

  // =====================================================================
  section('14) timeTo');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU, timeTo: '12:00' });
    check('14. recorta el hueco disponible al límite superior indicado', r.availableSlots.length === 1 && r.availableSlots[0].end === '12:00');
  }

  // =====================================================================
  section('15) preferredDayParts');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU, preferredDayParts: ['morning'] });
    check('15a. no inventa ninguna hora de corte (no hay una franja horaria segura definida) — la jornada sigue completa', r.availableSlots.length === 1 && r.availableSlots[0].minutes === 960);
    check('15b. documenta la limitación en notes', r.notes.some(n => /preferredDayParts/.test(n)));
  }

  // =====================================================================
  section('16) availableMinutesPerDay');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU, availableMinutesPerDay: 60 });
    check('16a. NO convierte availableMinutesPerDay en un bloque horario (availableSlots sigue representando la disponibilidad REAL, no recortada a 60min)', r.availableSlots.length === 1 && r.availableSlots[0].minutes === 960);
    check('16b. documenta en notes que hay más disponibilidad real que el presupuesto diario', r.notes.some(n => /availableMinutesPerDay/.test(n)));
  }

  // =====================================================================
  section('17) maxSessionMinutes');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU, timeFrom: '09:00', timeTo: '10:30', maxSessionMinutes: 30 });
    check('17a. divide el hueco en segmentos de como máximo maxSessionMinutes', r.availableSlots.length === 3 && r.availableSlots.every(s => s.minutes <= 30));
    check('17b. la suma de los segmentos sigue representando la disponibilidad real completa (90 min)', r.availableSlots.reduce((s, x) => s + x.minutes, 0) === 90);
    check('17c. no elimina disponibilidad (huecos consecutivos, sin huecos perdidos entre segmentos)', r.availableSlots[0].end === r.availableSlots[1].start && r.availableSlots[1].end === r.availableSlots[2].start);
  }

  // =====================================================================
  section('18) Combinación de varias restricciones');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability(
      { events: [{ id: 'e5', date: THU, startTime: '12:00', endTime: '13:00' }] },
      { dateFrom: MON, dateTo: SUN, daysOfWeek: [1, 3], timeFrom: '09:00', timeTo: '17:00', excludedDates: [TUE] }
    );
    const dates = [...new Set(r.availableSlots.map(s => s.date))];
    check('18a. combina daysOfWeek (solo martes/jueves) + excludedDates (martes fuera)', deepEq(dates, [THU]));
    check('18b. combina timeFrom/timeTo (09:00-17:00) con el evento del jueves', r.availableSlots.some(s => s.date === THU && s.start === '09:00' && s.end === '12:00') && r.availableSlots.some(s => s.date === THU && s.start === '13:00' && s.end === '17:00'));
    check('18c. el martes excluido aparece en excludedDates', deepEq(r.excludedDates, [TUE]));
  }

  // =====================================================================
  section('19) Intervalos ordenados');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability(
      { events: [{ id: 'eA', date: SAT, startTime: '10:00', endTime: '11:00' }, { id: 'eB', date: THU, startTime: '15:00', endTime: '16:00' }] },
      { dateFrom: THU, dateTo: SAT }
    );
    const availKeys = r.availableSlots.map(s => s.date + s.start);
    const occKeys = r.occupiedSlots.map(s => s.date + s.start);
    check('19a. availableSlots ordenado por date+start', deepEq(availKeys, [...availKeys].sort()));
    check('19b. occupiedSlots ordenado por date+start', deepEq(occKeys, [...occKeys].sort()));
  }

  // =====================================================================
  section('20) totalAvailableMinutes correcto');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ events: [{ id: 'e6', date: THU, startTime: '10:00', endTime: '11:00' }] }, { dateFrom: THU, dateTo: FRI });
    const expected = r.availableSlots.reduce((sum, s) => sum + s.minutes, 0);
    check('20. totalAvailableMinutes es la suma EXACTA de minutes de availableSlots', r.totalAvailableMinutes === expected && expected > 0);
  }

  // =====================================================================
  section('21) No solapamiento available/occupied');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability(
      { events: [{ id: 'e7', date: THU, startTime: '10:00', endTime: '11:00' }], tasks: [{ id: 't4', dueDate: THU, dueTime: '15:00', estimatedMinutes: 45 }], customSchedules: [{ id: 'cs2', days: [3], startTime: '18:00', endTime: '19:00' }] },
      { dateFrom: THU, dateTo: THU }
    );
    const overlaps = r.availableSlots.some(a => r.occupiedSlots.some(o => a.date === o.date && a.start < o.end && a.end > o.start));
    check('21. ningún availableSlot se solapa con ningún occupiedSlot', !overlaps);
  }

  // =====================================================================
  section('22) Arrays de entrada desordenados producen el mismo resultado');
  // =====================================================================
  {
    const events = [{ id: 'e8', date: THU, startTime: '10:00', endTime: '11:00' }, { id: 'e9', date: FRI, startTime: '09:00', endTime: '09:30' }];
    const tasks = [{ id: 't5', dueDate: THU, dueTime: '15:00', estimatedMinutes: 20 }, { id: 't6', dueDate: FRI, dueTime: '16:00', estimatedMinutes: 40 }];
    const r1 = sb.analyzePlanningAvailability({ events, tasks }, { dateFrom: THU, dateTo: FRI });
    const r2 = sb.analyzePlanningAvailability({ events: [...events].reverse(), tasks: [...tasks].reverse() }, { dateFrom: THU, dateTo: FRI });
    check('22. mismo resultado exacto con los arrays invertidos', deepEq(r1, r2));
  }

  // =====================================================================
  section('23-25) No mutación de tasks/events/constraints');
  // =====================================================================
  {
    const tasks = [{ id: 't7', dueDate: THU, dueTime: '09:00', estimatedMinutes: 30 }];
    const events = [{ id: 'e10', date: THU, startTime: '11:00', endTime: '12:00' }];
    const constraints = { dateFrom: THU, dateTo: FRI, excludedDates: [], daysOfWeek: [], preferredDayParts: [] };
    const tasksSnap = JSON.stringify(tasks);
    const eventsSnap = JSON.stringify(events);
    const constraintsSnap = JSON.stringify(constraints);
    sb.analyzePlanningAvailability({ tasks, events }, constraints);
    check('23. tasks no se modifica', JSON.stringify(tasks) === tasksSnap);
    check('24. events no se modifica', JSON.stringify(events) === eventsSnap);
    check('25. constraints no se modifica', JSON.stringify(constraints) === constraintsSnap);
  }

  // =====================================================================
  section('26-28) Rango inválido / falta dateFrom / falta dateTo');
  // =====================================================================
  {
    check('26. dateFrom > dateTo -> objeto vacío estable', deepEq(sb.analyzePlanningAvailability({}, { dateFrom: FRI, dateTo: THU }), EMPTY));
    check('27. falta dateFrom -> objeto vacío estable', deepEq(sb.analyzePlanningAvailability({}, { dateTo: THU }), EMPTY));
    check('28. falta dateTo -> objeto vacío estable', deepEq(sb.analyzePlanningAvailability({}, { dateFrom: THU }), EMPTY));
  }

  // =====================================================================
  section('29) Fecha excluida + evento');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ events: [{ id: 'e11', date: THU, startTime: '10:00', endTime: '11:00' }] }, { dateFrom: THU, dateTo: THU, excludedDates: [THU] });
    check('29. la exclusión gana: no se analiza el evento de ese día (ni available ni occupied)', r.availableSlots.length === 0 && r.occupiedSlots.length === 0 && deepEq(r.excludedDates, [THU]));
  }

  // =====================================================================
  section('30) Día completo bloqueado');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ customSchedules: [{ id: 'cs3', days: [3], startTime: '00:00', endTime: '23:59' }] }, { dateFrom: THU, dateTo: THU });
    check('30. prácticamente todo el día ocupado -> availableSlots mínimo o vacío, sin solapar', r.availableSlots.every(a => a.start >= '23:59'));
  }

  // =====================================================================
  section('31) Ningún hueco disponible');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ events: [{ id: 'e12', date: THU, allDay: true }] }, { dateFrom: THU, dateTo: THU });
    check('31. availableSlots vacío, totalAvailableMinutes 0', r.availableSlots.length === 0 && r.totalAvailableMinutes === 0);
  }

  // =====================================================================
  section('32) Ninguna ocupación');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability({ tasks: [], events: [], customSchedules: [] }, { dateFrom: THU, dateTo: THU });
    check('32. occupiedSlots vacío, un único availableSlot con la jornada completa', r.occupiedSlots.length === 0 && r.availableSlots.length === 1);
  }

  // =====================================================================
  section('33) Determinismo entre dos ejecuciones');
  // =====================================================================
  {
    const ctx = { events: [{ id: 'e13', date: THU, startTime: '10:00', endTime: '11:00' }], tasks: [{ id: 't8', dueDate: FRI, dueTime: '09:00', estimatedMinutes: 30 }] };
    const cons = { dateFrom: THU, dateTo: SAT, daysOfWeek: [], excludedDates: [] };
    const r1 = sb.analyzePlanningAvailability(ctx, cons);
    const r2 = sb.analyzePlanningAvailability(ctx, cons);
    check('33. dos llamadas idénticas devuelven exactamente el mismo resultado', deepEq(r1, r2));
  }

  // =====================================================================
  section('34) No dependencia de posiciones del array');
  // =====================================================================
  {
    const a = { id: 'x1', date: THU, startTime: '10:00', endTime: '11:00' };
    const b = { id: 'x2', date: THU, startTime: '14:00', endTime: '15:00' };
    const c = { id: 'x3', date: THU, startTime: '18:00', endTime: '19:00' };
    const r1 = sb.analyzePlanningAvailability({ events: [a, b, c] }, { dateFrom: THU, dateTo: THU });
    const r2 = sb.analyzePlanningAvailability({ events: [c, a, b] }, { dateFrom: THU, dateTo: THU });
    const r3 = sb.analyzePlanningAvailability({ events: [b, c, a] }, { dateFrom: THU, dateTo: THU });
    check('34. el resultado no depende de la posición de cada evento en el array', deepEq(r1, r2) && deepEq(r1, r3));
  }

  // =====================================================================
  section('35) constraints vacías');
  // =====================================================================
  {
    check('35a. constraints {} -> objeto vacío estable (sin dateFrom/dateTo no se inventa nada)', deepEq(sb.analyzePlanningAvailability({ tasks: [], events: [] }, {}), EMPTY));
    check('35b. constraints undefined (segundo argumento omitido) -> objeto vacío estable, no lanza', deepEq(sb.analyzePlanningAvailability({}), EMPTY));
  }

  // =====================================================================
  section('36) context vacío');
  // =====================================================================
  {
    check('36a. context {} -> analiza igualmente con tasks/events/customSchedules vacíos', sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU }).availableSlots.length === 1);
    check('36b. context undefined (primer argumento omitido) -> no lanza, mismo resultado', deepEq(sb.analyzePlanningAvailability(undefined, { dateFrom: THU, dateTo: THU }), sb.analyzePlanningAvailability({}, { dateFrom: THU, dateTo: THU })));
  }

  // =====================================================================
  section('Extra) Forma exacta de todos los occupiedSlots generados en la suite');
  // =====================================================================
  {
    const r = sb.analyzePlanningAvailability(
      { events: [{ id: 'eZ', date: THU, startTime: '10:00', endTime: '11:00' }], tasks: [{ id: 'tZ', dueDate: THU, dueTime: '15:00', estimatedMinutes: 30 }], customSchedules: [{ id: 'csZ', days: [3], startTime: '18:00', endTime: '19:00' }] },
      { dateFrom: THU, dateTo: THU }
    );
    check('Extra1. todos los occupiedSlots tienen exactamente la forma pedida', r.occupiedSlots.every(isValidOccupiedSlot));
    check('Extra2. todos los availableSlots tienen exactamente la forma pedida', r.availableSlots.every(isValidAvailableSlot));
  }

  // =====================================================================
  section('Extra) Pureza: no lanza sin state/DOM/callAI/batches/reminders definidos');
  // =====================================================================
  {
    let threw = false;
    try {
      sb.analyzePlanningAvailability(
        { tasks: [{ id: 't9', dueDate: THU, dueTime: '09:00', estimatedMinutes: 30 }], events: [{ id: 'e14', date: THU, allDay: true }], customSchedules: [{ id: 'cs4', days: [3], startTime: '18:00', endTime: '19:00' }] },
        { dateFrom: THU, dateTo: SAT, daysOfWeek: [1, 3], timeFrom: '08:00', timeTo: '20:00', maxSessionMinutes: 45, availableMinutesPerDay: 60, preferredDayParts: ['morning'], excludedDates: [FRI] }
      );
    } catch (e) { threw = true; }
    check('Extra3. no lanza ReferenceError con todas las restricciones combinadas (no depende de `state`/DOM/callAI/batches/reminders)', threw === false);
  }

  // =====================================================================
  section('Extra) Export: no reemplaza los exports existentes de AI-3.1/AI-3.2');
  // =====================================================================
  {
    check('Extra4. global.AIActions.detectPlanningIntent (AI-3.1) sigue exportado', /global\.AIActions\.detectPlanningIntent = detectPlanningIntent;/.test(aiActionsSrc));
    check('Extra5. global.AIActions.extractPlanningConstraints (AI-3.2) sigue exportado', /global\.AIActions\.extractPlanningConstraints = extractPlanningConstraints;/.test(aiActionsSrc));
    check('Extra6. global.AIActions.analyzePlanningAvailability se expone como propiedad ADICIONAL, sin tocar la línea principal', /global\.AIActions\.analyzePlanningAvailability = analyzePlanningAvailability;/.test(aiActionsSrc) && /global\.AIActions = \{ runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES \};/.test(aiActionsSrc));
    check('Extra7. ACTION_SCHEMA sigue teniendo exactamente los mismos 5 tipos de "op"', (aiActionsSrc.match(/"op": "create_task" \| "create_event" \| "move_item" \| "cancel_item" \| "update_priority"/g) || []).length === 1);
  }

  // =====================================================================
  section('node --check de js/ai-actions.js (sintaxis válida)');
  // =====================================================================
  {
    try {
      execFileSync(process.execPath, ['--check', AI_ACTIONS_PATH], { stdio: 'pipe' });
      check('C1. node --check de js/ai-actions.js pasa (sintaxis válida)', true);
    } catch (e) {
      check('C1. node --check de js/ai-actions.js pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
