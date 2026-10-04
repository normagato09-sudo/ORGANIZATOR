/**
 * ORGANIZATOR — Tests de R-8.2-A (infraestructura de Web Push vía QStash)
 *
 * Suite Node pura, SIN navegador ni jsdom, SIN red real ni base de datos
 * real: cada dependencia externa (Postgres/Neon, QStash, el envío VAPID
 * real) se sustituye por un mock/fake en memoria, cargado por encima de
 * `require.cache` ANTES de invocar cada endpoint — los endpoints de
 * api/push/*.js y los helpers de lib/*.js se `require()`an TAL CUAL están
 * en disco (nunca se copia su lógica aquí), así que esta suite prueba el
 * código real, no una reimplementación.
 *
 * IMPORTANTE (alcance de R-8.2-A, ver el propio encargo): esta suite NO
 * comprueba integración con createReminderForTarget()/
 * syncReminderForTarget()/cancelReminder()/loadState() ni con la UI de
 * organizator.html — eso es R-8.2-B, deliberadamente fuera de esta fase.
 * Tampoco prueba una entrega Web Push real de extremo a extremo (eso
 * exige un despliegue real, ver el informe de R-8.1 sobre qué se puede
 * probar localmente).
 *
 * Uso:  node js/test-push-infrastructure.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// ---------------------------------------------------------------------
// Entorno mínimo de variables de entorno necesarias para que los módulos
// se carguen sin lanzar (nunca secretos reales — solo valores de prueba,
// válidos solo dentro de este proceso Node efímero).
// ---------------------------------------------------------------------
process.env.JWT_SECRET = 'test-jwt-secret-not-real';
process.env.PUBLIC_APP_URL = 'https://organizator.example.com';
process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
process.env.QSTASH_TOKEN = 'test-qstash-token';
process.env.QSTASH_CURRENT_SIGNING_KEY = 'sig_current_test_key_0123456789';
process.env.QSTASH_NEXT_SIGNING_KEY = 'sig_next_test_key_0123456789';

// ---------------------------------------------------------------------
// Fake de Postgres en memoria para push_subscriptions/push_reminders,
// suficiente para las consultas EXACTAS que emiten api/push/*.js (no un
// motor SQL genérico). Reconoce cada consulta por un fragmento literal
// distintivo de su plantilla — si alguna consulta cambia de forma que deje
// de encajar aquí, el test que la ejercite fallará con un error claro en
// vez de dar un falso positivo silencioso.
// ---------------------------------------------------------------------
function makeFakeDb() {
  let subSeq = 0, remSeq = 0;
  const subscriptions = []; // { id, user_id, endpoint, p256dh, auth, last_seen_at }
  const reminders = [];     // { id, user_id, reminder_id, remind_at, status, title, body, qstash_message_id }

  async function sql(strings, ...values) {
    const text = strings.join('¶');

    if (text.includes('INSERT INTO push_subscriptions')) {
      const [userId, endpoint, p256dh, auth] = values;
      const existing = subscriptions.find(s => s.endpoint === endpoint);
      if (existing) {
        Object.assign(existing, { user_id: userId, p256dh, auth, last_seen_at: new Date() });
      } else {
        subscriptions.push({ id: ++subSeq, user_id: userId, endpoint, p256dh, auth, last_seen_at: new Date() });
      }
      return [];
    }

    if (text.includes('DELETE FROM push_subscriptions WHERE endpoint')) {
      const [endpoint, userId] = values;
      const idx = subscriptions.findIndex(s => s.endpoint === endpoint && s.user_id === userId);
      if (idx !== -1) subscriptions.splice(idx, 1);
      return [];
    }

    if (text.includes('DELETE FROM push_subscriptions WHERE id')) {
      const [id] = values;
      const idx = subscriptions.findIndex(s => s.id === id);
      if (idx !== -1) subscriptions.splice(idx, 1);
      return [];
    }

    if (text.includes('SELECT id, endpoint, p256dh, auth FROM push_subscriptions')) {
      const [userId] = values;
      return subscriptions.filter(s => s.user_id === userId).map(s => ({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }));
    }

    if (text.includes('SELECT qstash_message_id, status FROM push_reminders')) {
      const [userId, reminderId] = values;
      const row = reminders.find(r => r.user_id === userId && r.reminder_id === reminderId);
      return row ? [{ qstash_message_id: row.qstash_message_id, status: row.status }] : [];
    }

    if (text.includes('SELECT id, status, qstash_message_id FROM push_reminders')) {
      const [userId, reminderId] = values;
      const row = reminders.find(r => r.user_id === userId && r.reminder_id === reminderId);
      return row ? [{ id: row.id, status: row.status, qstash_message_id: row.qstash_message_id }] : [];
    }

    if (text.includes('INSERT INTO push_reminders')) {
      const [userId, reminderId, remindAt, title, body] = values;
      let row = reminders.find(r => r.user_id === userId && r.reminder_id === reminderId);
      if (row) {
        Object.assign(row, { remind_at: new Date(remindAt), status: 'pending', title, body, qstash_message_id: null });
      } else {
        row = { id: ++remSeq, user_id: userId, reminder_id: reminderId, remind_at: new Date(remindAt), status: 'pending', title, body, qstash_message_id: null };
        reminders.push(row);
      }
      return [{ id: row.id }];
    }

    if (text.includes('SET qstash_message_id')) {
      const [messageId, id] = values;
      const row = reminders.find(r => r.id === id);
      if (row) row.qstash_message_id = messageId;
      return [];
    }

    // send-due.js con los recordatorios apagados: cancela por id si sigue pending.
    if (text.includes("SET status = 'cancelled'") && text.includes("AND status = 'pending'") && values.length === 1) {
      const [id] = values;
      const row = reminders.find(r => r.id === id && r.status === 'pending');
      if (row) row.status = 'cancelled';
      return [];
    }

    if (text.includes("SET status = 'cancelled'")) {
      const [id, userId] = values;
      const row = reminders.find(r => r.id === id && r.user_id === userId);
      if (row) row.status = 'cancelled';
      return [];
    }

    if (text.includes("SET status = 'triggered'")) {
      const [pushReminderId] = values;
      const row = reminders.find(r => r.id === pushReminderId && r.status === 'pending');
      if (!row) return [];
      row.status = 'triggered';
      // R-8.2-C: reminder_id se añadió al RETURNING real (ver send-due.js)
      // para que el payload enviado al navegador pueda incluir reminderId.
      return [{ id: row.id, user_id: row.user_id, reminder_id: row.reminder_id, title: row.title, body: row.body }];
    }

    throw new Error(`Fake DB: consulta no reconocida en test-push-infrastructure.js: ${text}`);
  }

  return { sql, _subscriptions: subscriptions, _reminders: reminders };
}

// ---------------------------------------------------------------------
// Helpers de test: sesión real (cookie+JWT reales, ver lib/session.js) y
// mocks manuales de lib/db.js, lib/vapid.js, lib/qstash.js,
// lib/qstash-receiver.js — reasignando propiedades del módulo YA CARGADO
// (nunca se destructura en los propios endpoints, ver comentario de
// lib/auth.js), sin ninguna librería de mocking nueva.
// ---------------------------------------------------------------------
const session = require(path.join(ROOT, 'lib', 'session.js'));

function makeSessionCookieHeader(userId) {
  const token = session.signSession({ sub: userId, email: `user${userId}@example.com` }, process.env.JWT_SECRET);
  return `${session.SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function makeReq({ method, cookie, body, headers } = {}) {
  return {
    method: method || 'GET',
    headers: Object.assign({}, cookie ? { cookie } : {}, headers || {}),
    body,
    on() { /* solo usado por send-due.js para leer el stream crudo; se sustituye aparte en su sección */ },
  };
}

