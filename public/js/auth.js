// public/js/auth.js
//
// Lógica de la pantalla de login/registro: conecta los formularios del
// HTML con las funciones de api.js, y decide qué mostrar (formulario de
// acceso o la app ya dentro) según si hay sesión activa o no.
//
// Este archivo asume que api.js ya se ha cargado antes (por eso en
// index.html lo pondremos en ese orden: primero api.js, luego auth.js).

// Guarda en memoria el usuario actualmente conectado (o null si no hay).
// No se guarda en localStorage: la fuente de verdad es siempre la cookie
// de sesión, que comprobamos contra el servidor con apiSession().
let currentUser = null;

// Comprueba contra el servidor si ya hay una sesión activa (por ejemplo,
// si recargas la página y la cookie sigue siendo válida). Se llama al
// arrancar la app.
async function checkSession() {
  const result = await apiSession();
  currentUser = result.ok ? result.data.user : null;
  renderAuthState();
  return currentUser;
}

// Muestra la pantalla de login/registro o la app, según haya o no sesión.
// (Los elementos #auth-screen y #app-screen los añadiremos en index.html
// en el siguiente paso; aquí solo se referencian por su id.)
function renderAuthState() {
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const userLabel = document.getElementById('current-username');

  if (!authScreen || !appScreen) return; // por si este archivo se carga antes de tener el HTML

  if (currentUser) {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    if (userLabel) userLabel.textContent = currentUser.username;
    if (typeof loadPlannerData === 'function') loadPlannerData();
  } else {
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
  }
}

// Muestra un mensaje de error en la pantalla de login/registro.
function showAuthError(message) {
  const errorBox = document.getElementById('auth-error');
  if (!errorBox) return;
  errorBox.textContent = message || '';
  errorBox.classList.toggle('hidden', !message);
}

// --- Manejadores de los formularios (se enganchan en index.html) ---

async function handleRegisterSubmit(event) {
  event.preventDefault();
  showAuthError('');

  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;

  const result = await apiRegister(username, password);

  if (!result.ok) {
    showAuthError((result.data && result.data.error) || 'No se pudo completar el registro.');
    return;
  }

  // Avisamos del código de recuperación: es la única vez que se muestra,
  // así que hay que dejar constancia clara para el usuario.
  window.alert(
    'Cuenta creada. Guarda este código de recuperación en un lugar seguro, ' +
      'lo necesitarás si olvidas tu contraseña:\n\n' +
      result.data.recoveryCode
  );

  currentUser = result.data.user;
  renderAuthState();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  showAuthError('');

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  const result = await apiLogin(username, password);

  if (!result.ok) {
    showAuthError((result.data && result.data.error) || 'No se pudo iniciar sesión.');
    return;
  }

  currentUser = result.data.user;
  renderAuthState();
}

async function handleLogoutClick() {
  await apiLogout();
  currentUser = null;
  renderAuthState();
}