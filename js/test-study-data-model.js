/**
 * ORGANIZATOR — Tests del paso 1 de la app de exámenes (modelo de datos)
 *
 * Comprueba que organizator.html carga, guarda, exporta, importa y borra
 * las tres listas nuevas (subjects, exams, studySessions) igual que el
 * resto de datos, sin ninguna interfaz nueva.
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html loadState(), saveSubjects()/saveExams()/
 * saveStudySessions(), sanitizeImportedStudyItems() y el bloque de import
 * de estas claves, y los ejecuta en un sandbox con un window.storage en
 * memoria — mismo patrón que test-reminders-model.js. exportData() y
 * deleteAllData() se revisan por contenido (dependen de DOM/confirm).
 *
 * Uso:  node js/test-study-data-model.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// organizator.html puede estar con CRLF en el checkout; se normaliza a LF
// solo en memoria.
const html = fs.readFileSync(path.join(ROOT, 'organizator.html'), 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

const studyConstSrc = extractBetween(html, '/* ---------- App de exámenes: modelo de datos (paso 1)', '\n\n/* ==================================================================\n   CRUD', 'constantes STUDY_*');
const loadStateSrc = extractBetween(html, 'async function loadState(){', '\nasync function saveTasks(){', 'función loadState()');
const saveStudySrc = extractBetween(html, 'async function saveSubjects(){', '\nasync function savePrefs(){', 'saveSubjects/saveExams/saveStudySessions');
const sanitizeSrc = extractBetween(html, '/** Valida una lista importada de asignaturas', '\nfunction initSettingsDataIO(){', 'sanitizeImportedStudyItems()');
const importBlockSrc = extractBetween(html, '    const sanitizedStudy = {};', '    // R-8.2-C: el registro', 'bloque de import de STUDY_KEYS');
const exportDataSrc = extractBetween(html, 'function exportData(){', '\n  try{', 'función exportData()');
const importFnSrc = extractBetween(html, 'function initSettingsDataIO(){', '\nasync function deleteAllData(){', 'función initSettingsDataIO()');
const deleteAllSrc = extractBetween(html, 'async function deleteAllData(){', '\n/* ==================================================================\n   IA — ASISTENTE PERSONAL', 'función deleteAllData()');

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}
function section(title) { console.log('\n' + title); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Sandbox con window.storage en memoria y el código real extraído. */
function makeSandbox(initial) {
  const mem = new Map(Object.entries(initial || {}));
  const toasts = [];
  const sandbox = {
    console,
    state: { tasks: [], events: [], subjects: [], exams: [], studySessions: [] },
    defaultPrefs: () => ({}),
    defaultIA: () => ({}),
    showToast: (m) => toasts.push(m),
    window: {
      storage: {
        async get(key) { return mem.has(key) ? { key, value: mem.get(key), shared: false } : null; },
        async set(key, value) { mem.set(key, value); return { key, value, shared: false }; },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext([studyConstSrc, loadStateSrc, saveStudySrc, sanitizeSrc,
    'this.STUDY_KEYS = STUDY_KEYS; this.loadState = loadState; this.saveSubjects = saveSubjects;',
    'this.saveExams = saveExams; this.saveStudySessions = saveStudySessions;',
    'this.sanitizeImportedStudyItems = sanitizeImportedStudyItems;',
    'this.EXAM_TYPE_INFO = EXAM_TYPE_INFO; this.EXAM_TYPES = EXAM_TYPES; this.EXAM_TERMS = EXAM_TERMS;',
    'this.EXAM_DELIVERY_STATUSES = EXAM_DELIVERY_STATUSES; this.DEFAULT_PASS_GRADE = DEFAULT_PASS_GRADE;',
    'this.STUDY_SESSION_KINDS = STUDY_SESSION_KINDS; this.defaultExamWeight = defaultExamWeight;',
    'this.isStudyWindowType = isStudyWindowType; this.isDeliveryType = isDeliveryType; this.examStudyDays = examStudyDays;',
    'this.sanitizeRecovers = sanitizeRecovers;'].join('\n'), sandbox);
  return { sandbox, mem, toasts };
}

(async () => {
  // =====================================================================
  section('A) Modelo: constantes y estado inicial');
  // =====================================================================
  {
    const { sandbox } = makeSandbox();
    check('A1. STUDY_KEYS son subjects, exams y studySessions', same([...sandbox.STUDY_KEYS], ['subjects', 'exams', 'studySessions']));
    const stateSrc = extractBetween(html, 'let state = {', '\n};', 'estado inicial');
    check('A2. el estado inicial tiene las tres listas vacías', /subjects: \[\], exams: \[\], studySessions: \[\]/.test(stateSrc));
    const syncKeys = require(path.join(ROOT, 'js', 'sync-storage.js')).SYNCED_KEYS;
    check('A3. las tres claves se sincronizan con la cuenta (SYNCED_KEYS)', sandbox.STUDY_KEYS.every(k => syncKeys.includes(k)));
  }

  // =====================================================================
  section('B) loadState()');
  // =====================================================================
  {
    const subjects = [{ id: 's1', name: 'Mates', color: '#3366ff' }];
    const exams = [{ id: 'e1', subjectId: 's1', type: 'examen', title: 'Parcial', date: '2026-10-20', topics: [], difficulty: 3 }];
    const { sandbox } = makeSandbox({ subjects: JSON.stringify(subjects), exams: JSON.stringify(exams) });
    await sandbox.loadState();
    check('B1. carga subjects y exams guardados', same(sandbox.state.subjects, subjects) && same(sandbox.state.exams, exams));
    check('B2. sin studySessions guardadas -> lista vacía', same(sandbox.state.studySessions, []));

    const bad = makeSandbox({ subjects: '{no es json', exams: '{"id":"e1"}', studySessions: 'null' });
    await bad.sandbox.loadState();
    check('B3. JSON roto, objeto suelto o null -> listas vacías (nunca rompe el arranque)',
      same(bad.sandbox.state.subjects, []) && same(bad.sandbox.state.exams, []) && same(bad.sandbox.state.studySessions, []));
  }

  // =====================================================================
  section('C) saveSubjects/saveExams/saveStudySessions');
  // =====================================================================
  {
    const { sandbox, mem } = makeSandbox();
    sandbox.state.subjects = [{ id: 's1', name: 'Lengua', color: '#ff0000' }];
    sandbox.state.exams = [{ id: 'e1', subjectId: 's1' }];
    sandbox.state.studySessions = [{ id: 'ss1', examId: 'e1', status: 'pendiente' }];
    await sandbox.saveSubjects(); await sandbox.saveExams(); await sandbox.saveStudySessions();
    check('C1. cada lista se guarda en su clave como JSON', JSON.parse(mem.get('subjects'))[0].name === 'Lengua'
      && JSON.parse(mem.get('exams'))[0].id === 'e1' && JSON.parse(mem.get('studySessions'))[0].status === 'pendiente');
    const reload = makeSandbox(Object.fromEntries(mem));
    await reload.sandbox.loadState();
    check('C2. guardar y volver a cargar devuelve lo mismo', same(reload.sandbox.state.subjects, sandbox.state.subjects)
      && same(reload.sandbox.state.studySessions, sandbox.state.studySessions));
  }

  // =====================================================================
  section('D) Exportar / Importar / Borrar todos los datos');
  // =====================================================================
  {
    check('D1. exportData() incluye subjects, exams y studySessions',
      ['subjects: state.subjects,', 'exams: state.exams,', 'studySessions: state.studySessions,'].every(s => exportDataSrc.includes(s)));

    const { sandbox } = makeSandbox();
    const { kept, discarded } = sandbox.sanitizeImportedStudyItems([
      { id: 's1', name: 'Mates', color: '#000', extra: 1 }, null, 'texto', [], { name: 'sin id' }, { id: '  ' }, { id: 5 },
    ]);
    check('D2. sanitizeImportedStudyItems conserva los elementos con id (y todos sus campos)', same(kept, [{ id: 's1', name: 'Mates', color: '#000', extra: 1 }]));
    check('D3. descarta los que no son objetos o no tienen id de texto', discarded === 6);
    check('D4. un valor que no es lista -> vacío sin errores', same(sandbox.sanitizeImportedStudyItems(undefined), { kept: [], discarded: 0 }));

    // Bloque real del import, ejecutado aislado.
    const runImport = (data) => {
      const ctx = { state: {}, data, STUDY_KEYS: sandbox.STUDY_KEYS, sanitizeImportedStudyItems: sandbox.sanitizeImportedStudyItems };
      vm.createContext(ctx);
      vm.runInContext(importBlockSrc + '\nthis.sanitizedStudy = sanitizedStudy;', ctx);
      return ctx;
    };
    const imported = runImport({ subjects: [{ id: 's1', name: 'Mates' }], exams: [{ id: 'e1' }, { title: 'sin id' }], studySessions: [{ id: 'ss1' }] });
    check('D5. importar reemplaza las tres listas', imported.state.subjects[0].id === 's1' && imported.state.exams.length === 1 && imported.state.studySessions[0].id === 'ss1');
    check('D6. importar cuenta los descartados por lista', imported.sanitizedStudy.exams.discarded === 1 && imported.sanitizedStudy.subjects.discarded === 0);
    const oldBackup = runImport({ tasks: [] });
    check('D7. una copia antigua sin estas claves deja las listas vacías', same(oldBackup.state.subjects, []) && same(oldBackup.state.exams, []) && same(oldBackup.state.studySessions, []));
    check('D8. el import guarda las tres listas', ['saveSubjects()', 'saveExams()', 'saveStudySessions()'].every(s => importFnSrc.includes(s)));

    check('D9. "Borrar todos los datos" vacía y guarda las tres listas',
      ['state.subjects = [];', 'state.exams = [];', 'state.studySessions = [];', 'saveSubjects()', 'saveExams()', 'saveStudySessions()'].every(s => deleteAllSrc.includes(s)));
  }

  // =====================================================================
  section('E) Tipos de prueba, trimestre, peso, entregas y días de estudio');
  // =====================================================================
  {
    const { sandbox: s } = makeSandbox();
    check('E1. los 9 tipos de prueba', same([...s.EXAM_TYPES],
      ['examen', 'parcial', 'trimestral', 'final', 'recuperacion', 'trabajo', 'exposicion', 'ejercicios', 'deberes']));
    check('E2. todos tienen etiqueta y un peso por defecto entre 1 y 100, salvo la recuperación (0: sustituye, no suma)',
      s.EXAM_TYPES.every(t => typeof s.EXAM_TYPE_INFO[t].label === 'string'
        && (t === 'recuperacion' ? s.EXAM_TYPE_INFO[t].weight === 0 : s.EXAM_TYPE_INFO[t].weight > 0 && s.EXAM_TYPE_INFO[t].weight <= 100)));
    check('E3. defaultExamWeight devuelve el peso del tipo (y 0 si no existe)',
      s.defaultExamWeight('final') === s.EXAM_TYPE_INFO.final.weight && s.defaultExamWeight('inventado') === 0 && s.defaultExamWeight('__proto__') === 0);
    const windowTypes = s.EXAM_TYPES.filter(t => s.isStudyWindowType(t));
    const deliveryTypes = s.EXAM_TYPES.filter(t => s.isDeliveryType(t));
    check('E4. ventana de estudio: examen, parcial, trimestral, final y recuperación', same(windowTypes, ['examen', 'parcial', 'trimestral', 'final', 'recuperacion']));
    check('E5. estado de entrega: trabajo, exposición, ejercicios y deberes', same(deliveryTypes, ['trabajo', 'exposicion', 'ejercicios', 'deberes']));
    check('E6. trimestres 1, 2 y 3; estados pendiente/entregado; aprobado 5 por defecto',
      same([...s.EXAM_TERMS], [1, 2, 3]) && same([...s.EXAM_DELIVERY_STATUSES], ['pendiente', 'entregado']) && s.DEFAULT_PASS_GRADE === 5);
    check('E7. las sesiones pueden ser de estudio, repaso, "hacer el trabajo" o ensayo', same([...s.STUDY_SESSION_KINDS], ['estudio', 'repaso', 'trabajo', 'ensayo']));

    const defaultPrefsSrc = extractBetween(html, 'function defaultPrefs(){', '\nfunction defaultIA(){', 'función defaultPrefs()');
    const prefs = vm.runInNewContext(defaultPrefsSrc + '\ndefaultPrefs();');
    check('E8. Ajustes: "Días de estudio antes de un examen" es 10 por defecto', prefs.studyDaysBefore === 10);
    check('E9. una prueba sin días propios usa los de Ajustes', s.examStudyDays({ type: 'parcial' }, { studyDaysBefore: 7 }) === 7);
    check('E10. una prueba con días propios usa los suyos', s.examStudyDays({ type: 'final', studyDaysBefore: 15 }, { studyDaysBefore: 7 }) === 15);
    check('E11. valores no válidos (0, negativos, decimales, texto) -> se ignoran; sin Ajustes -> 10',
      s.examStudyDays({ type: 'examen', studyDaysBefore: 0 }, { studyDaysBefore: 2.5 }) === 10
      && s.examStudyDays({ type: 'examen', studyDaysBefore: '5' }, null) === 10
      && s.examStudyDays({ type: 'examen', studyDaysBefore: -3 }, { studyDaysBefore: 4 }) === 4);
    check('E12. las entregas no usan ventana de estudio (null)',
      ['trabajo', 'exposicion', 'ejercicios', 'deberes'].every(t => s.examStudyDays({ type: t, studyDaysBefore: 5 }, { studyDaysBefore: 10 }) === null)
      && s.examStudyDays(null, {}) === null);

    check('E13. recovers: una prueba concreta por id', same(s.sanitizeRecovers({ examId: 'e7' }), { examId: 'e7' }));
    check('E14. recovers: un trimestre (1, 2 o 3)', same(s.sanitizeRecovers({ term: 2 }), { term: 2 }));
    check('E15. recovers no válido -> null (id vacío, trimestre 4, texto, null)',
      [{ examId: '  ' }, { term: 4 }, { term: '2' }, 'e7', null, undefined, {}].every(v => s.sanitizeRecovers(v) === null));
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
