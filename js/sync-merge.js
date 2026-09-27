/**
 * ORGANIZATOR — Fusión a tres bandas para la sincronización (SYNC, paso 4)
 *
 * Cuando un dispositivo intenta guardar una clave (p. ej. 'tasks') y el
 * servidor responde que OTRO dispositivo la cambió antes (conflicto de
 * `rev`, ver api/data.js), no se puede elegir "la última escritura" sin
 * más: cada clave es una lista COMPLETA, así que se perderían las tareas
 * creadas en el otro dispositivo. En su lugar se fusiona con tres
 * versiones:
 *   - base:   el último valor del servidor que conocía este dispositivo
 *   - local:  lo que tiene ahora este dispositivo (con sus cambios)
 *   - remote: lo que hay ahora en el servidor (con los cambios del otro)
 * y se aplican los cambios locales (respecto a base) sobre remote.
 *
 * Reglas (listas de tasks/events/customSchedules/eventCategories/reminders,
 * elementos identificados por su `id`):
 *   - Altas de cualquiera de los dos lados: se conservan todas.
 *   - Elemento editado solo en un lado: gana esa edición.
 *   - Editado en los dos lados de forma distinta: gana el LOCAL (es la
 *     edición que se está guardando ahora).
 *   - Borrado en un lado: se borra, aunque el otro lado lo hubiera editado
 *     ("borrar" es una decisión explícita; nunca resucita).
 *   - Elementos sin `id` válido: se identifican por su contenido completo
 *     (editar uno equivale a borrarlo y añadir otro).
 *   - Orden: el de remote, con las altas locales añadidas al final.
 * Objetos (settingsPrefs/settingsIA): mismas reglas, propiedad a propiedad.
 * Atajos: si solo cambió un lado, el resultado es ESE lado tal cual
 * (incluido su orden); si local y remote ya son iguales, no hay nada que
 * fusionar.
 *
 * Funciones puras: nunca modifican sus argumentos, no usan red, IndexedDB,
 * `state` ni DOM. Se cargan igual en el navegador (window.SyncMerge) y en
 * Node (module.exports) para poder probarlas sin navegador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** JSON con las claves de los objetos ordenadas: dos valores con el
   * mismo contenido dan el mismo texto aunque sus claves estén en otro
   * orden. */
  function stableStringify(value) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }

  function deepEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /** Clave de identidad de un elemento de lista: su `id` si es válido, o
   * su contenido completo si no lo tiene. */
  function itemKey(item) {
    if (isPlainObject(item)) {
      const id = item.id;
      if ((typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id))) {
        return 'id:' + String(id);
      }
    }
    return 'json:' + stableStringify(item);
  }

  /** Mapa clave -> elemento (primera aparición si hubiera repetidos). */
  function indexByKey(list) {
    const map = new Map();
    for (const item of list) {
      const k = itemKey(item);
      if (!map.has(k)) map.set(k, item);
    }
    return map;
  }

  /** Decide el valor final de UN elemento/propiedad presente en alguno de
   * los lados. Devuelve { keep: false } si debe desaparecer, o
   * { keep: true, value }. `has*` indica si existe en cada versión. */
  function resolveOne(hasBase, base, hasLocal, local, hasRemote, remote) {
    if (hasLocal && hasRemote) {
      if (deepEqual(local, remote)) return { keep: true, value: remote };
      if (hasBase && deepEqual(local, base)) return { keep: true, value: remote }; // solo cambió remote
      if (hasBase && deepEqual(remote, base)) return { keep: true, value: local }; // solo cambió local
      return { keep: true, value: local }; // cambiaron los dos (o sin base): gana local
    }
    if (hasLocal) {
      // No está en remote: si estaba en base, el otro dispositivo lo borró.
      return hasBase ? { keep: false } : { keep: true, value: local };
    }
    if (hasRemote) {
      // No está en local: si estaba en base, este dispositivo lo borró.
      return hasBase ? { keep: false } : { keep: true, value: remote };
    }
    return { keep: false };
  }

  function mergeArrays(base, local, remote) {
    const B = indexByKey(base);
    const L = indexByKey(local);
    const R = indexByKey(remote);
    const out = [];
    const emitted = new Set();

    for (const item of remote) {
      const k = itemKey(item);
      if (emitted.has(k)) { out.push(item); continue; } // repetido ya en remote: se conserva tal cual
      emitted.add(k);
      const r = resolveOne(B.has(k), B.get(k), L.has(k), L.get(k), true, R.get(k));
      if (r.keep) out.push(r.value);
    }
    for (const item of local) {
      const k = itemKey(item);
      if (emitted.has(k) || R.has(k)) continue;
      emitted.add(k);
      const r = resolveOne(B.has(k), B.get(k), true, L.get(k), false, undefined);
      if (r.keep) out.push(r.value);
    }
    return out;
  }

  function mergeObjects(base, local, remote) {
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const out = {};
    const keys = [...Object.keys(remote), ...Object.keys(local).filter(k => !own(remote, k))];
    for (const k of keys) {
      const r = resolveOne(own(base, k), base[k], own(local, k), local[k], own(remote, k), remote[k]);
      if (r.keep) out[k] = r.value;
    }
    return out;
  }

  /** Fusiona `local` sobre `remote` usando `base` como referencia común.
   * `base` puede ser null/undefined (no se conoce ninguna versión común:
   * p.ej. primera subida con datos ya en el servidor) — entonces no se
   * puede saber qué se borró, así que se hace la UNIÓN de ambos lados
   * (a igualdad de id, gana local). Si `remote` no tiene la forma esperada
   * (null: la clave no existe en el servidor) no hay nada con qué fusionar
   * y se devuelve lo local — nunca se interpreta como "el otro dispositivo
   * lo borró todo", que haría perder los datos locales. Devuelve SIEMPRE
   * un valor nuevo, nunca uno de los argumentos. */
  function threeWayMerge(base, local, remote) {
    if (Array.isArray(local)) {
      if (!Array.isArray(remote)) return clone(local);
      const r = remote;
      const b = Array.isArray(base) ? base : null;
      if (deepEqual(local, r)) return clone(local);
      if (b && deepEqual(r, b)) return clone(local);
      if (b && deepEqual(local, b)) return clone(r);
      return clone(mergeArrays(b || [], local, r));
    }
    if (isPlainObject(local)) {
      if (!isPlainObject(remote)) return clone(local);
      const r = remote;
      const b = isPlainObject(base) ? base : null;
      if (deepEqual(local, r)) return clone(local);
      if (b && deepEqual(r, b)) return clone(local);
      if (b && deepEqual(local, b)) return clone(r);
      return clone(mergeObjects(b || {}, local, r));
    }
    // Forma inesperada (no debería ocurrir con las claves sincronizadas):
    // se conserva lo local, que es lo que el usuario acaba de guardar.
    return clone(local);
  }

  return { threeWayMerge, stableStringify, deepEqual };
});
