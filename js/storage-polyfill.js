/**
 * ORGANIZATOR — Polyfill de window.storage (Fase 6, PWA)
 *
 * organizator.html guarda todos sus datos (tareas, eventos, Rubik, horarios
 * personalizados, ajustes...) llamando a `window.storage.get/set/delete/list`.
 * Esa API la proporciona automáticamente el entorno de artefactos de Claude.ai,
 * pero NO existe en un navegador normal (por ejemplo, al abrir la app ya
 * publicada en Vercel). Sin este archivo, fuera de Claude la app no persiste
 * absolutamente nada entre recargas.
 *
 * Este script define `window.storage` con la MISMA interfaz, respaldada por
 * IndexedDB, únicamente cuando no exista ya (es decir, fuera de Claude).
 * No se toca ni una sola llamada a window.storage.* del resto de la app.
 *
 * IMPORTANTE: este archivo debe cargarse ANTES del <script> principal de
 * organizator.html, para que window.storage ya exista cuando arranque loadState().
 */
(function () {
  if (window.storage) {
    // Ya existe (p. ej. estamos dentro del entorno de artefactos de Claude).
    // No lo sustituimos.
    return;
  }

  const DB_NAME = 'organizator-storage';
  const DB_VERSION = 1;
  const STORE = 'kv';

  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB no está disponible en este navegador'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function compositeKey(key, shared) {
    return (shared ? 'shared:' : 'user:') + key;
  }

  function idbGet(key) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function idbSet(key, value) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function idbDelete(key) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function idbAllKeys() {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  window.storage = {
    async get(key, shared = false) {
      const value = await idbGet(compositeKey(key, shared));
      if (value === undefined || value === null) return null;
      return { key, value, shared: !!shared };
    },
    async set(key, value, shared = false) {
      await idbSet(compositeKey(key, shared), value);
      return { key, value, shared: !!shared };
    },
    async delete(key, shared = false) {
      await idbDelete(compositeKey(key, shared));
      return { key, deleted: true, shared: !!shared };
    },
    async list(prefix = '', shared = false) {
      const prefixTag = (shared ? 'shared:' : 'user:') + (prefix || '');
      const all = await idbAllKeys();
      const keys = all
        .filter(k => typeof k === 'string' && k.startsWith(prefixTag))
        .map(k => k.slice(shared ? 7 : 5));
      return { keys, prefix: prefix || undefined, shared: !!shared };
    },
  };
})();
