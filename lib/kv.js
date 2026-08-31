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

// En producción es obligatorio tener REDIS_URL configurado (igual que
// SESSION_SECRET en lib/auth.js). Sin esta comprobación, si alguien olvidara
// conectar la integración de Redis en el proyecto, la app arrancaría "como
// si nada" usando el fichero JSON local como almacén — que en un entorno
// serverless real (Vercel) no es persistente entre invocaciones e incluso
// puede no ser escribible, así que el fallo sería silencioso y con pérdida
// de datos. Mejor no arrancar que arrancar perdiendo datos de los usuarios.
if (!USE_REDIS && process.env.NODE_ENV === 'production') {
  throw new Error(
    'Falta configurar la variable de entorno REDIS_URL en producción. ' +
      'Conecta la base de datos Redis del proyecto (o defínela manualmente) ' +
      'antes de desplegar: sin ella los datos no persistirían de forma fiable.'
  );
}

let kv;

if (USE_REDIS) {
  const { createClient } = require('redis');

  const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      // Sin esto, si Redis no está disponible el cliente reintenta conectar
      // indefinidamente y una petición HTTP se quedaría colgada para siempre
      // (el usuario nunca vería ni un error). Con esto, tras ~3 intentos en
      // unos segundos, connect() rechaza con un error real que sube hasta el
      // try/catch de cada endpoint (api/data.js, api/auth/*.js) y se convierte
      // en una respuesta 500 normal.
      connectTimeout: 5000,
      reconnectStrategy: (retries) =>
        retries > 3 ? new Error('No se pudo conectar con el almacenamiento (Redis).') : Math.min(retries * 200, 1000),
    },
  });
  // Silenciado a propósito: los errores de conexión ya se propagan como
  // rechazo de la promesa de connect()/comandos, que cada endpoint captura
  // en su try/catch. Sin este listener, el cliente "redis" lanzaría un
  // error no controlado (unhandled 'error' event) y tumbaría el proceso.
  client.on('error', () => {});

  // Se conecta una sola vez y se reutiliza la misma conexión entre invocaciones
  // (dentro de lo posible en un entorno serverless). Si un intento de conexión
  // falla, se olvida la promesa fallida para que la siguiente petición pueda
  // volver a intentarlo (por si Redis solo estuvo caído un momento), en vez
  // de quedar permanentemente rota hasta reiniciar el proceso.
  let connectPromise = null;
  function ensureConnected() {
    if (!connectPromise) {
      connectPromise = client.connect().catch((err) => {
        connectPromise = null;
        throw err;
      });
    }
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
  console.warn(
    '[aviso] REDIS_URL no está configurado: usando el almacenamiento JSON local ' +
      '(.local-kv.json). Válido solo para desarrollo, nunca para producción.'
  );

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
