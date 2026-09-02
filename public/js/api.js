// public/js/api.js
//
// Capa mínima para hablar con las rutas /api/* del backend.
// No guarda nada en localStorage ni maneja cookies a mano: el navegador
// se encarga de mandar la cookie de sesión sola en cada petición, gracias
// a "credentials: 'include'". Esto encaja con cómo está hecho lib/auth.js
// (cookie firmada, HttpOnly), así que el frontend nunca toca la sesión
// directamente, solo pregunta al backend.

const API_BASE = '/api';

// Función interna: hace la petición fetch, añade las cabeceras/cookies
// necesarias, y convierte la respuesta en un objeto { ok, status, data }
// fácil de usar desde el resto del código, sin tener que repetir
// try/catch ni "response.json()" en cada sitio.
async function apiRequest(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    credentials: 'include', // manda y recibe la cookie de sesión
    headers: {},
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(API_BASE + path, options);
  } catch (networkError) {
    // El servidor no responde (apagado, sin conexión, etc.)
    return { ok: false, status: 0, data: { error: 'No se pudo conectar con el servidor.' } };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    data = null; // respuesta vacía o no-JSON, no pasa nada
  }

  return { ok: response.ok, status: response.status, data };
}

// --- Funciones concretas de autenticación ---
// Cada una llama a un endpoint que ya probamos por terminal (paso 8-13).

async function apiRegister(username, password) {
  return apiRequest('/auth/register', { method: 'POST', body: { username, password } });
}

async function apiLogin(username, password) {
  return apiRequest('/auth/login', { method: 'POST', body: { username, password } });
}

async function apiLogout() {
  return apiRequest('/auth/logout', { method: 'POST' });
}

async function apiSession() {
  return apiRequest('/auth/session', { method: 'GET' });
}

async function apiGetData(type) {
  return apiRequest('/data?type=' + encodeURIComponent(type), { method: 'GET' });
}

async function apiSaveData(type, data) {
  return apiRequest('/data', { method: 'POST', body: { type, data } });
}

// Exportar/backup (16.2.8): a diferencia del resto de funciones de este
// archivo, aquí no usamos apiRequest porque esa función siempre intenta
// parsear la respuesta como JSON y devolver { ok, status, data }. Para una
// descarga necesitamos el Blob "en crudo" tal cual lo manda el servidor
// (con su cabecera Content-Disposition), así que hacemos el fetch a mano,
// pero manteniendo el mismo "credentials: 'include'" para mandar la cookie
// de sesión.
async function apiExportarDatos() {
  let response;
  try {
    response = await fetch(API_BASE + '/export', {
      method: 'GET',
      credentials: 'include',
    });
  } catch (networkError) {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }

  if (!response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch (parseError) {
      data = null;
    }
    return { ok: false, error: (data && data.error) || 'No se pudo exportar los datos.' };
  }

  const blob = await response.blob();

  // Recupera el nombre de archivo que puso el servidor (Content-Disposition:
  // attachment; filename="..."), para no tener que reconstruirlo aquí.
  let filename = 'organizator-backup.json';
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  if (match) filename = match[1];

  return { ok: true, blob, filename };
}