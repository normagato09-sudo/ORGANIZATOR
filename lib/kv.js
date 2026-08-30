// lib/kv.js
//
// Capa de almacenamiento (KV).
// - En producción (desplegado en Vercel con la integración de Vercel KV activada)
//   usa @vercel/kv de verdad, leyendo KV_REST_API_URL / KV_REST_API_TOKEN.
// - En local, si esas variables no están definidas, usa un fichero JSON
//   (.local-kv.json) como almacén, para poder probar TODO el flujo
//   (registro, login, tareas, chat...) sin depender de ningún servicio externo.
//
// El resto del backend solo usa kv.get(key) / kv.set(key, value) / kv.del(key)
// y nunca necesita saber cuál de los dos está usando por debajo.

const fs = require('fs');
const path = require('path');

const USE_VERCEL_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

let kv;

if (USE_VERCEL_KV) {
  const { kv: vercelKv } = require('@vercel/kv');
  kv = {
    async get(key) {
      return await vercelKv.get(key);
    },
    async set(key, value) {
      await vercelKv.set(key, value);
    },
    async del(key) {
      await vercelKv.del(key);
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

module.exports = { kv, USE_VERCEL_KV };
