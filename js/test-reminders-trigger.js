/**
 * ORGANIZATOR — Tests de la Fase 4 de Recordatorios (motor de detección y
 * disparo lógico, SIN notificaciones)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html uid(), saveReminders(), el bloque RECORDATORIOS de la
 * Fase 1 (addReminder/getReminderById/getRemindersForTarget/updateReminder/
 * cancelReminder, de los que triggerDueReminders() depende) y el nuevo
 * bloque de la Fase 4 (getDueReminders/triggerDueReminders), y los ejecuta
 * en un sandbox con un window.storage en memoria — mismo patrón que
 * test-reminders-model.js / test-reminders-calculate.js / test-reminders-ui.js.
 *
 * Uso:  node js/test-reminders-trigger.js
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
const saveRemindersSrc = extractBetween(html, 'async function saveReminders(){', '\nasync function savePrefs(){', 'función saveReminders()');
const remindersFase1Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  'bloque RECORDATORIOS (Fase 1)'
);
const remindersFase4Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — motor de detección y disparo lógico (Fase 4)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fase 4, motor de disparo)'
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
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase4Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 4)' });
  vm.runInContext(
    `this.addReminder = addReminder;
     this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget;
     this.updateReminder = updateReminder;
     this.cancelReminder = cancelReminder;
     this.getDueReminders = getDueReminders;
     this.triggerDueReminders = triggerDueReminders;
     this.state = state;`,
    sandbox, { filename: 'expose-reminders-trigger' }
  );
  return sandbox;
}

/** Inserta un reminder directamente en state.reminders con los campos
 * exactos que se le pasen (sin pasar por addReminder(), para poder fijar
 * remindAt/status/id a mano y así construir escenarios de "vencido" de
 * forma determinista). Devuelve el reminder insertado. */
function seedReminder(sb, { id, targetType, targetId, remindAt, status, createdAt }) {
  const r = { id, targetType, targetId, remindAt, status, createdAt: createdAt || Date.now() };
  sb.state.reminders.push(r);
  return r;
}

