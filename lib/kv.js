// lib/kv.js
//
// Capa de almacenamiento (KV).
// - En producción (Vercel, con la base de datos Redis conectada al proyecto)
//   usa el cliente oficial "redis" de verdad, leyendo REDIS_URL (la variable
//   que la integración de Redis de Vercel inyecta en el proyecto).
// - En local, si REDIS_URL no está definida, usa un fichero JSON
//   (.local-kv.json) como almacén, para poder probar TODO el flujo
//   (registro, login, tareas, chat...) sin depender de ningún servicio externo.
//
// El resto del backend solo usa kv.get(key) / kv.set(key, value, ttlSeconds) / kv.del(key)
// y nunca necesita saber cuál de los dos está usando por debajo.
//
// ttlSeconds (opcional en set) hace que la clave caduque sola pasado ese tiempo.
// Se usa sobre todo para contadores de límite de uso (rate limiting) del chat,
// para que no se acumulen para siempre.

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
    async set(key, value, ttlSeconds) {
      await ensureConnected();
      const raw = JSON.stringify(value);
      if (ttlSeconds) {
        await client.set(key, raw, { EX: ttlSeconds });
      } else {
        await client.set(key, raw);
      }
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
      if (!Object.prototype.hasOwnProperty.call(db, key)) return null;
      const entry = db[key];
      // Expiración "perezosa": si la entrada tiene expiresAt y ya pasó, se borra al leerla.
      if (entry && typeof entry === 'object' && entry.__expiresAt) {
        if (Date.now() > entry.__expiresAt) {
          delete db[key];
          writeDb(db);
          return null;
        }
        return entry.__value;
      }
      return entry;
    },
    async set(key, value, ttlSeconds) {
      const db = readDb();
      db[key] = ttlSeconds
        ? { __expiresAt: Date.now() + ttlSeconds * 1000, __value: value }
        : value;
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
