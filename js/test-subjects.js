/**
 * ORGANIZATOR — Tests del paso 2 de la app de exámenes (asignaturas)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el bloque "ASIGNATURAS (app de exámenes, paso 2)", las
 * constantes del modelo (paleta y parsePassGrade incluidas) y
 * sanitizeImportedSubjects (junto al resto del import), y los ejecuta en un sandbox con un window.storage
 * en memoria (mismo patrón que test-study-data-model.js). La ventana
 * (openSubjectModal) depende del DOM: de ella solo se comprueba por
 * contenido que use la paleta y el aviso de color repetido.
 *
 * Uso:  node js/test-subjects.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'organizator.html'), 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

const HDR = '/* ==================================================================\n   ';
const studyConstSrc = extractBetween(html, '/* ---------- App de exámenes: modelo de datos (paso 1)', `\n\n${HDR}CRUD`, 'constantes STUDY_*');
const subjectsSrc = extractBetween(html, `${HDR}ASIGNATURAS (app de exámenes, paso 2)`, `\n${HDR}EXÁMENES Y ENTREGAS (app de exámenes)`, 'bloque ASIGNATURAS');
const importSanitizerSrc = extractBetween(html, '/** Valida las asignaturas de una copia importada', '\nfunction initSettingsDataIO(){', 'sanitizeImportedSubjects()');
const escSrc = extractBetween(html, 'function esc(s){', '\n}\n', 'esc()') + '\n}\n';
const renderAjustesSrc = extractBetween(html, 'function renderAjustes(){', '\nasync function deleteAllData(){', 'renderAjustes()');
const importFnSrc = extractBetween(html, 'function initSettingsDataIO(){', '\nasync function deleteAllData(){', 'initSettingsDataIO()');

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}
function section(title) { console.log('\n' + title); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function makeSandbox({ subjects = [], exams = [], customSchedules = [], confirmAnswer = true } = {}) {
  const saved = [];
  const savedSchedules = [];
  const calls = { alerts: [], confirms: [], toasts: [], renders: 0 };
  let seq = 0;
  const sb = {
    console,
    state: { subjects: JSON.parse(JSON.stringify(subjects)), exams: JSON.parse(JSON.stringify(exams)), customSchedules: JSON.parse(JSON.stringify(customSchedules)) },
    uid: () => 'id' + (++seq),
    saveSubjects: async () => { saved.push(JSON.stringify(sb.state.subjects)); },
    saveCustomSchedules: async () => { savedSchedules.push(JSON.stringify(sb.state.customSchedules)); },
    showToast: (m) => calls.toasts.push(m),
    alert: (m) => calls.alerts.push(m),
    confirm: (m) => { calls.confirms.push(m); return confirmAnswer; },
    renderAjustes: () => { calls.renders++; },
  };
  vm.createContext(sb);
  vm.runInContext([escSrc, studyConstSrc, subjectsSrc, importSanitizerSrc,
    'Object.assign(this, { SUBJECT_COLORS, textColorOn, DEFAULT_PASS_GRADE, parsePassGrade, formatGrade, validateSubjectData,',
    '  addSubject, updateSubject, deleteSubject, confirmDeleteSubject, sanitizeImportedSubjects, renderSubjectRows,',
    '  nextFreeSubjectColor, findSubjectByColor, countExamsForSubject });'].join('\n'), sb);
  return { sb, saved, savedSchedules, calls };
}

// Contraste WCAG entre dos colores #RRGGBB.
function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

(async () => {
  // =====================================================================
  section('A) Paleta de colores');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    const colors = sb.SUBJECT_COLORS.map(c => c.color);
    check('A1. 20 colores, todos #RRGGBB, sin repetir; los 10 primeros son los de siempre', colors.length === 20 && colors.every(c => /^#[0-9A-F]{6}$/.test(c)) && new Set(colors).size === 20
      && colors.slice(0, 10).join() === '#D64545,#C4621A,#A07800,#3A9149,#118A84,#3A7BD5,#5B63D6,#8E57D1,#D14E8E,#9C6B3E');
    check('A2. todos tienen nombre', sb.SUBJECT_COLORS.every(c => typeof c.name === 'string' && c.name.length > 0));
    const PAPER = '#F3F2EE', WHITE = '#FFFFFF', DARK = '#1B1F23';
    check('A3. contraste >= 3:1 sobre el fondo claro de la app y sobre blanco', colors.every(c => contrast(c, PAPER) >= 3 && contrast(c, WHITE) >= 3));
    check('A4. textColorOn elige blanco o negro, el que más contraste tiene (>= 4.5:1 en toda la paleta)', colors.every(c => {
      const t = sb.textColorOn(c); const other = t === '#FFFFFF' ? '#000000' : '#FFFFFF';
      return (t === '#FFFFFF' || t === '#000000') && contrast(c, t) >= contrast(c, other) && contrast(c, t) >= 4.5;
    }) && sb.textColorOn('#FFEE58') === '#000000' && sb.textColorOn('#1B1F23') === '#FFFFFF' && sb.textColorOn('rojo') === '#000000' && DARK);
  }

  // =====================================================================
  section('B) Nota de aprobado');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    check('B1. "4,5" y "4.5" -> 4.5', sb.parsePassGrade('4,5') === 4.5 && sb.parsePassGrade('4.5') === 4.5);
    check('B2. 0, 10 y "7" son válidas', sb.parsePassGrade(0) === 0 && sb.parsePassGrade(10) === 10 && sb.parsePassGrade('7') === 7);
    check('B3. fuera de rango o no numérica -> null', [-1, 10.5, '11', 'cinco', '', '4,5,1', NaN, null, '-2'].every(v => sb.parsePassGrade(v) === null));
    check('B4. se redondea a 2 decimales', sb.parsePassGrade('5,256') === 5.26);
    check('B5. se muestra con coma decimal', sb.formatGrade(4.5) === '4,5' && sb.formatGrade(5) === '5');
  }

  // =====================================================================
  section('C) Crear');
  // =====================================================================
  {
    const { sb, saved } = makeSandbox();
    const red = sb.SUBJECT_COLORS[0].color;
    const r = await sb.addSubject({ name: '  Matemáticas ', color: red, passGrade: '' });
    check('C1. se crea con nombre recortado, color y aprobado 5 por defecto', r.ok && r.subject.name === 'Matemáticas' && r.subject.color === red && r.subject.passGrade === 5);
    check('C2. tiene id, createdAt y updatedAt, y se guarda', !!r.subject.id && r.subject.createdAt > 0 && r.subject.updatedAt === r.subject.createdAt && saved.length === 1);
    const dec = await sb.addSubject({ name: 'Historia', color: sb.SUBJECT_COLORS[1].color, passGrade: '4,5' });
    check('C3. aprobado con decimales (4,5)', dec.ok && dec.subject.passGrade === 4.5);
    const dup = await sb.addSubject({ name: 'MATEMÁTICAS', color: red, passGrade: 5 });
    check('C4. nombre repetido (sin distinguir mayúsculas) -> error y no se guarda', !dup.ok && !!dup.errors.name && sb.state.subjects.length === 2 && saved.length === 2);
    const empty = await sb.addSubject({ name: '   ', color: red });
    check('C5. sin nombre -> error', !empty.ok && !!empty.errors.name);
    const badGrade = await sb.addSubject({ name: 'Física', color: red, passGrade: '12' });
    check('C6. aprobado fuera de 0-10 -> error', !badGrade.ok && !!badGrade.errors.passGrade);
    const badColor = await sb.addSubject({ name: 'Física', color: 'rojo' });
    check('C7. un color que no es #RRGGBB -> error', !badColor.ok && !!badColor.errors.color);
    const custom = await sb.addSubject({ name: 'Música', color: '#12abef' });
    check('C7b. "Otro color": se acepta cualquier #RRGGBB (en mayúsculas)', custom.ok && custom.subject.color === '#12ABEF');
    const lower = await sb.addSubject({ name: 'Química', color: sb.SUBJECT_COLORS[2].color.toLowerCase() });
    check('C8. el color de la paleta se acepta aunque venga en minúsculas', lower.ok && lower.subject.color === sb.SUBJECT_COLORS[2].color);
  }

  // =====================================================================
  section('D) Color repetido: avisa pero deja guardar');
  // =====================================================================
  {
    const red = '#D64545';
    const { sb } = makeSandbox({ subjects: [{ id: 's1', name: 'Mates', color: red, passGrade: 5 }] });
    const r = await sb.addSubject({ name: 'Lengua', color: red });
    check('D1. se puede guardar una asignatura con un color ya usado', r.ok && sb.state.subjects.length === 2);
    check('D2. findSubjectByColor encuentra la otra asignatura (para el aviso)', sb.findSubjectByColor(red, r.subject.id).id === 's1');
    check('D3. la propia asignatura no cuenta como repetida', sb.findSubjectByColor(red, 's1').id === r.subject.id && makeSandbox({ subjects: [{ id: 's1', name: 'M', color: red }] }).sb.findSubjectByColor(red, 's1') === null);
    check('D4. una asignatura nueva propone el primer color libre', sb.nextFreeSubjectColor() === sb.SUBJECT_COLORS[1].color);
    const modalSrc = extractBetween(html, 'function openSubjectModal(', '\n/* ===', 'openSubjectModal()');
    check('D5. la ventana usa la paleta (radios) y avisa del color repetido', modalSrc.includes('SUBJECT_COLORS.map') && modalSrc.includes('type="radio" name="color"')
      && modalSrc.includes('Este color ya lo usa') && modalSrc.includes('Puedes guardarlo igualmente'));
    check('D6. la ventana tiene "Otro color" con selector libre y lo usa al guardar', modalSrc.includes('type="color" id="subject-custom-color"') && modalSrc.includes('value="custom"')
      && modalSrc.includes("picked.value === 'custom' ? customInput.value.toUpperCase() : picked.value") && modalSrc.includes('color: pickedColor()'));
  }

  // =====================================================================
  section('E) Editar');
  // =====================================================================
  {
    const subjects = [
      { id: 's1', name: 'Mates', color: '#D64545', passGrade: 5, createdAt: 1, updatedAt: 1 },
      { id: 's2', name: 'Lengua', color: '#C4621A', passGrade: 5, createdAt: 1, updatedAt: 1 },
    ];
    const { sb, saved } = makeSandbox({ subjects });
    const r = await sb.updateSubject('s1', { name: 'Matemáticas II', color: '#3A7BD5', passGrade: '4,5' });
    const s1 = sb.state.subjects.find(s => s.id === 's1');
    check('E1. cambia nombre, color y aprobado; conserva id y createdAt', r.ok && s1.name === 'Matemáticas II' && s1.color === '#3A7BD5' && s1.passGrade === 4.5 && s1.createdAt === 1);
    check('E2. actualiza updatedAt y se guarda', s1.updatedAt > 1 && saved.length === 1);
    const same1 = await sb.updateSubject('s1', { name: 'matemáticas ii', color: '#3A7BD5', passGrade: 5 });
    check('E3. puede mantener su propio nombre (cambiando mayúsculas)', same1.ok);
    const dup = await sb.updateSubject('s1', { name: 'LENGUA', color: '#3A7BD5' });
    check('E4. no puede usar el nombre de otra asignatura', !dup.ok && !!dup.errors.name);
    const missing = await sb.updateSubject('nope', { name: 'X', color: '#3A7BD5' });
    check('E5. una asignatura que no existe -> error', !missing.ok);
  }

  // =====================================================================
  section('F) Borrar (no se puede si tiene exámenes)');
  // =====================================================================
  {
    const subjects = [{ id: 's1', name: 'Mates', color: '#D64545', passGrade: 5 }, { id: 's2', name: 'Lengua', color: '#C4621A', passGrade: 5 }];
    const exams = [{ id: 'e1', subjectId: 's1' }, { id: 'e2', subjectId: 's1' }, { id: 'e3', subjectId: 's2' }];
    const { sb, saved, calls } = makeSandbox({ subjects, exams });
    const blocked = await sb.deleteSubject('s1');
    check('F1. con exámenes -> no se borra y devuelve cuántos tiene', !blocked.ok && blocked.examCount === 2 && sb.state.subjects.length === 2 && saved.length === 0);
    await sb.confirmDeleteSubject('s1');
    check('F2. el botón Borrar avisa con el número de exámenes y no pide confirmación', calls.alerts.length === 1 && calls.alerts[0].includes('2 exámenes') && calls.alerts[0].includes('Mates') && calls.confirms.length === 0);
    sb.state.exams = sb.state.exams.filter(e => e.subjectId !== 's2');
    await sb.confirmDeleteSubject('s2');
    check('F3. sin exámenes -> pide confirmación, borra, guarda y repinta', calls.confirms.length === 1 && !sb.state.subjects.some(s => s.id === 's2') && saved.length === 1 && calls.renders === 1);
    const one = makeSandbox({ subjects, exams: [{ id: 'e1', subjectId: 's2' }] });
    await one.sb.confirmDeleteSubject('s2');
    check('F4. con un solo examen dice "1 examen"', one.calls.alerts[0].includes('1 examen') && !one.calls.alerts[0].includes('exámenes'));
    const cancel = makeSandbox({ subjects, confirmAnswer: false });
    await cancel.sb.confirmDeleteSubject('s1');
    check('F5. si cancelas la confirmación no se borra nada', cancel.sb.state.subjects.length === 2 && cancel.saved.length === 0);
    const withClasses = makeSandbox({ subjects, customSchedules: [
      { id: 'c1', name: 'Mates', days: [0], startTime: '09:00', endTime: '10:00', subjectId: 's1' },
      { id: 'c2', name: 'Mates', days: [2], startTime: '09:00', endTime: '10:00', subjectId: 's1' },
      { id: 'g', name: 'Gimnasio', days: [1], startTime: '18:00', endTime: '19:00' },
    ] });
    const blockedByClasses = await withClasses.sb.deleteSubject('s1');
    check('F6. (2b) con clases en el horario -> no se borra y devuelve cuántas', !blockedByClasses.ok && blockedByClasses.classCount === 2 && blockedByClasses.examCount === 0 && withClasses.saved.length === 0);
    await withClasses.sb.confirmDeleteSubject('s1');
    check('F7. (2b) el botón Borrar avisa de "2 clases en el horario" sin pedir confirmación', withClasses.calls.alerts.length === 1 && withClasses.calls.alerts[0].includes('2 clases en el horario') && withClasses.calls.confirms.length === 0);
    await withClasses.sb.confirmDeleteSubject('s2');
    check('F8. (2b) una asignatura sin clases se sigue pudiendo borrar', !withClasses.sb.state.subjects.some(s => s.id === 's2'));
  }

  // =====================================================================
  section('F2) (2b) Renombrar una asignatura renombra sus clases');
  // =====================================================================
  {
    const { sb, savedSchedules } = makeSandbox({
      subjects: [{ id: 's1', name: 'Mates', color: '#D64545', passGrade: 5 }],
      customSchedules: [
        { id: 'c1', name: 'Mates', days: [0], startTime: '09:00', endTime: '10:00', subjectId: 's1' },
        { id: 'g', name: 'Gimnasio', days: [1], startTime: '18:00', endTime: '19:00' },
      ],
    });
    await sb.updateSubject('s1', { name: 'Matemáticas', color: '#D64545', passGrade: 5 });
    check('R1. la clase pasa a llamarse como la asignatura y se guarda', sb.state.customSchedules[0].name === 'Matemáticas' && savedSchedules.length === 1);
    check('R2. los bloques sin asignatura no cambian', sb.state.customSchedules[1].name === 'Gimnasio');
    await sb.updateSubject('s1', { name: 'Matemáticas', color: '#3A7BD5', passGrade: 5 });
    check('R3. si el nombre no cambia, no se vuelve a guardar el horario', savedSchedules.length === 1);
  }

  // =====================================================================
  section('G) Lista en Ajustes');
  // =====================================================================
  {
    const { sb } = makeSandbox({ subjects: [{ id: 's2', name: 'Química', color: '#3A9149', passGrade: 4.5 }, { id: 's1', name: 'Biología <b>', color: '#D64545', passGrade: 5 }] });
    const rows = sb.renderSubjectRows();
    check('G1. ordenadas por nombre, con color y "Aprobado con 4,5"', rows.indexOf('Biología') < rows.indexOf('Química') && rows.includes('background:#3A9149') && rows.includes('Aprobado con 4,5'));
    check('G2. botones Editar y Borrar en cada fila y "+ Añadir asignatura"', (rows.match(/data-subject-edit=/g) || []).length === 2
      && (rows.match(/data-subject-delete=/g) || []).length === 2 && rows.includes('id="btn-add-subject"'));
    check('G3. el nombre se escapa', rows.includes('Biología &lt;b&gt;') && !rows.includes('<b>'));
    check('G4. sin asignaturas muestra un mensaje', makeSandbox().sb.renderSubjectRows().includes('Todavía no tienes asignaturas'));
    const accordion = renderAjustesSrc.indexOf("ajustesAccordionSection('asignaturas'");
    check('G5. "Asignaturas" es la primera sección de Ajustes', accordion !== -1 && accordion < renderAjustesSrc.indexOf("ajustesAccordionSection('organizacion'"));
    check('G6. los botones están conectados', ['openSubjectModal()', 'openSubjectModal({ subjectId: btn.dataset.subjectEdit })', 'confirmDeleteSubject(btn.dataset.subjectDelete)'].every(s => renderAjustesSrc.includes(s)));
  }

  // =====================================================================
  section('H) Importar una copia');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    const { kept, discarded } = sb.sanitizeImportedSubjects([
      { id: 's1', name: ' Mates ', color: '#D64545', passGrade: 4.5, extra: 1 },
      { id: 's2', name: 'Sin color', color: 'rojo', passGrade: 'nada' },
      { id: 's3', name: '  ' },
      { id: 's4', color: '#D64545' },
    ]);
    check('H1. conserva las válidas con todos sus campos', same(kept[0], { id: 's1', name: 'Mates', color: '#D64545', passGrade: 4.5, extra: 1 }));
    check('H2. color o aprobado no válidos -> primer color de la paleta y 5', kept[1].color === sb.SUBJECT_COLORS[0].color && kept[1].passGrade === 5);
    check('H3. sin nombre -> se descarta', kept.length === 2 && discarded === 2);
    check('H4. el import aplica esta validación y cuenta los descartados', importFnSrc.includes('sanitizeImportedSubjects(state.subjects)') && importFnSrc.includes('sanitizedStudy.subjects.discarded += sanitizedSubjects.discarded'));
  }

  // =====================================================================
  section('I) Ajustes: solo Asignaturas, Cuenta, Copia de seguridad y versión');
  // =====================================================================
  {
    const src = renderAjustesSrc;
    const visible = src.slice(src.indexOf('<div class="settings-accordion">'), src.indexOf('<div class="settings-hidden-sections" hidden>'));
    const hidden = src.slice(src.indexOf('<div class="settings-hidden-sections" hidden>'));
    check('I1. visibles, en este orden: Asignaturas, Cuenta, Copia de seguridad, Información', ["'asignaturas'", "'cuenta'", "'datos', 'Copia de seguridad'", "'informacion'"]
      .map(k => visible.indexOf(k)).every((i, n, arr) => i !== -1 && (n === 0 || i > arr[n - 1])));
    check('I2. oculta (pero se sigue pintando): Organización (Horarios bloqueados); las secciones de IA y Recordatorios ya no existen', hidden.includes("'organizacion'") && !visible.includes("'organizacion'")
      && !src.includes("ajustesAccordionSection('ia'") && !src.includes('id="toggle-ia"')
      && !src.includes("ajustesAccordionSection('recordatorios'") && !src.includes('id="btn-enable-notifications"'));
    check('I3. estadísticas de duración ocultas; la versión sigue a la vista', /<div hidden>\s*\$\{renderDurationStatsSection\(\)\}\s*\$\{renderGeneralPatternsSection\(\)\}\s*<\/div>/.test(src) && src.includes('versión ${APP_VERSION}'));
    check('I4. Copia de seguridad: Exportar e Importar; "Borrar todos los datos" oculto (su código sigue)', src.includes('id="btn-export-data">⬇️ Exportar copia') && src.includes('id="btn-import-data">⬆️ Importar copia')
      && src.includes('id="btn-delete-data" hidden>') && html.includes('async function deleteAllData(){'));
    check('I5. Cuenta: cerrar sesión y estado de sincronización', src.includes('id="btn-logout"') && src.includes('id="sync-status-text"'));
  }

  {
    const { sb } = makeSandbox();
    const yes = await sb.addSubject({ name: 'Arte', color: '#D64545' });
    const no = await sb.addSubject({ name: 'Tutoría', color: '#3A7BD5', graded: false });
    check('J1. "Lleva nota": sí por defecto, no si se desmarca', yes.subject.graded === true && no.subject.graded === false);
    await sb.updateSubject(no.subject.id, { name: 'Tutoría', color: '#3A7BD5', graded: true });
    check('J2. se puede volver a marcar', sb.state.subjects.find(x => x.id === no.subject.id).graded === true);
    const modalSrc2 = html.slice(html.indexOf('function openSubjectModal('), html.indexOf('function openSubjectModal(') + 9000);
    check('J3. la ventana de la asignatura tiene la casilla "Lleva nota" (marcada salvo graded === false)', modalSrc2.includes('id="subject-graded" name="graded"') && modalSrc2.includes("existing && existing.graded === false ? '' : 'checked'") && modalSrc2.includes("graded: fd.get('graded') === 'on'"));
    sb.state.subjects.find(x => x.id === no.subject.id).graded = false;
    check('J4. en Ajustes una asignatura sin nota dice "No lleva nota"', sb.renderSubjectRows().includes('No lleva nota'));
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
