/**
 * ORGANIZATOR — Tests de R-2 (cálculo de próximas ocurrencias de recurrencia)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el bloque "RECURRENCIA — cálculo de próximas
 * ocurrencias (Fase R-2)" (isDateInRecurrence, getNextRecurrenceDate y
 * sus helpers internos), que vive dentro del mismo bloque SANEAMIENTO DE
 * EVENTOS/CATEGORÍAS IMPORTADOS que ya usa test-recurrence-model.js (R-1),
 * porque depende de sanitizeRecurrence/RECURRENCE_TYPES/isValidYMDDate
 * definidos justo antes. También extrae UTILIDADES DE FECHA (pad,
 * parseYMD, dowOfDate, addDays, getWeekMonday), de las que R-2 depende
 * directamente y que ya usa el resto de la suite (test-semana-ia-proposals.js).
 *
 * Esta fase (R-2) SOLO calcula: no crea ocurrencias ni copias de
 * tareas/eventos, no muta `recurrence` ni `state`, no toca
 * Scheduler/recordatorios/IA/UI. Por eso esta suite tampoco los testea.
 *
 * Uso:  node js/test-recurrence-r2.js
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
// UTILIDADES DE FECHA (pad, parseYMD, dowOfDate, addDays, getWeekMonday...)
// de las que depende directamente el bloque R-2.
// ---------------------------------------------------------------------
const dateUtilsSrc = extractBetween(
  html,
  '/* ==================================================================\n   UTILIDADES DE FECHA',
  '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS',
  'bloque UTILIDADES DE FECHA'
);
// dowOfDate/getWeekMonday viven en el bloque HORARIOS BLOQUEADOS / VISTA
// SEMANA, justo después del anterior; se extraen juntos porque R-2 los usa.
const weekHelpersSrc = extractBetween(
  html,
  'function dowOfDate(dateStr){',
  '\nfunction weekGoForward(){',
  'helpers dowOfDate/getWeekMonday'
);

// ---------------------------------------------------------------------
// Bloque real de saneamiento + recurrencia R-1 + cálculo de ocurrencias
// R-2 (isDateInRecurrence, getNextRecurrenceDate y helpers internos).
// Mismo rango que ya extrae test-recurrence-model.js (R-1).
// ---------------------------------------------------------------------
const recurrenceSrc = extractBetween(
  html,
  '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS',
  '\n\nfunction initSettingsDataIO(){',
  'bloque SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS (incluye RECURRENCIA R-1 y R-2)'
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
  sandbox.window = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(dateUtilsSrc, sandbox, { filename: 'organizator.html (utilidades de fecha)' });
  vm.runInContext(weekHelpersSrc, sandbox, { filename: 'organizator.html (dowOfDate/getWeekMonday)' });
  vm.runInContext(recurrenceSrc, sandbox, { filename: 'organizator.html (saneamiento + recurrencia R-1/R-2)' });
  vm.runInContext(
    `this.isDateInRecurrence = isDateInRecurrence;
     this.getNextRecurrenceDate = getNextRecurrenceDate;
     this.sanitizeRecurrence = sanitizeRecurrence;`,
    sandbox, { filename: 'expose-recurrence-R2' }
  );
  return sandbox;
}

const sb = makeSandbox();

// Recurrencias base reutilizables entre tests.
const daily1 = { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null };
const daily3 = { type: 'daily', interval: 3, daysOfWeek: [], startDate: '2026-09-01', endDate: null };
// 2026-09-07 es lunes (dow 0); lunes/miércoles/viernes = [0,2,4].
const weeklyOnce = { type: 'weekly', interval: 1, daysOfWeek: [], startDate: '2026-09-07', endDate: null };
const weeklyMWF = { type: 'weekly', interval: 1, daysOfWeek: [0, 2, 4], startDate: '2026-09-07', endDate: null };
const weeklyMWFx2 = { type: 'weekly', interval: 2, daysOfWeek: [0, 2, 4], startDate: '2026-09-07', endDate: null };
const monthlyOnce = { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-09-15', endDate: null };
const monthlyx2 = { type: 'monthly', interval: 2, daysOfWeek: [], startDate: '2026-01-15', endDate: null };
const monthlyDay31 = { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-01-31', endDate: null };

// =====================================================================
section('1) daily cada día');
// =====================================================================
{
  check('1. 01/09 es ocurrencia', sb.isDateInRecurrence('2026-09-01', daily1) === true);
  check('1. 02/09 es ocurrencia', sb.isDateInRecurrence('2026-09-02', daily1) === true);
  check('1. 15/09 es ocurrencia', sb.isDateInRecurrence('2026-09-15', daily1) === true);
}

// =====================================================================
section('2) daily cada 3 días');
// =====================================================================
{
  check('2. 01/09 es ocurrencia (día 0)', sb.isDateInRecurrence('2026-09-01', daily3) === true);
  check('2. 04/09 es ocurrencia (día 3)', sb.isDateInRecurrence('2026-09-04', daily3) === true);
  check('2. 07/09 es ocurrencia (día 6)', sb.isDateInRecurrence('2026-09-07', daily3) === true);
  check('2. 10/09 es ocurrencia (día 9)', sb.isDateInRecurrence('2026-09-10', daily3) === true);
  check('2. 02/09 NO es ocurrencia', sb.isDateInRecurrence('2026-09-02', daily3) === false);
  check('2. 03/09 NO es ocurrencia', sb.isDateInRecurrence('2026-09-03', daily3) === false);
  check('2. 05/09 NO es ocurrencia', sb.isDateInRecurrence('2026-09-05', daily3) === false);
}

// =====================================================================
section('3) daily con fecha anterior al startDate');
// =====================================================================
{
  check('3. el día anterior a startDate nunca es ocurrencia', sb.isDateInRecurrence('2026-08-31', daily1) === false);
  check('3. tampoco lo es con interval > 1', sb.isDateInRecurrence('2026-08-01', daily3) === false);
}

// =====================================================================
section('4) daily después de endDate');
// =====================================================================
{
  const withEnd = { ...daily1, endDate: '2026-09-10' };
  check('4. endDate incluido sí es ocurrencia', sb.isDateInRecurrence('2026-09-10', withEnd) === true);
  check('4. el día siguiente a endDate ya NO es ocurrencia', sb.isDateInRecurrence('2026-09-11', withEnd) === false);
  check('4. mucho después de endDate tampoco', sb.isDateInRecurrence('2026-12-01', withEnd) === false);
}

// =====================================================================
section('5) weekly cada semana (sin daysOfWeek → mismo día que startDate)');
// =====================================================================
{
  check('5. startDate (lunes) es ocurrencia', sb.isDateInRecurrence('2026-09-07', weeklyOnce) === true);
  check('5. lunes siguiente es ocurrencia', sb.isDateInRecurrence('2026-09-14', weeklyOnce) === true);
  check('5. martes de esa semana NO es ocurrencia', sb.isDateInRecurrence('2026-09-08', weeklyOnce) === false);
}

// =====================================================================
section('6) weekly cada 2 semanas (sin daysOfWeek)');
// =====================================================================
{
  const w2 = { ...weeklyOnce, interval: 2 };
  check('6. semana 0 (startDate) es ocurrencia', sb.isDateInRecurrence('2026-09-07', w2) === true);
  check('6. semana 1 (siguiente lunes) NO es ocurrencia', sb.isDateInRecurrence('2026-09-14', w2) === false);
  check('6. semana 2 (dos lunes después) sí es ocurrencia', sb.isDateInRecurrence('2026-09-21', w2) === true);
}

// =====================================================================
section('7) weekly con varios días (lunes, miércoles, viernes)');
// =====================================================================
{
  check('7. lunes 07/09 es ocurrencia', sb.isDateInRecurrence('2026-09-07', weeklyMWF) === true);
  check('7. miércoles 09/09 es ocurrencia', sb.isDateInRecurrence('2026-09-09', weeklyMWF) === true);
  check('7. viernes 11/09 es ocurrencia', sb.isDateInRecurrence('2026-09-11', weeklyMWF) === true);
  check('7. martes 08/09 NO es ocurrencia', sb.isDateInRecurrence('2026-09-08', weeklyMWF) === false);
  check('7. jueves 10/09 NO es ocurrencia', sb.isDateInRecurrence('2026-09-10', weeklyMWF) === false);
  check('7. domingo 06/09 (antes de startDate) NO es ocurrencia', sb.isDateInRecurrence('2026-09-06', weeklyMWF) === false);
}

// =====================================================================
section('8) weekly con intervalo > 1 y varios días');
// =====================================================================
{
  check('8. lunes semana 0 es ocurrencia', sb.isDateInRecurrence('2026-09-07', weeklyMWFx2) === true);
  check('8. miércoles semana 0 es ocurrencia', sb.isDateInRecurrence('2026-09-09', weeklyMWFx2) === true);
  check('8. viernes semana 0 es ocurrencia', sb.isDateInRecurrence('2026-09-11', weeklyMWFx2) === true);
  check('8. lunes semana 1 (impar) NO es ocurrencia — el intervalo se respeta', sb.isDateInRecurrence('2026-09-14', weeklyMWFx2) === false);
  check('8. miércoles semana 1 (impar) NO es ocurrencia', sb.isDateInRecurrence('2026-09-16', weeklyMWFx2) === false);
  check('8. viernes semana 1 (impar) NO es ocurrencia', sb.isDateInRecurrence('2026-09-18', weeklyMWFx2) === false);
  check('8. lunes semana 2 (par) sí es ocurrencia', sb.isDateInRecurrence('2026-09-21', weeklyMWFx2) === true);
  check('8. miércoles semana 2 (par) sí es ocurrencia', sb.isDateInRecurrence('2026-09-23', weeklyMWFx2) === true);
}

// =====================================================================
section('9) monthly cada mes');
// =====================================================================
{
  check('9. startDate (15/09) es ocurrencia', sb.isDateInRecurrence('2026-09-15', monthlyOnce) === true);
  check('9. 15/10 es ocurrencia (mes siguiente)', sb.isDateInRecurrence('2026-10-15', monthlyOnce) === true);
  check('9. 15/11 es ocurrencia', sb.isDateInRecurrence('2026-11-15', monthlyOnce) === true);
  check('9. 14/10 NO es ocurrencia (día distinto)', sb.isDateInRecurrence('2026-10-14', monthlyOnce) === false);
  check('9. 15/10 NO es ocurrencia si es antes de startDate (control: aquí no aplica, ya cubierto arriba)', true);
}

// =====================================================================
section('10) monthly cada 2 meses');
// =====================================================================
{
  check('10. startDate (15/01) es ocurrencia', sb.isDateInRecurrence('2026-01-15', monthlyx2) === true);
  check('10. 15/02 (mes 1, impar) NO es ocurrencia', sb.isDateInRecurrence('2026-02-15', monthlyx2) === false);
  check('10. 15/03 (mes 2, par) es ocurrencia', sb.isDateInRecurrence('2026-03-15', monthlyx2) === true);
  check('10. 15/05 (mes 4, par) es ocurrencia', sb.isDateInRecurrence('2026-05-15', monthlyx2) === true);
}

// =====================================================================
section('11) cambio de año');
// =====================================================================
{
  const daily = { type: 'daily', interval: 1, daysOfWeek: [], startDate: '2026-12-30', endDate: null };
  check('11. 31/12/2026 es ocurrencia', sb.isDateInRecurrence('2026-12-30', daily) === true);
  check('11. 01/01/2027 (cambio de año) es ocurrencia', sb.isDateInRecurrence('2027-01-01', daily) === true);
  check('11. getNextRecurrenceDate cruza el año correctamente', sb.getNextRecurrenceDate('2026-12-31', daily) === '2027-01-01');

  const monthly = { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-11-15', endDate: null };
  check('11b. monthly 15/12/2026 es ocurrencia', sb.isDateInRecurrence('2026-12-15', monthly) === true);
  check('11b. monthly 15/01/2027 (cambio de año) es ocurrencia', sb.isDateInRecurrence('2027-01-15', monthly) === true);
}

// =====================================================================
section('12) febrero');
// =====================================================================
{
  // startDate 31/01/2026 (no bisiesto): febrero de destino solo tiene 28
  // días, así que la ocurrencia de ese mes se recorta a 28/02 (ver R-2 en
  // el código: se usa el último día del mes de destino, sin inventar otra
  // fecha ni lanzar).
  check('12. 28/02/2026 es la ocurrencia recortada de "31 de enero"', sb.isDateInRecurrence('2026-02-28', monthlyDay31) === true);
  check('12. 27/02/2026 NO es ocurrencia', sb.isDateInRecurrence('2026-02-27', monthlyDay31) === false);
  check('12. 01/03/2026 NO es ocurrencia (ese mes es de intervalo, no éste)', sb.isDateInRecurrence('2026-03-01', monthlyDay31) === false);
  // El mes siguiente (marzo, con 31 días) vuelve a usar el día original
  // de startDate: el recorte de febrero no "contamina" los meses futuros.
  check('12. 31/03/2026 es ocurrencia (marzo sí tiene 31 días)', sb.isDateInRecurrence('2026-03-31', monthlyDay31) === true);
}

// =====================================================================
section('13) año bisiesto');
// =====================================================================
{
  // 2028 es bisiesto: startDate 31/01/2028 recorta a 29/02/2028 (no 28).
  const monthlyDay31Leap = { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2028-01-31', endDate: null };
  check('13. 2028 es año bisiesto (control)', new Date(2028, 1, 29).getMonth() === 1);
  check('13. 29/02/2028 es la ocurrencia recortada en año bisiesto', sb.isDateInRecurrence('2028-02-29', monthlyDay31Leap) === true);
  check('13. 28/02/2028 NO es ocurrencia en año bisiesto (sí existe el 29)', sb.isDateInRecurrence('2028-02-28', monthlyDay31Leap) === false);
  check('13. getNextRecurrenceDate desde 31/01/2028 da 29/02/2028', sb.getNextRecurrenceDate('2028-01-31', monthlyDay31Leap) === '2028-02-29');
}

// =====================================================================
section('14) endDate');
// =====================================================================
{
  const withEnd = { ...weeklyMWF, endDate: '2026-09-11' };
  check('14. ocurrencia justo en endDate es válida (endDate incluido)', sb.isDateInRecurrence('2026-09-11', withEnd) === true);
  check('14. ocurrencia posterior a endDate ya no es válida', sb.isDateInRecurrence('2026-09-14', withEnd) === false);
  check('14. getNextRecurrenceDate no devuelve nada más allá de endDate', sb.getNextRecurrenceDate('2026-09-11', withEnd) === null);
  check('14. endDate === null no limita nada (control)', sb.isDateInRecurrence('2027-09-10', weeklyMWF) === true);
}

// =====================================================================
section('15) fecha que no pertenece a una recurrencia');
// =====================================================================
{
  check('15. día suelto fuera de patrón daily cada 3 días', sb.isDateInRecurrence('2026-09-05', daily3) === false);
  check('15. día suelto fuera de patrón weekly (martes en L/X/V)', sb.isDateInRecurrence('2026-09-15', weeklyMWF) === false);
  check('15. día suelto fuera de patrón monthly (día distinto)', sb.isDateInRecurrence('2026-10-16', monthlyOnce) === false);
}

// =====================================================================
section('16) getNextRecurrenceDate');
// =====================================================================
{
  check('16. daily: siguiente tras la primera ocurrencia', sb.getNextRecurrenceDate('2026-09-01', daily3) === '2026-09-04');
  check('16. daily: desde una fecha anterior a startDate devuelve startDate', sb.getNextRecurrenceDate('2026-08-01', daily3) === '2026-09-01');
  check('16. weekly: siguiente día activo dentro de la misma semana', sb.getNextRecurrenceDate('2026-09-07', weeklyMWF) === '2026-09-09');
  check('16. weekly: salta a la semana siguiente tras el último día activo', sb.getNextRecurrenceDate('2026-09-11', weeklyMWF) === '2026-09-14');
  check('16. weekly con intervalo: salta la semana inactiva', sb.getNextRecurrenceDate('2026-09-11', weeklyMWFx2) === '2026-09-21');
  check('16. monthly: siguiente mes con recorte de día (31→28)', sb.getNextRecurrenceDate('2026-01-31', monthlyDay31) === '2026-02-28');
  check('16. monthly: tras el recorte, el mes siguiente recupera el día original', sb.getNextRecurrenceDate('2026-02-28', monthlyDay31) === '2026-03-31');
  check('16. la fecha devuelta es siempre estrictamente posterior a la pasada', sb.getNextRecurrenceDate('2026-09-07', weeklyMWF) > '2026-09-07');
}

// =====================================================================
section('17) recurrencia inválida → resultado seguro (sin lanzar)');
// =====================================================================
{
  check('17. isDateInRecurrence(fecha, null) → false', sb.isDateInRecurrence('2026-09-01', null) === false);
  check('17. isDateInRecurrence(fecha, undefined) → false', sb.isDateInRecurrence('2026-09-01', undefined) === false);
  // R-1.6: 'yearly' ya es un type válido, así que se usa 'annual'
  // (inexistente) para seguir probando un type realmente desconocido.
  check('17. isDateInRecurrence con type inválido → false', sb.isDateInRecurrence('2026-09-01', { ...daily1, type: 'annual' }) === false);
  check('17. isDateInRecurrence con interval inválido → false', sb.isDateInRecurrence('2026-09-01', { ...daily1, interval: 0 }) === false);
  check('17. isDateInRecurrence con startDate inválida → false', sb.isDateInRecurrence('2026-09-01', { ...daily1, startDate: 'no-es-fecha' }) === false);
  check('17. isDateInRecurrence con fecha inválida → false', sb.isDateInRecurrence('no-es-fecha', daily1) === false);
  check('17. getNextRecurrenceDate(fecha, null) → null', sb.getNextRecurrenceDate('2026-09-01', null) === null);
  check('17. getNextRecurrenceDate con recurrencia inválida → null', sb.getNextRecurrenceDate('2026-09-01', { ...daily1, type: 'annual' }) === null);
  check('17. getNextRecurrenceDate con fecha inválida → null', sb.getNextRecurrenceDate('no-es-fecha', daily1) === null);
  check('17. ninguna de las llamadas anteriores lanza una excepción (si llegamos aquí, es así)', true);
}

// =====================================================================
section('18) no mutación del objeto `recurrence`');
// =====================================================================
{
  const original = { type: 'weekly', interval: 2, daysOfWeek: [0, 2, 4], startDate: '2026-09-07', endDate: '2026-12-31' };
  const snapshot = JSON.stringify(original);
  sb.isDateInRecurrence('2026-09-21', original);
  check('18. isDateInRecurrence no muta recurrence', JSON.stringify(original) === snapshot);
  sb.getNextRecurrenceDate('2026-09-21', original);
  check('18. getNextRecurrenceDate no muta recurrence', JSON.stringify(original) === snapshot);
  sb.isDateInRecurrence('2026-09-21', monthlyDay31);
  sb.getNextRecurrenceDate('2026-01-31', monthlyDay31);
  check('18. tampoco se muta una recurrencia monthly reutilizada entre llamadas', JSON.stringify(monthlyDay31) === JSON.stringify({ type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-01-31', endDate: null }));
}

// =====================================================================
section('19) no modificación de `state`');
// =====================================================================
{
  // R-2 son helpers puros que ni siquiera reciben `state`: esta sandbox no
  // define `state` en absoluto (a diferencia de test-recurrence-model.js,
  // que sí lo necesita para probar addTask/updateTask/addEvent/updateEvent
  // de R-1). Si isDateInRecurrence/getNextRecurrenceDate tocaran `state`
  // global, esto lanzaría un ReferenceError en vez de devolver un valor.
  let threw = false;
  try {
    sb.isDateInRecurrence('2026-09-07', weeklyMWF);
    sb.getNextRecurrenceDate('2026-09-07', weeklyMWF);
  } catch (e) { threw = true; }
  check('19. ninguna de las dos funciones toca/lee `state` (no existe en esta sandbox y no falla)', threw === false);
  check('19. `state` sigue sin existir en la sandbox tras las llamadas', typeof sb.state === 'undefined');
}

// =====================================================================
section('20) node --check sobre el <script> principal de organizator.html');
// =====================================================================
{
  const scriptStartMarker = '\n<script>\n';
  const scriptEndMarker = '\n</script>';
  const scriptStart = html.indexOf(scriptStartMarker);
  if (scriptStart === -1) throw new Error('No se encontró el <script> principal de organizator.html');
  const scriptEnd = html.indexOf(scriptEndMarker, scriptStart + scriptStartMarker.length);
  if (scriptEnd === -1) throw new Error('No se encontró el cierre del <script> principal de organizator.html');
  const scriptBlock = html.slice(scriptStart + scriptStartMarker.length, scriptEnd);
  const tmpPath = path.join(require('os').tmpdir(), `organizator-recurrence-r2-check-${process.pid}.js`);
  fs.writeFileSync(tmpPath, scriptBlock, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
    check('20. node --check del <script> principal de organizator.html pasa (sintaxis válida)', true);
  } catch (e) {
    check('20. node --check del <script> principal de organizator.html pasa (sintaxis válida)', false);
    console.log(String(e.stderr || e.message));
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

console.log(`\n${pass} pasaron, ${fail} fallaron.`);
process.exit(fail > 0 ? 1 : 0);
