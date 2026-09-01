// dev-server.js
//
// Servidor mínimo SOLO para desarrollo local. No añade ninguna funcionalidad
// nueva a la app: su único trabajo es "hacer de Vercel" en tu máquina, para
// que los endpoints que ya existen en api/ (que están escritos con el estilo
// de función serverless de Vercel: module.exports = async (req, res) => {...},
// usando req.query, req.body y res.status().json()) se puedan probar con
// `npm run dev` sin necesidad de instalar ni configurar el CLI de Vercel.
//
// En producción (Vercel real) este archivo NO se usa para nada: Vercel
// detecta automáticamente cada fichero de api/ como una función y le
// proporciona él mismo req.query, req.body, res.status(), etc.
//
// Si más adelante existe una carpeta public/ con el frontend, este servidor
// también sirve esos ficheros estáticos. Mientras no exista, lo indica
// claramente en la consola y en la ruta "/".

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Mapa de rutas -> fichero de api/ ---------------------------------
// Refleja el mismo enrutado por convención que usa Vercel:
//   /api/data         -> api/data.js
//   /api/auth/login    -> api/auth/login.js
// Si añades un nuevo fichero en api/, añade aquí su ruta correspondiente.
const ROUTES = {
  '/api/data': './api/data.js',
  '/api/auth/login': './api/auth/login.js',
  '/api/auth/logout': './api/auth/logout.js',
  '/api/auth/register': './api/auth/register.js',
  '/api/auth/recover': './api/auth/recover.js',
  '/api/auth/session': './api/auth/session.js',
  '/api/auth/change-password': './api/auth/change-password.js',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function addResHelpers(res) {
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function json(body) {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(body));
    return res;
  };
  return res;
}

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(PUBLIC_DIR)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(
      'El frontend (carpeta public/) todavia no existe en este proyecto.\n' +
        'El backend (api/) esta disponible en /api/... para pruebas directas.'
    );
    return;
  }

  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname));
  if (pathname === '/' || pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  // Evita salir de public/ con rutas tipo "../../".
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 400;
    res.end('Ruta no válida.');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('No encontrado.');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  addResHelpers(res);

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  const routeFile = ROUTES[pathname];

  if (!routeFile) {
    // No es una ruta de api/ conocida: se sirve como estático (o el aviso
    // de que public/ aún no existe).
    serveStatic(req, res, pathname);
    return;
  }

  // req.query, igual que en Vercel.
  req.query = Object.fromEntries(parsedUrl.searchParams.entries());

  // req.body, igual que en Vercel: solo se parsea si el body es JSON.
  try {
    const rawBody = await readBody(req);
    if (rawBody.length > 0) {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        req.body = JSON.parse(rawBody.toString('utf8'));
      } else {
        req.body = rawBody.toString('utf8');
      }
    } else {
      req.body = {};
    }
  } catch (e) {
    res.status(400).json({ error: 'Cuerpo de la petición no válido (JSON mal formado).' });
    return;
  }

  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const handler = require(routeFile);
    // Cada vez que se modifique un fichero de api/ hace falta reiniciar
    // `npm run dev`, porque Node cachea los require(); es la misma
    // limitación de siempre en un servidor así de simple.
    await handler(req, res);
  } catch (e) {
    console.error(`[dev-server] Error en ${pathname}:`, e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error interno del servidor (ver consola).' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Servidor de desarrollo escuchando en http://localhost:${PORT}`);
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.log('[aviso] No existe la carpeta public/: el frontend todavía no está construido.');
    console.log('        Los endpoints de api/ ya se pueden probar en http://localhost:' + PORT + '/api/...');
  }
});
