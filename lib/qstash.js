/**
 * ORGANIZATOR — Integración con Upstash QStash (R-8.2-A)
 *
 * QStash es el scheduler externo elegido para R-8 (ver investigación
 * previa): permite programar UNA llamada HTTP puntual para un instante
 * exacto en el futuro (`Upstash-Not-Before`), sin depender de Vercel Cron
 * ni de su límite de "una vez al día" en el plan Hobby.
 *
 * Contrato REST oficial usado aquí (verificado en la documentación vigente
 * de Upstash, sin inventar rutas):
 *   - Publicar:  POST https://qstash.upstash.io/v2/publish/{destinationUrl}
 *                header Upstash-Not-Before: <unix seconds> para programar
 *                una fecha/hora EXACTA (no un delay relativo) — respuesta
 *                { messageId, deduplicated }.
 *   - Cancelar:  DELETE https://qstash.upstash.io/v2/messages/{messageId}
 *                (mensaje aún no entregado).
 * La verificación de firma de las llamadas ENTRANTES (que de verdad vienen
 * de QStash) vive aparte, en lib/qstash-receiver.js, usando el SDK oficial
 * `@upstash/qstash` (Receiver) — aquí solo se hacen peticiones salientes
 * con `fetch` normal, sin necesidad de SDK para publicar/cancelar.
 *
 * Nunca se usa Vercel Cron ni una ejecución periódica: cada reminder
 * programa su PROPIO mensaje puntual.
 */

const QSTASH_BASE_URL = 'https://qstash.upstash.io/v2';

function getToken() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error('Falta la variable de entorno QSTASH_TOKEN en Vercel');
  }
  return token;
}

/** Programa una llamada HTTP puntual a `destinationUrl` para el instante
 * `notBeforeDate` (objeto Date). `body` se envía como JSON. Devuelve el
 * `messageId` que QStash asigna — es lo único que hace falta guardar para
 * poder cancelar/reprogramar más tarde (ver push_reminders.qstash_message_id,
 * sql/003_push_reminders.sql). Lanza si QStash responde con un error (el
 * llamador decide cómo informarlo, mismo patrón que el resto de lib/*.js). */
async function scheduleMessage({ destinationUrl, body, notBeforeDate }) {
  const token = getToken();
  const notBeforeSeconds = Math.floor(notBeforeDate.getTime() / 1000);
  const res = await fetch(`${QSTASH_BASE_URL}/publish/${destinationUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Upstash-Not-Before': String(notBeforeSeconds),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`QStash publish falló (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data.messageId;
}

/** Cancela un mensaje programado que todavía no se ha entregado. Un
 * mensaje que ya se entregó (o que nunca existió) hace que QStash responda
 * con error — se trata como "ya no hay nada que cancelar" en vez de
 * propagar un fallo (mismo espíritu idempotente que cancelReminder() en
 * organizator.html: cancelar dos veces nunca debe romper nada). */
async function cancelMessage(messageId) {
  if (!messageId) return { cancelled: false };
  const token = getToken();
  const res = await fetch(`${QSTASH_BASE_URL}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  // 404: el mensaje ya no existe (ya se entregó, o ya se había cancelado
  // antes) — no es un fallo real para quien nos pidió cancelar.
  if (res.ok || res.status === 404) return { cancelled: res.ok };
  const detail = await res.text().catch(() => '');
  throw new Error(`QStash cancel falló (${res.status}): ${detail}`);
}

module.exports = { scheduleMessage, cancelMessage };
