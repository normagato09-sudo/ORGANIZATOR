/**
 * ORGANIZATOR — Verificación de firma de QStash (R-8.2-A)
 *
 * api/push/send-due.js recibe una llamada HTTP normal, sin cookie de
 * sesión (no la hace un usuario logueado, la hace QStash) — la única forma
 * de comprobar que de verdad viene de QStash y no de cualquiera que
 * adivine la URL es verificar el header `Upstash-Signature` (un JWT
 * firmado con las claves de firma del proyecto QStash).
 *
 * Se usa el SDK oficial `@upstash/qstash` (clase Receiver) en vez de
 * reimplementar a mano la verificación JWT + hash del cuerpo + URL de
 * destino: es la única parte de la integración donde un fallo sutil de
 * implementación propia sería un riesgo de seguridad real (aceptar una
 * llamada falsificada como si viniera de QStash), así que aquí sí se
 * justifica añadir la dependencia del SDK en vez de usar fetch a pelo
 * (a diferencia de lib/qstash.js, donde publicar/cancelar es HTTP simple).
 */

const { Receiver } = require('@upstash/qstash');

let receiver = null;

function getReceiver() {
  if (receiver) return receiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error('Faltan QSTASH_CURRENT_SIGNING_KEY/QSTASH_NEXT_SIGNING_KEY en las variables de entorno de Vercel');
  }
  receiver = new Receiver({ currentSigningKey, nextSigningKey });
  return receiver;
}

/** Verifica que `rawBody` (el cuerpo EXACTO, sin volver a serializar —
 * ver nota de la documentación oficial: JSON.stringify(JSON.parse(body))
 * puede no coincidir byte a byte con el original y romper la firma) y
 * `signature` (el header Upstash-Signature) corresponden de verdad a un
 * mensaje enviado por QStash hacia `url`. Devuelve `true`/`false`, nunca
 * lanza (un fallo de verificación es un resultado normal a rechazar con
 * 401, no una excepción). */
async function verifyQStashSignature({ signature, rawBody, url }) {
  if (!signature || typeof signature !== 'string') return false;
  try {
    const r = getReceiver();
    return await r.verify({ signature, body: rawBody, url });
  } catch (err) {
    return false;
  }
}

module.exports = { verifyQStashSignature };
