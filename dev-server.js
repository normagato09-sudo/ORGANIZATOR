// dev-server.js — SOLO para pruebas locales del aislamiento entre cuentas.
// Imita cómo Vercel invoca las funciones de api/ (rellena req.body y req.query
// antes de llamarlas), usando el mismo lib/kv.js (fichero JSON local, ya que
// no hay KV_REST_API_URL definida) y el mismo lib/auth.js que en producción.

const http = require('http');
const { URL } = require('url');

const routes = {
  'POST /api/auth/register': require('./api/auth/register'),
  'POST /api/auth/login': require('./api/auth/login'),
  'POST /api/auth/logout': require('./api/auth/logout'),
  'GET /api/auth/session': require('./api/auth/session'),
  'POST /api/auth/change-password': require('./api/auth/change-password'),
  'POST /api/auth/recover': require('./api/auth/recover'),
  'GET /api/data': require('./api/data'),
  'POST /api/data': require('./api/data'),
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const key = req.method + ' ' + u.pathname;
  const handler = routes[key];

  req.query = Object.fromEntries(u.searchParams.entries());

  let chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }

    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };

    if (!handler) { res.statusCode = 404; res.end('not found'); return; }
    Promise.resolve(handler(req, res)).catch((e) => {
      console.error(e);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'internal error' }));
    });
  });
});

server.listen(3000, () => console.log('dev server on http://localhost:3000'));
