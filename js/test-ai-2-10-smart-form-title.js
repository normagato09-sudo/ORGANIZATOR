/**
 * ORGANIZATOR — Tests de AI-2.10 (limpieza del título de los Smart Forms)
 *
 * Caso real que motivó esta fase: en el chat de IA, "pues hoy tengo que
 * hacer una tarea de mates" abría el formulario con el título "Pues tengo
 * que hacer una tarea de mates" (solo se quitaba "hoy"). Ahora, además de
 * las fechas/horas ya usadas, se quitan las muletillas y fórmulas de
 * relleno del PRINCIPIO ("pues", "tengo que", "hay que", "debo", "me
 * toca", "recuérdame"...), la primera letra va en mayúscula, y nunca queda
 * un título vacío (si solo había muletillas, se usa la frase original).
 *
 * Suite Node pura, SIN navegador. Mismo patrón que test-ai-2-1: extrae
 * literalmente de ai-actions.js los bloques AI-1.2..AI-1.5 + AI-2.1 y los
 * ejecuta en un sandbox `vm` (sin `state` ni DOM). Además carga el archivo
 * COMPLETO una vez para comprobar la API pública real (window.AIActions).
 *
 * Uso:  node js/test-ai-2-10-smart-form-title.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// ai-actions.js puede estar con CRLF en la copia local; los marcadores usan '\n'.
const aiActionsSrc = fs.readFileSync(path.join(ROOT, 'js', 'ai-actions.js'), 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" — ¿cambió el código?`);
  return source.slice(start, end);
}

const HEADER = '/* ==================================================================\n     ';
const NEXT = '\n\n  /* ==================================================================\n     ';
const datetimeSrc = extractBetween(aiActionsSrc, `${HEADER}AI-1.2`, `${NEXT}AI-1.3`, 'bloque AI-1.2');
const implicitEventSrc = extractBetween(aiActionsSrc, `${HEADER}AI-1.3`, `${NEXT}AI-1.4`, 'bloque AI-1.3');
const implicitTaskSrc = extractBetween(aiActionsSrc, `${HEADER}AI-1.4`, `${NEXT}AI-1.5`, 'bloque AI-1.4');
const modificationSrc = extractBetween(aiActionsSrc, `${HEADER}AI-1.5`, `${NEXT}AI-2.1`, 'bloque AI-1.5');
const smartFormSrc = extractBetween(aiActionsSrc, `${HEADER}AI-2.1`, '\n\n  /* ---------------- Contexto con IDs', 'bloque AI-2.1..AI-2.8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

const sb = {};
vm.createContext(sb);
vm.runInContext(
  [datetimeSrc, implicitEventSrc, implicitTaskSrc, modificationSrc, smartFormSrc].join('\n') + `
  this.detectSmartFormIntent = detectSmartFormIntent;
  this.buildSmartFormPrefill = buildSmartFormPrefill;
  this.extractTitleForSmartForm = extractTitleForSmartForm;
  // Opcionales a propósito: con una versión de ai-actions.js sin AI-2.10
  // la suite no aborta, sino que marca en rojo cada caso concreto.
  this.stripLeadingFillerForTitle = typeof stripLeadingFillerForTitle === 'function' ? stripLeadingFillerForTitle : () => null;
  this.SMART_FORM_TITLE_FILLERS = typeof SMART_FORM_TITLE_FILLERS !== 'undefined' ? SMART_FORM_TITLE_FILLERS : ['pues', 'tengo que'];
  `,
  sb, { filename: 'ai-actions.js (AI-1.2..AI-2.8, bloques puros)' }
);

const TODAY = '2026-09-27'; // domingo

/** Pasa un mensaje por el mismo camino que el chat (AI-2.1 -> AI-2.2). */
function smartForm(message) {
  const intent = sb.detectSmartFormIntent(message, { todayStr: TODAY });
  if (!intent) return null;
  return sb.buildSmartFormPrefill(intent);
}

