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