(async () => {
  const NOW = new Date('2026-09-20T20:00:00.000Z');

  // =====================================================================
  section('A) pending con remindAt futuro → no se dispara');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rA', targetType: 'event', targetId: 'e1', remindAt: '2026-09-20T20:00:01.000Z', status: 'pending' });
    const due = sb.getDueReminders(NOW);
    check('A. un reminder pending con remindAt POSTERIOR a now no está entre los vencidos', !due.some(r => r.id === 'rA'));
    check('A. getDueReminders devuelve [] (nada vencido todavía)', due.length === 0);
  }

  // =====================================================================
  section('B) pending con remindAt EXACTAMENTE igual a now → se dispara');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rB', targetType: 'event', targetId: 'e2', remindAt: NOW.toISOString(), status: 'pending' });
    const due = sb.getDueReminders(NOW);
    check('B. remindAt === now cuenta como vencido (<=, no <)', due.some(r => r.id === 'rB'));
    check('B. exactamente 1 vencido', due.length === 1);
  }

  // =====================================================================
  section('C) pending con remindAt ANTERIOR a now → se dispara');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rC', targetType: 'task', targetId: 't1', remindAt: '2026-09-20T19:59:00.000Z', status: 'pending' });
    const due = sb.getDueReminders(NOW);
    check('C. remindAt anterior a now está entre los vencidos', due.some(r => r.id === 'rC'));
  }

  // =====================================================================
  section('D) cancelled vencido → NO se dispara');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rD', targetType: 'event', targetId: 'e3', remindAt: '2026-09-20T19:00:00.000Z', status: 'cancelled' });
    const due = sb.getDueReminders(NOW);
    check('D. un reminder cancelled con remindAt vencido se IGNORA', due.length === 0);
  }

  // =====================================================================
  section('E) triggered vencido → NO se dispara de nuevo');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rE', targetType: 'task', targetId: 't2', remindAt: '2026-09-20T19:00:00.000Z', status: 'triggered' });
    const due = sb.getDueReminders(NOW);
    check('E. un reminder ya triggered con remindAt vencido se IGNORA (no se re-dispara)', due.length === 0);
  }

  // =====================================================================
  section('F) varios reminders vencidos → todos se disparan');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rF1', targetType: 'event', targetId: 'e4', remindAt: '2026-09-20T18:00:00.000Z', status: 'pending' });
    seedReminder(sb, { id: 'rF2', targetType: 'task', targetId: 't3', remindAt: '2026-09-20T19:30:00.000Z', status: 'pending' });
    seedReminder(sb, { id: 'rF3', targetType: 'event', targetId: 'e5', remindAt: NOW.toISOString(), status: 'pending' });
    const due = sb.getDueReminders(NOW);
    check('F. los 3 reminders vencidos aparecen', due.length === 3);
    check('F. incluye rF1', due.some(r => r.id === 'rF1'));
    check('F. incluye rF2', due.some(r => r.id === 'rF2'));
    check('F. incluye rF3', due.some(r => r.id === 'rF3'));
  }

  // =====================================================================
  section('G) reminder futuro mezclado con vencidos → solo los vencidos');
  // =====================================================================
  {
    const sb = makeSandbox();
    const due1 = seedReminder(sb, { id: 'rG1', targetType: 'event', targetId: 'e6', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const future = seedReminder(sb, { id: 'rG2', targetType: 'task', targetId: 't4', remindAt: '2026-09-21T09:00:00.000Z', status: 'pending' });
    const due = sb.getDueReminders(NOW);
    check('G. solo el vencido está en el resultado', due.length === 1 && due[0].id === due1.id);
    check('G. el futuro NO aparece', !due.some(r => r.id === future.id));
  }

  // =====================================================================
  section('H) getDueReminders() no modifica state.reminders');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rH', targetType: 'event', targetId: 'e7', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const snapshotBefore = JSON.stringify(sb.state.reminders);
    sb.getDueReminders(NOW);
    check('H. state.reminders queda exactamente igual (misma serialización)', JSON.stringify(sb.state.reminders) === snapshotBefore);
    check('H. el reminder sigue "pending" (getDueReminders no lo marca)', sb.getReminderById('rH').status === 'pending');
  }

  // =====================================================================
  section('I) getDueReminders() devuelve un array NUEVO');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rI', targetType: 'event', targetId: 'e8', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const due = sb.getDueReminders(NOW);
    check('I. el array devuelto NO es la misma referencia que state.reminders', due !== sb.state.reminders);
    due.push({ id: 'inyectado' });
    check('I. mutar el array devuelto no afecta a state.reminders', sb.state.reminders.length === 1);
  }

  // =====================================================================
  section('J) now inválido → []');
  // =====================================================================
  {
    const sb = makeSandbox();
    seedReminder(sb, { id: 'rJ', targetType: 'event', targetId: 'e9', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    check('J. now = "no-es-una-fecha" → []', Array.isArray(sb.getDueReminders('no-es-una-fecha')) && sb.getDueReminders('no-es-una-fecha').length === 0);
    check('J. now = new Date("bad") → []', sb.getDueReminders(new Date('bad')).length === 0);
    check('J. now = null → []', sb.getDueReminders(null).length === 0);
    check('J. now = undefined usa el valor por defecto (new Date()) y no lanza', (() => { try { sb.getDueReminders(undefined); return true; } catch (e) { return false; } })());
  }

  // =====================================================================
  section('K) triggerDueReminders() cambia status a "triggered"');
  // =====================================================================
  let sbK, triggeredK;
  {
    sbK = makeSandbox();
    await sbK.addReminder({ targetType: 'event', targetId: 'evK', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    triggeredK = await sbK.triggerDueReminders(NOW);
    check('K. triggerDueReminders devuelve un array con 1 elemento', Array.isArray(triggeredK) && triggeredK.length === 1);
    check('K. el reminder pasa a status "triggered"', triggeredK[0].status === 'triggered');
    check('K. state.reminders también refleja el cambio', sbK.state.reminders[0].status === 'triggered');
  }

  // =====================================================================
  section('L) conserva id/targetType/targetId/remindAt');
  // =====================================================================
  {
    const sb = makeSandbox();
    const original = await sb.addReminder({ targetType: 'task', targetId: 'tkL', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const originalId = original.id;
    const originalTargetType = original.targetType;
    const originalTargetId = original.targetId;
    const originalRemindAt = original.remindAt;
    const [triggered] = await sb.triggerDueReminders(NOW);
    check('L. conserva id', triggered.id === originalId);
    check('L. conserva targetType', triggered.targetType === originalTargetType);
    check('L. conserva targetId', triggered.targetId === originalTargetId);
    check('L. conserva remindAt', triggered.remindAt === originalRemindAt);
    check('L. status pasa a "triggered"', triggered.status === 'triggered');
  }

  // =====================================================================
  section('M) ejecutar triggerDueReminders() dos veces con el mismo now no duplica el disparo');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addReminder({ targetType: 'event', targetId: 'evM', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    const first = await sb.triggerDueReminders(NOW);
    const second = await sb.triggerDueReminders(NOW);
    check('M. la primera pasada dispara 1 reminder', first.length === 1);
    check('M. la segunda pasada con el mismo now no dispara nada (ya no es pending)', second.length === 0);
    check('M. sigue habiendo un único reminder en total (no se duplicó)', sb.state.reminders.length === 1);
    check('M. su status sigue siendo "triggered" (no volvió a "pending" ni cambió remindAt)', sb.state.reminders[0].status === 'triggered');
  }

  // =====================================================================
  section('N) persistencia correcta');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addReminder({ targetType: 'task', targetId: 'tkN', remindAt: '2026-09-20T19:00:00.000Z', status: 'pending' });
    await sb.triggerDueReminders(NOW);
    check('N. tras triggerDueReminders(), window.storage tiene la clave "reminders"', sb.storage._map.has('reminders'));
    const stored = JSON.parse(sb.storage._map.get('reminders'));
    check('N. el contenido persistido refleja el status "triggered"', Array.isArray(stored) && stored.length === 1 && stored[0].status === 'triggered');
  }

  // =====================================================================
  section('O) batch con reminders de distintos targetType funciona sin depender de posiciones');
  // =====================================================================
  {
    const sb = makeSandbox();
    // Se insertan en un orden deliberadamente "desordenado" y con ids no
    // secuenciales para comprobar que el motor no asume nada sobre la
    // posición en el array.
    const rTaskFuture = await sb.addReminder({ targetType: 'task', targetId: 'tkO-future', remindAt: '2026-09-21T09:00:00.000Z', status: 'pending' });
    const rEventDue = await sb.addReminder({ targetType: 'event', targetId: 'evO-due', remindAt: '2026-09-20T10:00:00.000Z', status: 'pending' });
    const rTaskDue = await sb.addReminder({ targetType: 'task', targetId: 'tkO-due', remindAt: '2026-09-20T19:59:59.000Z', status: 'pending' });
    const rEventCancelled = await sb.addReminder({ targetType: 'event', targetId: 'evO-cancelled', remindAt: '2026-09-20T10:00:00.000Z', status: 'cancelled' });
    const triggered = await sb.triggerDueReminders(NOW);
    check('O. se disparan exactamente los 2 vencidos-pending (evento + tarea)', triggered.length === 2);
    check('O. incluye el evento vencido, identificado por id (no por posición)', triggered.some(r => r.id === rEventDue.id && r.targetType === 'event'));
    check('O. incluye la tarea vencida, identificada por id (no por posición)', triggered.some(r => r.id === rTaskDue.id && r.targetType === 'task'));
    check('O. NO incluye la tarea futura', !triggered.some(r => r.id === rTaskFuture.id));
    check('O. NO incluye el evento cancelled', !triggered.some(r => r.id === rEventCancelled.id));
    check('O. el cancelled sigue "cancelled" (no se tocó)', sb.getReminderById(rEventCancelled.id).status === 'cancelled');
    check('O. la tarea futura sigue "pending" (no se tocó)', sb.getReminderById(rTaskFuture.id).status === 'pending');
  }

  // =====================================================================
  section('P) node --check del código extraído de organizator.html (Fase 4)');
  // =====================================================================
  {
    const combined = `${uidSrc}\n\nlet state = { reminders: [] };\nconst window = { storage: { async set(){ return {}; } } };\nfunction showToast(){}\n\n${saveRemindersSrc}\n\n${remindersFase1Src}\n\n${remindersFase4Src}\n`;
    const tmpPath = path.join(os.tmpdir(), `organizator-reminders-trigger-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('P. node --check del código extraído (Fase 4: getDueReminders + triggerDueReminders) pasa', true);
    } catch (e) {
      check('P. node --check del código extraído (Fase 4: getDueReminders + triggerDueReminders) pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
