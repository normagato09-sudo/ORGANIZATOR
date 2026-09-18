/**
 * ORGANIZATOR — Tests de UX-8 (rediseño de los modales de tarea/evento)
 *
 * Suite Node pura, SIN navegador ni jsdom: extrae literalmente de
 * organizator.html openTaskModal()/openEventModal() reales, el bloque
 * UX-8 (modalCollapsibleSection/wireModalCollapsibleSections), el bloque
 * RECURRENCIA — UI compartida (Fase R-5, recurrenceControlsHtml/
 * wireRecurrenceControls, sin tocar ni reimplementar), las constantes
 * DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES de las que depende
 * recurrenceControlsHtml, esc() y
 * los bloques RECORDATORIOS Fase 1/Fase 3 (reminderOptionsHtml/
 * reminderTargetDateTime/currentReminderMinutes/getRemindersForTarget),
 * y los ejecuta en un DOM mínimo simulado (mismo patrón que
 * test-event-category-orphan.js: solo lo que ambas funciones tocan de
 * forma síncrona al construir su HTML — los listeners de submit/click
 * nunca se disparan).
 *
 * Esta suite NO valida cálculo de ocurrencias, saneamiento ni disparo de
 * recordatorios (eso ya lo cubren test-recurrence-*.js/test-reminders-*.js):
 * solo que el HTML de los modales tiene la nueva estructura compacta
 * (campos principales visibles + secciones desplegables) y que, al
 * editar, esas secciones reflejan el estado ya guardado sin reiniciarlo.
 *
 * Uso:  node js/test-ux8-modal-redesign.js
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
// organizator.html se guarda con CRLF; se normaliza a LF solo para esta
// lectura en memoria (no se toca el archivo en disco) para que los
// marcadores de extractBetween, escritos con '\n', encuentren el texto.
const html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" (${JSON.stringify(startMarker)}) en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" (${JSON.stringify(endMarker)}) en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------
// Fragmentos reales de organizator.html.
// ---------------------------------------------------------------------
const escSrc = extractBetween(
  html,
  'function esc(s){',
  '\n\n/* ==================================================================\n   FILAS DE TAREA',
  'función esc()'
);
const dowConstsSrc = extractBetween(
  html,
  'const DOW_NAMES = ',
  '\n\n/* ==================================================================\n   AJUSTES',
  'constantes DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES'
);
const remindersFase1Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — estructura de datos mínima (Fase 1)',
  '\n\n/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)',
  'bloque RECORDATORIOS (Fase 1)'
);
const remindersFase3Src = extractBetween(
  html,
  '/* ==================================================================\n   RECORDATORIOS — integración con la interfaz (Fase 3, SIN notificaciones)',
  '\n\n/* ==================================================================\n   TOAST',
  'bloque RECORDATORIOS (Fase 3, integración UI)'
);
const recurrenceUiSrc = extractBetween(
  html,
  '/* ==================================================================\n   RECURRENCIA — UI compartida entre tarea y evento (Fase R-5)',
  '\n\n/* ==================================================================\n   MODAL: TAREA',
  'bloque RECURRENCIA — UI compartida (Fase R-5)'
);
const modalCollapsibleSrc = extractBetween(
  html,
  'function modalCollapsibleSection(id, label, contentHtml, open){',
  '\nfunction openTaskModal(',
  'bloque UX-8 secciones desplegables (modalCollapsibleSection/wireModalCollapsibleSections)'
);
const openTaskModalSrc = extractBetween(
  html,
  'function openTaskModal({taskId=null, date=null}={}){',
  '\n\n/* ==================================================================\n   MODAL: MINUTOS REALES',
  'función openTaskModal()'
);
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

/** Crea un sandbox nuevo con un DOM mínimo simulado (igual patrón que
 * test-event-category-orphan.js) y ejecuta openTaskModal(args) u
 * openEventModal(args) dentro. Devuelve el HTML final asignado a
 * modalBox.innerHTML. */
