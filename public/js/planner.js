// public/js/planner.js
//
// Controla la navegación entre secciones y la carga/guardado de datos
// reales contra /api/data (type: "planner"): Tareas, Hábitos, Objetivos,
// Exámenes y Estadísticas.

let plannerData = { tareas: [], habitos: [], objetivos: [], examenes: [] };

// Id de la tarea que está actualmente en modo edición (null si ninguna).
let tareaEnEdicionId = null;

function generateId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// --- Navegación entre secciones ---

function showSection(sectionName) {
  document.querySelectorAll('.section').forEach((el) => {
    el.classList.toggle('hidden', el.id !== 'section-' + sectionName);
  });
  document.querySelectorAll('.nav-item, .tab-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === sectionName);
  });
  if (sectionName === 'estadisticas') renderEstadisticas();
}

function initPlannerNav() {
  document.querySelectorAll('.nav-item, .tab-item').forEach((btn) => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });
}

// --- Carga y guardado contra el backend ---

async function loadPlannerData() {
  const result = await apiGetData('planner');
  if (result.ok && result.data && result.data.data) {
    plannerData = Object.assign(
      { tareas: [], habitos: [], objetivos: [], examenes: [] },
      result.data.data
    );
  }
  renderTareas();
  renderHabitos();
  renderObjetivos();
  renderExamenes();
  renderEstadisticas();
}

async function savePlannerData() {
  await apiSaveData('planner', plannerData);
}

// --- Tareas ---

function renderTareas() {
  const lista = document.getElementById('tarea-lista');
  const vacio = document.getElementById('tarea-vacio');
  if (!lista) return;

  lista.innerHTML = '';
  vacio.classList.toggle('hidden', plannerData.tareas.length > 0);

  plannerData.tareas.forEach((tarea) => {
    const li = document.createElement('li');
    li.className = 'item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = tarea.hecha;
    checkbox.addEventListener('change', () => toggleTarea(tarea.id));

    li.appendChild(checkbox);

    if (tareaEnEdicionId === tarea.id) {
      // Modo edición: el texto se sustituye por un input inline.
      const inputEdicion = document.createElement('input');
      inputEdicion.type = 'text';
      inputEdicion.className = 'item-edit-input';
      inputEdicion.value = tarea.texto;

      const guardar = document.createElement('button');
      guardar.type = 'button';
      guardar.className = 'item-save';
      guardar.textContent = 'Guardar';
      guardar.addEventListener('click', () => guardarEdicionTarea(tarea.id, inputEdicion.value));

      const cancelar = document.createElement('button');
      cancelar.type = 'button';
      cancelar.className = 'item-cancel';
      cancelar.textContent = 'Cancelar';
      cancelar.addEventListener('click', () => cancelarEdicionTarea());

      inputEdicion.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          guardarEdicionTarea(tarea.id, inputEdicion.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelarEdicionTarea();
        }
      });

      li.appendChild(inputEdicion);
      li.appendChild(guardar);
      li.appendChild(cancelar);

      lista.appendChild(li);
      inputEdicion.focus();
      inputEdicion.select();
      return;
    }

    const texto = document.createElement('span');
    texto.className = 'item-text' + (tarea.hecha ? ' done' : '');
    texto.textContent = tarea.texto;

    const editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'item-edit';
    editar.textContent = 'Editar';
    editar.addEventListener('click', () => editarTarea(tarea.id));

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-delete';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', () => deleteTarea(tarea.id));

    li.appendChild(texto);
    li.appendChild(editar);
    li.appendChild(borrar);
    lista.appendChild(li);
  });
}

async function handleTareaSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('tarea-texto');
  const texto = input.value.trim();
  if (!texto) return;

  plannerData.tareas.push({ id: generateId(), texto, hecha: false });
  input.value = '';
  renderTareas();
  await savePlannerData();
}

async function toggleTarea(id) {
  const tarea = plannerData.tareas.find((t) => t.id === id);
  if (!tarea) return;
  tarea.hecha = !tarea.hecha;
  renderTareas();
  await savePlannerData();
}

async function deleteTarea(id) {
  plannerData.tareas = plannerData.tareas.filter((t) => t.id !== id);
  renderTareas();
  await savePlannerData();
}

function editarTarea(id) {
  tareaEnEdicionId = id;
  renderTareas();
}

function cancelarEdicionTarea() {
  tareaEnEdicionId = null;
  renderTareas();
}

