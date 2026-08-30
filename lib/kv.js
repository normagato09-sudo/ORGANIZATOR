// lib/kv.js
//
// Capa de almacenamiento (KV).
// - En producción (desplegado en Vercel con la integración de Redis activada,
//   la que inyecta la variable REDIS_URL) usa el cliente oficial "redis" para
//   conectarse de verdad a la base de datos.
// - En local, si REDIS_URL no está definida, usa un fichero JSON
//   (.local-kv.json) como almacén, para poder probar TODO el flujo
//   (registro, login, tareas...) sin depender de ningún servicio externo.
//
// El resto del backend solo usa kv.get(key) / kv.set(key, value) / kv.del(key)
// y nunca necesita saber cuál de los dos está usando por debajo.
//
// Nota: los valores se guardan siempre como JSON (string) dentro de Redis,
// y se parsean/serializan aquí mismo, para que el resto del código pueda
// seguir pasando y recibiendo objetos JS normales, igual que antes.

const fs = require('fs');
const path = require('path');

const USE_REDIS = !!process.env.REDIS_URL;

let kv;

if (USE_REDIS) {
  const { createClient } = require('redis');

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => console.error('Redis client error', err));

  // Se conecta una sola vez y se reutiliza la misma conexión entre invocaciones
  // (dentro de lo posible en un entorno serverless).
  let connectPromise = null;
  function ensureConnected() {
    if (!connectPromise) connectPromise = client.connect();
    return connectPromise;
  }

  kv = {
    async get(key) {
      await ensureConnected();
      const raw = await client.get(key);
      if (raw === null || raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return raw; // por si hay algo guardado como texto plano
      }
    },
    async set(key, value) {
      await ensureConnected();
      await client.set(key, JSON.stringify(value));
    },
    async del(key) {
      await ensureConnected();
      await client.del(key);
    },
  };
} else {
  const DB_FILE = path.join(__dirname, '..', '.local-kv.json');

  function readDb() {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  function writeDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }

  kv = {
    async get(key) {
      const db = readDb();
      return Object.prototype.hasOwnProperty.call(db, key) ? db[key] : null;
    },
    async set(key, value) {
      const db = readDb();
      db[key] = value;
      writeDb(db);
    },
    async del(key) {
      const db = readDb();
      delete db[key];
      writeDb(db);
    },
  };
}

module.exports = { kv, USE_REDIS };