function makeRes() {
  const res = {
    _status: null, _json: null, _headers: {},
    status(code) { res._status = code; return res; },
    json(obj) { res._json = obj; return res; },
    setHeader(k, v) { res._headers[k] = v; },
  };
  return res;
}

function freshRequireModules() {
  // Cada test recarga los módulos desde cero (borrando require.cache de
  // TODO lo bajo lib/ y api/push/) para que las reasignaciones de mocks de
  // un test no se cuelen en el siguiente.
  Object.keys(require.cache).forEach((p) => {
    if (p.includes(`${path.sep}lib${path.sep}`) || p.includes(`${path.sep}api${path.sep}push${path.sep}`)) {
      delete require.cache[p];
    }
  });
  const db = require(path.join(ROOT, 'lib', 'db.js'));
  const vapid = require(path.join(ROOT, 'lib', 'vapid.js'));
  const qstash = require(path.join(ROOT, 'lib', 'qstash.js'));
  const qstashReceiver = require(path.join(ROOT, 'lib', 'qstash-receiver.js'));
  return { db, vapid, qstash, qstashReceiver };
}

function signQStashLikeJWT({ rawBody, url, signingKey }) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('base64url').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: 'Upstash', sub: url, body: bodyHash, iat: now, nbf: now, exp: now + 300, jti: 'test-jti' },
    signingKey,
    { algorithm: 'HS256' }
  );
}