async function guardarEdicionTarea(id, nuevoTexto) {
  const texto = nuevoTexto.trim();
  if (!texto) {
    // No se permite dejar la tarea sin texto; se descarta el cambio.
    cancelarEdicionTarea();
    return;
  }

  const tarea = plannerData.tareas.find((t) => t.id === id);
  if (!tarea) {
    cancelarEdicionTarea();
    return;
  }

  tarea.texto = texto;
  tareaEnEdicionId = null;
  renderTareas();
  await savePlannerData();
}

// --- Hábitos ---

function formatISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function getTodayISO() {
  return formatISODate(new Date());
}

function calcularRacha(fechas) {
  if (!fechas || fechas.length === 0) return 0;

  const fechasSet = new Set(fechas);
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  if (!fechasSet.has(getTodayISO())) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let racha = 0;
  while (fechasSet.has(formatISODate(cursor))) {
    racha++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return racha;
}

function renderHabitos() {
  const lista = document.getElementById('habito-lista');
  const vacio = document.getElementById('habito-vacio');
  if (!lista) return;

  lista.innerHTML = '';
  vacio.classList.toggle('hidden', plannerData.habitos.length > 0);

  const hoy = getTodayISO();

  plannerData.habitos.forEach((habito) => {
    const li = document.createElement('li');
    li.className = 'item-habito';

    const info = document.createElement('div');
    info.className = 'habito-info';

    const nombre = document.createElement('span');
    nombre.className = 'habito-nombre';
    nombre.textContent = habito.texto;

    const racha = document.createElement('span');
    racha.className = 'habito-racha';
    const numRacha = calcularRacha(habito.fechas);
    racha.textContent = numRacha === 1 ? '1 día seguido' : numRacha + ' días seguidos';

    info.appendChild(nombre);
    info.appendChild(racha);

    const hechoHoy = habito.fechas.includes(hoy);
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'habito-boton';
    boton.textContent = hechoHoy ? 'Completado hoy' : 'Hecho hoy';
    boton.disabled = hechoHoy;
    boton.addEventListener('click', () => marcarHabitoHoy(habito.id));

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-delete';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', () => deleteHabito(habito.id));

    li.appendChild(info);
    li.appendChild(boton);
    li.appendChild(borrar);
    lista.appendChild(li);
  });
}

async function handleHabitoSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('habito-texto');
  const texto = input.value.trim();
  if (!texto) return;

  plannerData.habitos.push({ id: generateId(), texto, fechas: [] });
  input.value = '';
  renderHabitos();
  await savePlannerData();
}

async function marcarHabitoHoy(id) {
  const habito = plannerData.habitos.find((h) => h.id === id);
  if (!habito) return;

  const hoy = getTodayISO();
  if (!habito.fechas.includes(hoy)) {
    habito.fechas.push(hoy);
  }
  renderHabitos();
  await savePlannerData();
}

async function deleteHabito(id) {
  plannerData.habitos = plannerData.habitos.filter((h) => h.id !== id);
  renderHabitos();
  await savePlannerData();
}

// --- Objetivos ---

function calcularProgreso(pasos) {
  if (!pasos || pasos.length === 0) return 0;
  const hechos = pasos.filter((p) => p.hecho).length;
  return Math.round((hechos / pasos.length) * 100);
}

