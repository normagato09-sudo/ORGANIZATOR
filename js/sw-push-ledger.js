/**
 * ORGANIZATOR — Ledger persistente de entregas de Web Push (Fase R-8.2-D)
 *
 * Expone `self.SWPushLedger` en CUALQUIER realm que cargue este archivo:
 * tanto en sw.js (vía importScripts('/js/sw-push-ledger.js'), donde
 * `self` es el ServiceWorkerGlobalScope) como en organizator.html (vía
 * <script src="/js/sw-push-ledger.js">, donde `self` es simplemente un
 * alias estándar del propio `window` de la página) — así el mismo
 * código sirve para que el Service Worker registre, de forma DURADERA,
 * qué reminderId ya mostró por push (incluso con ORGANIZATOR
 * completamente cerrado, sin ninguna pestaña a la que avisar por
 * postMessage — ver R-8.2-C) y para que la página, al reabrirse, pueda
 * CONSULTARLO antes de que el polling local (triggerDueReminders,
 * organizator.html) muestre un segundo aviso del mismo reminder.
 *
 * Por qué NO se reutiliza window.storage (storage-polyfill.js): ese
 * polyfill vive en `window` y NUNCA existe dentro de un Service Worker
 * (no hay `window`/`document` en ese realm) — reutilizarlo habría
 * obligado a que sw.js dependiera de que hubiera una página abierta,
 * justo la limitación que R-8.2-D tiene que resolver. En vez de
 * inventar un mecanismo nuevo, este archivo usa IndexedDB DIRECTAMENTE
 * (la única API de almacenamiento persistente estándar disponible en
 * AMBOS realms), con su PROPIA base de datos separada
 * ('organizator-push-ledger', distinta de 'organizator-storage') para
 * no interferir con el esquema/versión del polyfill existente.
 *
 * RESPONSABILIDAD DE CADA LADO (no mezclar, ver informe R-8.2-D):
 * - Escribe (markDelivered) SOLO el Service Worker, SOLO desde el
 *   manejador de 'push' en sw.js: es el registro de qué reminderId YA
 *   mostró el propio Service Worker por push, sea cual sea el estado de
 *   la app en ese momento (abierta, cerrada, con varias pestañas...).
 * - Lee (hasDelivered) la página, dentro de triggerDueReminders()
 *   (organizator.html), para saber si el Service Worker YA avisó de un
 *   reminder concreto aunque no hubiera ninguna pestaña abierta cuando
 *   llegó el push — y por tanto state.reminderNotificationLedger (que
 *   SOLO se alimenta de pushes recibidos con la app YA abierta vía
 *   postMessage, ver R-8.2-C) nunca se llegó a enterar.
 * - Limpia (pruneDelivered) y reinicia (clearAll) ambos lados según
 *   corresponda (ver cada función).
 * - NUNCA toca state.reminders, reminder.status, ni
 *   state.reminderNotificationLedger: es un registro aparte, exclusivo
 *   de "qué reminderId ya mostró un push el Service Worker".
 *
 * Idempotencia/carreras: markDelivered() usa IDBObjectStore.add(), que
 * el propio IndexedDB rechaza (ConstraintError) si la clave ya existe —
 * "quien llega primero, gana" de forma ATÓMICA a nivel de la propia
 * base de datos (nunca un get()+put() con hueco para una carrera entre
 * dos invocaciones del evento 'push', p.ej. un reintento de QStash
 * llegando justo cuando el Service Worker se reinició). Ninguna función
 * de este módulo lanza nunca: cualquier fallo de IndexedDB (no
 * disponible, cuota, contexto restringido...) se resuelve de forma
 * "fail-open" — se prefiere mostrar/dejar pasar un push de más antes
 * que perder un aviso real por un problema de almacenamiento.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'organizator-push-ledger';
  var DB_VERSION = 1;
  var STORE = 'delivered';
  // 7 días: margen generoso para que "el usuario reabre ORGANIZATOR
  // horas (o algún día) después" (R-8.2-D, sección 6) siga sin duplicar
  // el aviso, acotando igualmente el crecimiento a largo plazo del
  // registro — no se borra nunca antes de eso, así que nunca interfiere
  // con una reapertura normal.
  var DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  var dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root || !root.indexedDB) { reject(new Error('IndexedDB no disponible en este contexto')); return; }
      var req;
      try {
        req = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (db && !db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('No se pudo abrir organizator-push-ledger')); };
    }).catch(function (err) {
      // Si falla la apertura, no se deja "cacheado" el fallo: una
      // llamada posterior (p.ej. tras recuperarse un error transitorio)
      // puede volver a intentarlo en vez de fallar para siempre.
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  /** true si ya hay una marca de entrega para este reminderId. Nunca
   * lanza: cualquier fallo (IndexedDB no disponible, error de lectura,
   * reminderId inválido) se resuelve a false — fail-open, para no
   * bloquear nunca la reconciliación de la página por un problema de
   * almacenamiento. */
  function hasDelivered(reminderId) {
    if (typeof reminderId !== 'string' || !reminderId) return Promise.resolve(false);
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readonly');
          var req = tx.objectStore(STORE).get(reminderId);
          req.onsuccess = function () { resolve(req.result !== undefined); };
          req.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  /** Registra que el Service Worker YA mostró un push para este
   * reminderId. Idempotente y ATÓMICO (ver doc del módulo, arriba):
   * devuelve true la primera vez (marca recién creada — el llamador
   * DEBE mostrar la notificación), false si ya existía (duplicado o
   * reintento — el llamador NO debe volver a mostrarla). Nunca lanza:
   * un fallo real de IndexedDB se resuelve a true (fail-open: si no se
   * puede deduplicar, se prefiere mostrar el push de todas formas antes
   * que arriesgarse a perder un aviso real). SOLO debe llamarse desde
   * sw.js (ver responsabilidad de cada lado, arriba) — la página nunca
   * debe "reclamar" una marca, solo consultarla con hasDelivered(). */
  function markDelivered(reminderId, when) {
    if (typeof reminderId !== 'string' || !reminderId) return Promise.resolve(true);
    var ts = (typeof when === 'number' && !isNaN(when)) ? when : Date.now();
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          var req = tx.objectStore(STORE).add(ts, reminderId);
          req.onsuccess = function () { resolve(true); };
          req.onerror = function (ev) {
            // ConstraintError = la clave ya existía: es un duplicado
            // detectado correctamente, NO un fallo real — se evita que
            // se propague como error/abort de la transacción
            // (preventDefault) y se resuelve false.
            try { if (ev && typeof ev.preventDefault === 'function') ev.preventDefault(); } catch (e2) {}
            resolve(false);
          };
        } catch (e) { resolve(true); }
      });
    }).catch(function () { return true; });
  }

  /** Limpieza determinista: elimina marcas con más de `ttlMs`
   * milisegundos de antigüedad respecto a `now`. AMBOS parámetros son
   * EXPLÍCITOS (nunca se usa Date.now() internamente si se pasan) para
   * que sea 100% testeable con un reloj simulado. Nunca lanza; resuelve
   * al número de marcas eliminadas (0 si no había nada que limpiar o si
   * IndexedDB no está disponible). No toca reminders funcionales: solo
   * esta base de datos aparte. */
  function pruneDelivered(now, ttlMs) {
    var nowTs = (typeof now === 'number' && !isNaN(now)) ? now : Date.now();
    var ttl = (typeof ttlMs === 'number' && !isNaN(ttlMs) && ttlMs >= 0) ? ttlMs : DEFAULT_TTL_MS;
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          var store = tx.objectStore(STORE);
          var req = store.openCursor();
          var removed = 0;
          req.onsuccess = function () {
            var cursor = req.result;
            if (!cursor) { resolve(removed); return; }
            var value = cursor.value;
            if (typeof value !== 'number' || (nowTs - value) > ttl) {
              cursor.delete();
              removed++;
            }
            cursor.continue();
          };
          req.onerror = function () { resolve(removed); };
        } catch (e) { resolve(0); }
      });
    }).catch(function () { return 0; });
  }

  /** Borra TODO el ledger persistente del Service Worker. Se llama
   * desde la página tras importData()/deleteAllData() (ver
   * organizator.html): cualquier marca de "este reminderId ya avisó"
   * pierde sentido en cuanto el conjunto de reminders locales se
   * reemplaza o se borra por completo — evita que una marca de un
   * reminderId de un conjunto anterior "contamine" (R-8.2-D, sección
   * 12) un reminderId que, tras un import, pudiera coincidir por
   * casualidad con uno nuevo. Nunca lanza; resuelve a true/false según
   * si pudo completarse. */
  function clearAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  root.SWPushLedger = {
    hasDelivered: hasDelivered,
    markDelivered: markDelivered,
    pruneDelivered: pruneDelivered,
    clearAll: clearAll,
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
  };
})(typeof self !== 'undefined' ? self : this);