(async () => {
  // =====================================================================
  section('A) lib/auth.js — autenticación real por cookie+JWT (sin mocks)');
  // =====================================================================
  {
    const auth = require(path.join(ROOT, 'lib', 'auth.js'));
    const cookie = makeSessionCookieHeader(42);
    check('A1. cookie de sesión válida -> devuelve el user_id (payload.sub)', auth.getAuthenticatedUserId({ headers: { cookie } }, process.env.JWT_SECRET) === 42);
    check('A2. sin cookie en absoluto -> null', auth.getAuthenticatedUserId({ headers: {} }, process.env.JWT_SECRET) === null);
    check('A3. cookie con token corrupto -> null (nunca lanza)', auth.getAuthenticatedUserId({ headers: { cookie: `${session.SESSION_COOKIE}=basura-no-es-un-jwt` } }, process.env.JWT_SECRET) === null);
    const expired = jwt.sign({ sub: 7 }, process.env.JWT_SECRET, { expiresIn: '-10s' });
    check('A4. token JWT caducado -> null', auth.getAuthenticatedUserId({ headers: { cookie: `${session.SESSION_COOKIE}=${expired}` } }, process.env.JWT_SECRET) === null);
    const wrongSecret = jwt.sign({ sub: 7 }, 'otro-secreto-distinto');
    check('A5. token firmado con OTRO secreto -> null', auth.getAuthenticatedUserId({ headers: { cookie: `${session.SESSION_COOKIE}=${wrongSecret}` } }, process.env.JWT_SECRET) === null);
    check('A6. sin JWT_SECRET configurado -> null (nunca lanza)', auth.getAuthenticatedUserId({ headers: { cookie } }, undefined) === null);
  }

  // =====================================================================
  section('B) GET /api/push/vapid-public-key');
  // =====================================================================
  {
    const { vapid } = freshRequireModules();
    const handler = require(path.join(ROOT, 'api', 'push', 'vapid-public-key.js'));
    const res1 = makeRes();
    await handler(makeReq({ method: 'POST' }), res1);
    check('B1. método distinto de GET -> 405', res1._status === 405);

    const res2 = makeRes();
    await handler(makeReq({ method: 'GET' }), res2);
    check('B2. con VAPID_PUBLIC_KEY configurada -> 200 con la clave', res2._status === 200 && res2._json.publicKey === 'test-vapid-public-key');

    delete process.env.VAPID_PUBLIC_KEY;
    const res3 = makeRes();
    await handler(makeReq({ method: 'GET' }), res3);
    check('B3. sin VAPID_PUBLIC_KEY configurada -> 500 (nunca expone undefined como si fuera una clave)', res3._status === 500);
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
  }

  // =====================================================================
  section('C) POST /api/push/subscribe — payload, autorización, idempotencia');
  // =====================================================================
  {
    const { db } = freshRequireModules();
    const fakeDb = makeFakeDb();
    db.getSql = () => fakeDb.sql;
    const handler = require(path.join(ROOT, 'api', 'push', 'subscribe.js'));

    const resNoAuth = makeRes();
    await handler(makeReq({ method: 'POST', body: {} }), resNoAuth);
    check('C1. sin sesión -> 401', resNoAuth._status === 401);

    const cookieA = makeSessionCookieHeader(1);
    const resBadPayload = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: { endpoint: 'https://push.example/ep1' } }), resBadPayload);
    check('C2. payload sin keys.p256dh/auth -> 400', resBadPayload._status === 400);

    const validSub = { endpoint: 'https://push.example/ep1', keys: { p256dh: 'p1', auth: 'a1' } };
    const resOk = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: validSub }), resOk);
    check('C3. suscripción válida y autenticada -> 200', resOk._status === 200 && resOk._json.ok === true);
    check('C4. la fila se guarda asociada al usuario de la sesión (nunca a uno indicado por el body)', fakeDb._subscriptions.length === 1 && fakeDb._subscriptions[0].user_id === 1);

    // Idempotencia: volver a suscribirse con el MISMO endpoint no duplica fila.
    const resAgain = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: validSub }), resAgain);
    check('C5. re-suscribirse con el mismo endpoint es idempotente (sigue habiendo 1 fila)', fakeDb._subscriptions.length === 1);

    // Otro usuario reclama el MISMO endpoint (p.ej. mismo navegador, sesión distinta): se reasocia.
    const cookieB = makeSessionCookieHeader(2);
    const resReassign = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieB, body: validSub }), resReassign);
    check('C6. el mismo endpoint puede reasociarse a otro usuario (sigue 1 fila, ahora del usuario 2)', fakeDb._subscriptions.length === 1 && fakeDb._subscriptions[0].user_id === 2);
  }

  // =====================================================================
  section('D) POST /api/push/unsubscribe — ownership');
  // =====================================================================
  {
    const { db } = freshRequireModules();
    const fakeDb = makeFakeDb();
    fakeDb._subscriptions.push({ id: 1, user_id: 1, endpoint: 'https://push.example/ownerA', p256dh: 'p', auth: 'a', last_seen_at: new Date() });
    db.getSql = () => fakeDb.sql;
    const handler = require(path.join(ROOT, 'api', 'push', 'unsubscribe.js'));

    const cookieB = makeSessionCookieHeader(2);
    const resOtherUser = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieB, body: { endpoint: 'https://push.example/ownerA' } }), resOtherUser);
    check('D1. un usuario NO puede borrar la suscripción de otro (responde 200 igualmente, pero no borra nada)', resOtherUser._status === 200 && fakeDb._subscriptions.length === 1);

    const cookieA = makeSessionCookieHeader(1);
    const resOwner = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: { endpoint: 'https://push.example/ownerA' } }), resOwner);
    check('D2. el propio dueño SÍ puede borrar su suscripción', resOwner._status === 200 && fakeDb._subscriptions.length === 0);

    const resMissing = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: {} }), resMissing);
    check('D3. falta "endpoint" -> 400', resMissing._status === 400);
  }

  // =====================================================================
  section('E) POST /api/push/schedule-reminder — payload, ownership, reprogramación');
  // =====================================================================
  {
    const { db, qstash } = freshRequireModules();
    const fakeDb = makeFakeDb();
    db.getSql = () => fakeDb.sql;
    const scheduleCalls = [];
    const cancelCalls = [];
    qstash.scheduleMessage = async (args) => { scheduleCalls.push(args); return `msg-${scheduleCalls.length}`; };
    qstash.cancelMessage = async (id) => { cancelCalls.push(id); return { cancelled: true }; };
    const handler = require(path.join(ROOT, 'api', 'push', 'schedule-reminder.js'));

    const cookieA = makeSessionCookieHeader(1);
    const validBody = { reminderId: 'ia-1', remindAt: '2026-09-20T20:00:00.000Z', title: 'ORGANIZATOR', body: 'Tarea: Entregar informe' };

    const resNoAuth = makeRes();
    await handler(makeReq({ method: 'POST', body: validBody }), resNoAuth);
    check('E1. sin sesión -> 401', resNoAuth._status === 401);

    const resBadPayload = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: { reminderId: 'ia-1' } }), resBadPayload);
    check('E2. payload incompleto -> 400', resBadPayload._status === 400);

    const resBadDate = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: Object.assign({}, validBody, { remindAt: 'no-es-una-fecha' }) }), resBadDate);
    check('E3. remindAt no es una fecha válida -> 400', resBadDate._status === 400);

    const resOk = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: validBody }), resOk);
    check('E4. programación válida -> 200 con pushReminderId', resOk._status === 200 && typeof resOk._json.pushReminderId === 'number');
    check('E5. la fila queda en la DB con status pending', fakeDb._reminders[0].status === 'pending');
    check('E6. se llamó a qstash.scheduleMessage con la fecha exacta y la URL de destino correcta', scheduleCalls.length === 1 && scheduleCalls[0].notBeforeDate.toISOString() === validBody.remindAt && scheduleCalls[0].destinationUrl === 'https://organizator.example.com/api/push/send-due');
    check('E7. el messageId devuelto por QStash se guarda en la fila', fakeDb._reminders[0].qstash_message_id === 'msg-1');

    // Reprogramación: mismo reminderId, nueva hora -> cancela el mensaje anterior.
    const resReschedule = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: Object.assign({}, validBody, { remindAt: '2026-09-20T21:00:00.000Z' }) }), resReschedule);
    check('E8. reprogramar cancela el mensaje QStash anterior', cancelCalls.length === 1 && cancelCalls[0] === 'msg-1');
    check('E9. sigue habiendo una única fila para ese reminder (no se duplica)', fakeDb._reminders.length === 1);
    check('E10. la fila refleja la nueva fecha y el nuevo messageId', fakeDb._reminders[0].qstash_message_id === 'msg-2');

    // Ownership: otro usuario con el MISMO reminderId (posible en local, ids solo únicos por navegador) obtiene su PROPIA fila.
    const cookieB = makeSessionCookieHeader(2);
    const resOtherUser = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieB, body: validBody }), resOtherUser);
    check('E11. otro usuario con el mismo reminderId crea una fila INDEPENDIENTE (ownership por user_id+reminder_id)', fakeDb._reminders.length === 2 && fakeDb._reminders[1].user_id === 2);
  }

  // =====================================================================
  section('F) POST /api/push/cancel-reminder — idempotencia y ownership');
  // =====================================================================
  {
    const { db, qstash } = freshRequireModules();
    const fakeDb = makeFakeDb();
    fakeDb._reminders.push({ id: 1, user_id: 1, reminder_id: 'ia-1', remind_at: new Date(), status: 'pending', title: 'T', body: 'B', qstash_message_id: 'msg-1' });
    db.getSql = () => fakeDb.sql;
    const cancelCalls = [];
    qstash.cancelMessage = async (id) => { cancelCalls.push(id); return { cancelled: true }; };
    const handler = require(path.join(ROOT, 'api', 'push', 'cancel-reminder.js'));

    const cookieB = makeSessionCookieHeader(2);
    const resOtherUser = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieB, body: { reminderId: 'ia-1' } }), resOtherUser);
    check('F1. otro usuario no puede cancelar el reminder ajeno (200 pero sin efecto)', resOtherUser._status === 200 && fakeDb._reminders[0].status === 'pending' && cancelCalls.length === 0);

    const cookieA = makeSessionCookieHeader(1);
    const resMissing = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: {} }), resMissing);
    check('F2. falta reminderId -> 400', resMissing._status === 400);

    const resNonExistent = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: { reminderId: 'no-existe' } }), resNonExistent);
    check('F3. cancelar un reminder inexistente -> 200 (idempotente, no es un error)', resNonExistent._status === 200);

    const resOk = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: { reminderId: 'ia-1' } }), resOk);
    check('F4. cancelar el propio reminder pending -> 200', resOk._status === 200);
    check('F5. la fila pasa a "cancelled"', fakeDb._reminders[0].status === 'cancelled');
    check('F6. se canceló también el mensaje QStash correspondiente', cancelCalls.length === 1 && cancelCalls[0] === 'msg-1');

    // Idempotencia: cancelar dos veces no vuelve a llamar a QStash.
    const resTwice = makeRes();
    await handler(makeReq({ method: 'POST', cookie: cookieA, body: { reminderId: 'ia-1' } }), resTwice);
    check('F7. cancelar dos veces es idempotente (no se vuelve a llamar a QStash)', resTwice._status === 200 && cancelCalls.length === 1);
  }

  // =====================================================================
  section('G) lib/qstash-receiver.js — verificación de firma/autenticidad de QStash');
  // =====================================================================
  {
    const { qstashReceiver } = freshRequireModules();
    const url = 'https://organizator.example.com/api/push/send-due';
    const rawBody = JSON.stringify({ pushReminderId: 1 });

    check('G1. sin header de firma -> false', await qstashReceiver.verifyQStashSignature({ signature: undefined, rawBody, url }) === false);
    check('G2. firma con basura (no es un JWT) -> false', await qstashReceiver.verifyQStashSignature({ signature: 'esto-no-es-un-jwt', rawBody, url }) === false);

    const validSig = signQStashLikeJWT({ rawBody, url, signingKey: process.env.QSTASH_CURRENT_SIGNING_KEY });
    check('G3. firma válida (firmada con la current signing key, cuerpo y URL correctos) -> true', await qstashReceiver.verifyQStashSignature({ signature: validSig, rawBody, url }) === true);

    const validSigNext = signQStashLikeJWT({ rawBody, url, signingKey: process.env.QSTASH_NEXT_SIGNING_KEY });
    check('G4. firma válida con la NEXT signing key (rotación de claves) -> true', await qstashReceiver.verifyQStashSignature({ signature: validSigNext, rawBody, url }) === true);

    const wrongKeySig = signQStashLikeJWT({ rawBody, url, signingKey: 'una-clave-que-no-es-ninguna-de-las-dos' });
    check('G5. firma firmada con una clave que NO es ninguna de las dos configuradas -> false', await qstashReceiver.verifyQStashSignature({ signature: wrongKeySig, rawBody, url }) === false);

    const tamperedBodySig = signQStashLikeJWT({ rawBody, url, signingKey: process.env.QSTASH_CURRENT_SIGNING_KEY });
    const tamperedBody = JSON.stringify({ pushReminderId: 999 }); // cuerpo distinto al firmado
    check('G6. firma válida pero CUERPO manipulado tras firmar -> false', await qstashReceiver.verifyQStashSignature({ signature: tamperedBodySig, rawBody: tamperedBody, url }) === false);

    const wrongUrlSig = signQStashLikeJWT({ rawBody, url: 'https://un-atacante.example.com/robar', signingKey: process.env.QSTASH_CURRENT_SIGNING_KEY });
    check('G7. firma válida para OTRA url (replay hacia un destino distinto) -> false', await qstashReceiver.verifyQStashSignature({ signature: wrongUrlSig, rawBody, url }) === false);
  }

  // =====================================================================
  section('H) lib/qstash.js — publicación/cancelación (fetch real mockeado)');
  // =====================================================================
  {
    const { qstash } = freshRequireModules();
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes('/publish/') && url.includes('/error')) {
        return { ok: false, status: 500, text: async () => 'boom' };
      }
      if (url.includes('/publish/')) {
        return { ok: true, json: async () => ({ messageId: 'msg-abc', deduplicated: false }) };
      }
      if (opts.method === 'DELETE' && url.includes('/messages/existing')) {
        return { ok: true, text: async () => '' };
      }
      if (opts.method === 'DELETE' && url.includes('/messages/gone')) {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      return { ok: false, status: 500, text: async () => 'boom' };
    };

    const messageId = await qstash.scheduleMessage({ destinationUrl: 'https://app.example.com/cb', body: { a: 1 }, notBeforeDate: new Date('2026-01-01T00:00:00Z') });
    check('H1. scheduleMessage devuelve el messageId de la respuesta', messageId === 'msg-abc');
    const publishCall = calls.find(c => c.url.includes('/publish/'));
    check('H2. la URL de publish incluye la destinationUrl tal cual', publishCall.url === 'https://qstash.upstash.io/v2/publish/https://app.example.com/cb');
    check('H3. incluye el header Upstash-Not-Before con el timestamp Unix correcto', publishCall.opts.headers['Upstash-Not-Before'] === String(Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000)));
    check('H4. incluye Authorization Bearer con QSTASH_TOKEN', publishCall.opts.headers['Authorization'] === 'Bearer test-qstash-token');

    const cancelled = await qstash.cancelMessage('existing');
    check('H5. cancelMessage sobre un mensaje existente -> { cancelled: true }', cancelled.cancelled === true);
    const cancelledGone = await qstash.cancelMessage('gone');
    check('H6. cancelar un mensaje que ya no existe (404) -> no lanza, { cancelled: false }', cancelledGone.cancelled === false);

    let threw = false;
    try { await qstash.scheduleMessage({ destinationUrl: 'https://app.example.com/error', body: {}, notBeforeDate: new Date() }); }
    catch (e) { threw = true; }
    check('H7. si QStash responde con error real (no 404 de cancelación) -> lanza', threw);

    global.fetch = originalFetch;
  }

  // =====================================================================
  section('I) POST /api/push/send-due — idempotencia, envío, suscripciones inválidas');
  // =====================================================================
  {
    function makeStreamReq({ rawBody, headers }) {
      return {
        method: 'POST',
        headers: headers || {},
        on(event, cb) {
          if (event === 'data') cb(rawBody);
          if (event === 'end') cb();
        },
      };
    }

    const { db, vapid, qstashReceiver } = freshRequireModules();
    const url = 'https://organizator.example.com/api/push/send-due';
    const fakeDb = makeFakeDb();
    fakeDb._reminders.push({ id: 1, user_id: 1, reminder_id: 'ia-1', remind_at: new Date(), status: 'pending', title: 'ORGANIZATOR', body: 'Tarea: Entregar informe', qstash_message_id: 'msg-1' });
    fakeDb._subscriptions.push({ id: 1, user_id: 1, endpoint: 'https://push.example/ok', p256dh: 'p1', auth: 'a1', last_seen_at: new Date() });
    fakeDb._subscriptions.push({ id: 2, user_id: 1, endpoint: 'https://push.example/expired', p256dh: 'p2', auth: 'a2', last_seen_at: new Date() });
    db.getSql = () => fakeDb.sql;
    qstashReceiver.verifyQStashSignature = async () => true; // firma ya cubierta a fondo en la sección G
    const sendCalls = [];
    vapid.sendPush = async (sub, payload) => {
      sendCalls.push({ sub, payload });
      if (sub.endpoint === 'https://push.example/expired') {
        const err = new Error('Gone'); err.statusCode = 410; throw err;
      }
      return {};
    };
    const handler = require(path.join(ROOT, 'api', 'push', 'send-due.js'));

    const validBody = JSON.stringify({ pushReminderId: 1 });

    const resNoSig = makeRes();
    qstashReceiver.verifyQStashSignature = async () => false;
    await handler(makeStreamReq({ rawBody: validBody, headers: { 'upstash-signature': 'bad' } }), resNoSig);
    check('I1. firma inválida -> 401, y NO se toca la base de datos', resNoSig._status === 401 && fakeDb._reminders[0].status === 'pending');
    qstashReceiver.verifyQStashSignature = async () => true;

    const resBadJson = makeRes();
    await handler(makeStreamReq({ rawBody: 'no es json', headers: { 'upstash-signature': 'ok' } }), resBadJson);
    check('I2. cuerpo no es JSON válido -> 400', resBadJson._status === 400);

    const resMissingId = makeRes();
    await handler(makeStreamReq({ rawBody: JSON.stringify({}), headers: { 'upstash-signature': 'ok' } }), resMissingId);
    check('I3. falta pushReminderId -> 400', resMissingId._status === 400);

    const resOk = makeRes();
    await handler(makeStreamReq({ rawBody: validBody, headers: { 'upstash-signature': 'ok' } }), resOk);
    // App de exámenes: los recordatorios están apagados (PUSH_REMINDERS_ENABLED
    // = false en send-due.js): un reminder que llega a su hora no se envía.
    check('I4. recordatorios apagados: reminder pending -> 200 status "disabled"', resOk._status === 200 && resOk._json.status === 'disabled');
    check('I5. la fila queda "cancelled"', fakeDb._reminders[0].status === 'cancelled');
    check('I6. no se envía nada a ninguna suscripción', sendCalls.length === 0);

    // El resto de la sección comprueba el envío con el interruptor encendido
    // (por si algún día se vuelven a activar los avisos). Solo para el test.
    handler.setPushRemindersEnabledForTests(true);
    fakeDb._reminders[0].status = 'pending';
    await handler(makeStreamReq({ rawBody: validBody, headers: { 'upstash-signature': 'ok' } }), makeRes());
    check('I7. el payload enviado por VAPID tiene la forma correcta (title/body/url/tag)', sendCalls[0].payload.title === 'ORGANIZATOR' && sendCalls[0].payload.body === 'Tarea: Entregar informe' && typeof sendCalls[0].payload.url === 'string' && sendCalls[0].payload.tag === 'push-reminder-1');
    // R-8.2-C: el payload también lleva el reminderId de ORGANIZATOR (no
    // el id interno de push_reminders) — lo necesita sw.js para avisar a
    // la página de qué reminder recibió el push (ver organizator.html,
    // bloque RECORDATORIOS — reconciliación local↔Web Push).
    check('I7b. el payload incluye reminderId (el de ORGANIZATOR, "ia-1", no el id interno de push_reminders)', sendCalls[0].payload.reminderId === 'ia-1');
    check('I8. la suscripción caducada (410) se elimina automáticamente', fakeDb._subscriptions.length === 1 && fakeDb._subscriptions[0].endpoint === 'https://push.example/ok');

    // Idempotencia real (punto 9 del encargo): reintento de QStash tras un
    // envío ya realizado NUNCA vuelve a enviar.
    sendCalls.length = 0;
    const resRetry = makeRes();
    await handler(makeStreamReq({ rawBody: validBody, headers: { 'upstash-signature': 'ok' } }), resRetry);
    check('I9. reintento tras ya haberse enviado -> 200 "already_handled", CERO envíos nuevos', resRetry._status === 200 && resRetry._json.status === 'already_handled' && sendCalls.length === 0);

    // Reminder cancelado antes de que tocara enviarlo -> nunca se envía.
    fakeDb._reminders.push({ id: 2, user_id: 1, reminder_id: 'ia-2', remind_at: new Date(), status: 'cancelled', title: 'X', body: 'Y', qstash_message_id: 'msg-2' });
    const resCancelled = makeRes();
    await handler(makeStreamReq({ rawBody: JSON.stringify({ pushReminderId: 2 }), headers: { 'upstash-signature': 'ok' } }), resCancelled);
    check('I10. reminder cancelled -> 200 "already_handled", sin enviar nada', resCancelled._status === 200 && resCancelled._json.status === 'already_handled' && sendCalls.length === 0);

    // Reminder pending pero SIN suscripciones -> no falla, no envía nada.
    fakeDb._reminders.push({ id: 3, user_id: 99, reminder_id: 'ia-3', remind_at: new Date(), status: 'pending', title: 'X', body: 'Y', qstash_message_id: 'msg-3' });
    const resNoSubs = makeRes();
    await handler(makeStreamReq({ rawBody: JSON.stringify({ pushReminderId: 3 }), headers: { 'upstash-signature': 'ok' } }), resNoSubs);
    check('I11. reminder pending sin ninguna suscripción -> 200 "no_subscriptions", y aun así queda triggered', resNoSubs._status === 200 && resNoSubs._json.status === 'no_subscriptions' && fakeDb._reminders[2].status === 'triggered');
    handler.setPushRemindersEnabledForTests(false);
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