function renderObjetivos() {
  const lista = document.getElementById('objetivo-lista');
  const vacio = document.getElementById('objetivo-vacio');
  if (!lista) return;

  lista.innerHTML = '';
  vacio.classList.toggle('hidden', plannerData.objetivos.length > 0);

  plannerData.objetivos.forEach((objetivo) => {
    const card = document.createElement('div');
    card.className = 'objetivo-card';

    const header = document.createElement('div');
    header.className = 'objetivo-header';

    const nombre = document.createElement('span');
    nombre.className = 'objetivo-nombre';
    nombre.textContent = objetivo.texto;

    const progresoTexto = document.createElement('span');
    progresoTexto.className = 'objetivo-progreso-texto';
    const pct = calcularProgreso(objetivo.pasos);
    progresoTexto.textContent = objetivo.pasos.length
      ? pct + '% (' + objetivo.pasos.filter((p) => p.hecho).length + '/' + objetivo.pasos.length + ')'
      : 'Sin pasos';

    header.appendChild(nombre);
    header.appendChild(progresoTexto);

    const barra = document.createElement('div');
    barra.className = 'objetivo-barra';
    const relleno = document.createElement('div');
    relleno.className = 'objetivo-barra-relleno';
    relleno.style.width = pct + '%';
    barra.appendChild(relleno);

    const pasoLista = document.createElement('ul');
    pasoLista.className = 'paso-lista';
    objetivo.pasos.forEach((paso) => {
      const li = document.createElement('li');
      li.className = 'paso-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = paso.hecho;
      checkbox.addEventListener('change', () => togglePaso(objetivo.id, paso.id));

      const texto = document.createElement('span');
      texto.className = 'paso-texto' + (paso.hecho ? ' done' : '');
      texto.textContent = paso.texto;

      const borrarPaso = document.createElement('button');
      borrarPaso.type = 'button';
      borrarPaso.className = 'item-delete';
      borrarPaso.textContent = 'Eliminar';
      borrarPaso.addEventListener('click', () => deletePaso(objetivo.id, paso.id));

      li.appendChild(checkbox);
      li.appendChild(texto);
      li.appendChild(borrarPaso);
      pasoLista.appendChild(li);
    });

    const pasoForm = document.createElement('form');
    pasoForm.className = 'paso-form';

    const pasoInput = document.createElement('input');
    pasoInput.type = 'text';
    pasoInput.placeholder = 'Nuevo paso';
    pasoInput.required = true;

    const pasoBoton = document.createElement('button');
    pasoBoton.type = 'submit';
    pasoBoton.textContent = 'Añadir paso';

    pasoForm.appendChild(pasoInput);
    pasoForm.appendChild(pasoBoton);
    pasoForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const texto = pasoInput.value.trim();
      if (!texto) return;
      addPaso(objetivo.id, texto);
      pasoInput.value = '';
    });

    const borrarObjetivo = document.createElement('button');
    borrarObjetivo.type = 'button';
    borrarObjetivo.className = 'item-delete';
    borrarObjetivo.textContent = 'Eliminar objetivo';
    borrarObjetivo.addEventListener('click', () => deleteObjetivo(objetivo.id));

    card.appendChild(header);
    card.appendChild(barra);
    card.appendChild(pasoLista);
    card.appendChild(pasoForm);
    card.appendChild(borrarObjetivo);
    lista.appendChild(card);
  });
}

async function handleObjetivoSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('objetivo-texto');
  const texto = input.value.trim();
  if (!texto) return;

  plannerData.objetivos.push({ id: generateId(), texto, pasos: [] });
  input.value = '';
  renderObjetivos();
  await savePlannerData();
}

async function addPaso(objetivoId, texto) {
  const objetivo = plannerData.objetivos.find((o) => o.id === objetivoId);
  if (!objetivo) return;
  objetivo.pasos.push({ id: generateId(), texto, hecho: false });
  renderObjetivos();
  await savePlannerData();
}

async function togglePaso(objetivoId, pasoId) {
  const objetivo = plannerData.objetivos.find((o) => o.id === objetivoId);
  if (!objetivo) return;
  const paso = objetivo.pasos.find((p) => p.id === pasoId);
  if (!paso) return;
  paso.hecho = !paso.hecho;
  renderObjetivos();
  await savePlannerData();
}

async function deletePaso(objetivoId, pasoId) {
  const objetivo = plannerData.objetivos.find((o) => o.id === objetivoId);
  if (!objetivo) return;
  objetivo.pasos = objetivo.pasos.filter((p) => p.id !== pasoId);
  renderObjetivos();
  await savePlannerData();
}

async function deleteObjetivo(id) {
  plannerData.objetivos = plannerData.objetivos.filter((o) => o.id !== id);
  renderObjetivos();
  await savePlannerData();
}

// --- Exámenes ---

