/**
 * ORGANIZATOR — Tests de la Fase 2 de Recordatorios (cálculo de remindAt,
 * SIN notificaciones)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el bloque "RECORDATORIOS — cálculo de remindAt (Fase 2,
 * SIN notificaciones)" (calculateReminderAt/createReminderForTarget), junto
 * con uid(), saveReminders() y el bloque RECORDATORIOS de la Fase 1
 * (addReminder y el resto del CRUD, del que createReminderForTarget
 * depende), y los ejecuta en un sandbox con un window.storage en memoria
 * — mismo patrón que test-reminders-model.js.
 *
 * Uso:  node js/test-reminders-calculate.js
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
// Bloque CRUD de la Fase 1 (addReminder/getReminderById/getRemindersForTarget/
// updateReminder/cancelReminder). createReminderForTarget (Fase 2) depende de
// addReminder y NO debe duplicar su lógica, así que este fragmento también se
// extrae y se ejecuta en el sandbox.
const remindersCrudSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  'bloque RECORDATORIOS (Fase 1)'
);
// Bloque de cálculo de la Fase 2 (calculateReminderAt/createReminderForTarget).
const remindersCalculateSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt (Fase 2, SIN notificaciones)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fase 2, cálculo)'
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
  vm.runInContext(uidSrc, sandbox, { filename: 'organizator.html (uid)' });
  vm.runInContext('let state = { reminders: [] };', sandbox, { filename: 'state-setup' });
  sandbox.storage = makeStorage();
  vm.runInContext(saveRemindersSrc, sandbox, { filename: 'organizator.html (saveReminders)' });
  vm.runInContext(remindersCrudSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersCalculateSrc, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 2)' });
  vm.runInContext(
    `this.addReminder = addReminder;
     this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget;
     this.updateReminder = updateReminder;
     this.cancelReminder = cancelReminder;
     this.calculateReminderAt = calculateReminderAt;
     this.createReminderForTarget = createReminderForTarget;
     this.state = state;`,
    sandbox, { filename: 'expose-reminders' }
  );
  return sandbox;
}

(async () => {

  // =====================================================================
  section('A) fecha válida + 15 minutos');
  // =====================================================================
  {
    const sb = makeSandbox();
    const result = sb.calculateReminderAt('2026-09-20T20:00:00', 15);
    const expected = new Date(new Date('2026-09-20T20:00:00').getTime() - 15 * 60000).toISOString();
    check('A. calculateReminderAt devuelve el ISO esperado (target - 15 min)', result === expected);
  }

  // =====================================================================
  section('B) fecha válida + 30 minutos');
  // =====================================================================
  {
    const sb = makeSandbox();
    const result = sb.calculateReminderAt('2026-09-20T20:00:00', 30);
    const expected = new Date(new Date('2026-09-20T20:00:00').getTime() - 30 * 60000).toISOString();
    check('B. calculateReminderAt devuelve el ISO esperado (target - 30 min)', result === expected);
  }

  // =====================================================================
  section('C) fecha válida + 60 minutos');
  // =====================================================================
  {
    const sb = makeSandbox();
    const result = sb.calculateReminderAt('2026-09-20T20:00:00', 60);
    const expected = new Date(new Date('2026-09-20T20:00:00').getTime() - 60 * 60000).toISOString();
    check('C. calculateReminderAt devuelve el ISO esperado (target - 60 min)', result === expected);
  }

  // =====================================================================
  section('D) 0 minutos de anticipación devuelve exactamente el momento objetivo');
  // =====================================================================
  {
    const sb = makeSandbox();
    const result = sb.calculateReminderAt('2026-09-20T20:00:00', 0);
    const expected = new Date('2026-09-20T20:00:00').toISOString();
    check('D. calculateReminderAt(target, 0) === target en ISO', result === expected);
  }

  // =====================================================================
  section('E) 1440 minutos (un día) de anticipación');
  // =====================================================================
  {
    const sb = makeSandbox();
    const result = sb.calculateReminderAt('2026-09-20T20:00:00', 1440);
    const expected = new Date(new Date('2026-09-20T20:00:00').getTime() - 1440 * 60000).toISOString();
    check('E. calculateReminderAt(target, 1440) === target - 1 día', result === expected);
    check('E. equivale exactamente al día anterior a la misma hora', result === new Date('2026-09-19T20:00:00').toISOString());
  }

  // =====================================================================
  section('F) fecha objetivo inválida → null');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('F. cadena no-fecha → null', sb.calculateReminderAt('no-es-una-fecha', 15) === null);
    check('F. cadena vacía → null', sb.calculateReminderAt('', 15) === null);
    check('F. null → null', sb.calculateReminderAt(null, 15) === null);
    check('F. undefined → null', sb.calculateReminderAt(undefined, 15) === null);
    check('F. Date inválida (new Date("bad")) → null', sb.calculateReminderAt(new Date('bad'), 15) === null);
  }

  // =====================================================================
  section('G) minutesBefore inválido (no numérico) → null');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('G. minutesBefore string → null', sb.calculateReminderAt('2026-09-20T20:00:00', '15') === null);
    check('G. minutesBefore null → null', sb.calculateReminderAt('2026-09-20T20:00:00', null) === null);
    check('G. minutesBefore undefined → null', sb.calculateReminderAt('2026-09-20T20:00:00', undefined) === null);
    check('G. minutesBefore NaN → null', sb.calculateReminderAt('2026-09-20T20:00:00', NaN) === null);
    check('G. minutesBefore Infinity → null', sb.calculateReminderAt('2026-09-20T20:00:00', Infinity) === null);
  }

  // =====================================================================
  section('H) minutesBefore negativo → null');
  // =====================================================================
  {
    const sb = makeSandbox();
    check('H. minutesBefore -1 → null', sb.calculateReminderAt('2026-09-20T20:00:00', -1) === null);
    check('H. minutesBefore -1440 → null', sb.calculateReminderAt('2026-09-20T20:00:00', -1440) === null);
  }

  // =====================================================================
  section('I) no modifica el objeto/estado original');
  // =====================================================================
  {
    const sb = makeSandbox();
    const original = new Date('2026-09-20T20:00:00');
    const originalTime = original.getTime();
    const stateSnapshotBefore = JSON.stringify(sb.state);
    sb.calculateReminderAt(original, 15);
    check('I. la instancia Date pasada como argumento no se muta', original.getTime() === originalTime);
    check('I. state no se toca en absoluto (función pura)', JSON.stringify(sb.state) === stateSnapshotBefore);
  }

  // =====================================================================
  section('J) devuelve un ISO válido (parseable y re-serializable)');
  // =====================================================================
  {
    const sb = makeSandbox();
    const result = sb.calculateReminderAt('2026-09-20T20:00:00', 45);
    check('J. el resultado es un string', typeof result === 'string');
    check('J. el resultado tiene forma de ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result));
    check('J. new Date(resultado).toISOString() === resultado (round-trip)', new Date(result).toISOString() === result);
  }

  // =====================================================================
  section('K) createReminderForTarget con un evento');
  // =====================================================================
  let sbK, reminderEvent;
  {
    sbK = makeSandbox();
    reminderEvent = await sbK.createReminderForTarget('event', 'evX', '2026-09-20T20:00:00', 15);
    check('K. createReminderForTarget devuelve un reminder (no null)', !!reminderEvent);
    check('K. targetType es "event"', reminderEvent.targetType === 'event');
    check('K. el reminder queda en state.reminders', sbK.state.reminders.some(r => r.id === reminderEvent.id));
  }

  // =====================================================================
  section('L) createReminderForTarget con una tarea');
  // =====================================================================
  let reminderTask;
  {
    reminderTask = await sbK.createReminderForTarget('task', 'tkX', '2026-09-21T09:30:00', 30);
    check('L. createReminderForTarget devuelve un reminder (no null)', !!reminderTask);
    check('L. targetType es "task"', reminderTask.targetType === 'task');
    check('L. el reminder queda en state.reminders', sbK.state.reminders.some(r => r.id === reminderTask.id));
  }

  // =====================================================================
  section('M) targetId se conserva');
  // =====================================================================
  {
    check('M. el reminder de evento conserva su targetId', reminderEvent.targetId === 'evX');
    check('M. el reminder de tarea conserva su targetId', reminderTask.targetId === 'tkX');
  }

  // =====================================================================
  section('N) status inicial es "pending"');
  // =====================================================================
  {
    check('N. reminder de evento nace "pending"', reminderEvent.status === 'pending');
    check('N. reminder de tarea nace "pending"', reminderTask.status === 'pending');
  }

  // =====================================================================
  section('O) remindAt coincide con el cálculo esperado');
  // =====================================================================
  {
    const expectedEvent = new Date(new Date('2026-09-20T20:00:00').getTime() - 15 * 60000).toISOString();
    const expectedTask = new Date(new Date('2026-09-21T09:30:00').getTime() - 30 * 60000).toISOString();
    check('O. remindAt del evento coincide con calculateReminderAt equivalente', reminderEvent.remindAt === expectedEvent);
    check('O. remindAt de la tarea coincide con calculateReminderAt equivalente', reminderTask.remindAt === expectedTask);
  }

  // =====================================================================
  section('P) datos inválidos no crean ningún reminder');
  // =====================================================================
  {
    const sb = makeSandbox();
    const r1 = await sb.createReminderForTarget('event', 'evBad', 'fecha-invalida', 15);
    const r2 = await sb.createReminderForTarget('task', 'tkBad', '2026-09-20T20:00:00', -5);
    const r3 = await sb.createReminderForTarget('otro-tipo', 'x1', '2026-09-20T20:00:00', 15);
    const r4 = await sb.createReminderForTarget('event', '', '2026-09-20T20:00:00', 15);
    check('P. targetDateTime inválido → null y no crea reminder', r1 === null);
    check('P. minutesBefore negativo → null y no crea reminder', r2 === null);
    check('P. targetType inválido → null y no crea reminder', r3 === null);
    check('P. targetId vacío → null y no crea reminder', r4 === null);
    check('P. state.reminders sigue vacío tras los 4 intentos inválidos', sb.state.reminders.length === 0);
  }

  // =====================================================================
  section('Q) IDs diferentes al crear dos reminders');
  // =====================================================================
  {
    check('Q. el reminder de evento y el de tarea tienen ids distintos', reminderEvent.id !== reminderTask.id);
    const sb = makeSandbox();
    const a = await sb.createReminderForTarget('task', 'dup', '2026-10-01T08:00:00', 5);
    const b = await sb.createReminderForTarget('task', 'dup', '2026-10-01T08:00:00', 5);
    check('Q. dos reminders creados con los mismos datos tienen ids distintos', a.id !== b.id);
    check('Q. ambos coexisten en state.reminders', sb.state.reminders.length === 2);
  }

  // =====================================================================
  section('R) node --check del código extraído de organizator.html (Fase 2)');
  // =====================================================================
  {
    const combined = `${uidSrc}\n\nlet state = { reminders: [] };\nconst window = { storage: { async set(){ return {}; } } };\nfunction showToast(){}\n\n${saveRemindersSrc}\n\n${remindersCrudSrc}\n\n${remindersCalculateSrc}\n`;
    const tmpPath = path.join(os.tmpdir(), `organizator-reminders-calculate-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('R. node --check del código extraído (Fase 2: calculateReminderAt + createReminderForTarget) pasa', true);
    } catch (e) {
      check('R. node --check del código extraído (Fase 2: calculateReminderAt + createReminderForTarget) pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
