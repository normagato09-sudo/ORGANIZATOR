/**
 * ORGANIZATOR — Tests de los recordatorios apagados (app de exámenes)
 *
 * Suite Node pura: extrae de organizator.html el bloque "RECORDATORIOS
 * APAGADOS (app de exámenes)" y lo ejecuta en un sandbox con
 * cancelReminderPush, unsubscribePushForThisDevice y localStorage falsos.
 * De startApp() y de api/push/send-due.js solo se comprueba el contenido
 * (el envío del servidor se prueba en test-push-infrastructure.js, I4–I6).
 *
 * Uso:  node js/test-reminders-off.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'organizator.html'), 'utf8').replace(/\r\n/g, '\n');
const sendDueSrc = fs.readFileSync(path.join(ROOT, 'api', 'push', 'send-due.js'), 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}
const HDR = '/* ==================================================================\n   ';
const offSrc = extractBetween(html, `${HDR}RECORDATORIOS APAGADOS (app de exámenes)`, `\n${HDR}RECORDATORIOS — registro de avisos`, 'bloque RECORDATORIOS APAGADOS');
const startAppSrc = extractBetween(html, 'async function startApp(){', '\n}\n', 'startApp()');

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}
function section(title) { console.log('\n' + title); }

function makeSandbox({ reminders = [], failIds = [], store = {}, user = { id: 7 } } = {}) {
  const calls = { cancelled: [], unsubscribed: 0 };
  const sb = {
    console,
    currentUser: user,
    state: { reminders },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    cancelReminderPush: async (id) => { calls.cancelled.push(id); return { ok: !failIds.includes(id) }; },
    unsubscribePushForThisDevice: async () => { calls.unsubscribed++; },
  };
  vm.createContext(sb);
  vm.runInContext(offSrc + '\nObject.assign(this, { disableRemindersOnThisDevice });', sb);
  return { sb, calls, store };
}

(async () => {
  section('A) Interruptores');
  {
    check('A1. en la app ya no hay recordatorios locales (ni polling, ni aviso, ni suscripción Web Push)',
      ['function startReminderPolling(', 'function triggerDueReminders(', 'function showReminderNotification(', 'function subscribeToPushNotifications(', 'function addReminder(']
        .every(s => !html.includes(s)));
    check('A2. startApp hace siempre la limpieza (sin esperarla)',
      /\n  disableRemindersOnThisDevice\(\);\n/.test(startAppSrc) && !startAppSrc.includes('startReminderPolling'));
    check('A3. el servidor está apagado (send-due.js) y entonces cancela sin enviar', /^let PUSH_REMINDERS_ENABLED = false;$/m.test(sendDueSrc)
      && sendDueSrc.includes("if (!PUSH_REMINDERS_ENABLED) {") && sendDueSrc.includes("status: 'disabled'"));
  }

  section('B) Limpieza de una vez por cuenta y dispositivo');
  {
    const reminders = [
      { id: 'r1', status: 'pending' }, { id: 'r2', status: 'triggered' }, { id: 'r3', status: 'pending' }, { id: 'r4', status: 'cancelled' },
    ];
    const { sb, calls, store } = makeSandbox({ reminders });
    const res = await sb.disableRemindersOnThisDevice();
    check('B1. cancela en el servidor solo los pendientes', JSON.stringify(calls.cancelled) === '["r1","r3"]' && res.ok && res.cancelled === 2);
    check('B2. da de baja este dispositivo', calls.unsubscribed === 1);
    check('B3. no toca los recordatorios locales', reminders.map(r => r.status).join() === 'pending,triggered,pending,cancelled');
    check('B4. se apunta por cuenta en este dispositivo', !!store['organizator:remindersOffCleanup:v1:7']);
    const again = await sb.disableRemindersOnThisDevice();
    check('B5. la segunda vez no hace nada', again.skipped === true && calls.cancelled.length === 2 && calls.unsubscribed === 1);
    const other = makeSandbox({ reminders: [{ id: 'x', status: 'pending' }], store, user: { id: 8 } });
    await other.sb.disableRemindersOnThisDevice();
    check('B6. otra cuenta en el mismo dispositivo hace su propia limpieza', JSON.stringify(other.calls.cancelled) === '["x"]');
    const flaky = makeSandbox({ reminders: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }], failIds: ['b'] });
    const r = await flaky.sb.disableRemindersOnThisDevice();
    check('B7. si algo falla (sin red), no se apunta y se reintenta en el siguiente arranque', !r.ok && r.cancelled === 1 && !flaky.store['organizator:remindersOffCleanup:v1:7']);
    const broken = makeSandbox();
    broken.sb.cancelReminderPush = async () => { throw new Error('boom'); };
    broken.sb.state.reminders = [{ id: 'z', status: 'pending' }];
    const rb = await broken.sb.disableRemindersOnThisDevice();
    check('B8. nunca lanza', rb && rb.ok === false);
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