function renderModalHTML(kind, state, args) {
  const sandbox = {};
  sandbox.console = console;
  vm.createContext(sandbox);

  vm.runInContext(escSrc, sandbox, { filename: 'organizator.html (esc)' });
  vm.runInContext(dowConstsSrc, sandbox, { filename: 'organizator.html (DOW_NAMES/DOW_SHORT/DOW_FULL_MONFIRST/MONTH_NAMES)' });
  vm.runInContext(
    `let state = ${JSON.stringify(state)};
     let window = {}; // sin DurationLearning: renderDurationHint() no hace nada
     const modalBox = {
       _html: '',
       set innerHTML(v){ this._html = v; },
       get innerHTML(){ return this._html; },
       querySelector(){ return { addEventListener(){}, style:{}, value:'' }; },
       querySelectorAll(){ return { forEach(){} }; },
     };
     const overlay = { classList: { add(){}, remove(){} } };
     // Ambos modales pasan closeModal como referencia de callback
     // (addEventListener('click', closeModal)); nunca se dispara aquí.
     function closeModal(){}
     function requestReminderNotificationPermission(){}
     function showToast(){}
     function uid(){ return 'id-' + Math.random().toString(36).slice(2, 10); }`,
    sandbox, { filename: 'dom-stub' }
  );
  vm.runInContext(remindersFase1Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 1)' });
  vm.runInContext(remindersFase3Src, sandbox, { filename: 'organizator.html (RECORDATORIOS Fase 3)' });
  vm.runInContext(recurrenceUiSrc, sandbox, { filename: 'organizator.html (RECURRENCIA UI R-5)' });
  vm.runInContext(modalCollapsibleSrc, sandbox, { filename: 'organizator.html (UX-8 modalCollapsibleSection)' });
  if (kind === 'task') {
    vm.runInContext(openTaskModalSrc, sandbox, { filename: 'organizator.html (openTaskModal)' });
    vm.runInContext('this.openTaskModal = openTaskModal; this.modalBox = modalBox;', sandbox, { filename: 'expose-openTaskModal' });
    sandbox.openTaskModal(args);
  } else {
    vm.runInContext(openEventModalSrc, sandbox, { filename: 'organizator.html (openEventModal)' });
    vm.runInContext('this.openEventModal = openEventModal; this.modalBox = modalBox;', sandbox, { filename: 'expose-openEventModal' });
    sandbox.openEventModal(args);
  }
  return sandbox.modalBox.innerHTML;
}

/** Extrae el <div class="modal-collapsible-panel" id="modal-collapsible-panel-XXX" ...>
 * de un HTML de modal y dice si tiene el atributo `hidden`. */
function isCollapsiblePanelHidden(modalHtml, id) {
  const re = new RegExp(`<div class="modal-collapsible-panel" id="modal-collapsible-panel-${id}"([^>]*)>`);
  const m = re.exec(modalHtml);
  if (!m) return null;
  return / hidden(\s|>|$)/.test(m[1]) || m[1].trim() === 'hidden';
}
function collapsibleAriaExpanded(modalHtml, id) {
  const re = new RegExp(`data-modal-collapsible="${id}" aria-expanded="(true|false)"`);
  const m = re.exec(modalHtml);
  return m ? m[1] : null;
}