// Frases reales escritas en el chat -> lo que debe llevar el formulario.
// date/time: undefined = el formulario no trae ese campo prellenado.
const CASES = [
  // --- El caso que se reportó ---
  { msg: 'pues hoy tengo que hacer una tarea de mates', type: 'task', title: 'Hacer tarea de mates', date: '2026-09-27' },
  { msg: 'Pues, hoy tengo que hacer una tarea de mates.', type: 'task', title: 'Hacer tarea de mates', date: '2026-09-27' },
  // --- Muletillas / obligación / petición al principio ---
  { msg: 'hoy me toca estudiar biología', type: 'task', title: 'Estudiar biología', date: '2026-09-27' },
  { msg: 'hay que comprar pan mañana', type: 'task', title: 'Comprar pan', date: '2026-09-28' },
  { msg: 'debo entregar el trabajo el viernes', type: 'task', title: 'Entregar el trabajo', date: '2026-10-02' },
  { msg: 'mañana tengo que estudiar biología', type: 'task', title: 'Estudiar biología', date: '2026-09-28' },
  { msg: 'tengo que hacer la compra mañana', type: 'task', title: 'Hacer la compra', date: '2026-09-28' },
  { msg: 'necesito comprar un regalo para Ana', type: 'task', title: 'Comprar un regalo para Ana' },
  { msg: 'pero bueno tengo que preparar la presentación', type: 'task', title: 'Preparar la presentación' },
  { msg: 'recuérdame llamar a mamá el lunes a las 8', type: 'task', title: 'Llamar a mamá', date: '2026-09-28', time: '08:00' },
  { msg: 'bueno pues mañana tengo examen de mates', type: 'event', title: 'Examen de mates', date: '2026-09-28' },
  { msg: 'tengo una reunión con Ana el viernes a las 9', type: 'event', title: 'Reunión con Ana', date: '2026-10-02', time: '09:00' },
  { msg: 'tengo dentista mañana a las 17:30', type: 'event', title: 'Dentista', date: '2026-09-28', time: '17:30' },
  { msg: 'el lunes tengo médico', type: 'event', title: 'Médico', date: '2026-09-28' },
  { msg: 'añade dentista el martes a las 17:30', type: 'event', title: 'Dentista', date: '2026-09-29', time: '17:30' },
  // --- Frases que ya salían bien: no deben cambiar ---
  { msg: 'examen de mates el jueves a las 10', type: 'event', title: 'Examen de mates', date: '2026-10-01', time: '10:00' },
  { msg: 'reunión con Ana el viernes a las 9', type: 'event', title: 'Reunión con Ana', date: '2026-10-02', time: '09:00' },
  { msg: 'comprar pan mañana', type: 'task', title: 'Comprar pan', date: '2026-09-28' },
];

