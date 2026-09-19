/**
 * ORGANIZATOR — Tests de R-1 (modelo de datos y persistencia de recurrencia)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el bloque "RECURRENCIA — modelo de datos (Fase R-1)"
 * (sanitizeRecurrence y sus helpers, que viven dentro del mismo bloque
 * SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS que ya usa
 * test-event-import-sanitize.js) y el bloque CRUD (addTask/updateTask/
 * addEvent/updateEvent) — mismo patrón que el resto de la suite
 * (test-event-categories.js, test-event-import-sanitize.js).
 *
 * Esta fase (R-1) SOLO cubre modelo de datos y persistencia: no calcula
 * próximas ocurrencias, no genera copias de tareas/eventos, no toca
 * Scheduler/recordatorios/IA/UI. Por eso esta suite tampoco los testea.
 *
 * Uso:  node js/test-recurrence-model.js
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
// lectura (no se toca el archivo en disco) porque los marcadores de
// extractBetween de abajo usan '\n'.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Bloque real de saneamiento (incluye isValidYMDDate, sanitizeRecurrence
// y sus helpers, y sanitizeImportedEvents/sanitizeImportedEventCategories)
// — mismo rango que ya extrae test-event-import-sanitize.js.
// ---------------------------------------------------------------------
const sanitizeSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1)'
);

// ---------------------------------------------------------------------
// Bloque real de CRUD (addTask/updateTask/deleteTask/toggleTask/
// addEvent/updateEvent/deleteEvent) de organizator.html.
// ---------------------------------------------------------------------
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS',
  'bloque CRUD'
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
  // 1) Saneamiento (sanitizeRecurrence + helpers + sanitizeImportedEvents/Categories).
  vm.runInContext(sanitizeSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1)' });
  // 2) Entorno mínimo del que depende el bloque CRUD real.
  vm.runInContext(
    `let state = { tasks: [], events: [] };
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }
     async function saveTasks(){ await window.storage.set('tasks', JSON.stringify(state.tasks), false); }
     async function saveEvents(){ await window.storage.set('events', JSON.stringify(state.events), false); }
     async function cancelRemindersForTarget(){ /* no-op: fuera de alcance de R-1 */ }
     function renderCurrentView(){ /* no-op: fuera de alcance de R-1 (UI) */ }
     function openActualMinutesModal(){ /* no-op: fuera de alcance de R-1 (UI) */ }`,
    sandbox, { filename: 'state-setup' }
  );
  sandbox.storage = makeStorage();
  // 3) CRUD real (addTask/updateTask/addEvent/updateEvent), usa sanitizeRecurrence definido en (1).
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(
    `this.sanitizeRecurrence = sanitizeRecurrence;
     this.sanitizeImportedEvents = sanitizeImportedEvents;
     this.sanitizeImportedEventCategories = sanitizeImportedEventCategories;
     this.addTask = addTask;
     this.updateTask = updateTask;
     this.addEvent = addEvent;
     this.updateEvent = updateEvent;
     this.state = state;`,
    sandbox, { filename: 'expose-recurrence-R1' }
  );
  return sandbox;
}

// Recurrencia válida "base" reutilizable entre tests.
const dailyOnce = { type: 'daily', interval: 1, startDate: '2026-10-01', endDate: null };

(async () => {

  // =====================================================================
  section('1) Tarea sin recurrencia → recurrence === null');
  // =====================================================================
  {
    const sb = makeSandbox();
    const task = await sb.addTask({ title: 'Ducharse' });
    check('1. addTask sin recurrence en data → recurrence null en el objeto creado', task === undefined); // addTask no retorna nada; se valida vía state
    check('1. la tarea guardada en state.tasks tiene recurrence === null', sb.state.tasks[0].recurrence === null);
    check('1. el resto de campos de la tarea no se ve afectado (title, done, id)',
      sb.state.tasks[0].title === 'Ducharse' && sb.state.tasks[0].done === false && typeof sb.state.tasks[0].id === 'string');
  }

  // =====================================================================
  section('2) Evento sin recurrencia → recurrence === null');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addEvent({ title: 'Cita médica', date: '2026-10-05' });
    check('2. el evento guardado en state.events tiene recurrence === null', sb.state.events[0].recurrence === null);
    check('2. el resto de campos del evento no se ve afectado (title, date, id)',
      sb.state.events[0].title === 'Cita médica' && sb.state.events[0].date === '2026-10-05' && typeof sb.state.events[0].id === 'string');
  }

  // =====================================================================
  section('3) Recurrencia diaria cada 1 día');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ type: 'daily', interval: 1, startDate: '2026-10-01', endDate: null });
    check('3. type/interval/startDate/endDate correctos', r && r.type === 'daily' && r.interval === 1 &&
      r.startDate === '2026-10-01' && r.endDate === null);
    check('3. daysOfWeek por defecto es [] (no se especificó)', Array.isArray(r.daysOfWeek) && r.daysOfWeek.length === 0);
  }

  // =====================================================================
  section('4) Recurrencia diaria cada 3 días');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ type: 'daily', interval: 3, startDate: '2026-10-01', endDate: null });
    check('4. interval: 3 se conserva', r && r.type === 'daily' && r.interval === 3);
  }

  // =====================================================================
  section('5) Recurrencia semanal (cada semana)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ type: 'weekly', interval: 1, startDate: '2026-10-01', endDate: null });
    check('5. type weekly, interval 1', r && r.type === 'weekly' && r.interval === 1);
  }

  // =====================================================================
  section('6) Recurrencia semanal con lunes/miércoles/viernes');
  // =====================================================================
  {
    const sb = makeSandbox();
    // Mismo índice que customSchedules.days/DOW_SHORT: 0=Lunes...6=Domingo.
    const r = sb.sanitizeRecurrence({ type: 'weekly', interval: 1, daysOfWeek: [0, 2, 4], startDate: '2026-10-01', endDate: null });
    check('6. daysOfWeek [lunes, miércoles, viernes] = [0,2,4] se conserva tal cual', r &&
      Array.isArray(r.daysOfWeek) && r.daysOfWeek.length === 3 && r.daysOfWeek[0] === 0 && r.daysOfWeek[1] === 2 && r.daysOfWeek[2] === 4);
  }

  // =====================================================================
  section('7) Recurrencia cada 2 semanas');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ type: 'weekly', interval: 2, startDate: '2026-10-01', endDate: null });
    check('7. type weekly, interval 2', r && r.type === 'weekly' && r.interval === 2);
  }

  // =====================================================================
  section('8) Recurrencia mensual (cada mes)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ type: 'monthly', interval: 1, startDate: '2026-10-01', endDate: null });
    check('8. type monthly, interval 1', r && r.type === 'monthly' && r.interval === 1);
  }

  // =====================================================================
  section('9) Recurrencia cada 2 meses');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ type: 'monthly', interval: 2, startDate: '2026-10-01', endDate: null });
    check('9. type monthly, interval 2', r && r.type === 'monthly' && r.interval === 2);
  }

  // =====================================================================
  section('10) startDate válida se conserva');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ ...dailyOnce, startDate: '2026-12-25' });
    check('10. startDate YYYY-MM-DD válida se conserva exacta', r && r.startDate === '2026-12-25');
  }

  // =====================================================================
  section('11) endDate válida (posterior a startDate) se conserva');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ ...dailyOnce, startDate: '2026-10-01', endDate: '2026-12-31' });
    check('11. endDate posterior a startDate se conserva exacta', r && r.endDate === '2026-12-31');
  }

  // =====================================================================
  section('12) endDate === null se conserva (sin fecha de fin)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r1 = sb.sanitizeRecurrence({ ...dailyOnce, endDate: null });
    check('12. endDate: null explícito → endDate null en el resultado', r1 && r1.endDate === null);
    const { endDate, ...withoutEndDate } = dailyOnce;
    const r2 = sb.sanitizeRecurrence(withoutEndDate);
    check('12. endDate ausente (undefined) también se normaliza a null', r2 && r2.endDate === null);
  }

  // =====================================================================
  section('13) endDate anterior a startDate → recurrencia inválida (null)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = sb.sanitizeRecurrence({ ...dailyOnce, startDate: '2026-10-10', endDate: '2026-10-01' });
    check('13. endDate < startDate → null', r === null);
    // Caso límite: endDate === startDate SÍ debe ser válido (no es "anterior").
    const rEqual = sb.sanitizeRecurrence({ ...dailyOnce, startDate: '2026-10-10', endDate: '2026-10-10' });
    check('13b. endDate === startDate (no es anterior) → sigue siendo válida', rEqual !== null && rEqual.endDate === '2026-10-10');
  }

  // =====================================================================
  section('14) interval inválido → recurrencia inválida (null)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cases = [0, -1, 1.5, '3', null, undefined, NaN, Infinity];
    const results = cases.map(interval => sb.sanitizeRecurrence({ ...dailyOnce, interval }));
    check('14. ningún interval inválido produce una recurrencia válida', results.every(r => r === null));
  }

  // =====================================================================
  section('15) type inválido → recurrencia inválida (null)');
  // =====================================================================
  {
    const sb = makeSandbox();
    // R-1.6: 'yearly' pasó a ser un type VÁLIDO (recurrencia anual) — se
    // sustituye aquí por 'annual' (un type que sigue sin existir) para
    // seguir probando exactamente lo mismo: un type desconocido nunca
    // produce una recurrencia válida.
    const cases = ['annual', 'Daily', '', null, undefined, 123, 'DAILY'];
    const results = cases.map(type => sb.sanitizeRecurrence({ ...dailyOnce, type }));
    check('15. ningún type fuera de daily/weekly/monthly/yearly produce una recurrencia válida', results.every(r => r === null));
  }

  // =====================================================================
  section('16) daysOfWeek inválidos → recurrencia inválida (null)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cases = [[7], [-1], ['lunes'], [1.5], 'no-es-array', [0, 6, 7]];
    const results = cases.map(daysOfWeek => sb.sanitizeRecurrence({ ...dailyOnce, type: 'weekly', daysOfWeek }));
    check('16. ningún daysOfWeek con valores fuera de 0-6 (o no-array) produce una recurrencia válida', results.every(r => r === null));
    // Control positivo: [] y ausente SÍ son válidos.
    const rEmpty = sb.sanitizeRecurrence({ ...dailyOnce, type: 'weekly', daysOfWeek: [] });
    check('16b. daysOfWeek: [] es válido', rEmpty !== null && rEmpty.daysOfWeek.length === 0);
  }

  // =====================================================================
  section('17) Datos antiguos sin recurrence siguen funcionando');
  // =====================================================================
  {
    const sb = makeSandbox();
    // Tarea/evento "antiguos", tal como estarían guardados antes de R-1
    // (sin la clave recurrence en absoluto).
    await sb.addTask({ title: 'Tarea antigua', dueDate: '2026-09-01', priority: 'media' });
    await sb.addEvent({ title: 'Evento antiguo', date: '2026-09-01' });
    check('17. tarea antigua (sin recurrence) sigue creándose con normalidad', sb.state.tasks[0].title === 'Tarea antigua' && sb.state.tasks[0].dueDate === '2026-09-01');
    check('17. tarea antigua obtiene recurrence === null', sb.state.tasks[0].recurrence === null);
    check('17. evento antiguo (sin recurrence) sigue creándose con normalidad', sb.state.events[0].title === 'Evento antiguo');
    check('17. evento antiguo obtiene recurrence === null', sb.state.events[0].recurrence === null);
    // Actualización parcial (sin tocar recurrence) no debe romperse ni inventar recurrencia.
    await sb.updateTask(sb.state.tasks[0].id, { priority: 'alta' });
    check('17. updateTask sin recurrence en data no la toca (sigue null)', sb.state.tasks[0].recurrence === null && sb.state.tasks[0].priority === 'alta');
  }

  // =====================================================================
  section('18) Sanitización no modifica el objeto original');
  // =====================================================================
  {
    const sb = makeSandbox();
    const original = { type: 'weekly', interval: 2, daysOfWeek: [0, 2, 4], startDate: '2026-10-01', endDate: '2026-12-31' };
    const snapshot = JSON.stringify(original);
    const result = sb.sanitizeRecurrence(original);
    check('18. el objeto de entrada no se muta (misma serialización antes/después)', JSON.stringify(original) === snapshot);
    check('18. el resultado es un objeto distinto (no la misma referencia)', result !== original);
    check('18. daysOfWeek del resultado es un array distinto (copia, no la misma referencia)', result.daysOfWeek !== original.daysOfWeek);
    check('18. el resultado tiene los mismos valores que el original', result.type === 'weekly' && result.interval === 2 &&
      result.startDate === '2026-10-01' && result.endDate === '2026-12-31' && result.daysOfWeek.join(',') === '0,2,4');
  }

  // =====================================================================
  section('19) Exportar/importar conserva la recurrencia');
  // =====================================================================
  {
    const sb = makeSandbox();
    const validRecurrence = { type: 'weekly', interval: 1, daysOfWeek: [1, 3], startDate: '2026-10-01', endDate: null };
    await sb.addTask({ title: 'Regar plantas', recurrence: validRecurrence });
    await sb.addEvent({ title: 'Reunión semanal', date: '2026-10-01', recurrence: validRecurrence });

    // "Exportar": organizator.html serializa state.tasks/state.events tal
    // cual (exportData no transforma nada); se simula con JSON.stringify
    // + JSON.parse, igual que escribir el backup a disco y volver a leerlo.
    const exported = JSON.parse(JSON.stringify({ tasks: sb.state.tasks, events: sb.state.events }));
    check('19. la tarea exportada conserva la recurrencia saneada', JSON.stringify(exported.tasks[0].recurrence) === JSON.stringify({ ...validRecurrence, daysOfWeek: [1, 3] }));
    check('19. el evento exportado conserva la recurrencia saneada', JSON.stringify(exported.events[0].recurrence) === JSON.stringify({ ...validRecurrence, daysOfWeek: [1, 3] }));

    // "Importar": mismo criterio que initSettingsDataIO en organizator.html
    // — tasks solo normaliza recurrence (sanitizeRecurrence), events pasa
    // por sanitizeImportedEvents (que ya incluye recurrence).
    const importedTasks = exported.tasks.map(t => (t && typeof t === 'object') ? { ...t, recurrence: sb.sanitizeRecurrence(t.recurrence) } : t);
    const { kept: importedEvents } = sb.sanitizeImportedEvents(exported.events);
    check('19. tras "reimportar", la tarea conserva la recurrencia válida', JSON.stringify(importedTasks[0].recurrence) === JSON.stringify({ ...validRecurrence, daysOfWeek: [1, 3] }));
    check('19. tras "reimportar", el evento conserva la recurrencia válida', JSON.stringify(importedEvents[0].recurrence) === JSON.stringify({ ...validRecurrence, daysOfWeek: [1, 3] }));

    // Un backup con recurrencia corrupta (editado a mano) no debe colarse
    // como válida al importar: debe normalizarse a null, no lanzar.
    // R-1.6: 'yearly' ya es válido, así que se usa 'annual' (inexistente)
    // para seguir probando un type realmente corrupto.
    const corruptImport = sb.sanitizeImportedEvents([{ title: 'Ev corrupto', date: '2026-10-05', recurrence: { type: 'annual', interval: 1, startDate: '2026-10-01' } }]);
    check('19b. recurrencia corrupta en un evento importado se normaliza a null (no rompe la importación)', corruptImport.kept[0].recurrence === null);
    const importedCorruptTask = sb.sanitizeRecurrence({ type: 'weekly', interval: 0, startDate: '2026-10-01' });
    check('19b. recurrencia corrupta en una tarea importada se normaliza a null', importedCorruptTask === null);
  }

  // =====================================================================
  section('20) node --check sobre el <script> principal de organizator.html');
  // =====================================================================
  {
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-recurrence-r1-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('20. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
    } catch (e) {
      check('20. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
