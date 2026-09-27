/**
 * ORGANIZATOR — Capa de sincronización con la cuenta (SYNC, paso 5)
 *
 * Sustituye a `window.storage` (js/storage-polyfill.js) por una
 * implementación con la MISMA interfaz (get/set/delete/list, mismos
 * valores de retorno), así que ninguna llamada de organizator.html cambia:
 *   - Los datos se guardan en una caché local POR USUARIO (IndexedDB
 *     'organizator-data-u<id>'): otra cuenta en el mismo dispositivo abre
 *     otra base distinta y nunca ve nada de esta.
 *   - Las 7 claves sincronizadas (ver SYNCED_KEYS, igual que la lista
 *     blanca de lib/user-data.js) se suben a /api/data poco después de
 *     cada cambio y se descargan al arrancar, al volver la conexión y al
 *     volver a la pestaña.
 *   - Cualquier otra clave (p. ej. 'reminderNotificationLedger', registro
 *     propio de cada dispositivo) se guarda SOLO en la caché local.
 *
 * Sin conexión todo sigue funcionando sobre la caché: cada clave cambiada
 * queda marcada como pendiente (la marca se guarda en IndexedDB, así que
 * sobrevive a cerrar la app) y se sube en cuanto se pueda.
 *
 * Conflictos: cada clave guarda el `rev` del servidor que conoce y el
 * valor de esa versión (`base`). Si otro dispositivo guardó antes, el
 * servidor rechaza la escritura (ver api/data.js) y aquí se fusiona con
 * SyncMerge.threeWayMerge (js/sync-merge.js) y se vuelve a subir. Nunca se
 * sobrescribe el servidor a ciegas.
 *
 * Se carga igual en el navegador (window.SyncStorage) y en Node
 * (module.exports); todo lo externo (fetch, indexedDB, temporizadores,
 * función de fusión) se puede inyectar para probarlo sin navegador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root, require('./sync-merge.js'));
  else root.SyncStorage = factory(root, root.SyncMerge);
})(typeof self !== 'undefined' ? self : this, function (root, SyncMerge) {
  'use strict';

  const SYNCED_KEYS = ['tasks', 'events', 'customSchedules', 'eventCategories', 'reminders', 'settingsPrefs', 'settingsIA'];
  const DB_PREFIX = 'organizator-data-u';
  const DB_VERSION = 1;
  const KV_STORE = 'kv';
  const META_STORE = 'meta';
  const API_URL = '/api/data';
  const DEFAULT_DEBOUNCE_MS = 1000;
  const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
  // Margen bajo el límite de 4.5 MB por petición de Vercel: si los cambios
  // pendientes ocupan más, se envían en varias peticiones.
  const MAX_BODY_BYTES = 3.5 * 1024 * 1024;
  // Una petición con keepalive (al cerrar la página) no puede pasar de 64 KB.
  const MAX_KEEPALIVE_BYTES = 60 * 1024;
  const RETRY_DELAYS_MS = [5000, 15000, 60000, 300000];
  const MAX_PUSH_ROUNDS = 5;

  function isSyncedKey(key) { return SYNCED_KEYS.indexOf(key) !== -1; }
  function dbNameForUser(userId) { return DB_PREFIX + String(userId); }
  // Misma clave compuesta que storage-polyfill.js ('user:'/'shared:').
  function storageKey(key, shared) { return (shared ? 'shared:' : 'user:') + key; }
  function byteLength(text) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : unescape(encodeURIComponent(text)).length;
  }
  function parseJSON(text) {
    try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false }; }
  }
  function hasSyncedShape(key, value) {
    const isArrayKey = key !== 'settingsPrefs' && key !== 'settingsIA';
    return isArrayKey ? Array.isArray(value) : (!!value && typeof value === 'object' && !Array.isArray(value));
  }
  function emptyMeta() { return { rev: 0, base: null, dirty: false, seq: 0 }; }

  /* ---------------- Almacenamiento local ---------------- */

  /** Caché en IndexedDB: dos almacenes (valores y metadatos) escritos
   * SIEMPRE en la misma transacción, para que un valor nunca quede
   * guardado sin su marca de "pendiente" (o al revés). */
  function createIdbBackend(idb, name) {
    let dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try { req = idb.open(name, DB_VERSION); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
          if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }
    function readStore(db, storeName) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const keysReq = store.getAllKeys();
        const valuesReq = store.getAll();
        tx.oncomplete = () => {
          const map = new Map();
          (keysReq.result || []).forEach((k, i) => map.set(k, valuesReq.result[i]));
          resolve(map);
        };
        tx.onerror = () => reject(tx.error);
      });
    }
    return {
      persistent: true,
      async loadAll() {
        const db = await open();
        return { kv: await readStore(db, KV_STORE), meta: await readStore(db, META_STORE) };
      },
      /** entries: [{ store: 'kv'|'meta', key, value }] (value undefined = borrar). */
      async write(entries) {
        const db = await open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction([KV_STORE, META_STORE], 'readwrite');
          for (const e of entries) {
            const store = tx.objectStore(e.store);
            if (e.value === undefined) store.delete(e.key); else store.put(e.value, e.key);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
        });
      },
      async close() {
        if (!dbPromise) return;
        try { (await dbPromise).close(); } catch (e) { /* ya cerrada o nunca abierta */ }
        dbPromise = null;
      },
      async destroy() {
        await this.close();
        await new Promise((resolve, reject) => {
          const req = idb.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          // 'blocked': otra pestaña la tiene abierta; se borrará cuando la cierre.
          req.onblocked = () => resolve();
        });
      },
    };
  }

  /** Respaldo si IndexedDB no está disponible (algunos modos privados):
   * la app funciona igual contra el servidor, pero sin caché persistente. */
  function createMemoryBackend() {
    const stores = { kv: new Map(), meta: new Map() };
    return {
      persistent: false,
      async loadAll() { return { kv: new Map(stores.kv), meta: new Map(stores.meta) }; },
      async write(entries) {
        for (const e of entries) {
          if (e.value === undefined) stores[e.store].delete(e.key);
          else stores[e.store].set(e.key, JSON.parse(JSON.stringify(e.value)));
        }
      },
      async close() {},
      async destroy() { stores.kv.clear(); stores.meta.clear(); },
    };
  }

  /* ---------------- Motor de sincronización ---------------- */

  /** Crea el almacén de UN usuario. Opciones:
   *  userId (obligatorio), fetch, indexedDB, merge, backend,
   *  debounceMs, requestTimeoutMs, timers { setTimeout, clearTimeout },
   *  now(), onRemoteChange(keys), onStatusChange(status), onUnauthorized(). */
  function createStore(options) {
    const opts = options || {};
    if (opts.userId === undefined || opts.userId === null || opts.userId === '') {
      throw new Error('SyncStorage: falta userId');
    }
    const userId = opts.userId;
    const fetchFn = opts.fetch;
    const merge = opts.merge || (SyncMerge && SyncMerge.threeWayMerge);
    const deepEqual = (SyncMerge && SyncMerge.deepEqual) || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
    if (typeof merge !== 'function') throw new Error('SyncStorage: falta la función de fusión (js/sync-merge.js)');
    const timers = opts.timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
    const now = opts.now || (() => Date.now());
    const debounceMs = opts.debounceMs !== undefined ? opts.debounceMs : DEFAULT_DEBOUNCE_MS;
    const requestTimeoutMs = opts.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    const backend = opts.backend
      || (opts.indexedDB ? createIdbBackend(opts.indexedDB, dbNameForUser(userId)) : createMemoryBackend());

    const kv = new Map();   // storageKey -> valor tal cual lo guarda la app (string JSON)
    const meta = new Map(); // clave sincronizada -> { rev, base, dirty, seq }
    let status = 'idle';
    let lastError = null;
    let lastSyncAt = null;
    let destroyed = false;
    let pushing = null;
    let pushAgain = false;
    let debounceTimer = null;
    let retryTimer = null;
    let retryIndex = 0;

    const ready = backend.loadAll().then(({ kv: k, meta: m }) => {
      k.forEach((v, key) => kv.set(key, v));
      m.forEach((v, key) => { if (isSyncedKey(key)) meta.set(key, Object.assign(emptyMeta(), v)); });
    });

    function getMeta(key) {
      if (!meta.has(key)) meta.set(key, emptyMeta());
      return meta.get(key);
    }
    function anyDirty() {
      for (const key of SYNCED_KEYS) if (meta.has(key) && meta.get(key).dirty) return true;
      return false;
    }
    function pendingKeys() { return SYNCED_KEYS.filter(k => meta.has(k) && meta.get(k).dirty); }

    function setStatus(next, error) {
      if (error !== undefined) lastError = error ? String(error.message || error) : null;
      if (status === next) return;
      status = next;
      if (typeof opts.onStatusChange === 'function') {
        try { opts.onStatusChange(next, getStatus()); } catch (e) { /* un fallo de la UI nunca rompe la sync */ }
      }
    }
    function getStatus() {
      return { status, pendingKeys: pendingKeys(), lastSyncAt, lastError, persistent: !!backend.persistent };
    }
    function notifyRemoteChange(keys) {
      if (!keys.length || typeof opts.onRemoteChange !== 'function') return;
      try { opts.onRemoteChange(keys.slice()); } catch (e) { /* ídem */ }
    }

    /** Guarda en la caché el valor (string) y los metadatos de una clave. */
    function persistKey(key, { value, withMeta }) {
      const entries = [];
      if (value !== undefined) {
        kv.set(storageKey(key, false), value);
        entries.push({ store: KV_STORE, key: storageKey(key, false), value });
      }
      if (withMeta) entries.push({ store: META_STORE, key, value: Object.assign({}, getMeta(key)) });
      return entries.length ? backend.write(entries) : Promise.resolve();
    }

    function localValueOf(key) {
      const raw = kv.get(storageKey(key, false));
      if (raw === undefined) return { exists: false };
      const parsed = parseJSON(raw);
      return parsed.ok && hasSyncedShape(key, parsed.value) ? { exists: true, value: parsed.value } : { exists: true, invalid: true };
    }

    /* ---- red ---- */

    async function request(method, body) {
      if (typeof fetchFn !== 'function') throw new Error('fetch no disponible');
      const init = { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = body;
      }
      let controller = null;
      let timeoutId = null;
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        init.signal = controller.signal;
        timeoutId = timers.setTimeout(() => controller.abort(), requestTimeoutMs);
      }
      try {
        return await fetchFn(API_URL, init);
      } finally {
        if (timeoutId !== null) timers.clearTimeout(timeoutId);
      }
    }

    function scheduleRetry() {
      if (destroyed || retryTimer !== null) return;
      const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
      retryIndex++;
      retryTimer = timers.setTimeout(() => { retryTimer = null; sync().catch(() => {}); }, delay);
    }
    function clearRetry() {
      if (retryTimer !== null) { timers.clearTimeout(retryTimer); retryTimer = null; }
      retryIndex = 0;
    }

    /** Resultado común de un fallo de red/servidor. */
    function failure(kind, error) {
      if (kind === 'unauthorized') {
        setStatus('unauthorized', error);
        if (typeof opts.onUnauthorized === 'function') { try { opts.onUnauthorized(); } catch (e) { /* ídem */ } }
        return { ok: false, unauthorized: true };
      }
      setStatus(kind, error);
      if (kind === 'offline' || kind === 'error') scheduleRetry();
      return { ok: false, offline: kind === 'offline', error: String((error && error.message) || error || kind) };
    }

    /* ---- descarga ---- */

    async function pull() {
      await ready;
      if (destroyed) return { ok: false, destroyed: true };
      setStatus('syncing');
      let res;
      try { res = await request('GET'); } catch (e) { return failure('offline', e); }
      if (res.status === 401) return failure('unauthorized', 'HTTP 401');
      if (!res.ok) return failure('error', 'HTTP ' + res.status);
      let body;
      try { body = await res.json(); } catch (e) { return failure('error', 'Respuesta no válida del servidor'); }
      if (destroyed) return { ok: false, destroyed: true };
      const items = (body && body.items) || {};
      const changed = [];

      for (const key of SYNCED_KEYS) {
        const server = items[key];
        const m = getMeta(key);
        if (!server || typeof server.rev !== 'number') {
          // El servidor no tiene esta clave. Si creíamos que sí (rev > 0),
          // se vuelve a subir lo local en vez de darlo por perdido.
          if (m.rev > 0) {
            m.rev = 0; m.base = null;
            if (localValueOf(key).exists) { m.dirty = true; m.seq++; }
            await persistKey(key, { withMeta: true });
          }
          continue;
        }
        if (server.rev === m.rev) continue; // ya teníamos esta versión

        if (!m.dirty) {
          // Sin cambios locales pendientes: se toma la versión del servidor.
          const text = JSON.stringify(server.value);
          const before = kv.get(storageKey(key, false));
          m.rev = server.rev; m.base = server.value; m.dirty = false;
          await persistKey(key, { value: text, withMeta: true });
          if (before !== text) changed.push(key);
        } else {
          // Hay cambios locales sin subir y el servidor avanzó: se fusiona
          // ya aquí; el resultado se subirá con el rev nuevo.
          const local = localValueOf(key);
          const merged = local.invalid ? server.value : merge(m.base, local.exists ? local.value : null, server.value);
          m.rev = server.rev; m.base = server.value;
          m.dirty = !deepEqual(merged, server.value);
          m.seq++;
          const text = JSON.stringify(merged);
          const before = kv.get(storageKey(key, false));
          await persistKey(key, { value: text, withMeta: true });
          if (before !== text) changed.push(key);
        }
      }

      lastSyncAt = now();
      notifyRemoteChange(changed);
      if (anyDirty()) {
        const r = await push();
        return Object.assign({ changed }, r);
      }
      clearRetry();
      setStatus('synced', null);
      return { ok: true, changed };
    }

    /* ---- subida ---- */

    /** Agrupa los elementos en peticiones que no superen MAX_BODY_BYTES. */
    function batchItems(items) {
      const batches = [];
      let current = [];
      let size = 0;
      for (const it of items) {
        const itemSize = byteLength(JSON.stringify(it)) + 1;
        if (current.length && size + itemSize > MAX_BODY_BYTES) { batches.push(current); current = []; size = 0; }
        current.push(it);
        size += itemSize;
      }
      if (current.length) batches.push(current);
      return batches;
    }

    async function pushOnce() {
      const snapshot = [];
      for (const key of pendingKeys()) {
        const m = getMeta(key);
        const local = localValueOf(key);
        if (!local.exists || local.invalid) {
          // Nada válido que subir para esta clave: se deja de marcar como
          // pendiente para no reintentar indefinidamente.
          m.dirty = false;
          await persistKey(key, { withMeta: true });
          continue;
        }
        snapshot.push({ key, seq: m.seq, baseRev: m.rev, value: local.value });
      }
      if (!snapshot.length) return { ok: true, conflicts: 0 };

      let conflicts = 0;
      const changed = [];
      for (const batch of batchItems(snapshot.map(s => ({ key: s.key, value: s.value, baseRev: s.baseRev })))) {
        let res;
        try { res = await request('PUT', JSON.stringify({ items: batch })); } catch (e) { return failure('offline', e); }
        if (res.status === 401) return failure('unauthorized', 'HTTP 401');
        if (res.status !== 200 && res.status !== 409) {
          let detail = 'HTTP ' + res.status;
          try { const b = await res.json(); if (b && b.error) detail += ': ' + b.error; } catch (e) { /* sin cuerpo */ }
          return failure('error', detail);
        }
        let body;
        try { body = await res.json(); } catch (e) { return failure('error', 'Respuesta no válida del servidor'); }
        if (destroyed) return { ok: false, destroyed: true };
        const results = (body && body.results) || {};

        for (const sent of batch) {
          const r = results[sent.key];
          const snap = snapshot.find(s => s.key === sent.key);
          const m = getMeta(sent.key);
          if (!r) continue;
          if (r.ok) {
            m.rev = r.rev;
            m.base = snap.value;
            // Si la app volvió a guardar mientras tanto, sigue pendiente.
            if (m.seq === snap.seq) m.dirty = false;
            await persistKey(sent.key, { withMeta: true });
          } else if (r.conflict) {
            conflicts++;
            const local = localValueOf(sent.key);
            const remoteValue = r.value;
            const merged = (remoteValue === null || remoteValue === undefined)
              ? (local.exists ? local.value : snap.value)
              : merge(m.base, local.exists && !local.invalid ? local.value : snap.value, remoteValue);
            m.rev = typeof r.rev === 'number' ? r.rev : 0;
            m.base = (remoteValue === null || remoteValue === undefined) ? null : remoteValue;
            m.dirty = m.rev === 0 || !deepEqual(merged, remoteValue);
            m.seq++;
            const text = JSON.stringify(merged);
            const before = kv.get(storageKey(sent.key, false));
            await persistKey(sent.key, { value: text, withMeta: true });
            if (before !== text) changed.push(sent.key);
          }
        }
      }
      lastSyncAt = now();
      notifyRemoteChange(changed);
      return { ok: true, conflicts };
    }

    /** Sube todas las claves pendientes. Una sola subida a la vez: si se
     * pide otra mientras tanto, se encadena al terminar la actual. */
    function push() {
      if (pushing) { pushAgain = true; return pushing; }
      pushing = (async () => {
        try {
          await ready;
          let rounds = 0;
          let last = { ok: true };
          do {
            pushAgain = false;
            if (destroyed) return { ok: false, destroyed: true };
            setStatus('syncing');
            last = await pushOnce();
            if (!last.ok) return last;
            rounds++;
            if (last.conflicts) pushAgain = true;
          } while (pushAgain && anyDirty() && rounds < MAX_PUSH_ROUNDS);
          if (anyDirty()) { setStatus('pending'); scheduleRetry(); return { ok: true, pending: pendingKeys() }; }
          clearRetry();
          setStatus('synced', null);
          return { ok: true };
        } finally {
          pushing = null;
        }
      })();
      return pushing;
    }

    function schedulePush() {
      if (destroyed) return;
      if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
      debounceTimer = timers.setTimeout(() => { debounceTimer = null; push().catch(() => {}); }, debounceMs);
    }

    /** Descarga y, si hay algo pendiente, sube. Nunca lanza. */
    async function sync() {
      try { return await pull(); } catch (e) { return failure('error', e); }
    }

    /** Sube ya lo pendiente (sin esperar al debounce) y devuelve true si
     * no queda nada por subir. */
    async function flush() {
      if (debounceTimer !== null) { timers.clearTimeout(debounceTimer); debounceTimer = null; }
      await ready;
      if (anyDirty()) {
        try { await push(); } catch (e) { failure('error', e); }
      }
      return !anyDirty();
    }

    /** Al cerrar/ocultar la página: último intento de subir lo pendiente
     * con keepalive (el navegador lo envía aunque la página se cierre). No
     * espera respuesta ni toca los metadatos: si llegó, la próxima
     * descarga verá que el servidor ya tiene ese mismo valor y la marca de
     * pendiente se limpia sola. */
    function flushKeepalive() {
      if (destroyed || typeof fetchFn !== 'function' || !anyDirty()) return false;
      const items = [];
      for (const key of pendingKeys()) {
        const local = localValueOf(key);
        if (local.exists && !local.invalid) items.push({ key, value: local.value, baseRev: getMeta(key).rev });
      }
      if (!items.length) return false;
      const body = JSON.stringify({ items });
      if (byteLength(body) > MAX_KEEPALIVE_BYTES) return false;
      try {
        const p = fetchFn(API_URL, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body });
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return true;
      } catch (e) { return false; }
    }

    /** Detiene temporizadores y deja de sincronizar (sin borrar nada). */
    async function deactivate() {
      destroyed = true;
      if (debounceTimer !== null) { timers.clearTimeout(debounceTimer); debounceTimer = null; }
      clearRetry();
      await backend.close();
    }

    /** Borra la caché local de este usuario (al cerrar sesión). */
    async function destroy() {
      destroyed = true;
      if (debounceTimer !== null) { timers.clearTimeout(debounceTimer); debounceTimer = null; }
      clearRetry();
      kv.clear();
      meta.clear();
      await backend.destroy();
    }

    /* ---- interfaz window.storage (misma que storage-polyfill.js) ---- */
    const storage = {
      async get(key, shared = false) {
        await ready;
        const value = kv.get(storageKey(key, shared));
        if (value === undefined || value === null) return null;
        return { key, value, shared: !!shared };
      },
      async set(key, value, shared = false) {
        await ready;
        if (destroyed) throw new Error('SyncStorage: la sesión de este usuario ya se cerró');
        const sk = storageKey(key, shared);
        if (!shared && isSyncedKey(key)) {
          const m = getMeta(key);
          m.dirty = true;
          m.seq++;
          await persistKey(key, { value, withMeta: true });
          if (status === 'synced' || status === 'idle') setStatus('pending');
          schedulePush();
        } else {
          kv.set(sk, value);
          await backend.write([{ store: KV_STORE, key: sk, value }]);
        }
        return { key, value, shared: !!shared };
      },
      async delete(key, shared = false) {
        await ready;
        const sk = storageKey(key, shared);
        kv.delete(sk);
        const entries = [{ store: KV_STORE, key: sk, value: undefined }];
        // Borrar una clave sincronizada solo la quita de ESTE dispositivo
        // (la app nunca lo hace): la próxima descarga la vuelve a traer.
        if (!shared && isSyncedKey(key)) { meta.delete(key); entries.push({ store: META_STORE, key, value: undefined }); }
        await backend.write(entries);
        return { key, deleted: true, shared: !!shared };
      },
      async list(prefix = '', shared = false) {
        await ready;
        const tag = (shared ? 'shared:' : 'user:') + (prefix || '');
        const keys = [...kv.keys()].filter(k => k.startsWith(tag)).map(k => k.slice(shared ? 7 : 5));
        return { keys, prefix: prefix || undefined, shared: !!shared };
      },
    };

    return {
      userId,
      dbName: dbNameForUser(userId),
      ready,
      storage,
      sync,
      pull,
      push,
      flush,
      flushKeepalive,
      deactivate,
      destroy,
      getStatus,
      hasPendingChanges: anyDirty,
    };
  }

  /* ---------------- Integración con la página ---------------- */

  let current = null;
  let detachListeners = null;

  /** Activa la sincronización para `user` ({ id, ... }): crea su almacén,
   * sustituye window.storage, hace la primera descarga (si hay red) y
   * engancha los eventos de conexión/visibilidad. Si ya había otro
   * usuario activo, lo desactiva antes (sin borrar su caché). */
  async function activate(user, options) {
    if (!user || user.id === undefined || user.id === null) throw new Error('SyncStorage.activate: falta el usuario');
    await deactivate();
    const win = (options && options.window) || root;
    const store = createStore(Object.assign({
      userId: user.id,
      fetch: typeof win.fetch === 'function' ? win.fetch.bind(win) : undefined,
      indexedDB: win.indexedDB,
    }, options || {}));
    try {
      await store.ready;
    } catch (e) {
      // IndexedDB falló al abrir: se sigue en memoria contra el servidor.
      return activate(user, Object.assign({}, options || {}, { backend: createMemoryBackend() }));
    }
    win.storage = store.storage;
    current = store;

    const onOnline = () => { store.sync(); };
    const onVisibility = () => {
      const doc = win.document;
      if (!doc || doc.visibilityState === 'visible') store.sync();
      else store.flushKeepalive();
    };
    const onPageHide = () => { store.flushKeepalive(); };
    if (typeof win.addEventListener === 'function') {
      win.addEventListener('online', onOnline);
      win.addEventListener('pagehide', onPageHide);
    }
    if (win.document && typeof win.document.addEventListener === 'function') {
      win.document.addEventListener('visibilitychange', onVisibility);
    }
    detachListeners = () => {
      if (typeof win.removeEventListener === 'function') {
        win.removeEventListener('online', onOnline);
        win.removeEventListener('pagehide', onPageHide);
      }
      if (win.document && typeof win.document.removeEventListener === 'function') {
        win.document.removeEventListener('visibilitychange', onVisibility);
      }
    };

    await store.sync();
    return store;
  }

  async function deactivate() {
    if (detachListeners) { detachListeners(); detachListeners = null; }
    if (current) { const c = current; current = null; await c.deactivate(); }
  }

  /** Borra la caché local de un usuario sin necesidad de tenerla activa. */
  async function deleteUserCache(userId, idb) {
    const db = idb || root.indexedDB;
    if (!db) return;
    await createIdbBackend(db, dbNameForUser(userId)).destroy();
  }

  /* ---------------- Datos antiguos (antes de las cuentas) ----------------
     Hasta SYNC, storage-polyfill.js guardaba todo en UNA base compartida
     por todo el navegador: 'organizator-storage', almacén 'kv', claves
     'user:<clave>'. Estas funciones la leen y la borran para migrarla a
     la cuenta (la decisión y el aviso al usuario viven en organizator.html,
     bloque "SYNC — migración de datos antiguos"). */
  const LEGACY_DB_NAME = 'organizator-storage';
  const LEGACY_STORE = 'kv';
  const LEGACY_LOCAL_KEYS = ['reminderNotificationLedger'];
  const LIST_KEYS = SYNCED_KEYS.filter(k => k !== 'settingsPrefs' && k !== 'settingsIA');

  /** Lee la base antigua SIN crearla si no existe (abrir una base que no
   * existe la crearía vacía: se aborta esa creación). Devuelve null si no
   * hay base o no tiene nada útil, o { values: { clave: valorParseado } }
   * con las claves sincronizadas y las locales que tengan un valor válido. */
  function readLegacyData(idb) {
    return new Promise((resolve) => {
      if (!idb) { resolve(null); return; }
      let req;
      let created = false;
      try { req = idb.open(LEGACY_DB_NAME); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        // No existía: se cancela la creación para no dejar una base vacía.
        created = true;
        try { req.transaction.abort(); } catch (e) { /* ignorado */ }
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (created || !db.objectStoreNames.contains(LEGACY_STORE)) { db.close(); resolve(null); return; }
        const tx = db.transaction(LEGACY_STORE, 'readonly');
        const store = tx.objectStore(LEGACY_STORE);
        const keysReq = store.getAllKeys();
        const valuesReq = store.getAll();
        tx.oncomplete = () => {
          db.close();
          const values = {};
          (keysReq.result || []).forEach((k, i) => {
            if (typeof k !== 'string' || !k.startsWith('user:')) return;
            const key = k.slice(5);
            if (!isSyncedKey(key) && LEGACY_LOCAL_KEYS.indexOf(key) === -1) return;
            const raw = valuesReq.result[i];
            if (typeof raw !== 'string') return;
            const parsed = parseJSON(raw);
            if (!parsed.ok) return;
            if (isSyncedKey(key) && !hasSyncedShape(key, parsed.value)) return;
            values[key] = parsed.value;
          });
          resolve(Object.keys(values).length ? { values } : null);
        };
        tx.onerror = () => { db.close(); resolve(null); };
      };
    });
  }

  /** Borra la base antigua. { deleted: true } solo cuando el navegador
   * confirma el borrado; si otra pestaña con una versión vieja la tiene
   * abierta ('blocked'), { deleted: false } para reintentarlo más tarde. */
  function deleteLegacyData(idb) {
    return new Promise((resolve) => {
      if (!idb) { resolve({ deleted: false }); return; }
      let req;
      try { req = idb.deleteDatabase(LEGACY_DB_NAME); } catch (e) { resolve({ deleted: false }); return; }
      req.onsuccess = () => resolve({ deleted: true });
      req.onerror = () => resolve({ deleted: false });
      req.onblocked = () => resolve({ deleted: false, blocked: true });
    });
  }

  /** Recuento de lo que hay en un conjunto de valores { clave: valor }
   * (datos antiguos o de la cuenta), para el aviso al usuario. */
  function summarizeData(values) {
    const v = values || {};
    const counts = {};
    let total = 0;
    for (const key of LIST_KEYS) {
      counts[key] = Array.isArray(v[key]) ? v[key].length : 0;
      total += counts[key];
    }
    const titles = [];
    for (const key of ['tasks', 'events']) {
      for (const item of (Array.isArray(v[key]) ? v[key] : [])) {
        if (titles.length >= 3) break;
        if (item && typeof item.title === 'string' && item.title.trim()) titles.push(item.title.trim());
      }
    }
    return { counts, total, hasListData: total > 0, sampleTitles: titles };
  }

  /** Valores a guardar en la cuenta al pasar los datos antiguos:
   *  - Listas: unión por id; si un mismo elemento está en los dos lados,
   *    se queda la versión de la CUENTA (es la que ya ven los demás
   *    dispositivos).
   *  - Ajustes: en modo 'upload' (la cuenta no tenía datos) mandan los
   *    antiguos; en 'combine' manda la cuenta y los antiguos solo rellenan
   *    lo que falte.
   * Solo claves sincronizadas; no modifica sus argumentos. */
  function buildMigratedValues(legacyValues, accountValues, mode) {
    const merge = SyncMerge.threeWayMerge;
    const out = {};
    for (const key of SYNCED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(legacyValues || {}, key)) continue;
      const legacy = legacyValues[key];
      const account = accountValues ? accountValues[key] : undefined;
      if (account === undefined || account === null) { out[key] = JSON.parse(JSON.stringify(legacy)); continue; }
      const isList = LIST_KEYS.indexOf(key) !== -1;
      out[key] = (isList || mode === 'combine') ? merge(null, account, legacy) : merge(null, legacy, account);
    }
    return out;
  }

  const legacy = {
    DB_NAME: LEGACY_DB_NAME,
    readLegacyData,
    deleteLegacyData,
    summarizeData,
    buildMigratedValues,
  };

  return {
    SYNCED_KEYS,
    dbNameForUser,
    createStore,
    createIdbBackend,
    createMemoryBackend,
    activate,
    deactivate,
    deleteUserCache,
    legacy,
    current: () => current,
  };
});
