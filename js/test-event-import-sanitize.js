/**
 * ORGANIZATOR — Tests de saneamiento de eventos/categorías importados
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente el bloque
 * "SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS" de organizator.html
 * (sanitizeImportedEvents, sanitizeImportedEventCategories) y lo ejecuta
 * aislado — mismo patrón que test-event-categories.js / test-event-allday-context.js.
 *
 * No se testea initSettingsDataIO() en sí (depende del DOM: input file,
 * confirm(), document.getElementById) — solo las funciones puras de
 * saneamiento que usa antes de tocar `state`, igual que el resto de la
 * suite evita DOM.
 *
 * Uso:  node js/test-event-import-sanitize.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// organizator.html se guarda con CRLF; se normaliza a LF solo para esta
// lectura (no se toca el archivo en disco) porque los marcadores de
// extractBetween de abajo usan '\n'.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Bloque real de "SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS" de
// organizator.html (sanitizeImportedEvents/sanitizeImportedEventCategories).
// ---------------------------------------------------------------------
const sanitizeSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

function makeSandbox() {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(sanitizeSrc, sandbox, { filename: 'organizator.html (saneamiento import eventos/categorías)' });
  vm.runInContext(
    `this.sanitizeImportedEvents = sanitizeImportedEvents;
     this.sanitizeImportedEventCategories = sanitizeImportedEventCategories;`,
    sandbox, { filename: 'expose-sanitize' }
  );
  return sandbox;
}

(() => {

  // =====================================================================
  section('1) Evento válido se conserva tal cual');
  // =====================================================================
  {
    const sb = makeSandbox();
    const input = [{ id: 'e1', title: 'Reunión', date: '2026-10-05', categoryId: 'catX', location: 'Sala 1', notes: 'traer portátil', allDay: true }];
    const { kept, discarded } = sb.sanitizeImportedEvents(input);
    check('1. el evento válido se conserva (1 elemento)', kept.length === 1);
    check('1. no se descarta nada', discarded === 0);
    check('1. conserva id/categoryId/location/notes/allDay exactos', kept[0].id === 'e1' && kept[0].categoryId === 'catX' &&
      kept[0].location === 'Sala 1' && kept[0].notes === 'traer portátil' && kept[0].allDay === true);
  }

  // =====================================================================
  section('2) Evento sin title se descarta');
  // =====================================================================
  {
    const sb = makeSandbox();
    const { kept, discarded } = sb.sanitizeImportedEvents([{ date: '2026-10-05' }, { title: '   ', date: '2026-10-05' }]);
    check('2. evento sin title se descarta', kept.length === 0);
    check('2. evento con title solo espacios también se descarta (no vacío tras trim)', discarded === 2);
  }

  // =====================================================================
  section('3) Evento sin date se descarta');
  // =====================================================================
  {
    const sb = makeSandbox();
    const { kept, discarded } = sb.sanitizeImportedEvents([{ title: 'Cita' }]);
    check('3. evento sin date se descarta', kept.length === 0 && discarded === 1);
  }

  // =====================================================================
  section('4) Evento con date en formato inválido se descarta');
  // =====================================================================
  {
    const sb = makeSandbox();
    const cases = [
      { title: 'A', date: '05-10-2026' },
      { title: 'B', date: '2026/10/05' },
      { title: 'C', date: '2026-10-5' },
      { title: 'D', date: 20261005 },
      { title: 'E', date: '' },
    ];
    const { kept, discarded } = sb.sanitizeImportedEvents(cases);
    check('4. ninguna fecha con formato distinto de YYYY-MM-DD se conserva', kept.length === 0);
    check('4. las 5 se descartan', discarded === 5);
  }

  // =====================================================================
  section('4b) Evento con formato YYYY-MM-DD correcto pero fecha de calendario IMPOSIBLE se descarta');
  // =====================================================================
  {
    const sb = makeSandbox();
    // Con new Date(y, m-1, d) estas fechas "desbordan" a otro mes/día en
    // vez de lanzar — por eso no basta con el regex de formato, hace
    // falta comprobar que el resultado siga siendo el mismo y/m/d pedido.
    const imposibles = [
      { title: 'Sin 31 de febrero', date: '2026-02-31' },     // febrero nunca tiene 31 días
      { title: 'Sin mes 13', date: '2026-13-01' },             // no existe el mes 13
      { title: 'Sin mes 00', date: '2026-00-10' },             // no existe el mes 0
      { title: 'Sin 31 de abril', date: '2026-04-31' },        // abril tiene 30 días
      { title: '29 feb en año NO bisiesto', date: '2026-02-29' }, // 2026 no es bisiesto
      { title: 'Día 00', date: '2026-05-00' },                 // no existe el día 0
      { title: 'Día 32', date: '2026-05-32' },                 // ningún mes tiene 32 días
    ];
    const { kept, discarded } = sb.sanitizeImportedEvents(imposibles);
    check('4b. ninguna fecha de calendario imposible se conserva, aunque el formato sea correcto', kept.length === 0);
    check('4b. las 7 fechas imposibles se descartan', discarded === 7);

    // Control positivo: una fecha bisiesta REAL en un año bisiesto real
    // sí debe aceptarse (para confirmar que no se ha vuelto demasiado
    // estricto y sigue aceptando fechas de calendario válidas).
    const { kept: keptLeap, discarded: discardedLeap } = sb.sanitizeImportedEvents([{ title: '29 feb en año bisiesto', date: '2024-02-29' }]);
    check('4b. 29 de febrero en un año bisiesto real (2024) SÍ se conserva', keptLeap.length === 1 && discardedLeap === 0);
  }

  // =====================================================================
  section('5) allDay no booleano se normaliza a false');
  // =====================================================================
  {
    const sb = makeSandbox();
    const { kept } = sb.sanitizeImportedEvents([
      { title: 'Ev1', date: '2026-10-05', allDay: 'true' },
      { title: 'Ev2', date: '2026-10-05', allDay: 1 },
      { title: 'Ev3', date: '2026-10-05' }, // ausente
      { title: 'Ev4', date: '2026-10-05', allDay: false },
      { title: 'Ev5', date: '2026-10-05', allDay: true },
    ]);
    check('5. allDay string se normaliza a false', kept[0].allDay === false);
    check('5. allDay numérico se normaliza a false', kept[1].allDay === false);
    check('5. allDay ausente se normaliza a false', kept[2].allDay === false);
    check('5. allDay:false explícito se conserva como false', kept[3].allDay === false);
    check('5. allDay:true (booleano real) se conserva intacto', kept[4].allDay === true);
  }

  // =====================================================================
  section('6) notes/location no string se normalizan a \'\'');
  // =====================================================================
  {
    const sb = makeSandbox();
    const { kept } = sb.sanitizeImportedEvents([
      { title: 'Ev1', date: '2026-10-05', notes: 123, location: null },
      { title: 'Ev2', date: '2026-10-05' }, // ambos ausentes
      { title: 'Ev3', date: '2026-10-05', notes: 'ok', location: 'Aquí' },
    ]);
    check('6. notes numérico → \'\'', kept[0].notes === '');
    check('6. location null → \'\'', kept[0].location === '');
    check('6. notes/location ausentes → \'\'', kept[1].notes === '' && kept[1].location === '');
    check('6. notes/location string válidos se conservan intactos', kept[2].notes === 'ok' && kept[2].location === 'Aquí');
  }

  // =====================================================================
  section('7) Categoría válida se conserva con sus valores');
  // =====================================================================
  {
    const sb = makeSandbox();
    const input = [{ id: 'c1', name: 'Trabajo', color: '#123456', icon: '💼', blocksSchedule: false }];
    const { kept, discarded } = sb.sanitizeImportedEventCategories(input);
    check('7. la categoría válida se conserva', kept.length === 1 && discarded === 0);
    check('7. conserva id/color/icon/blocksSchedule exactos', kept[0].id === 'c1' && kept[0].color === '#123456' &&
      kept[0].icon === '💼' && kept[0].blocksSchedule === false);
  }

  // =====================================================================
  section('8) Categoría sin name se descarta');
  // =====================================================================
  {
    const sb = makeSandbox();
    const { kept, discarded } = sb.sanitizeImportedEventCategories([{ color: '#000' }, { name: '   ', color: '#111' }]);
    check('8. categoría sin name se descarta', kept.length === 0);
    check('8. categoría con name solo espacios también se descarta', discarded === 2);
  }

  // =====================================================================
  section('9) categoryId huérfano se conserva exactamente, sin limpiarlo ni corregirlo');
  // =====================================================================
  {
    const sb = makeSandbox();
    // Ninguna categoría "no-existe" se importa junto a este evento —
    // sanitizeImportedEvents no conoce ni consulta eventCategories.
    const { kept } = sb.sanitizeImportedEvents([{ id: 'e1', title: 'Cita', date: '2026-10-05', categoryId: 'no-existe' }]);
    check('9. categoryId huérfano se conserva tal cual (no se borra ni se sustituye)', kept[0].categoryId === 'no-existe');
  }

  // =====================================================================
  section('10) Contadores kept/discarded correctos en un array mixto');
  // =====================================================================
  {
    const sb = makeSandbox();
    const eventsInput = [
      { title: 'Válido 1', date: '2026-10-01' },
      { date: '2026-10-02' },              // sin title
      { title: 'Sin fecha' },              // sin date
      { title: 'Fecha mala', date: '02/10/2026' },
      { title: 'Válido 2', date: '2026-10-03' },
    ];
    const eventsResult = sb.sanitizeImportedEvents(eventsInput);
    check('10. eventos: 2 conservados, 3 descartados', eventsResult.kept.length === 2 && eventsResult.discarded === 3);
    check('10. eventos: se conservan justo los dos válidos, en orden', eventsResult.kept[0].title === 'Válido 1' && eventsResult.kept[1].title === 'Válido 2');

    const categoriesInput = [
      { name: 'Cat 1' },
      { color: '#fff' },        // sin name
      { name: 'Cat 2' },
    ];
    const categoriesResult = sb.sanitizeImportedEventCategories(categoriesInput);
    check('10. categorías: 2 conservadas, 1 descartada', categoriesResult.kept.length === 2 && categoriesResult.discarded === 1);
  }

  // =====================================================================
  section('11) El saneamiento no modifica otros datos válidos');
  // =====================================================================
  {
    const sb = makeSandbox();
    const originalEvent = { id: 'e1', title: 'Reunión', date: '2026-10-05', startTime: '10:00', endTime: '11:00', categoryId: 'catX', location: 'Sala', notes: 'nota' };
    const snapshot = JSON.stringify(originalEvent);
    const { kept } = sb.sanitizeImportedEvents([originalEvent]);
    check('11. el objeto de entrada no se muta (misma serialización antes/después)', JSON.stringify(originalEvent) === snapshot);
    check('11. el evento conservado tiene exactamente los mismos valores que el original',
      kept[0].id === originalEvent.id && kept[0].title === originalEvent.title && kept[0].date === originalEvent.date &&
      kept[0].startTime === '10:00' && kept[0].endTime === '11:00' && kept[0].categoryId === 'catX' &&
      kept[0].location === 'Sala' && kept[0].notes === 'nota');

    const originalCategory = { id: 'c1', name: 'Ocio', color: '#4477AA', icon: '🎮', blocksSchedule: true };
    const catSnapshot = JSON.stringify(originalCategory);
    const { kept: keptCats } = sb.sanitizeImportedEventCategories([originalCategory]);
    check('11. la categoría de entrada no se muta', JSON.stringify(originalCategory) === catSnapshot);
    check('11. la categoría conservada tiene exactamente los mismos valores que la original',
      keptCats[0].id === 'c1' && keptCats[0].name === 'Ocio' && keptCats[0].color === '#4477AA' &&
      keptCats[0].icon === '🎮' && keptCats[0].blocksSchedule === true);
  }

  // =====================================================================
  section('12) node --check sobre el <script> principal de organizator.html');
  // =====================================================================
  {
    // organizator.html no es un .js, así que node --check no puede apuntar
    // directamente al archivo: se extrae el <script> principal (el que
    // contiene el código tocado por este saneamiento) a un archivo
    // temporal y se comprueba su sintaxis con el mismo comando que ya usa
    // test-event-allday-context.js para scheduler.js.
    // A diferencia de extractBetween() (que incluye el propio marcador de
    // inicio a propósito, para bloques de comentario), aquí se necesita
    // el contenido SIN las etiquetas <script>/</script> para que sea JS
    // válido por sí solo.
    const scriptStartMarker = '\n<script>\n';
    const scriptEndMarker = '\n</script>';
    const scriptStart = html.indexOf(scriptStartMarker);
    if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
    const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
    if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
    const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
    const tmpPath = path.join(require('os').tmpdir(), `organizator-main-script-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('12. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
    } catch (e) {
      check('12. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
