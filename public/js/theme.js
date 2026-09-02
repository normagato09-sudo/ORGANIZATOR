// public/js/theme.js
//
// Modo oscuro (16.2.9). Solo gestiona el tema visual: no toca datos,
// sesión ni ninguna otra función de la app. La preferencia se guarda
// en localStorage porque es un ajuste de este dispositivo/navegador,
// no un dato de usuario que deba sincronizarse en el backend.

(function () {
  var STORAGE_KEY = 'organizator-theme';

  // Se ejecuta inmediatamente, en el <head>, para aplicar el tema
  // guardado antes de que el navegador pinte la página y así evitar
  // el parpadeo (flash del tema claro seguido de un cambio a oscuro).
  var temaGuardado = localStorage.getItem(STORAGE_KEY);
  if (temaGuardado === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

// Actualiza el texto del botón según el tema activo.
function actualizarTextoBotonTema(boton) {
  var esOscuro = document.documentElement.getAttribute('data-theme') === 'dark';
  boton.textContent = esOscuro ? '☀️ Modo claro' : '🌙 Modo oscuro';
}

// Conecta el botón de la cabecera con el cambio de tema.
// Se llama desde index.html cuando arranca la app (igual que
// checkSession()), no antes: el botón todavía no existe en el DOM
// mientras el navegador solo ha cargado el <head>.
function initThemeToggle() {
  var boton = document.getElementById('theme-toggle-button');
  if (!boton) return;

  actualizarTextoBotonTema(boton);

  boton.addEventListener('click', function () {
    var esOscuroAhora = document.documentElement.getAttribute('data-theme') === 'dark';

    if (esOscuroAhora) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('organizator-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('organizator-theme', 'dark');
    }

    actualizarTextoBotonTema(boton);
  });
}
