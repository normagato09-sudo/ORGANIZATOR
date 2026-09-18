/**
 * ORGANIZATOR — Tests de la Fase 3 de Recordatorios (configuración desde la
 * interfaz de eventos y tareas, SIN notificaciones)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html uid(), saveTasks()/saveEvents()/saveReminders(), el
 * bloque CRUD (addTask/updateTask/deleteTask/addEvent/updateEvent/
 * deleteEvent — que en esta fase también cancelan los reminders del
 * target al borrar), el bloque RECORDATORIOS de la Fase 1, el de la Fase 2
 * y el nuevo bloque de integración de la Fase 3 (reminderTargetDateTime/
 * reminderOptionsHtml/pendingReminderForTarget/currentReminderMinutes/
 * syncReminderForTarget/cancelRemindersForTarget), y los ejecuta en un
 * sandbox con un window.storage en memoria — mismo patrón que
 * test-reminders-model.js y test-reminders-calculate.js.
 *
 * Los formularios en sí (openEventModal/openTaskModal) dependen del DOM
 * real y no se instancian aquí: en su lugar se prueban directamente los
 * helpers puros/de sincronización que esos formularios invocan al guardar,
 * que es donde vive toda la lógica de esta fase.
 *
 * Uso:  node js/test-reminders-ui.js
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
const saveTasksSrc = extractBetween(html, 'async function saveTasks(){', '\nasync function saveEvents(){', 'función saveTasks()');
const saveEventsSrc = extractBetween(html, 'async function saveEvents(){', '\nasync function saveCustomSchedules(){', 'función saveEvents()');
const saveRemindersSrc = extractBetween(html, 'async function saveReminders(){', '\nasync function savePrefs(){', 'función saveReminders()');
// Bloque CRUD (addTask/updateTask/deleteTask/toggleTask/addEvent/updateEvent/
// deleteEvent). En esta fase, deleteTask/deleteEvent también cancelan los
// reminders del target — se prueba el comportamiento REAL, no una reimplementación.
const crudSrc = extractBetween(
  html,
  '/* ==================================================================\n   CRUD',
  '\n\n/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  'bloque CRUD'
);
// Desde R-1, addTask/addEvent/updateTask/updateEvent (bloque CRUD) llaman
// a sanitizeRecurrence() para sanear `recurrence` — no se relaciona con
// reminders, pero debe existir en el sandbox o el CRUD lanza un
// ReferenceError. Mismo rango que ya extraen test-recurrence-model.js/
// test-recurrence-ui-r5.js (bloque de saneamiento completo, autocontenido).
const sanitizeSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1)'
);
const remindersFase1Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  'bloque RECORDATORIOS (Fase 1)'
);
const remindersFase2Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt (Fase 2, SIN notificaciones)',
  '\n\n/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)',
  'bloque RECORDATORIOS (Fase 2, cálculo)'
);
const remindersFase3Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fase 3, integración UI)'
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
  vm.runInContext('let state = { tasks: [], events: [], reminders: [] };', sandbox, { filename: 'state-setup' });
  sandbox.storage = makeStorage();
  vm.runInContext('function showToast(){}', sandbox, { filename: 'stub-showToast' });
  vm.runInContext(saveTasksSrc, sandbox, { filename: 'organizator.html (saveTasks)' });
  vm.runInContext(saveEventsSrc, sandbox, { filename: 'organizator.html (saveEvents)' });
  vm.runInContext(saveRemindersSrc, sandbox, { filename: 'organizator.html (saveReminders)' });
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase2Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 2)' });
  vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3)' });
  vm.runInContext(sanitizeSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1)' });
  vm.runInContext(crudSrc, sandbox, { filename: 'organizator.html (CRUD)' });
  vm.runInContext(
    `this.addTask = addTask; this.updateTask = updateTask; this.deleteTask = deleteTask;
     this.addEvent = addEvent; this.updateEvent = updateEvent; this.deleteEvent = deleteEvent;
     this.addReminder = addReminder; this.getReminderById = getReminderById;
     this.getRemindersForTarget = getRemindersForTarget; this.updateReminder = updateReminder;
     this.cancelReminder = cancelReminder;
     this.calculateReminderAt = calculateReminderAt; this.createReminderForTarget = createReminderForTarget;
     this.reminderTargetDateTime = reminderTargetDateTime; this.reminderOptionsHtml = reminderOptionsHtml;
     this.pendingReminderForTarget = pendingReminderForTarget; this.currentReminderMinutes = currentReminderMinutes;
     this.syncReminderForTarget = syncReminderForTarget; this.cancelRemindersForTarget = cancelRemindersForTarget;
     this.REMINDER_OPTIONS = REMINDER_OPTIONS;
     this.state = state;`,
    sandbox, { filename: 'expose-reminders-ui' }
  );
  return sandbox;
}

(async () => {

  // =====================================================================
  section('A) evento sin reminder (Sin recordatorio)');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addEvent({ id: 'evA', title: 'Reunión', date: '2026-11-02', allDay: false, startTime: '10:00' });
    const dt = sb.reminderTargetDateTime('2026-11-02', '10:00');
    const result = await sb.syncReminderForTarget('event', 'evA', dt, '');
    check('A. syncReminderForTarget con "Sin recordatorio" devuelve null', result === null);
    check('A. no se crea ningún reminder', sb.getRemindersForTarget('event', 'evA').length === 0);
  }

  // =====================================================================
  section('B) evento con reminder');
  // =====================================================================
  let sbB, eventReminder;
  {
    sbB = makeSandbox();
    await sbB.addEvent({ id: 'evB', title: 'Reunión', date: '2026-11-02', allDay: false, startTime: '10:00' });
    const dt = sbB.reminderTargetDateTime('2026-11-02', '10:00');
    eventReminder = await sbB.syncReminderForTarget('event', 'evB', dt, '15');
    check('B. syncReminderForTarget devuelve un reminder (no null)', !!eventReminder);
    check('B. el reminder queda registrado para el evento', sbB.getRemindersForTarget('event', 'evB').some(r => r.id === eventReminder.id));
  }

  // =====================================================================
  section('C) tarea con reminder');
  // =====================================================================
  let sbC, taskReminder;
  {
    sbC = makeSandbox();
    await sbC.addTask({ id: 'tkC', title: 'Entregar informe', dueDate: '2026-11-03', dueTime: '09:00' });
    const dt = sbC.reminderTargetDateTime('2026-11-03', '09:00');
    taskReminder = await sbC.syncReminderForTarget('task', 'tkC', dt, '30');
    check('C. syncReminderForTarget devuelve un reminder (no null)', !!taskReminder);
    check('C. el reminder queda registrado para la tarea', sbC.getRemindersForTarget('task', 'tkC').some(r => r.id === taskReminder.id));
  }

  // =====================================================================
  section('D) targetType "event"');
  // =====================================================================
  {
    check('D. el reminder del evento tiene targetType "event"', eventReminder.targetType === 'event');
  }

  // =====================================================================
  section('E) targetType "task"');
  // =====================================================================
  {
    check('E. el reminder de la tarea tiene targetType "task"', taskReminder.targetType === 'task');
  }

  // =====================================================================
  section('F) targetId correcto');
  // =====================================================================
  {
    check('F. el reminder del evento conserva targetId "evB"', eventReminder.targetId === 'evB');
    check('F. el reminder de la tarea conserva targetId "tkC"', taskReminder.targetId === 'tkC');
  }

  // =====================================================================
  section('G) remindAt correcto');
  // =====================================================================
  {
    const expectedEvent = sbB.calculateReminderAt('2026-11-02T10:00:00', 15);
    const expectedTask = sbC.calculateReminderAt('2026-11-03T09:00:00', 30);
    check('G. remindAt del reminder de evento coincide con calculateReminderAt', eventReminder.remindAt === expectedEvent);
    check('G. remindAt del reminder de tarea coincide con calculateReminderAt', taskReminder.remindAt === expectedTask);
  }

  // =====================================================================
  section('H) cambiar 30 → 60 minutos conserva el mismo id');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ id: 'tkH', title: 'Pagar factura', dueDate: '2026-11-05', dueTime: '08:00' });
    const dt = sb.reminderTargetDateTime('2026-11-05', '08:00');
    const first = await sb.syncReminderForTarget('task', 'tkH', dt, '30');
    const second = await sb.syncReminderForTarget('task', 'tkH', dt, '60');
    check('H. el segundo guardado devuelve el MISMO id que el primero', second.id === first.id);
    check('H. remindAt se actualiza al nuevo valor (60 min)', second.remindAt === sb.calculateReminderAt(dt, 60));
    check('H. sigue habiendo un único reminder en total para ese target', sb.getRemindersForTarget('task', 'tkH').length === 1);
    check('H. el reminder sigue "pending"', second.status === 'pending');
  }

  // =====================================================================
  section('I) cancelar (30 min → Sin recordatorio) cambia status a "cancelled"');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addEvent({ id: 'evI', title: 'Cita médica', date: '2026-11-06', allDay: false, startTime: '17:00' });
    const dt = sb.reminderTargetDateTime('2026-11-06', '17:00');
    const created = await sb.syncReminderForTarget('event', 'evI', dt, '30');
    const cancelled = await sb.syncReminderForTarget('event', 'evI', dt, '');
    check('I. syncReminderForTarget con "Sin recordatorio" devuelve null', cancelled === null);
    const stored = sb.getReminderById(created.id);
    check('I. el reminder original pasa a status "cancelled"', stored.status === 'cancelled');
    check('I. conserva su id', stored.id === created.id);
    check('I. conserva targetType', stored.targetType === 'event');
    check('I. conserva targetId', stored.targetId === 'evI');
    check('I. conserva remindAt (no se borra el dato, solo se cancela)', stored.remindAt === created.remindAt);
  }

  // =====================================================================
  section('J) no se crean reminders duplicados para el mismo target');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addTask({ id: 'tkJ', title: 'Llamar al banco', dueDate: '2026-11-07', dueTime: '12:00' });
    const dt = sb.reminderTargetDateTime('2026-11-07', '12:00');
    await sb.syncReminderForTarget('task', 'tkJ', dt, '5');
    await sb.syncReminderForTarget('task', 'tkJ', dt, '10');
    await sb.syncReminderForTarget('task', 'tkJ', dt, '15');
    await sb.syncReminderForTarget('task', 'tkJ', dt, '60');
    check('J. tras varios cambios, sigue habiendo un único reminder en state.reminders', sb.state.reminders.length === 1);
    check('J. sigue habiendo un único reminder para ese target', sb.getRemindersForTarget('task', 'tkJ').length === 1);
  }

  // =====================================================================
  section('K) borrar el target deja su reminder "cancelled" (no lo borra)');
  // =====================================================================
  {
    const sbEv = makeSandbox();
    await sbEv.addEvent({ id: 'evK', title: 'Evento a borrar', date: '2026-11-08', allDay: false, startTime: '11:00' });
    const dtEv = sbEv.reminderTargetDateTime('2026-11-08', '11:00');
    const remEv = await sbEv.syncReminderForTarget('event', 'evK', dtEv, '15');
    await sbEv.deleteEvent('evK');
    check('K. tras deleteEvent(), el evento ya no existe', !sbEv.state.events.some(e => e.id === 'evK'));
    check('K. el reminder del evento SIGUE existiendo (no se borra físicamente)', !!sbEv.getReminderById(remEv.id));
    check('K. el reminder del evento pasa a status "cancelled"', sbEv.getReminderById(remEv.id).status === 'cancelled');

    const sbTk = makeSandbox();
    await sbTk.addTask({ id: 'tkK', title: 'Tarea a borrar', dueDate: '2026-11-08', dueTime: '11:00' });
    const dtTk = sbTk.reminderTargetDateTime('2026-11-08', '11:00');
    const remTk = await sbTk.syncReminderForTarget('task', 'tkK', dtTk, '15');
    await sbTk.deleteTask('tkK');
    check('K. tras deleteTask(), la tarea ya no existe', !sbTk.state.tasks.some(t => t.id === 'tkK'));
    check('K. el reminder de la tarea SIGUE existiendo (no se borra físicamente)', !!sbTk.getReminderById(remTk.id));
    check('K. el reminder de la tarea pasa a status "cancelled"', sbTk.getReminderById(remTk.id).status === 'cancelled');
  }

  // =====================================================================
  section('L) el reminder existente se detecta por targetType + targetId (no por posición)');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addEvent({ id: 'evL', title: 'Evento L', date: '2026-11-09', allDay: false, startTime: '09:00' });
    await sb.addTask({ id: 'evL', title: 'Tarea con mismo id que el evento', dueDate: '2026-11-09', dueTime: '09:00' });
    const dt = sb.reminderTargetDateTime('2026-11-09', '09:00');
    const evReminder = await sb.syncReminderForTarget('event', 'evL', dt, '10');
    const tkReminder = await sb.syncReminderForTarget('task', 'evL', dt, '20');
    check('L. mismo targetId pero distinto targetType generan reminders DISTINTOS', evReminder.id !== tkReminder.id);
    check('L. pendingReminderForTarget("event", "evL") encuentra el del evento', sb.pendingReminderForTarget('event', 'evL').id === evReminder.id);
    check('L. pendingReminderForTarget("task", "evL") encuentra el de la tarea', sb.pendingReminderForTarget('task', 'evL').id === tkReminder.id);
    // addReminder/updateReminder mutan el mismo objeto por referencia (igual
    // que en la Fase 1), así que el remindAt ORIGINAL se guarda en una
    // variable aparte ANTES de actualizar — comparar contra evReminder.remindAt
    // después de mutarlo compararía el objeto consigo mismo.
    const originalEvId = evReminder.id;
    const originalEvRemindAt = evReminder.remindAt;
    const originalTkRemindAt = tkReminder.remindAt;
    const evUpdated = await sb.syncReminderForTarget('event', 'evL', dt, '30');
    check('L. actualizar el del evento no toca el de la tarea', sb.getReminderById(tkReminder.id).remindAt === originalTkRemindAt);
    check('L. y sí actualiza el correcto (mismo id, nuevo remindAt)', evUpdated.id === originalEvId && evUpdated.remindAt !== originalEvRemindAt);
  }

  // =====================================================================
  section('M) evento allDay sin hora no crea reminder');
  // =====================================================================
  {
    const sb = makeSandbox();
    await sb.addEvent({ id: 'evM', title: 'Evento todo el día', date: '2026-11-10', allDay: true, startTime: '' });
    const dt = sb.reminderTargetDateTime('2026-11-10', ''); // sin hora -> null
    check('M. reminderTargetDateTime de un allDay sin hora es null', dt === null);
    const result = await sb.syncReminderForTarget('event', 'evM', dt, '15');
    check('M. syncReminderForTarget con datetime null devuelve null aunque se pida "15"', result === null);
    check('M. no se crea ningún reminder para el evento allDay', sb.getRemindersForTarget('event', 'evM').length === 0);

    // También una tarea sin hora (dueTime vacío) debe comportarse igual.
    const sb2 = makeSandbox();
    await sb2.addTask({ id: 'tkM', title: 'Tarea sin hora', dueDate: '2026-11-10', dueTime: '' });
    const dtTask = sb2.reminderTargetDateTime('2026-11-10', '');
    const resultTask = await sb2.syncReminderForTarget('task', 'tkM', dtTask, '30');
    check('M-bis. tarea sin hora tampoco crea reminder', resultTask === null && sb2.getRemindersForTarget('task', 'tkM').length === 0);

    // reminderOptionsHtml no debe ofrecer opciones cuando no hay datetime.
    const html = sb.reminderOptionsHtml(false, '');
    check('M-ter. reminderOptionsHtml(false, ...) solo ofrece "Sin recordatorio"', html.includes('Sin recordatorio') && !html.includes('15 minutos antes'));
  }

  // =====================================================================
  section('N) target inexistente no rompe la aplicación');
  // =====================================================================
  {
    const sb = makeSandbox();
    let threw = false;
    let syncResult, cancelResult, pendingResult;
    try {
      const dt = sb.reminderTargetDateTime('2026-12-01', '10:00');
      syncResult = await sb.syncReminderForTarget('event', 'no-existe', dt, '15');
      cancelResult = await sb.cancelRemindersForTarget('task', 'tampoco-existe');
      pendingResult = sb.pendingReminderForTarget('event', 'no-existe-2');
    } catch (e) { threw = true; }
    check('N. ninguna llamada con target inexistente lanza una excepción', !threw);
    // syncReminderForTarget SÍ puede crear un reminder "huérfano" (el helper
    // no conoce la tabla de eventos/tareas, solo targetType+targetId+datetime);
    // lo relevante es que no rompe y que targetId queda correctamente asociado.
    check('N. syncReminderForTarget con target inexistente no lanza y devuelve un reminder coherente', !!syncResult && syncResult.targetId === 'no-existe');
    check('N. cancelRemindersForTarget de un target sin reminders no lanza (no hace nada)', cancelResult === undefined);
    check('N. pendingReminderForTarget de un target sin reminders devuelve null', pendingResult === null);
  }

  // =====================================================================
  section('O) la Fase 1 de recordatorios sigue pasando (regresión real, subproceso)');
  // =====================================================================
  {
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, 'test-reminders-model.js')], { encoding: 'utf8' });
      check('O. node js/test-reminders-model.js sigue pasando (42/42)', /42 pasaron, 0 fallaron\./.test(out));
    } catch (e) {
      check('O. node js/test-reminders-model.js sigue pasando (42/42)', false);
      console.log(String(e.stdout || e.message));
    }
  }

  // =====================================================================
  section('P) la Fase 2 de recordatorios sigue pasando (regresión real, subproceso)');
  // =====================================================================
  {
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, 'test-reminders-calculate.js')], { encoding: 'utf8' });
      check('P. node js/test-reminders-calculate.js sigue pasando (44/44)', /44 pasaron, 0 fallaron\./.test(out));
    } catch (e) {
      check('P. node js/test-reminders-calculate.js sigue pasando (44/44)', false);
      console.log(String(e.stdout || e.message));
    }
  }

  // =====================================================================
  section('Q) node --check del código extraído de organizator.html (Fase 3)');
  // =====================================================================
  {
    const combined = `${uidSrc}\n\nlet state = { tasks: [], events: [], reminders: [] };\nconst window = { storage: { async set(){ return {}; } } };\nfunction showToast(){}\n\n${saveTasksSrc}\n\n${saveEventsSrc}\n\n${saveRemindersSrc}\n\n${remindersFase1Src}\n\n${remindersFase2Src}\n\n${remindersFase3Src}\n\n${crudSrc}\n`;
    const tmpPath = path.join(os.tmpdir(), `organizator-reminders-ui-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('Q. node --check del código extraído (Fase 3: integración UI de recordatorios) pasa', true);
    } catch (e) {
      check('Q. node --check del código extraído (Fase 3: integración UI de recordatorios) pasa', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
