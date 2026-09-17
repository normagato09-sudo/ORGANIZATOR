/**
 * ORGANIZATOR — Tests de la Fase 1 de Recordatorios (estructura de datos y
 * persistencia mínima, SIN notificaciones)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el bloque "RECORDATORIOS — estructura de datos mínima
 * (Fase 1)" (addReminder/getReminderById/getRemindersForTarget/
 * updateReminder/cancelReminder), junto con uid() y saveReminders(), y los
 * ejecuta en un sandbox con un window.storage en memoria — mismo patrón
 * que test-event-categories.js.
 *
 * export/import se comprueban SIN simular DOM: exportData() se revisa por
 * contenido (que su payload incluya `reminders: state.reminders`), y la
 * línea real de import de reminders en initSettingsDataIO() se localiza
 * por contenido y se ejecuta aislada (no toda la función, que depende de
 * document/confirm/fetch de archivo).
 *
 * Uso:  node js/test-reminders-model.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// organizator.html se guarda con CRLF en este checkout; se normaliza a LF
// SOLO para esta lectura en memoria (no se toca el archivo en disco).
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Fragmentos reales de organizator.html.
// ---------------------------------------------------------------------
const uidSrc = extractBetween(
  html,
  'function uid(){',
  '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS',
  'función uid()'
);
const saveRemindersSrc = extractBetween(
  html,
  'async function saveReminders(){',
  '\nasync function savePrefs(){',
  'función saveReminders()'
);
const remindersCrudSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  'bloque RECORDATORIOS'
);
const loadStateSrc = extractBetween(
  html,
  'async function loadState(){',
  '\nasync function saveTasks(){',
  'función loadState()'
);
const exportDataSrc = extractBetween(
  html,
  'function exportData(){',
  '\n\n/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  'función exportData()'
);
// Línea real (y única) de initSettingsDataIO() que resuelve state.reminders
// a partir de data.reminders — se localiza por CONTENIDO, no por posición.
const importRemindersLineRe = /state\.reminders = Array\.isArray\(data\.reminders\) \? data\.reminders : \[\];/;
const importRemindersLineMatch = importRemindersLineRe.exec(html);

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
  vm.runInContext(uidSrc, sandbox, { filename: 'organizator.html (uid)' });
  vm.runInContext('let state = { reminders: [] };', sandbox, { filename: 'state-setup' });
  sandbox.storage = makeStorage();
  vm.runInContext(saveRemindersSrc, sandbox, { filename: 'organizator.html (saveReminders)' });
  vm.runInContext(remindersCrudSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS)' });
  vm.runInContext(
    `this.addReminder = addReminder;
     this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget;
     this.updateReminder = updateReminder;
     this.cancelReminder = cancelReminder;
     this.state = state;`,
    sandbox, { filename: 'expose-reminders' }
  );
  return sandbox;
}

(async () => {

  // =====================================================================
  section('A) state.reminders puede inicializarse vacío');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('A. state.reminders es un array vacío al arrancar', Array.isArray(sb.state.reminders) && sb.state.reminders.length === 0);
  }

  // =====================================================================
  section('B/C) Crear un reminder genera un id estable; dos reminders generan ids distintos');
  // =====================================================================
  let sbBC, r1, r2;
  {
    sbBC = makeSandbox();
    r1 = await sbBC.addReminder({ targetType: 'task', targetId: 't1', remindAt: '2026-01-10T09:00:00.000Z' });
    check('B. addReminder devuelve un objeto con id de tipo string no vacío', typeof r1.id === 'string' && r1.id.length > 0);
    check('B. el reminder queda en state.reminders con el mismo id', sbBC.state.reminders.some(r => r.id === r1.id));
    r2 = await sbBC.addReminder({ targetType: 'task', targetId: 't2', remindAt: '2026-01-11T09:00:00.000Z' });
    check('C. crear un segundo reminder genera un id DISTINTO del primero', r2.id !== r1.id);
    check('C. ambos reminders coexisten en state.reminders (2 elementos)', sbBC.state.reminders.length === 2);
  }

  // =====================================================================
  section('D) Obtener por id funciona');
  // =====================================================================
  {
    const found = sbBC.getReminderById(r1.id);
    check('D. getReminderById devuelve el reminder correcto', !!found && found.id === r1.id && found.targetId === 't1');
  }

  // =====================================================================
  section('E) Obtener por target funciona');
  // =====================================================================
  {
    const forT1 = sbBC.getRemindersForTarget('task', 't1');
    check('E. getRemindersForTarget devuelve un array', Array.isArray(forT1));
    check('E. contiene exactamente el reminder de ese target (1 elemento, el correcto)',
      forT1.length === 1 && forT1[0].id === r1.id);
    check('E. NO incluye reminders de otro target', !forT1.some(r => r.id === r2.id));
  }

  // =====================================================================
  section('F) Actualizar por id conserva el id');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r = await sb.addReminder({ targetType: 'event', targetId: 'e1', remindAt: '2026-02-01T08:00:00.000Z' });
    const updated = await sb.updateReminder(r.id, { remindAt: '2026-02-02T08:00:00.000Z', id: 'id-malicioso-inyectado' });
    check('F. updateReminder devuelve el reminder actualizado (no null)', !!updated);
    check('F. el id NO cambia aunque data incluya un id distinto', updated.id === r.id);
    check('F. el campo remindAt sí se actualiza', updated.remindAt === '2026-02-02T08:00:00.000Z');
    check('F. state.reminders conserva el id original (no se duplicó ni se perdió el elemento)',
      sb.state.reminders.length === 1 && sb.state.reminders[0].id === r.id);
  }

  // =====================================================================
  section('G) Actualizar un reminder no afecta a otros');
  // =====================================================================
  {
    const sb = makeSandbox();
    const a = await sb.addReminder({ targetType: 'task', targetId: 'ta', remindAt: '2026-03-01T08:00:00.000Z' });
    const b = await sb.addReminder({ targetType: 'task', targetId: 'tb', remindAt: '2026-03-02T08:00:00.000Z' });
    const bSnapshotBefore = JSON.stringify(sb.getReminderById(b.id));
    await sb.updateReminder(a.id, { remindAt: '2026-03-10T08:00:00.000Z', status: 'triggered' });
    check('G. el reminder "a" se actualizó', sb.getReminderById(a.id).remindAt === '2026-03-10T08:00:00.000Z');
    check('G. el reminder "b" queda exactamente igual que antes (misma serialización)',
      JSON.stringify(sb.getReminderById(b.id)) === bSnapshotBefore);
    check('G. sigue habiendo exactamente 2 reminders en total', sb.state.reminders.length === 2);
  }

  // =====================================================================
  section('H) Cancelar cambia únicamente el status correspondiente');
  // =====================================================================
  {
    const sb = makeSandbox();
    const a = await sb.addReminder({ targetType: 'event', targetId: 'ea', remindAt: '2026-04-01T08:00:00.000Z' });
    const b = await sb.addReminder({ targetType: 'event', targetId: 'eb', remindAt: '2026-04-02T08:00:00.000Z' });
    check('H. ambos reminders nacen con status "pending"', a.status === 'pending' && b.status === 'pending');

    const cancelled = await sb.cancelReminder(a.id);
    check('H. cancelReminder devuelve el reminder con status "cancelled"', !!cancelled && cancelled.status === 'cancelled');
    check('H. el resto de campos de "a" no cambian (id/targetType/targetId/remindAt intactos)',
      cancelled.id === a.id && cancelled.targetType === 'event' && cancelled.targetId === 'ea' && cancelled.remindAt === '2026-04-01T08:00:00.000Z');
    check('H. el reminder "b" sigue "pending" (cancelar uno no afecta a los demás)',
      sb.getReminderById(b.id).status === 'pending');
  }

  // =====================================================================
  section('I/J) targetType "event" y "task" funcionan');
  // =====================================================================
  {
    const sb = makeSandbox();
    const ev = await sb.addReminder({ targetType: 'event', targetId: 'evX', remindAt: '2026-05-01T08:00:00.000Z' });
    const tk = await sb.addReminder({ targetType: 'task', targetId: 'tkX', remindAt: '2026-05-02T08:00:00.000Z' });
    check('I. reminder de evento se guarda con targetType "event" y su targetId', ev.targetType === 'event' && ev.targetId === 'evX');
    check('I. se recupera correctamente por getRemindersForTarget("event", "evX")',
      sb.getRemindersForTarget('event', 'evX').some(r => r.id === ev.id));
    check('J. reminder de tarea se guarda con targetType "task" y su targetId', tk.targetType === 'task' && tk.targetId === 'tkX');
    check('J. se recupera correctamente por getRemindersForTarget("task", "tkX")',
      sb.getRemindersForTarget('task', 'tkX').some(r => r.id === tk.id));
    check('I/J. un evento y una tarea con distinto targetType no se confunden entre sí',
      !sb.getRemindersForTarget('event', 'evX').some(r => r.id === tk.id) &&
      !sb.getRemindersForTarget('task', 'tkX').some(r => r.id === ev.id));
  }

  // =====================================================================
  section('K) Un target inexistente devuelve []');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addReminder({ targetType: 'task', targetId: 'real', remindAt: '2026-06-01T08:00:00.000Z' });
    const result = sb.getRemindersForTarget('task', 'no-existe');
    check('K. getRemindersForTarget de un target inexistente devuelve un array', Array.isArray(result));
    check('K. ese array está vacío', result.length === 0);
    const resultOtherType = sb.getRemindersForTarget('event', 'real'); // mismo targetId, otro targetType
    check('K. mismo targetId pero distinto targetType tampoco lo encuentra (también [])', resultOtherType.length === 0);
  }

  // =====================================================================
  section('L) Un id inexistente no rompe la aplicación');
  // =====================================================================
  {
    const sb = makeSandbox();
    let threw = false;
    let getResult, updateResult, cancelResult;
    try {
      getResult = sb.getReminderById('id-que-no-existe');
      updateResult = await sb.updateReminder('id-que-no-existe', { status: 'triggered' });
      cancelResult = await sb.cancelReminder('id-que-no-existe-2');
    } catch (e) { threw = true; }
    check('L. ninguna de las tres llamadas con id inexistente lanza una excepción', !threw);
    check('L. getReminderById con id inexistente devuelve null', getResult === null);
    check('L. updateReminder con id inexistente devuelve null (no crea nada)', updateResult === null && sb.state.reminders.length === 0);
    check('L. cancelReminder con id inexistente devuelve null (no crea nada)', cancelResult === null && sb.state.reminders.length === 0);
  }

  // =====================================================================
  section('M) export incluye reminders');
  // =====================================================================
  {
    check('M. exportData() incluye "reminders: state.reminders," en su payload',
      exportDataSrc.includes('reminders: state.reminders,'));
  }

  // =====================================================================
  section('N) Import de datos sin reminders produce []');
  // =====================================================================
  {
    check('N. la línea real de import de reminders existe en organizator.html (localizada por contenido)',
      !!importRemindersLineMatch);

    // Se ejecuta la línea real (extraída, no reimplementada) en aislado,
    // con `data` sin la clave "reminders" — el mismo caso de un backup
    // antiguo anterior a esta fase.
    // `let` a nivel superior de un script de vm NO crea una propiedad en
    // el objeto global/sandbox, así que hay que exponer `state` con
    // `this.state = state;` (mismo truco ya usado en makeSandbox()) para
    // poder leerlo desde fuera después de ejecutar la línea real.
    const sbNoReminders = {};
    vm.createContext(sbNoReminders);
    vm.runInContext('let state = {}; let data = {};', sbNoReminders);
    vm.runInContext(importRemindersLineMatch[0] + '\nthis.state = state;', sbNoReminders);
    check('N. con data.reminders ausente, state.reminders queda como [] (no undefined, no null, no lanza)',
      Array.isArray(sbNoReminders.state.reminders) && sbNoReminders.state.reminders.length === 0);

    // Control positivo: si el backup SÍ trae reminders, se conservan tal
    // cual (validación mínima de esta fase: solo comprobar que es array).
    const sbWithReminders = {};
    vm.createContext(sbWithReminders);
    vm.runInContext(`let state = {}; let data = { reminders: [{ id: 'r1', targetType: 'task', targetId: 't1', remindAt: '2026-01-01T00:00:00.000Z', status: 'pending' }] };`, sbWithReminders);
    vm.runInContext(importRemindersLineMatch[0] + '\nthis.state = state;', sbWithReminders);
    check('N-bis. con data.reminders presente (array), se conserva tal cual, sin sanear campos',
      Array.isArray(sbWithReminders.state.reminders) && sbWithReminders.state.reminders.length === 1 &&
      sbWithReminders.state.reminders[0].id === 'r1');

    // Si data.reminders no es un array (dato corrupto), también cae a [].
    const sbCorrupt = {};
    vm.createContext(sbCorrupt);
    vm.runInContext(`let state = {}; let data = { reminders: 'no-es-un-array' };`, sbCorrupt);
    vm.runInContext(importRemindersLineMatch[0] + '\nthis.state = state;', sbCorrupt);
    check('N-ter. con data.reminders corrupto (no array), state.reminders también cae a []',
      Array.isArray(sbCorrupt.state.reminders) && sbCorrupt.state.reminders.length === 0);
  }

  // =====================================================================
  section('O) La persistencia usa la clave de reminders');
  // =====================================================================
  {
    check('O. saveReminders() usa la clave "reminders" en window.storage.set',
      saveRemindersSrc.includes("window.storage.set('reminders', JSON.stringify(state.reminders), false)"));
    check('O. loadState() usa la clave "reminders" en window.storage.get',
      loadStateSrc.includes("window.storage.get('reminders', false)"));

    // Comprobación de comportamiento real: crear un reminder debe dejarlo
    // guardado en window.storage bajo esa clave exacta.
    const sb = makeSandbox();
    const r = await sb.addReminder({ targetType: 'task', targetId: 't1', remindAt: '2026-07-01T08:00:00.000Z' });
    check('O. tras addReminder(), window.storage tiene la clave "reminders"', sb.storage._map.has('reminders'));
    const stored = JSON.parse(sb.storage._map.get('reminders'));
    check('O. el contenido guardado coincide con state.reminders', Array.isArray(stored) && stored.length === 1 && stored[0].id === r.id);
  }

  // =====================================================================
  section('P) node --check del código extraído de organizator.html (uid + saveReminders + RECORDATORIOS)');
  // =====================================================================
  {
    const combined = `${uidSrc}\n\nlet state = { reminders: [] };\nconst window = { storage: { async set(){ return {}; } } };\nfunction showToast(){}\n\n${saveRemindersSrc}\n\n${remindersCrudSrc}\n`;
    const tmpPath = path.join(os.tmpdir(), `organizator-reminders-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('P. node --check del código extraído (uid + saveReminders + RECORDATORIOS) pasa (sintaxis válida)', true);
    } catch (e) {
      check('P. node --check del código extraído (uid + saveReminders + RECORDATORIOS) pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