(() => {

  // =====================================================================
  section('1) Tarea: campos principales visibles (nombre, fecha, repetición)');
  // =====================================================================
  {
    const html1 = renderModalHTML('task', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('1. input de título (nombre) presente', /<input type="text" name="title"/.test(html1));
    check('1. input de fecha límite presente', /<input type="date" name="dueDate"/.test(html1));
    check('1. selector de repetición presente ("Repetir")', /name="repeatType"/.test(html1));
    check('1. las 4 opciones de repetición existen (No repetir/día/semana/mes)',
      /No repetir/.test(html1) && /Cada día/.test(html1) && /Cada semana/.test(html1) && /Cada mes/.test(html1));
  }

  // =====================================================================
  section('2) Tarea nueva: "Más opciones" empieza cerrado');
  // =====================================================================
  {
    const html2 = renderModalHTML('task', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('2. el panel "task-more" existe', isCollapsiblePanelHidden(html2, 'task-more') !== null);
    check('2. el panel "task-more" tiene el atributo hidden al crear', isCollapsiblePanelHidden(html2, 'task-more') === true);
    check('2. el botón de "Más opciones" tiene aria-expanded="false"', collapsibleAriaExpanded(html2, 'task-more') === 'false');
  }

  // =====================================================================
  section('3) Dentro de "Más opciones" aparecen sus controles (hora, prioridad, recordatorio)');
  // =====================================================================
  {
    const html3 = renderModalHTML('task', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('3. input de hora (dueTime) presente en el HTML (aunque el panel esté cerrado, el control existe en el DOM)', /<input type="time" name="dueTime"/.test(html3));
    check('3. selector de prioridad presente', /name="priority"/.test(html3) && /Media<\/option>/.test(html3));
    check('3. selector de recordatorio presente', /id="task-reminder-select"/.test(html3));
    // Los tres controles deben vivir DENTRO del panel de "Más opciones",
    // no sueltos en el nivel principal del formulario.
    const panelMatch = /<div class="modal-collapsible-panel" id="modal-collapsible-panel-task-more"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div class="modal-actions">/.exec(html3);
    check('3b. hora/prioridad/recordatorio están dentro del panel "Más opciones"',
      !!panelMatch && /name="dueTime"/.test(panelMatch[1]) && /name="priority"/.test(panelMatch[1]) && /id="task-reminder-select"/.test(panelMatch[1]));
  }

  // =====================================================================
  section('4) Ubicación y Notas no aparecen en ningún formulario');
  // =====================================================================
  {
    const htmlTask = renderModalHTML('task', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('4. la tarea no tiene campo "location"', !/name="location"/.test(htmlTask));
    check('4. la tarea no tiene campo "notes"', !/name="notes"/.test(htmlTask));
    const htmlEvent = renderModalHTML('event', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('4. el evento no tiene campo "location"', !/name="location"/.test(htmlEvent));
    check('4. el evento no tiene campo "notes"', !/name="notes"/.test(htmlEvent));
  }

  // =====================================================================
  section('5) Repetición de tarea conserva exactamente las opciones existentes (R-5, sin reimplementar)');
  // =====================================================================
  {
    const html5 = renderModalHTML('task', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    // Mismo bloque real recurrenceControlsHtml('task', null): "No repetir" seleccionada, detalle oculto.
    check('5. "No repetir" seleccionada por defecto', /<option value="none" selected>No repetir<\/option>/.test(html5));
    check('5. el detalle de recurrencia empieza oculto', /id="task-repeat-detail" style="display:none;"/.test(html5));
    check('5. los 7 checkboxes de día (L M X J V S D, uno por índice 0-6) están presentes en el marcado (aunque ocultos hasta elegir "semana")',
      [0, 1, 2, 3, 4, 5, 6].every(i => html5.includes(`id="task-repeat-day-${i}"`)));
  }

  // =====================================================================
  section('6) Editar una tarea recurrente carga correctamente su recurrencia');
  // =====================================================================
  {
    const state6 = {
      tasks: [{ id: 't1', title: 'Repasar', dueDate: '2026-09-18', priority: 'media', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1, 3], startDate: '2026-09-14', endDate: null } }],
      events: [], eventCategories: [], reminders: [],
    };
    const html6 = renderModalHTML('task', state6, { taskId: 't1' });
    check('6. "Cada semana" queda seleccionada al editar', /<option value="weekly" selected>Cada semana<\/option>/.test(html6));
    check('6. el detalle de recurrencia NO está oculto (hay algo que repetir)', !/id="task-repeat-detail" style="display:none;"/.test(html6));
    check('6. día 1 (martes) marcado', /id="task-repeat-day-1"[^>]*checked/.test(html6));
    check('6. día 3 (jueves) marcado', /id="task-repeat-day-3"[^>]*checked/.test(html6));
    check('6. día 0 (lunes) NO marcado', !/id="task-repeat-day-0"[^>]*checked/.test(html6));
    // La recurrencia vive en el nivel principal del formulario (no dentro
    // de "Más opciones"): sigue visible aunque "Más opciones" esté cerrado.
    check('6b. "Más opciones" puede seguir cerrado (sin hora/prioridad/recordatorio) sin ocultar la recurrencia', isCollapsiblePanelHidden(html6, 'task-more') === true);
  }

  // =====================================================================
  section('7) Evento: campos principales visibles (nombre, fecha, horario/todo el día, categoría)');
  // =====================================================================
  {
    const state7 = { tasks: [], events: [], eventCategories: [{ id: 'cat1', name: 'Fútbol', color: '#123456', icon: '⚽', blocksSchedule: true }], reminders: [] };
    const html7 = renderModalHTML('event', state7, {});
    check('7. input de título presente', /<input type="text" name="title"/.test(html7));
    check('7. input de fecha presente', /<input type="date" name="date"/.test(html7));
    check('7. checkbox "Todo el día" presente', /name="allDay" id="event-allday"/.test(html7));
    check('7. horas de inicio/fin presentes', /name="startTime"/.test(html7) && /name="endTime"/.test(html7));
    check('7. selector de categoría presente con la categoría real', /name="categoryId"/.test(html7) && /Fútbol/.test(html7));
  }

  // =====================================================================
  section('8) Repetición de evento disponible pero opcional (cerrada por defecto al crear)');
  // =====================================================================
  {
    const html8 = renderModalHTML('event', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('8. la sección "Repetición" del evento existe', isCollapsiblePanelHidden(html8, 'event-repeat') !== null);
    check('8. está cerrada por defecto al crear un evento nuevo', isCollapsiblePanelHidden(html8, 'event-repeat') === true);
    check('8. su selector "Repetir" sigue existiendo dentro (aunque el panel esté cerrado)', /name="repeatType"/.test(html8));
    check('8. no repetir por defecto', /<option value="none" selected>No repetir<\/option>/.test(html8));
  }

  // =====================================================================
  section('9) Recordatorio de evento disponible pero opcional (cerrado por defecto, "Sin recordatorio")');
  // =====================================================================
  {
    const html9 = renderModalHTML('event', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('9. la sección "Recordatorio" del evento existe', isCollapsiblePanelHidden(html9, 'event-reminder') !== null);
    check('9. está cerrada por defecto al crear un evento nuevo (sin recordatorio)', isCollapsiblePanelHidden(html9, 'event-reminder') === true);
    check('9. "Sin recordatorio" es la opción seleccionada', /<option value="" selected>Sin recordatorio<\/option>/.test(html9));
  }

  // =====================================================================
  section('10) Los controles adicionales de repetición aparecen solo cuando corresponden');
  // =====================================================================
  {
    const stateWeekly = { tasks: [], events: [{ id: 'e1', title: 'Entreno', date: '2026-09-18', startTime: '18:00', endTime: '19:00', allDay: false, recurrence: { type: 'weekly', interval: 1, daysOfWeek: [4], startDate: '2026-09-18', endDate: null } }], eventCategories: [], reminders: [] };
    const htmlWeekly = renderModalHTML('event', stateWeekly, { eventId: 'e1' });
    check('10. tipo "weekly": el grupo de días de la semana NO está oculto', !/id="event-repeat-days-group" style="display:none;"/.test(htmlWeekly));

    const stateMonthly = { tasks: [], events: [{ id: 'e2', title: 'Pago alquiler', date: '2026-09-01', allDay: true, recurrence: { type: 'monthly', interval: 1, daysOfWeek: [], startDate: '2026-09-01', endDate: null } }], eventCategories: [], reminders: [] };
    const htmlMonthly = renderModalHTML('event', stateMonthly, { eventId: 'e2' });
    check('10. tipo "monthly": el grupo de días de la semana SÍ está oculto (no aplica)', /id="event-repeat-days-group" style="display:none;"/.test(htmlMonthly));

    const stateNone = { tasks: [], events: [], eventCategories: [], reminders: [] };
    const htmlNone = renderModalHTML('event', stateNone, {});
    check('10. tipo "none" (nuevo): todo el detalle de repetición está oculto', /id="event-repeat-detail" style="display:none;"/.test(htmlNone));
  }

  // =====================================================================
  section('11) "Todo el día" conserva el comportamiento actual');
  // =====================================================================
  {
    const stateAllDay = { tasks: [], events: [{ id: 'e3', title: 'Festivo', date: '2026-10-12', allDay: true }], eventCategories: [], reminders: [] };
    const htmlAllDay = renderModalHTML('event', stateAllDay, { eventId: 'e3' });
    check('11. el checkbox "Todo el día" queda marcado', /name="allDay" id="event-allday" checked/.test(htmlAllDay));
    check('11. la fila de horas queda oculta (display:none) cuando allDay', /id="event-time-row" style="display:none;"/.test(htmlAllDay));
    // Fase 3 de recordatorios: allDay sin hora → sin datetime válido → solo "Sin recordatorio" ofrecido.
    check('11. sin datetime válido (allDay), el <select> de recordatorio SOLO ofrece "Sin recordatorio"', (htmlAllDay.match(/<option value="\d+"/g) || []).length === 0);

    const stateTimed = { tasks: [], events: [{ id: 'e4', title: 'Reunión', date: '2026-10-12', allDay: false, startTime: '10:00', endTime: '11:00' }], eventCategories: [], reminders: [] };
    const htmlTimed = renderModalHTML('event', stateTimed, { eventId: 'e4' });
    check('11b. sin allDay, la fila de horas NO está oculta', !/id="event-time-row" style="display:none;"/.test(htmlTimed));
  }

  // =====================================================================
  section('12) Editar un evento conserva categoría, recurrencia y recordatorio');
  // =====================================================================
  {
    const state12 = {
      tasks: [],
      events: [{
        id: 'e5', title: 'Liga de fútbol', date: '2026-09-20', startTime: '17:00', endTime: '18:30', allDay: false,
        categoryId: 'cat-futbol',
        recurrence: { type: 'monthly', interval: 3, daysOfWeek: [], startDate: '2026-01-15', endDate: null },
      }],
      eventCategories: [{ id: 'cat-futbol', name: 'Fútbol', color: '#2E7D32', icon: '⚽', blocksSchedule: true }],
      reminders: [{ id: 'r1', targetType: 'event', targetId: 'e5', remindAt: '2026-09-20T16:45:00', status: 'pending', createdAt: 1 }],
    };
    const html12 = renderModalHTML('event', state12, { eventId: 'e5' });
    check('12. la categoría real queda seleccionada', /<option value="cat-futbol"\s*selected>⚽ Fútbol<\/option>/.test(html12));
    check('12. "Cada mes" (recurrencia) queda seleccionada', /<option value="monthly" selected>Cada mes<\/option>/.test(html12));
    check('12. el intervalo de la recurrencia se precarga (3)', /id="event-repeat-interval"[^>]*value="3"/.test(html12));
    check('12. la sección "Repetición" empieza ABIERTA (ya tiene recurrencia configurada)', isCollapsiblePanelHidden(html12, 'event-repeat') === false);
    check('12. el recordatorio de "15 minutos antes" queda preseleccionado', /<option value="15" selected>15 minutos antes<\/option>/.test(html12));
    check('12. la sección "Recordatorio" empieza ABIERTA (ya tiene un recordatorio activo)', isCollapsiblePanelHidden(html12, 'event-reminder') === false);
  }

  // =====================================================================
  section('13) No se rompen los formularios actuales (siguen existiendo todos los controles de guardado)');
  // =====================================================================
  {
    const htmlTaskEdit = renderModalHTML('task', { tasks: [{ id: 't9', title: 'Tarea', dueDate: '2026-09-18', priority: 'alta', recurrence: null }], events: [], eventCategories: [], reminders: [] }, { taskId: 't9' });
    check('13. modal de tarea en edición tiene título "Editar tarea"', /<h3>Editar tarea<\/h3>/.test(htmlTaskEdit));
    check('13. botón "Eliminar" presente al editar', /id="task-delete-btn"/.test(htmlTaskEdit));
    check('13. botón "Guardar" (submit) presente', /type="submit" class="btn btn-dark">Guardar<\/button>/.test(htmlTaskEdit));
    check('13. botón "Cancelar" presente', /id="task-cancel-btn"/.test(htmlTaskEdit));

    const htmlEventNew = renderModalHTML('event', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('13. modal de evento nuevo tiene título "Añadir evento"', /<h3>Añadir evento<\/h3>/.test(htmlEventNew));
    check('13. sin botón "Eliminar" al crear (no editing)', !/id="event-delete-btn"/.test(htmlEventNew));
    check('13. botón "Guardar" (submit) presente', /type="submit" class="btn btn-dark">Guardar<\/button>/.test(htmlEventNew));
  }

  // =====================================================================
  section('14) Accesibilidad: botones desplegables con aria-expanded y accesibles por teclado (<button type="button">)');
  // =====================================================================
  {
    const html14task = renderModalHTML('task', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('14. el toggle de "Más opciones" es un <button type="button"> real (accesible con Tab/Enter/Espacio)',
      /<button type="button" class="modal-collapsible-toggle" data-modal-collapsible="task-more" aria-expanded="false"/.test(html14task));
    const html14event = renderModalHTML('event', { tasks: [], events: [], eventCategories: [], reminders: [] }, {});
    check('14. el toggle de "Repetición" (evento) es un <button type="button"> con aria-expanded',
      /<button type="button" class="modal-collapsible-toggle" data-modal-collapsible="event-repeat" aria-expanded="false"/.test(html14event));
    check('14. el toggle de "Recordatorio" (evento) es un <button type="button"> con aria-expanded',
      /<button type="button" class="modal-collapsible-toggle" data-modal-collapsible="event-reminder" aria-expanded="false"/.test(html14event));
  }

  // =====================================================================
  section('15) node --check del código extraído de organizator.html (esc + R-5 + UX-8 + ambos modales)');
  // =====================================================================
  {
    const combined = [
      escSrc, dowConstsSrc, remindersFase1Src, remindersFase3Src, recurrenceUiSrc, modalCollapsibleSrc,
      `let state = { tasks: [], events: [], eventCategories: [], reminders: [] };`,
      `const modalBox = { innerHTML: '', querySelector(){ return { addEventListener(){} }; }, querySelectorAll(){ return { forEach(){} }; } };`,
      `const overlay = { classList: { add(){}, remove(){} } };`,
      `function closeModal(){} function requestReminderNotificationPermission(){} function showToast(){} function uid(){ return 'x'; }`,
      openTaskModalSrc,
      openEventModalSrc,
    ].join('\n\n');
    const tmpPath = path.join(os.tmpdir(), `organizator-ux8-modal-check-${process.pid}.js`);
    fs.writeFileSync(tmpPath, combined, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
      check('15. node --check del código extraído (modales UX-8) pasa (sintaxis válida)', true);
    } catch (e) {
      check('15. node --check del código extraído (modales UX-8) pasa (sintaxis válida)', false);
      console.log(String(e.stderr || e.message));
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  console.log(`\n${pass} pasaron, ${fail} fallaron.`);
  process.exit(fail > 0 ? 1 : 0);
})();
