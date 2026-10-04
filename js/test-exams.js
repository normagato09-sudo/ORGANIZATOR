/**
 * ORGANIZATOR — Tests de exámenes y entregas en el Calendario (app de exámenes)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html las constantes del modelo (STUDY_*), isValidYMDDate y el
 * bloque "EXÁMENES Y ENTREGAS (app de exámenes)", y los ejecuta en un
 * sandbox (mismo patrón que test-subjects.js). Del calendario y de la
 * ventana solo se comprueba el contenido.
 *
 * Uso:  node js/test-exams.js
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
const examsSrc = extractBetween(html, `${HDR}EXÁMENES Y ENTREGAS (app de exámenes)`, `\n${HDR}RENDER: AJUSTES`, 'bloque EXÁMENES Y ENTREGAS');
const ymdSrc = extractBetween(html, 'const IMPORT_DATE_YMD_RE', '\n}\n', 'isValidYMDDate()') + '\n}\n';
const escSrc = extractBetween(html, 'function esc(s){', '\n}\n', 'esc()') + '\n}\n';
const renderCalendarSrc = extractBetween(html, 'function renderCalendar(){', '\nfunction renderDayPanel(){', 'renderCalendar()');
const renderDayPanelSrc = extractBetween(html, 'function renderDayPanel(){', "\ndocument.getElementById('cal-prev')", 'renderDayPanel()');
const openExamModalSrc = extractBetween(examsSrc, 'function openExamModal(', '\n}\n', 'openExamModal()');

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}
function section(title) { console.log('\n' + title); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MATES = { id: 's1', name: 'Mates', color: '#D64545', passGrade: 5 };
const LENGUA = { id: 's2', name: 'Lengua <b>', color: '#3A7BD5', passGrade: 5 };

function makeSandbox({ subjects = [MATES, LENGUA], exams = [], confirmAnswer = true } = {}) {
  const saved = [];
  const calls = { confirms: [], toasts: [], renders: 0 };
  let seq = 0;
  const sb = {
    console,
    state: { subjects: JSON.parse(JSON.stringify(subjects)), exams: JSON.parse(JSON.stringify(exams)) },
    uid: () => 'e' + (++seq),
    saveExams: async () => { saved.push(JSON.stringify(sb.state.exams)); },
    showToast: (m) => calls.toasts.push(m),
    confirm: (m) => { calls.confirms.push(m); return confirmAnswer; },
    renderCurrentView: () => { calls.renders++; },
    todayStr: () => '2026-10-05',
    DOW_NAMES: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
    DOW_SHORT: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    MONTH_NAMES: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    parseYMD: (x) => { const [y, m, d] = x.split('-').map(Number); return new Date(y, m - 1, d); },
    humanDateShort: (x) => 'corta:' + x,
  };
  vm.createContext(sb);
  vm.runInContext([escSrc, studyConstSrc, ymdSrc, examsSrc,
    'Object.assign(this, { termForDate, examTypeLabel, examSubject, validateExamData, addExam, updateExam, deleteExam, examsOnDate, examRowHTML, confirmDeleteExam, daysBetween, daysLeftLabel, upcomingExams, renderUpcomingHTML, UPCOMING_LIST_MAX });'].join('\n'), sb);
  return { sb, saved, calls };
}

const FORM = { subjectId: 's1', type: 'examen', title: '  Tema 3  ', date: '2026-10-20', time: '', term: '1', notes: '' };

(async () => {
  // =====================================================================
  section('A) Trimestre según la fecha');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    check('A1. septiembre a diciembre -> 1', [9, 10, 11, 12].every(m => sb.termForDate(`2026-${String(m).padStart(2, '0')}-15`) === 1));
    check('A2. enero a marzo -> 2', ['2027-01-08', '2027-02-28', '2027-03-31'].every(d => sb.termForDate(d) === 2));
    check('A3. abril a junio -> 3', ['2027-04-01', '2027-05-15', '2027-06-30'].every(d => sb.termForDate(d) === 3));
    check('A4. julio, agosto o fecha vacía -> sin trimestre', sb.termForDate('2027-07-10') === null && sb.termForDate('2027-08-31') === null && sb.termForDate('') === null);
  }

  // =====================================================================
  section('B) Validar el formulario');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    const ok = sb.validateExamData(FORM);
    check('B1. un formulario correcto pasa, con el título recortado y sin hora -> null', ok.ok && ok.value.title === 'Tema 3' && ok.value.time === null && ok.value.term === 1);
    const bad = sb.validateExamData({ subjectId: 'x', type: 'otro', title: '  ', date: '2026-02-30', time: '25:00', term: '4', notes: '' });
    check('B2. asignatura, tipo, título, fecha, hora y trimestre incorrectos dan su error', !bad.ok && ['subjectId', 'type', 'title', 'date', 'time', 'term'].every(k => bad.errors[k]));
    check('B3. trimestre vacío -> sin trimestre (vale)', sb.validateExamData({ ...FORM, term: '' }).value.term === null && sb.validateExamData({ ...FORM, term: '' }).ok);
    check('B4. hora opcional válida', sb.validateExamData({ ...FORM, time: '09:30' }).value.time === '09:30');
    check('B5. título demasiado largo', !sb.validateExamData({ ...FORM, title: 'x'.repeat(121) }).ok);
  }

  // =====================================================================
  section('C) Crear, editar y borrar');
  // =====================================================================
  {
    const { sb, saved, calls } = makeSandbox();
    const r = await sb.addExam({ ...FORM, notes: ' Temas 1-3 ' });
    const e = r.exam;
    check('C1. crea con los campos del formulario y guarda', r.ok && sb.state.exams.length === 1 && saved.length === 1
      && e.subjectId === 's1' && e.type === 'examen' && e.title === 'Tema 3' && e.date === '2026-10-20' && e.time === null && e.term === 1 && e.notes === 'Temas 1-3');
    check('C2. el resto del modelo queda con sus valores por defecto', e.weight === 20 && same(e.topics, []) && e.difficulty === 3
      && e.studyDaysBefore === null && e.deliveryStatus === null && e.recovers === null && e.grade === null && e.durationMinutes === null && typeof e.createdAt === 'number');
    const bad = await sb.addExam({ ...FORM, subjectId: '' });
    check('C3. si falta la asignatura no se guarda nada', !bad.ok && bad.errors.subjectId && sb.state.exams.length === 1 && saved.length === 1);
    const del = await sb.addExam({ ...FORM, type: 'trabajo', title: 'Trabajo célula' });
    check('C4. una entrega empieza como "pendiente"', del.exam.deliveryStatus === 'pendiente' && del.exam.weight === 15);
    const up = await sb.updateExam(e.id, { ...FORM, type: 'trabajo', title: 'Ya es un trabajo', date: '2027-01-12', time: '10:00', term: '2' });
    check('C5. editar cambia los campos; al pasar a entrega queda "pendiente" con el peso del tipo', up.ok && e.title === 'Ya es un trabajo' && e.term === 2 && e.time === '10:00' && e.deliveryStatus === 'pendiente' && e.weight === 15);
    e.grade = 7.5;
    await sb.updateExam(e.id, { ...FORM, type: 'examen', date: '2027-01-12', term: '2' });
    check('C6. al volver a prueba se quita el estado de entrega; la nota no se toca', e.deliveryStatus === null && e.grade === 7.5);
    check('C7. editar uno que no existe -> error', !(await sb.updateExam('nope', FORM)).ok);
    await sb.confirmDeleteExam(del.exam.id);
    check('C8. borrar pide confirmación, borra, avisa y repinta', calls.confirms.length === 1 && calls.confirms[0].includes('Trabajo célula') && !sb.state.exams.some(x => x.id === del.exam.id) && calls.renders === 1);
    const cancel = makeSandbox({ exams: [{ id: 'k', title: 'X', date: '2026-10-10' }], confirmAnswer: false });
    await cancel.sb.confirmDeleteExam('k');
    check('C9. si cancelas no se borra', cancel.sb.state.exams.length === 1 && cancel.saved.length === 0);
  }

  // =====================================================================
  section('D) En su día, con el color de su asignatura');
  // =====================================================================
  {
    const { sb } = makeSandbox({ exams: [
      { id: 'a', subjectId: 's1', type: 'examen', title: 'Sin hora', date: '2026-10-20', time: null, term: 1, notes: '' },
      { id: 'b', subjectId: 's2', type: 'exposicion', title: 'Expo <i>', date: '2026-10-20', time: '08:30', term: 1, notes: 'Llevar USB' },
      { id: 'c', subjectId: 's1', type: 'examen', title: 'Otro día', date: '2026-10-21', time: null, term: 1, notes: '' },
    ] });
    check('D1. examsOnDate: solo ese día, primero los que tienen hora', same(sb.examsOnDate('2026-10-20').map(e => e.id), ['b', 'a']));
    const row = sb.examRowHTML(sb.state.exams[1]);
    check('D2. la fila lleva el color, el tipo, la asignatura, la hora, el trimestre y las notas', row.includes('border-left:4px solid #3A7BD5') && row.includes('Exposición · Lengua &lt;b&gt;')
      && row.includes('08:30') && row.includes('1.º trimestre') && row.includes('Llevar USB'));
    check('D3. el título se escapa y hay botones de editar y borrar', row.includes('Expo &lt;i&gt;') && row.includes('data-action="edit-exam" data-id="b"') && row.includes('data-action="delete-exam" data-id="b"'));
    check('D4. sin hora -> "Sin hora"', sb.examRowHTML(sb.state.exams[0]).includes('Sin hora'));
    check('D5. el calendario pinta los exámenes del día con el color de su asignatura (máx. 2 y "+n")',
      renderCalendarSrc.includes('const dayExams = examsOnDate(dateStr);') && renderCalendarSrc.includes('class="cal-exam" style="background:${esc(color)}26;border-left-color:${esc(color)};"')
      && renderCalendarSrc.includes('dayExams.slice(0, 2)') && renderCalendarSrc.includes('+${dayExams.length - 2}'));
    check('D6. el panel del día lista los exámenes primero, con editar y borrar',
      renderDayPanelSrc.includes('${dayExams.map(ex=>examRowHTML(ex)).join(\'\')}') && renderDayPanelSrc.includes('openExamModal({examId:b.dataset.id})') && renderDayPanelSrc.includes('confirmDeleteExam(b.dataset.id)'));
    check('D7. botón "+ Examen" en el Calendario (día elegido o hoy)', html.includes('id="day-add-exam"') && html.includes("openExamModal({date: cal.selected || todayStr()})"));
  }

  // =====================================================================
  section('E) Ventana del examen');
  // =====================================================================
  {
    const src = openExamModalSrc;
    check('E1. campos: asignatura, tipo, título, fecha, hora, trimestre y notas', ['name="subjectId"', 'name="type"', 'name="title"', 'name="date"', 'name="time"', 'name="term"', 'name="notes"'].every(f => src.includes(f)));
    check('E2. tipos agrupados en Pruebas y Entregas', src.includes('<optgroup label="Pruebas">') && src.includes('<optgroup label="Entregas">'));
    check('E3. el trimestre se rellena con la fecha y sigue a la fecha hasta que lo cambias a mano',
      src.includes('termForDate(startDate)') && src.includes("termSelect.addEventListener('change', () => { termTouched = true; })") && src.includes('if(termTouched) return;'));
    check('E4. sin asignaturas, pide crearlas en Ajustes', src.includes('Primero añade tus asignaturas en Ajustes › Asignaturas.'));
    check('E5. al editar se puede eliminar', src.includes('id="exam-delete-btn"') && src.includes('await deleteExam(examId)'));
  }

  // =====================================================================
  section('F) Inicio: próximo examen o entrega y los siguientes');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    check('F1. daysBetween cuenta días enteros (también con cambio de hora y de año)', sb.daysBetween('2026-10-05', '2026-10-05') === 0
      && sb.daysBetween('2026-10-24', '2026-10-26') === 2 && sb.daysBetween('2026-12-31', '2027-01-01') === 1);
    check('F2. Hoy / Mañana / En n días', sb.daysLeftLabel(0) === 'Hoy' && sb.daysLeftLabel(1) === 'Mañana' && sb.daysLeftLabel(15) === 'En 15 días');
    check('F3. sin exámenes: mensaje que manda al Calendario', sb.renderUpcomingHTML('2026-10-05').includes('Apúntalos en el <strong>Calendario</strong>'));

    const exams = [
      { id: 'pasado', subjectId: 's1', type: 'examen', title: 'Ya pasó', date: '2026-10-01', time: null },
      { id: 'tarde', subjectId: 's2', type: 'trabajo', title: 'Trabajo', date: '2026-10-20', time: null },
      { id: 'pronto', subjectId: 's1', type: 'examen', title: 'Tema <1>', date: '2026-10-20', time: '09:00' },
      { id: 'hoy', subjectId: 's2', type: 'examen', title: 'Control', date: '2026-10-05', time: '12:00' },
    ];
    const withExams = makeSandbox({ exams });
    check('F4. upcomingExams: de hoy en adelante, por fecha y hora (sin hora al final)', same(withExams.sb.upcomingExams('2026-10-05').map(e => e.id), ['hoy', 'pronto', 'tarde']));
    const out = withExams.sb.renderUpcomingHTML('2026-10-05');
    const heroEnd = out.indexOf('</button>');
    const hero = out.slice(0, heroEnd);
    check('F5. arriba el próximo (hoy) con "Hoy", su asignatura y su color', hero.includes('data-upcoming-exam="hoy"') && hero.includes('>Hoy<') && hero.includes('Lengua &lt;b&gt;') && hero.includes('border-left-color:#3A7BD5'));
    check('F6. la fecha larga del próximo, con su hora', hero.includes('lunes 5 de octubre · 12:00'));
    check('F7. debajo, los siguientes con los días que faltan; no sale el pasado', out.includes('Después') && out.includes('data-upcoming-exam="pronto"') && out.includes('En 15 días')
      && out.includes('data-upcoming-exam="tarde"') && !out.includes('Ya pasó'));
    check('F8. los títulos se escapan', out.includes('Tema &lt;1&gt;') && !out.includes('Tema <1>'));
    const future = makeSandbox({ exams: [{ id: 'x', subjectId: 's1', type: 'examen', title: 'Lejos', date: '2026-10-20', time: null }] });
    const one = future.sb.renderUpcomingHTML('2026-10-05');
    check('F9. si es dentro de varios días: número grande + "días"; sin lista "Después" si es el único', one.includes('next-exam-num">15<') && one.includes('>días<') && !one.includes('Después'));
    const many = makeSandbox({ exams: Array.from({ length: 14 }, (_, i) => ({ id: 'm' + i, subjectId: 's1', type: 'examen', title: 'E' + i, date: `2026-11-${String(i + 1).padStart(2, '0')}`, time: null })) });
    const manyOut = many.sb.renderUpcomingHTML('2026-10-05');
    check('F10. la lista se corta en 10 y dice cuántos más hay', (manyOut.match(/class="upcoming-row"/g) || []).length === many.sb.UPCOMING_LIST_MAX && manyOut.includes('Y 3 más en el Calendario.'));
    check('F11. Inicio pinta el bloque arriba del todo', html.indexOf('id="upcoming-exams"') > 0 && html.indexOf('id="upcoming-exams"') < html.indexOf('id="today-timeline"')
      && extractBetween(html, 'function renderInicio(){', '\n}\n', 'renderInicio()').includes('renderUpcoming();'));
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