function diasHasta(fechaISO) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(fechaISO + 'T00:00:00');
  const diffMs = fecha.getTime() - hoy.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function formatFechaLegible(fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  return fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderExamenes() {
  const lista = document.getElementById('examen-lista');
  const vacio = document.getElementById('examen-vacio');
  if (!lista) return;

  lista.innerHTML = '';
  vacio.classList.toggle('hidden', plannerData.examenes.length > 0);

  const ordenados = [...plannerData.examenes].sort((a, b) => a.fecha.localeCompare(b.fecha));

  ordenados.forEach((examen) => {
    const li = document.createElement('li');
    li.className = 'item-examen';

    const info = document.createElement('div');
    info.className = 'examen-info';

    const nombre = document.createElement('span');
    nombre.className = 'examen-nombre';
    nombre.textContent = examen.texto;

    const dias = diasHasta(examen.fecha);
    const fechaEl = document.createElement('span');
    fechaEl.className = 'examen-fecha';
    let fechaTexto = formatFechaLegible(examen.fecha) + ' — ';
    if (dias < 0) {
      fechaTexto += 'ya pasó';
    } else if (dias === 0) {
      fechaTexto += 'es hoy';
      fechaEl.classList.add('proxima');
    } else if (dias === 1) {
      fechaTexto += 'queda 1 día';
      fechaEl.classList.add('proxima');
    } else {
      fechaTexto += 'quedan ' + dias + ' días';
      if (dias <= 3) fechaEl.classList.add('proxima');
    }
    fechaEl.textContent = fechaTexto;

    info.appendChild(nombre);
    info.appendChild(fechaEl);

    if (examen.notas) {
      const notas = document.createElement('div');
      notas.className = 'examen-notas';
      notas.textContent = examen.notas;
      info.appendChild(notas);
    }

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-delete';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', () => deleteExamen(examen.id));

    li.appendChild(info);
    li.appendChild(borrar);
    lista.appendChild(li);
  });
}

async function handleExamenSubmit(event) {
  event.preventDefault();
  const nombreInput = document.getElementById('examen-nombre');
  const fechaInput = document.getElementById('examen-fecha');
  const notasInput = document.getElementById('examen-notas');

  const texto = nombreInput.value.trim();
  const fecha = fechaInput.value;
  if (!texto || !fecha) return;

  plannerData.examenes.push({
    id: generateId(),
    texto,
    fecha,
    notas: notasInput.value.trim(),
  });

  nombreInput.value = '';
  fechaInput.value = '';
  notasInput.value = '';

  renderExamenes();
  await savePlannerData();
}

async function deleteExamen(id) {
  plannerData.examenes = plannerData.examenes.filter((e) => e.id !== id);
  renderExamenes();
  await savePlannerData();
}

// --- Estadísticas ---

function renderEstadisticas() {
  const tareasEl = document.getElementById('stat-tareas');
  if (!tareasEl) return;

  const totalTareas = plannerData.tareas.length;
  const hechasTareas = plannerData.tareas.filter((t) => t.hecha).length;
  tareasEl.textContent = totalTareas > 0 ? hechasTareas + ' de ' + totalTareas : '—';

  const rachaMaxima = plannerData.habitos.reduce((max, h) => {
    return Math.max(max, calcularRacha(h.fechas));
  }, 0);
  document.getElementById('stat-racha').textContent =
    plannerData.habitos.length > 0 ? rachaMaxima + (rachaMaxima === 1 ? ' día' : ' días') : '—';

  const objetivosConPasos = plannerData.objetivos.filter((o) => o.pasos.length > 0);
  const progresoMedio = objetivosConPasos.length > 0
    ? Math.round(
        objetivosConPasos.reduce((sum, o) => sum + calcularProgreso(o.pasos), 0) / objetivosConPasos.length
      )
    : null;
  document.getElementById('stat-objetivos').textContent =
    progresoMedio === null ? '—' : progresoMedio + '%';

  const proximoEl = document.getElementById('stat-examen');
  const futuros = plannerData.examenes
    .filter((e) => diasHasta(e.fecha) >= 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (futuros.length === 0) {
    proximoEl.textContent = '—';
  } else {
    const proximo = futuros[0];
    const dias = diasHasta(proximo.fecha);
    proximoEl.textContent = proximo.texto + ' (' + (dias === 0 ? 'hoy' : dias + ' días') + ')';
  }
}

// --- Arranque ---

function initPlanner() {
  initPlannerNav();

  const form = document.getElementById('tarea-form');
  if (form) form.addEventListener('submit', handleTareaSubmit);

  const habitoForm = document.getElementById('habito-form');
  if (habitoForm) habitoForm.addEventListener('submit', handleHabitoSubmit);

  const objetivoForm = document.getElementById('objetivo-form');
  if (objetivoForm) objetivoForm.addEventListener('submit', handleObjetivoSubmit);

  const examenForm = document.getElementById('examen-form');
  if (examenForm) examenForm.addEventListener('submit', handleExamenSubmit);
}

initPlanner();