/**
 * ORGANIZATOR — Tests de la vista Horario de la app de exámenes (clases y recreo)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html el bloque "HORARIOS BLOQUEADOS" (subjectId de cada
 * bloque) y el bloque "VISTA HORARIO (app de exámenes)", y los
 * ejecuta en un sandbox (mismo patrón que test-subjects.js). renderHorario
 * se ejecuta con un document mínimo que solo guarda el innerHTML. De la
 * ventana del bloque, el menú y el import solo se comprueba el contenido.
 *
 * Uso:  node js/test-horario.js
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
const schedulesSrc = extractBetween(html, `${HDR}HORARIOS BLOQUEADOS`, '\nfunction dowOfDate(', 'bloque HORARIOS BLOQUEADOS');
const horarioSrc = extractBetween(html, `${HDR}VISTA HORARIO (app de exámenes)
`, `\n${HDR}MODAL: HORARIO BLOQUEADO`, 'bloque VISTA HORARIO');
const scheduleModalSrc = extractBetween(html, 'function openScheduleModal(', `\n${HDR}`, 'openScheduleModal()');
const scheduleRowsSrc = extractBetween(html, 'function renderScheduleRows(){', '\n}\n', 'renderScheduleRows()') + '\n}\n';
const textColorOnSrc = 'const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;\n' + extractBetween(html, 'function textColorOn(hex){', '\n}\n', 'textColorOn()') + '\n}\n';
const escSrc = extractBetween(html, 'function esc(s){', '\n}\n', 'esc()') + '\n}\n';
const importFnSrc = extractBetween(html, 'function initSettingsDataIO(){', '\nasync function deleteAllData(){', 'initSettingsDataIO()');
const renderCurrentViewSrc = extractBetween(html, 'function renderCurrentView(){', '\n}\n', 'renderCurrentView()');

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}
function section(title) { console.log('\n' + title); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MATES = { id: 's1', name: 'Mates', color: '#D64545', passGrade: 5 };
const LENGUA = { id: 's2', name: 'Lengua <b>', color: '#3A7BD5', passGrade: 5 };

function makeSandbox({ subjects = [], customSchedules = [], todayDow = 0 } = {}) {
  const saved = [];
  const view = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  let seq = 0;
  const sb = {
    console,
    state: { subjects: JSON.parse(JSON.stringify(subjects)), customSchedules: JSON.parse(JSON.stringify(customSchedules)) },
    uid: () => 'id' + (++seq),
    saveCustomSchedules: async () => { saved.push(JSON.stringify(sb.state.customSchedules)); },
    DOW_SHORT: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    DOW_FULL_MONFIRST: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
    pad: (n) => String(n).padStart(2, '0'),
    todayStr: () => '2026-10-05',
    dowOfDate: () => todayDow,
    openScheduleModal: () => {},
    document: { getElementById: (id) => (id === 'view-horario' ? view : null) },
  };
  vm.createContext(sb);
  vm.runInContext([escSrc, textColorOnSrc, schedulesSrc, horarioSrc, scheduleRowsSrc,
    'Object.assign(this, { scheduleSubject, addCustomSchedule, updateCustomSchedule, horarioLayout, hhmmToMin, minToHHMM, horarioSlots, horarioSlotPrefill, renderHorario, renderScheduleRows, HORARIO_SLOT_PX });'].join('\n'), sb);
  return { sb, saved, view };
}

(async () => {
  // =====================================================================
  section('A) Bloques de horario con asignatura');
  // =====================================================================
  {
    const { sb, saved } = makeSandbox({ subjects: [MATES] });
    await sb.addCustomSchedule({ name: 'Mates', days: [0, 2], startTime: '09:00', endTime: '10:00', subjectId: 's1' });
    await sb.addCustomSchedule({ name: 'Gimnasio', days: [1], startTime: '18:00', endTime: '19:00' });
    const [cls, gym] = sb.state.customSchedules;
    check('A1. un bloque nuevo guarda su subjectId', cls.subjectId === 's1' && saved.length === 2);
    check('A2. sin asignatura -> subjectId null', gym.subjectId === null);
    await sb.updateCustomSchedule(cls.id, { name: 'Mates', days: [0], startTime: '09:00', endTime: '10:00', subjectId: '' });
    check('A3. al editar se puede quitar la asignatura', sb.state.customSchedules[0].subjectId === null);
    check('A4. scheduleSubject devuelve la asignatura o null', sb.scheduleSubject({ subjectId: 's1' }).name === 'Mates'
      && sb.scheduleSubject({ subjectId: 'borrada' }) === null && sb.scheduleSubject(gym) === null);
  }

  // =====================================================================
  section('B) Tabla de 8:00 a 14:30 (horarioLayout)');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    const subjects = [MATES, LENGUA];
    const empty = sb.horarioLayout([], subjects);
    check('B1. sin clases -> 5 días vacíos (la tabla se pinta igual)', empty.days.length === 5 && empty.days.every(d => d.length === 0));
    const layout = sb.horarioLayout([
      { id: 'c1', days: [0, 2], startTime: '08:30', endTime: '09:25', subjectId: 's1' },
      { id: 'c2', days: [0], startTime: '12:10', endTime: '13:05', subjectId: 's2' },
      { id: 'g', name: 'Gimnasio', days: [0], startTime: '10:00', endTime: '11:00' },
      { id: 'recreo', name: 'Recreo', days: [0, 1, 2, 3, 4], startTime: '11:00', endTime: '11:30', inHorario: true },
      { id: 'finde', days: [5, 6], startTime: '10:00', endTime: '11:00', subjectId: 's1' },
      { id: 'mal', days: [1], startTime: '11:00', endTime: '10:00', subjectId: 's1' },
      { id: 'tarde', days: [1], startTime: '16:00', endTime: '17:00', subjectId: 's1' },
      { id: 'larga', days: [3], startTime: '07:30', endTime: '15:00', subjectId: 's2' },
    ], subjects);
    const all = layout.days.flat();
    check('B2. 5 días (lunes a viernes); sábado y domingo no salen', layout.days.length === 5 && !all.some(it => it.id === 'finde'));
    check('B3. una clase que se repite sale en cada uno de sus días', layout.days[0].some(it => it.id === 'c1') && layout.days[2].some(it => it.id === 'c1'));
    const c1 = layout.days[0].find(it => it.id === 'c1');
    check('B4. posición en minutos desde las 8:00, con nombre y color de la asignatura', c1.top === 30 && c1.height === 55 && c1.name === 'Mates' && c1.color === '#D64545' && c1.isClass);
    const recreo = layout.days[1].find(it => it.id === 'recreo');
    check('B5. un bloque sin asignatura creado desde Horario (recreo) sale, sin color', recreo && !recreo.isClass && recreo.color === null && recreo.name === 'Recreo' && layout.days.every(d => d.some(it => it.id === 'recreo')));
    check('B6. no salen bloques de rutina de Ajustes (gimnasio), horas imposibles ni clases fuera de 8:00–14:30', !all.some(it => ['g', 'mal', 'tarde'].includes(it.id)));
    const larga = layout.days[3].find(it => it.id === 'larga');
    check('B7. una clase que se sale de la tabla se recorta a 8:00–14:30 pero muestra su hora real', larga.top === 0 && larga.height === 390 && larga.startTime === '07:30');
    const overlap = sb.horarioLayout([
      { id: 'a', days: [1], startTime: '09:00', endTime: '11:00', subjectId: 's1' },
      { id: 'b', days: [1], startTime: '10:00', endTime: '11:00', subjectId: 's2' },
      { id: 'c', days: [1], startTime: '11:00', endTime: '12:00', subjectId: 's2' },
    ], subjects).days[1];
    const byId = Object.fromEntries(overlap.map(it => [it.id, it]));
    check('B8. dos clases que se solapan van en carriles distintos', byId.a.lanes === 2 && byId.b.lanes === 2 && byId.a.lane !== byId.b.lane);
    check('B9. una clase que empieza cuando acaba otra ocupa todo el ancho', byId.c.lanes === 1 && byId.c.lane === 0);
    check('B10. hhmmToMin / minToHHMM', sb.hhmmToMin('08:30') === 510 && sb.hhmmToMin('9:05') === 545 && sb.hhmmToMin('') === null && sb.hhmmToMin('8h') === null && sb.minToHHMM(545) === '09:05');
    const slots = sb.horarioSlots();
    check('B11. 13 franjas de 30 min: de 08:00 a 14:00', slots.length === 13 && slots[0] === 480 && slots[12] === 840);
    check('B12. al tocar una franja propone 1 hora ese día, sin pasar de 14:30',
      same(sb.horarioSlotPrefill(2, 540), { days: [2], startTime: '09:00', endTime: '10:00' })
      && same(sb.horarioSlotPrefill(4, 840), { days: [4], startTime: '14:00', endTime: '14:30' }));
  }

  // =====================================================================
  section('C) Vista Horario (renderHorario)');
  // =====================================================================
  {
    const noSubjects = makeSandbox();
    noSubjects.sb.renderHorario();
    check('C1. sin asignaturas: avisa de crearlas en Ajustes, pero la tabla se puede tocar (recreo)', noSubjects.view.innerHTML.includes('Ajustes › Asignaturas') && noSubjects.view.innerHTML.includes('data-horario-slot='));
    const full = makeSandbox({ subjects: [MATES, LENGUA], todayDow: 2, customSchedules: [
      { id: 'c1', name: 'Mates', days: [0, 2], startTime: '08:30', endTime: '09:25', subjectId: 's1' },
      { id: 'c2', name: 'Lengua <b>', days: [4], startTime: '12:00', endTime: '13:00', subjectId: 's2' },
      { id: 'r', name: 'Recreo', days: [0], startTime: '11:00', endTime: '11:30', inHorario: true },
    ] });
    full.sb.renderHorario();
    const out = full.view.innerHTML;
    check('C2. cabecera Lunes–Viernes (sin sábado ni domingo) y el día de hoy resaltado (cabecera y columna)', ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'].every(d => out.includes(`horario-day-full">${d}</span>`)) && !out.includes('Sábado')
      && out.includes('class="horario-day-name today is-selected" data-horario-day="2"') && out.includes('class="horario-col today is-selected" data-horario-day="2"'));
    check('C2b. pestañas L M X J V para el móvil, empezando por hoy', ['L', 'M', 'X', 'J', 'V'].every((d, i) => out.includes(`data-horario-tab="${i}" aria-label="`) && out.includes(`>${d}</button>`))
      && out.includes('class="horario-tab today is-selected" data-horario-tab="2"'));
    const weekend = makeSandbox({ subjects: [MATES], todayDow: 6 });
    weekend.sb.renderHorario();
    check('C2c. en fin de semana el móvil empieza por el lunes', weekend.view.innerHTML.includes('class="horario-tab is-selected" data-horario-tab="0"'));
    check('C2d. filas de 46 px por media hora; las horas en punto marcadas', full.sb.HORARIO_SLOT_PX === 46 && out.includes('class="horario-hour is-hour"') && out.includes('class="horario-slot is-hour"'));
    check('C3. etiquetas de 08:00 a 14:00 cada media hora', ['08:00', '08:30', '11:30', '14:00'].every(h => out.includes(`>${h}</div>`)) && !out.includes('>14:30</div>') && !out.includes('>07:30</div>'));
    check('C4. 5 × 13 franjas tocables con su día y hora', (out.match(/data-horario-slot=/g) || []).length === 65 && out.includes('data-horario-slot="4|840"') && out.includes('aria-label="Añadir clase el Lunes a las 08:00"'));
    check('C5. 3 clases y 1 recreo pintados; las clases rellenas con el color de su asignatura y texto blanco o negro', (out.match(/data-horario-class=/g) || []).length === 4
      && out.includes('background:#D64545;border-left-color:#D64545;color:#000000;') && (out.match(/horario-break/g) || []).length === 1);
    const px = 30 / 30 * full.sb.HORARIO_SLOT_PX;
    check('C6. posición en píxeles según la hora', out.includes(`top:${px.toFixed(1)}px;height:${(55 / 30 * full.sb.HORARIO_SLOT_PX).toFixed(1)}px`));
    check('C7. el nombre se escapa', out.includes('Lengua &lt;b&gt;') && !out.includes('Lengua <b>'));
  }

  // =====================================================================
  section('D) Ventana del bloque, lista de Ajustes, menú e import');
  // =====================================================================
  {
    check('D1. la ventana ofrece la asignatura solo si hay asignaturas; en Ajustes "Ninguna", en Horario "Sin asignatura"', scheduleModalSrc.includes('name="subjectId"') && scheduleModalSrc.includes('<option value="">Ninguna</option>') && scheduleModalSrc.includes('Sin asignatura (recreo, tutoría…)') && scheduleModalSrc.includes('state.subjects.length ?'));
    check('D2. al guardar una clase el nombre es el de la asignatura', scheduleModalSrc.includes('name: subject ? subject.name :') && scheduleModalSrc.includes('subjectId: subject ? subject.id : null'));
    check('D3. tras guardar o borrar se repinta la vista actual (Ajustes u Horario)', (scheduleModalSrc.match(/renderCurrentView\(\)/g) || []).length === 2 && !scheduleModalSrc.includes('renderAjustes()'));
    check('D4. desde Horario: franja nueva obliga a elegir asignatura, usa día/horas de la franja y marca inHorario',
      scheduleModalSrc.includes('<option value="" disabled selected>Elige una asignatura…</option>') && scheduleModalSrc.includes('const base = existing || prefill || {}')
      && scheduleModalSrc.includes('inHorario: fromHorario || !!(existing && existing.inHorario)'));
    check('D5. la hora de fin tiene que ser posterior a la de inicio', scheduleModalSrc.includes("if(data.endTime <= data.startTime)"));
    const { sb } = makeSandbox({ subjects: [MATES], customSchedules: [
      { id: 'c1', name: 'Mates', days: [0], startTime: '09:00', endTime: '10:00', subjectId: 's1' },
      { id: 'g', name: 'Gimnasio', days: [1], startTime: '18:00', endTime: '19:00' },
    ] });
    const rows = sb.renderScheduleRows();
    check('D6. en Ajustes las clases llevan el punto de color de su asignatura', rows.includes('background:#D64545') && (rows.match(/subject-dot/g) || []).length === 1);
    check('D7. menú: Inicio, Calendario, Horario, Ajustes (sin Semana); la vista Semana ya no existe',
      ['inicio', 'calendario', 'horario', 'ajustes'].every(v => html.includes(`data-view="${v}"`)) && !html.includes('data-view="semana"')
      && !html.includes('id="view-semana"') && !html.includes('function renderSemana(){') && renderCurrentViewSrc.includes("currentView === 'horario') renderHorario()"));
    check('D8. import: una clase cuya asignatura no viene en la copia pierde el subjectId', importFnSrc.includes('!state.subjects.some(x => x.id === s.subjectId)) ? { ...s, subjectId: null }'));
  }

  // =====================================================================
  section('E) inHorario al crear y editar');
  // =====================================================================
  {
    const { sb } = makeSandbox();
    await sb.addCustomSchedule({ name: 'Recreo', days: [0], startTime: '11:00', endTime: '11:30', inHorario: true });
    await sb.addCustomSchedule({ name: 'Gimnasio', days: [1], startTime: '18:00', endTime: '19:00' });
    check('E1. se guarda inHorario (true en el recreo, false en un bloque de Ajustes)', sb.state.customSchedules[0].inHorario === true && sb.state.customSchedules[1].inHorario === false);
    await sb.updateCustomSchedule(sb.state.customSchedules[0].id, { name: 'Recreo', days: [0, 1], startTime: '11:00', endTime: '11:30' });
    check('E2. editar sin indicar inHorario lo conserva', sb.state.customSchedules[0].inHorario === true && same(sb.state.customSchedules[0].days, [0, 1]));
  }

  // =====================================================================
  section('F) Tamaño y legibilidad (CSS)');
  // =====================================================================
  {
    const css = html.slice(html.indexOf('/* Vista Horario:'), html.indexOf('.btn-danger{'));
    check('F1. en el ordenador la tabla usa todo el ancho', css.includes('main:has(#view-horario.active){max-width:none;}'));
    check('F2. nombre de la asignatura grande, en negrita y sin cortarse con "…"', css.includes('.horario-class-name{font-size:14.5px;font-weight:700;') && css.includes('overflow-wrap:anywhere')
      && !/\.horario-class-name\{[^}]*(ellipsis|nowrap)/.test(css));
    check('F3. medias horas con línea discontinua y horas con línea continua', css.includes('border-top:1px dashed var(--line)') && css.includes('.horario-slot.is-hour{border-top-style:solid;}'));
    check('F4. móvil en vertical: pestañas y un solo día', /@media \(max-width:640px\) and \(orientation:portrait\)\{[^@]*\.horario-tabs\{display:flex;\}[^@]*\.horario-col:not\(\.is-selected\)\{display:none;\}/.test(css));
    check('F5. móvil en horizontal: la semana entera (sin pestañas)', css.includes('@media (max-height:500px) and (orientation:landscape)') && css.includes('.horario-tabs{display:none;'));
  }

  console.log(`\n${pass} ✅  ·  ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
