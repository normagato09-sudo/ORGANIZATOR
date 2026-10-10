/**
 * ORGANIZATOR — Tests de SYNC paso 1 (el Service Worker nunca cachea /api/*)
 *
 * Suite Node pura, SIN navegador: carga sw.js TAL CUAL está en disco en
 * un sandbox `vm` con `self`/`caches`/`fetch` falsos (mismo enfoque que
 * test-reminders-r8-closed-app.js), captura su manejador de 'fetch' y lo
 * invoca con peticiones simuladas.
 *
 * Qué se comprueba:
 *  - Ninguna petición a /api/* se sirve desde la caché ni se guarda en
 *    ella (motivo: dependen de la sesión — un GET /api/auth/me cacheado
 *    podía devolver la sesión de la cuenta anterior tras cerrar sesión).
 *  - El resto del comportamiento del shell sigue igual (navegación red
 *    primero + copia en caché; recursos propios caché primero; POST y
 *    peticiones de otro origen no se interceptan).
 *  - APP_VERSION (organizator.html) y CACHE_VERSION (sw.js) coinciden.
 *
 * Uso:  node js/test-sw-api-bypass.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(ROOT, 'organizator.html'), 'utf8').replace(/\r\n/g, '\n');

const ORIGIN = 'https://organizator.example.com';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Caché falsa en memoria que registra cada lectura/escritura por URL. */
function makeCaches() {
  const store = new Map();
  const log = { match: [], put: [] };
  const urlOf = (req) => (typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);
  const cache = {
    async put(req, res) { log.put.push(urlOf(req)); store.set(urlOf(req), res); },
    async addAll() {},
  };
  return {
    log, store,
    async open() { return cache; },
    async match(req) { log.match.push(urlOf(req)); return store.get(urlOf(req)); },
    async keys() { return []; },
    async delete() { return true; },
  };
}

function makeResponse(body) {
  return { ok: true, status: 200, body, clone() { return makeResponse(body); } };
}

/** Carga sw.js en un sandbox y devuelve su manejador de 'fetch'. */
function loadSW() {
  const handlers = {};
  const caches = makeCaches();
  const fetchLog = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) { handlers[type] = fn; },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: { showNotification: async () => {} },
  };
  const sandbox = {
    self, caches, URL, console,
    importScripts() {},
    fetch: async (req) => { fetchLog.push(typeof req === 'string' ? req : req.url); return makeResponse('network:' + (req.url || req)); },
  };
  vm.createContext(sandbox);
  vm.runInContext(swSrc, sandbox, { filename: 'sw.js' });
  return { onFetch: handlers.fetch, caches, fetchLog, context: sandbox };
}

/** Simula un FetchEvent. Devuelve { intercepted, response }. */
async function dispatch(onFetch, { url, method = 'GET', mode = 'cors', destination = '' }) {
  let responded = null;
  const event = {
    request: { url: new URL(url, ORIGIN).href, method, mode, destination },
    respondWith(p) { responded = Promise.resolve(p); },
  };
  onFetch(event);
  return { intercepted: responded !== null, response: responded ? await responded : undefined };
}

(async () => {
  section('1. /api/* nunca pasa por la caché');
  {
    const sw = loadSW();
    check('sw.js registra un manejador de fetch', typeof sw.onFetch === 'function');

    // Aunque la caché ya tuviera una copia (p.ej. de una versión anterior
    // del SW), NO se debe usar.
    sw.caches.store.set(`${ORIGIN}/api/auth/me`, makeResponse('me-cacheado-de-otra-cuenta'));

    const me = await dispatch(sw.onFetch, { url: '/api/auth/me' });
    check('GET /api/auth/me no se intercepta (va directo a la red del navegador)', me.intercepted === false);

    const data = await dispatch(sw.onFetch, { url: '/api/data' });
    check('GET /api/data no se intercepta', data.intercepted === false);

    const withQuery = await dispatch(sw.onFetch, { url: '/api/data?since=3' });
    check('GET /api/data?since=3 (con query) no se intercepta', withQuery.intercepted === false);

    const key = await dispatch(sw.onFetch, { url: '/api/push/vapid-public-key' });
    check('GET /api/push/vapid-public-key no se intercepta', key.intercepted === false);

    const apiLog = [...sw.caches.log.match, ...sw.caches.log.put].filter(u => new URL(u).pathname.startsWith('/api/'));
    check('ninguna URL /api/* se leyó ni se escribió en la caché', apiLog.length === 0);
  }

  section('2. El resto del shell sigue funcionando igual');
  {
    const sw = loadSW();

    const nav = await dispatch(sw.onFetch, { url: '/', mode: 'navigate', destination: 'document' });
    await new Promise(r => setImmediate(r));
    check('navegación: se intercepta y responde con la red', nav.intercepted && nav.response && nav.response.body === `network:${ORIGIN}/`);
    check('navegación: guarda copia de /organizator.html en caché', sw.caches.log.put.includes(`${ORIGIN}/organizator.html`));

    sw.caches.store.set(`${ORIGIN}/js/sync-merge.js`, makeResponse('sync-merge-cacheado'));
    const js = await dispatch(sw.onFetch, { url: '/js/sync-merge.js' });
    check('recurso propio cacheado: se sirve desde la caché (caché primero)', js.intercepted && js.response.body === 'sync-merge-cacheado');

    const fresh = await dispatch(sw.onFetch, { url: '/manifest.json' });
    await new Promise(r => setImmediate(r));
    check('recurso propio sin caché: se pide a la red y se guarda', fresh.intercepted && fresh.response.body === `network:${ORIGIN}/manifest.json` && sw.caches.log.put.includes(`${ORIGIN}/manifest.json`));

    const lookalike = await dispatch(sw.onFetch, { url: '/js/api-helpers.js' });
    check('una ruta que solo "contiene" api (/js/api-helpers.js) sigue cacheándose', lookalike.intercepted === true);

    const post = await dispatch(sw.onFetch, { url: '/api/data', method: 'PUT' });
    check('peticiones no-GET no se interceptan (sin cambios)', post.intercepted === false);

    const external = await dispatch(sw.onFetch, { url: 'https://fonts.googleapis.com/css2?family=x' });
    check('peticiones de otro origen no se interceptan (sin cambios)', external.intercepted === false);
  }

  section('3. Precache y versiones');
  {
    const sw = loadSW();
    const precache = vm.runInContext('PRECACHE_URLS', sw.context);
    check('PRECACHE_URLS no incluye ninguna ruta /api/', Array.isArray(precache) && precache.every(u => !u.startsWith('/api/')));

    const cacheVersion = (swSrc.match(/const CACHE_VERSION = 'v([^']+)';/) || [])[1];
    const appVersion = (html.match(/const APP_VERSION = '([^']+)';/) || [])[1];
    check(`CACHE_VERSION (v${cacheVersion}) y APP_VERSION (${appVersion}) existen`, !!cacheVersion && !!appVersion);
    check('CACHE_VERSION y APP_VERSION están alineadas', cacheVersion === appVersion);
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
