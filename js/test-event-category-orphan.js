/**
 * ORGANIZATOR — Test de regresión de 6A-4.3 (preservar categoryId huérfano
 * al editar un evento cuya categoría fue eliminada)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html la función openEventModal() (donde vive el fix de
 * 6A-4.3) y la función esc() de la que depende, y las ejecuta en un
 * sandbox con un DOM mínimo simulado (solo lo que openEventModal toca de
 * forma síncrona al construir el HTML: modalBox.innerHTML/querySelector,
 * overlay.classList — nunca se disparan los listeners de submit/click,
 * así que no hace falta simular document/confirm/closeModal/etc.).
 *
 * Localiza el bloque por CONTENIDO (nombre de función / comentario de
 * sección siguiente), no por número de línea, para no romperse si el
 * archivo se reordena.
 *
 * Uso:  node js/test-event-category-orphan.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'organizator.html');
// organizator.html se guarda con CRLF en este checkout; se normaliza a LF
// SOLO para esta lectura en memoria (no se toca el archivo en disco) para
// que los marcadores de extractBetween, escritos con '\n', encuentren el
// texto. Mismo ajuste ya usado en test-event-import-sanitize.js.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// esc() — usada dentro de openEventModal para escapar título/categoría.
// ---------------------------------------------------------------------
const escSrc = extractBetween(
  html,
  'function esc(s){',
  '\n\n/* ==================================================================\n   FILAS DE TAREA',
  'función esc()'
);

// ---------------------------------------------------------------------
// openEventModal() real de organizator.html — aquí vive el fix de 6A-4.3
// (la línea que inserta la opción "Categoría eliminada" cuando el
// categoryId del evento ya no existe en state.eventCategories).
// ---------------------------------------------------------------------
const openEventModalSrc = extractBetween(
  html,
  'function openEventModal({eventId=null, date=null}={}){',
  '\n\n/* ==================================================================\n   MODAL: HORARIO BLOQUEADO',
  'función openEventModal()'
);

// ---------------- Utilidades de test ----------------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

/** Extrae los <option> del <select name="categoryId"> del HTML generado
 * por openEventModal, como [{ value, selected, label }]. */
function parseCategorySelectOptions(modalHtml) {
  const selectMatch = /<select name="categoryId">([\s\S]*?)<\/select>/.exec(modalHtml);
  if (!selectMatch) return null;
  // openEventModal() deja un espacio suelto antes del "&gt;" cuando la
  // opción NO está seleccionada (el ternario de "selected" se resuelve a
  // '' pero el espacio delante de él es literal en la plantilla):
  //   <option value="cat1" >Trabajo</option>        (no seleccionada)
  //   <option value="cat1" selected>Trabajo</option> (seleccionada)
  // El \s* a ambos lados de "(selected)?" cubre las dos formas reales.
  const optionRe = /<option value="([^"]*)"\s*(selected)?\s*>([^<]*)<\/option>/g;
  const options = [];
  let m;
  while ((m = optionRe.exec(selectMatch[1])) !== null) {
    options.push({ value: m[1], selected: !!m[2], label: m[3] });
  }
  return options;
}

/** Crea un sandbox nuevo con un DOM mínimo simulado y el `state` dado, y
 * ejecuta openEventModal(args) dentro. Devuelve el HTML final asignado a
 * modalBox.innerHTML (lo único que openEventModal produce de forma
 * síncrona y observable sin simular eventos de usuario). */
function renderEventModalHTML(state, args) {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);

  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(
    `let state = ${JSON.stringify(state)};
     const modalBox = {
       _html: '',
       set innerHTML(v){ this._html = v; },
       get innerHTML(){ return this._html; },
       querySelector(){ return { addEventListener(){}, style:{} }; },
     };
     const overlay = { classList: { add(){}, remove(){} } };
     // openEventModal pasa closeModal directamente como referencia de
     // callback (addEventListener('click', closeModal)), así que el
     // identificador tiene que existir aunque nunca se dispare el click.
     function closeModal(){}`,
    sandbox, { filename: 'dom-stub' }
  );
  vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal)' });
  vm.runInContext(`this.openEventModal = openEventModal; this.modalBox = modalBox;`, sandbox, { filename: 'expose-openEventModal' });

  sandbox.openEventModal(args);
  return sandbox.modalBox.innerHTML;
}