(async () => {
  section('1) Tabla de frases reales (chat -> formulario)');
  for (const c of CASES) {
    const p = smartForm(c.msg);
    const ok = !!p && p.type === c.type && p.title === c.title && p.date === c.date && p.time === c.time;
    const got = p ? `${p.type} "${p.title}" ${p.date || '-'} ${p.time || '-'}` : 'null (no abre formulario)';
    check(`"${c.msg}" -> ${c.type} "${c.title}" ${c.date || '-'} ${c.time || '-'}${ok ? '' : `   [obtenido: ${got}]`}`, ok);
  }

  section('2) Invariantes sobre toda la tabla');
  const results = CASES.map(c => ({ c, p: smartForm(c.msg) })).filter(r => r.p);
  const fillerRe = new RegExp(`^(?:${sb.SMART_FORM_TITLE_FILLERS.slice().sort((a, b) => b.length - a.length).join('|')})(?:$|[\\s,;:.!?¡¿…])`, 'i');
  check('2a. ningún título queda vacío', results.every(r => r.p.title && r.p.title.trim().length > 0));
  check('2b. todos empiezan por mayúscula', results.every(r => r.p.title[0] === r.p.title[0].toUpperCase() && r.p.title[0] !== r.p.title[0].toLowerCase()));
  check('2c. ningún título empieza por una muletilla', results.every(r => !fillerRe.test(r.p.title)));
  check('2d. ningún título conserva la fecha/hora ya usada (hoy, mañana, día de la semana, "a las")',
    results.every(r => !/\b(hoy|mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b|\ba las\b/i.test(r.p.title)));
  check('2e. ningún título termina con puntuación sobrante', results.every(r => !/[\s,;:.!?¡¿…]$/.test(r.p.title)));
  check('2f. el verbo "hacer" nunca se pierde (solo el artículo indeterminado detrás)',
    results.filter(r => /\bhacer\b/i.test(r.c.msg)).every(r => /^hacer\b/i.test(r.p.title)));

  section('3) Límites de palabra (una muletilla nunca se come parte de otra palabra)');
  const keep = [
    ['queso para la cena', 'queso para la cena'], // "que"
    ['yoga', 'yoga'],                             // "y"
    ['perro', 'perro'],                           // "pero"
    ['ahorrar dinero', 'ahorrar dinero'],         // "ah"
    ['tocar el piano', 'tocar el piano'],         // "toca"
    ['venganza', 'venganza'],                     // "venga"
    ['debates de clase', 'debates de clase'],     // "debo"/"debe..."
    ['hacer la compra', 'hacer la compra'],       // artículo determinado: se conserva
  ];
  for (const [input, expected] of keep) {
    const out = sb.stripLeadingFillerForTitle(input);
    check(`"${input}" -> "${expected}"${out === expected ? '' : `   [obtenido: "${out}"]`}`, out === expected);
  }
  check('"hacer un pastel" -> "hacer pastel" (se quita el artículo, nunca el verbo)', sb.stripLeadingFillerForTitle('hacer un pastel') === 'hacer pastel');
  check('"pues pues, tengo que... ¡estudiar!" -> "estudiar" (repetidas + puntuación)', sb.stripLeadingFillerForTitle('pues pues, tengo que... ¡estudiar!') === 'estudiar');

  section('4) Nunca un título vacío');
  check('4a. solo muletillas ("pues tengo que") -> se usa la frase original', sb.extractTitleForSmartForm('pues tengo que') === 'Pues tengo que');
  check('4b. muletillas + fecha ("bueno, hoy tengo que") -> la frase original completa', sb.extractTitleForSmartForm('bueno, hoy tengo que') === 'Bueno, hoy tengo que');
  check('4c. solo fecha/hora ("mañana a las 10") -> sigue siendo null (no hay nada que crear; sin cambios)', sb.extractTitleForSmartForm('mañana a las 10') === null);
  check('4d. stripLeadingFillerForTitle puede devolver "" (decide el llamador)', sb.stripLeadingFillerForTitle('pues tengo que') === '');

  section('5) API pública real (ai-actions.js completo, como en el navegador)');
  {
    const win = { console };
    win.window = win; win.self = win;
    vm.createContext(win);
    vm.runInContext(aiActionsSrc, win, { filename: 'js/ai-actions.js (completo)' });
    const AI = win.AIActions;
    const intent = AI.detectSmartFormIntent('pues hoy tengo que hacer una tarea de mates', { todayStr: TODAY });
    const prefill = intent && AI.buildSmartFormPrefill(intent);
    check('5a. window.AIActions abre el Smart Form con "Hacer tarea de mates" y fecha de hoy',
      !!prefill && prefill.type === 'task' && prefill.title === 'Hacer tarea de mates' && prefill.date === TODAY);
    check('5b. AI-2.8 sigue detectando el duplicado si se envía dos veces el mismo Smart Form',
      !!AI.findExistingSmartFormEquivalent(
        { type: 'task', title: prefill.title, date: prefill.date },
        { tasks: [{ id: 'x', title: 'Hacer tarea de mates', dueDate: TODAY, dueTime: '' }], events: [] }
      ));
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