(() => {

  // =====================================================================
  section('A) La lógica de 6A-4.3 ("Categoría eliminada") sigue presente en el código fuente');
  // =====================================================================
  {
    check('A. openEventModal() sigue generando el texto "Categoría eliminada"',
      openEventModalSrc.includes('Categoría eliminada'));
    check('A. la condición comprueba que el categoryId del evento YA NO existe en state.eventCategories',
      /!\(state\.eventCategories\|\|\[\]\)\.some\(c=>c\.id===existing\.categoryId\)/.test(openEventModalSrc));
    check('A. la opción "Categoría eliminada" solo se genera si existing.categoryId es verdadero (evento con categoría asignada)',
      /existing\s*&&\s*existing\.categoryId\s*&&\s*!\(state\.eventCategories/.test(openEventModalSrc));
  }

  // =====================================================================
  section('B/C) categoryId huérfano: se conserva tal cual y queda seleccionado como "Categoría eliminada"');
  // =====================================================================
  {
    const state = {
      events: [{ id: 'e1', title: 'Cita vieja', date: '2026-01-10', categoryId: 'orphan-id' }],
      eventCategories: [], // la categoría de e1 ya no existe
    };
    const html2 = renderEventModalHTML(state, { eventId: 'e1' });
    const options = parseCategorySelectOptions(html2);
    check('B/C. el <select name="categoryId"> se genera correctamente', Array.isArray(options));

    const orphanOption = options.find(o => o.label === 'Categoría eliminada');
    check('C. aparece una opción "Categoría eliminada"', !!orphanOption);
    check('B. su value es EXACTAMENTE el categoryId huérfano original ("orphan-id"), no ""/null/undefined/otro id',
      !!orphanOption && orphanOption.value === 'orphan-id');
    check('C. esa opción "Categoría eliminada" está marcada selected', !!orphanOption && orphanOption.selected === true);

    // B (negativo): no se ha colado ninguna sustitución del categoryId.
    check('B. ninguna opción tiene value="" marcada como selected (no se sustituyó por vacío)',
      !options.some(o => o.value === '' && o.selected));
    check('B. ninguna opción tiene value="null" ni value="undefined"',
      !options.some(o => o.value === 'null' || o.value === 'undefined'));
    check('B. no aparece seleccionada ninguna OTRA categoría (solo existe la opción huérfana, sin categorías reales)',
      options.filter(o => o.selected).length === 1 && options.filter(o => o.selected)[0].value === 'orphan-id');

    // El propio state.events no se muta por abrir el modal (solo se lee).
    check('B. state.events[0].categoryId sigue siendo "orphan-id" tras abrir el modal (no se mutó al leerlo)',
      state.events[0].categoryId === 'orphan-id');
  }

  // =====================================================================
  section('D) Categoría existente sigue funcionando con normalidad');
  // =====================================================================
  {
    const state = {
      events: [{ id: 'e2', title: 'Reunión', date: '2026-01-11', categoryId: 'cat1' }],
      eventCategories: [{ id: 'cat1', name: 'Trabajo', color: '#123456', icon: '', blocksSchedule: true }],
    };
    const html2 = renderEventModalHTML(state, { eventId: 'e2' });
    const options = parseCategorySelectOptions(html2);

    check('D. NO aparece ninguna opción "Categoría eliminada" (la categoría sí existe)',
      !options.some(o => o.label === 'Categoría eliminada'));
    const catOption = options.find(o => o.value === 'cat1');
    check('D. la opción de la categoría real existe con su nombre', !!catOption && catOption.label === 'Trabajo');
    check('D. la opción de la categoría real está seleccionada', !!catOption && catOption.selected === true);
    check('D. sigue existiendo la opción "Sin categoría" (value="") sin seleccionar',
      options.some(o => o.value === '' && o.label === 'Sin categoría' && !o.selected));
  }

  // =====================================================================
  section('E) Evento sin categoryId sigue mostrando "Sin categoría"');
  // =====================================================================
  {
    const state = {
      events: [{ id: 'e3', title: 'Cita sin categoría', date: '2026-01-12' }], // sin categoryId
      eventCategories: [{ id: 'cat1', name: 'Trabajo', color: '#123456', icon: '', blocksSchedule: true }],
    };
    const html2 = renderEventModalHTML(state, { eventId: 'e3' });
    const options = parseCategorySelectOptions(html2);

    check('E. existe la opción "Sin categoría" (value="")', options.some(o => o.value === '' && o.label === 'Sin categoría'));
    check('E. NO aparece ninguna opción "Categoría eliminada" (el evento no tiene categoryId, no hay nada huérfano)',
      !options.some(o => o.label === 'Categoría eliminada'));

    // La categoría existente ("cat1") SÍ debe listarse en el <select>
    // (para poder elegirla), solo que sin seleccionar. El parser debe
    // reconocerla con selected:false y no dejarla fuera del array.
    const cat1Option = options.find(o => o.value === 'cat1');
    check('E. la categoría existente "cat1" aparece en el array parseado (el parser no la descarta por no estar seleccionada)',
      !!cat1Option);
    check('E. esa categoría aparece con selected: false (no true, no ausente)',
      !!cat1Option && cat1Option.selected === false);
    check('E. esa categoría conserva su label real ("Trabajo")', !!cat1Option && cat1Option.label === 'Trabajo');

    check('E. ninguna opción queda marcada selected explícitamente (el <select> recae por defecto en la primera: "Sin categoría")',
      !options.some(o => o.selected));
  }

  // =====================================================================
  section('F) node --check del código extraído de organizator.html (esc + openEventModal)');
  // =====================================================================
  {
    // Se combinan ambos fragmentos reales tal cual se extrajeron (más un
    // par de globals mínimos para que sea un script standalone válido),
    // y se comprueba su sintaxis con el mismo comando que ya usa el
    // resto de la suite (test-event-allday-context.js, test-event-import-sanitize.js).
    const combined = `${escSrc}\n\nlet state = { events: [], eventCategories: [] };\nconst modalBox = { innerHTML: '', querySelector(){ return { addEventListener(){} }; } };\nconst overlay = { classList: { add(){}, remove(){} } };\n\n${openEventModalSrc}\n`;
    const tmpPath = path.join(os.tmpdir(), `organizator-event-modal-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('F. node --check del código extraído (esc + openEventModal) pasa (sintaxis válida)', true);
    } catch (e) {
      check('F. node --check del código extraído (esc + openEventModal) pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
