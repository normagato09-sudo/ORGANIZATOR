// public/js/planner.js
//
// Controla la navegación entre secciones y la carga/guardado de datos
// reales contra /api/data (type: "planner"): Tareas, Hábitos, Objetivos,
// Exámenes y Estadísticas.

let plannerData = { tareas: [], habitos: [], objetivos: [], examenes: [] };

// Id de la tarea que está actualmente en modo edición (null si ninguna).
let tareaEnEdicionId = null;

// Id del hábito y del objetivo actualmente en modo edición (null si ninguno).
let habitoEnEdicionId = null;
let objetivoEnEdicionId = null;

// Orden y filtro actuales de cada lista. Solo viven en memoria (no se
// guardan en plannerData ni se envían al backend): al recargar la página
// vuelven a sus valores por defecto.
let tareaOrden = 'recientes';
let tareaFiltro = 'todas';
let habitoOrden = 'recientes';
let habitoFiltro = 'todos';
let objetivoOrden = 'recientes';
let objetivoFiltro = 'todos';

// Mes/año que se está viendo en el calendario (16.2.11). Solo vive en
// memoria, como el orden/filtro de las listas: al recargar la página
// vuelve al mes actual.
let calendarioFecha = new Date();

// --- Sincronización entre dispositivos (16.2.13) por polling ---
//
// No hay tiempo real de verdad (WebSockets): cada X segundos, y también
// al volver a la pestaña, se vuelve a pedir /api/data?type=planner y, si
// ha cambiado respecto a lo que hay en memoria, se repinta. Reutiliza el
// mismo endpoint de siempre, sin tocar sesiones, Redis ni el backend.
const POLLING_INTERVALO_MS = 15000;
let pollingIntervalId = null;

function generateId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// --- Navegación entre secciones ---

function showSection(sectionName) {
  document.querySelectorAll('.section').forEach((el) => {
    el.classList.toggle('hidden', el.id !== 'section-' + sectionName);
  });
  document.querySelectorAll('.nav-item, .side-menu-item[data-section]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === sectionName);
  });
  if (sectionName === 'estadisticas') renderEstadisticas();
  else if (sectionName === 'calendario') renderCalendario();
}

function initPlannerNav() {
  document.querySelectorAll('.nav-item, .side-menu-item[data-section]').forEach((btn) => {
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
  renderCalendario();
  iniciarPolling();
}

async function savePlannerData() {
  await apiSaveData('planner', plannerData);
}

// Compara el JSON recibido del servidor con lo que hay en memoria. Si es
// igual, no hace falta repintar nada (evita parpadeos innecesarios).
async function refrescarPlannerData() {
  // Si el navegador tiene la pestaña en segundo plano, no merece la pena
  // gastar peticiones: se pondrá al día en cuanto vuelva a estar visible
  // (ver el listener de "visibilitychange" en iniciarPolling).
  if (document.hidden) return;

  // Si el usuario está editando algo ahora mismo, no se toca su edición
  // a medias con datos que puedan venir de otro dispositivo.
  if (tareaEnEdicionId || habitoEnEdicionId || objetivoEnEdicionId) return;

  const result = await apiGetData('planner');
  if (!result.ok || !result.data || !result.data.data) return;

  const datosNuevos = JSON.stringify(result.data.data);
  const datosActuales = JSON.stringify(plannerData);
  if (datosNuevos === datosActuales) return;

  plannerData = Object.assign(
    { tareas: [], habitos: [], objetivos: [], examenes: [] },
    result.data.data
  );
  renderTareas();
  renderHabitos();
  renderObjetivos();
  renderExamenes();
  renderEstadisticas();
  renderCalendario();
}

function iniciarPolling() {
  if (pollingIntervalId) return; // ya está en marcha, no duplicar
  pollingIntervalId = setInterval(refrescarPlannerData, POLLING_INTERVALO_MS);
  document.addEventListener('visibilitychange', onVisibilityChangePolling);
}

function detenerPolling() {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChangePolling);
}

function onVisibilityChangePolling() {
  if (!document.hidden) refrescarPlannerData();
}

// --- Modal de confirmación de eliminación ---
//
// pedirConfirmacion(mensaje) muestra el modal reutilizable con el mensaje
// indicado y devuelve una promesa: true si el usuario pulsa "Eliminar",
// false si cancela, cierra con Escape o hace clic fuera del cuadro.

function pedirConfirmacion(mensaje) {
  const overlay = document.getElementById('confirm-modal');
  const texto = document.getElementById('confirm-modal-mensaje');
  const btnCancelar = document.getElementById('confirm-modal-cancelar');
  const btnEliminar = document.getElementById('confirm-modal-eliminar');

  if (!overlay) return Promise.resolve(true); // fallback defensivo

  texto.textContent = mensaje;
  overlay.classList.remove('hidden');
  btnEliminar.focus();

  return new Promise((resolve) => {
    function cerrar(resultado) {
      overlay.classList.add('hidden');
      btnCancelar.removeEventListener('click', onCancelar);
      btnEliminar.removeEventListener('click', onEliminar);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      resolve(resultado);
    }
    function onCancelar() { cerrar(false); }
    function onEliminar() { cerrar(true); }
    function onOverlayClick(event) {
      if (event.target === overlay) cerrar(false);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') cerrar(false);
    }

    btnCancelar.addEventListener('click', onCancelar);
    btnEliminar.addEventListener('click', onEliminar);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
  });
}

// --- Utilidad de fecha límite compartida por tareas y objetivos ---
//
// Reutiliza diasHasta/formatFechaLegible (definidas más abajo, en la
// sección de Exámenes; las funciones declaradas con "function" están
// disponibles en todo el archivo independientemente del orden).
function textoFechaLimite(fechaISO) {
  const dias = diasHasta(fechaISO);
  let texto = 'Vence: ' + formatFechaLegible(fechaISO);
  if (dias < 0) texto += ' (venció)';
  else if (dias === 0) texto += ' (hoy)';
  else if (dias === 1) texto += ' (mañana)';
  return { texto, vencida: dias < 0 };
}

// --- Tareas ---

function renderTareas() {
  const lista = document.getElementById('tarea-lista');
  const vacio = document.getElementById('tarea-vacio');
  if (!lista) return;

  lista.innerHTML = '';

  let items = plannerData.tareas.slice();

  if (tareaFiltro === 'pendientes') items = items.filter((t) => !t.hecha);
  else if (tareaFiltro === 'completadas') items = items.filter((t) => t.hecha);

  if (tareaOrden === 'recientes') items.reverse();
  else if (tareaOrden === 'alfabetico') items.sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
  // 'antiguas' es el orden de inserción tal cual, no hace falta tocarlo.

  vacio.classList.toggle('hidden', items.length > 0);

  items.forEach((tarea) => {
    const li = document.createElement('li');
    li.className = 'item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = tarea.hecha;
    checkbox.addEventListener('change', () => toggleTarea(tarea.id));

    li.appendChild(checkbox);

    if (tareaEnEdicionId === tarea.id) {
      // Modo edición: el texto se sustituye por un input inline, y se
      // añade una fila con la fecha límite (opcional) y las acciones.
      const form = document.createElement('div');
      form.className = 'item-edit-form';

      const inputEdicion = document.createElement('input');
      inputEdicion.type = 'text';
      inputEdicion.className = 'item-edit-input';
      inputEdicion.value = tarea.texto;

      const fechaInput = document.createElement('input');
      fechaInput.type = 'date';
      fechaInput.className = 'item-edit-fecha';
      fechaInput.value = tarea.fecha || '';

      const quitarFecha = document.createElement('button');
      quitarFecha.type = 'button';
      quitarFecha.className = 'item-quitar-fecha';
      quitarFecha.textContent = 'Quitar fecha';
      quitarFecha.addEventListener('click', () => {
        fechaInput.value = '';
      });

      const guardar = document.createElement('button');
      guardar.type = 'button';
      guardar.className = 'item-save';
      guardar.textContent = 'Guardar';
      guardar.addEventListener('click', () =>
        guardarEdicionTarea(tarea.id, inputEdicion.value, fechaInput.value)
      );

      const cancelar = document.createElement('button');
      cancelar.type = 'button';
      cancelar.className = 'item-cancel';
      cancelar.textContent = 'Cancelar';
      cancelar.addEventListener('click', () => cancelarEdicionTarea());

      inputEdicion.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          guardarEdicionTarea(tarea.id, inputEdicion.value, fechaInput.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelarEdicionTarea();
        }
      });

      const filaFecha = document.createElement('div');
      filaFecha.className = 'item-edit-row';
      filaFecha.appendChild(fechaInput);
      filaFecha.appendChild(quitarFecha);
      filaFecha.appendChild(guardar);
      filaFecha.appendChild(cancelar);

      form.appendChild(inputEdicion);
      form.appendChild(filaFecha);

      li.appendChild(form);
      lista.appendChild(li);
      inputEdicion.focus();
      inputEdicion.select();
      return;
    }

    const textoWrap = document.createElement('div');
    textoWrap.className = 'item-text-wrap';

    const texto = document.createElement('span');
    texto.className = 'item-text' + (tarea.hecha ? ' done' : '');
    texto.textContent = tarea.texto;
    textoWrap.appendChild(texto);

    if (tarea.fecha) {
      const { texto: fechaTexto, vencida } = textoFechaLimite(tarea.fecha);
      const fechaEl = document.createElement('span');
      fechaEl.className = 'item-fecha' + (vencida ? ' vencida' : '');
      fechaEl.textContent = fechaTexto;
      textoWrap.appendChild(fechaEl);
    }

    const editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'item-edit';
    editar.textContent = 'Editar';
    editar.addEventListener('click', () => editarTarea(tarea.id));

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-delete';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', async () => {
      const confirmado = await pedirConfirmacion('¿Eliminar esta tarea?');
      if (confirmado) deleteTarea(tarea.id);
    });

    li.appendChild(textoWrap);
    li.appendChild(editar);
    li.appendChild(borrar);
    lista.appendChild(li);
  });
}

async function handleTareaSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('tarea-texto');
  const fechaInput = document.getElementById('tarea-fecha');
  const texto = input.value.trim();
  if (!texto) return;

  const nuevaTarea = { id: generateId(), texto, hecha: false };
  if (fechaInput && fechaInput.value) nuevaTarea.fecha = fechaInput.value;

  plannerData.tareas.push(nuevaTarea);
  input.value = '';
  if (fechaInput) fechaInput.value = '';
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

async function guardarEdicionTarea(id, nuevoTexto, nuevaFecha) {
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
  if (nuevaFecha) {
    tarea.fecha = nuevaFecha;
  } else {
    delete tarea.fecha;
  }
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

  const hoy = getTodayISO();

  let items = plannerData.habitos.slice();

  if (habitoFiltro === 'hecho-hoy') items = items.filter((h) => h.fechas.includes(hoy));
  else if (habitoFiltro === 'pendiente-hoy') items = items.filter((h) => !h.fechas.includes(hoy));

  if (habitoOrden === 'recientes') items.reverse();
  else if (habitoOrden === 'alfabetico') items.sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
  else if (habitoOrden === 'racha') items.sort((a, b) => calcularRacha(b.fechas) - calcularRacha(a.fechas));

  vacio.classList.toggle('hidden', items.length > 0);

  items.forEach((habito) => {
    const li = document.createElement('li');
    li.className = 'item-habito';

    if (habitoEnEdicionId === habito.id) {
      // Modo edición: el nombre se sustituye por un input inline.
      // La racha (habito.fechas) no se toca, así que el progreso se mantiene.
      const inputEdicion = document.createElement('input');
      inputEdicion.type = 'text';
      inputEdicion.className = 'item-edit-input';
      inputEdicion.value = habito.texto;

      const guardar = document.createElement('button');
      guardar.type = 'button';
      guardar.className = 'item-save';
      guardar.textContent = 'Guardar';
      guardar.addEventListener('click', () => guardarEdicionHabito(habito.id, inputEdicion.value));

      const cancelar = document.createElement('button');
      cancelar.type = 'button';
      cancelar.className = 'item-cancel';
      cancelar.textContent = 'Cancelar';
      cancelar.addEventListener('click', () => cancelarEdicionHabito());

      inputEdicion.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          guardarEdicionHabito(habito.id, inputEdicion.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelarEdicionHabito();
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

    const editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'item-edit';
    editar.textContent = 'Editar';
    editar.addEventListener('click', () => editarHabito(habito.id));

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-delete';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', async () => {
      const confirmado = await pedirConfirmacion('¿Eliminar este hábito?');
      if (confirmado) deleteHabito(habito.id);
    });

    li.appendChild(info);
    li.appendChild(boton);
    li.appendChild(editar);
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

function editarHabito(id) {
  habitoEnEdicionId = id;
  renderHabitos();
}

function cancelarEdicionHabito() {
  habitoEnEdicionId = null;
  renderHabitos();
}

async function guardarEdicionHabito(id, nuevoTexto) {
  const texto = nuevoTexto.trim();
  if (!texto) {
    // No se permite dejar el hábito sin texto; se descarta el cambio.
    cancelarEdicionHabito();
    return;
  }

  const habito = plannerData.habitos.find((h) => h.id === id);
  if (!habito) {
    cancelarEdicionHabito();
    return;
  }

  habito.texto = texto;
  habitoEnEdicionId = null;
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

  let items = plannerData.objetivos.slice();

  if (objetivoFiltro === 'completados') {
    items = items.filter((o) => o.pasos.length > 0 && calcularProgreso(o.pasos) === 100);
  } else if (objetivoFiltro === 'en-progreso') {
    items = items.filter((o) => !(o.pasos.length > 0 && calcularProgreso(o.pasos) === 100));
  }

  if (objetivoOrden === 'recientes') items.reverse();
  else if (objetivoOrden === 'alfabetico') items.sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
  else if (objetivoOrden === 'progreso') {
    items.sort((a, b) => calcularProgreso(b.pasos) - calcularProgreso(a.pasos));
  }

  vacio.classList.toggle('hidden', items.length > 0);

  items.forEach((objetivo) => {
    const card = document.createElement('div');
    card.className = 'objetivo-card';

    const header = document.createElement('div');
    header.className = 'objetivo-header';

    const pct = calcularProgreso(objetivo.pasos);

    if (objetivoEnEdicionId === objetivo.id) {
      // Modo edición: el nombre se sustituye por un input inline, y se
      // añade una fila con la fecha límite (opcional) y las acciones.
      // objetivo.pasos no se toca, así que el progreso se mantiene.
      const inputEdicion = document.createElement('input');
      inputEdicion.type = 'text';
      inputEdicion.className = 'item-edit-input';
      inputEdicion.value = objetivo.texto;

      const fechaInput = document.createElement('input');
      fechaInput.type = 'date';
      fechaInput.className = 'item-edit-fecha';
      fechaInput.value = objetivo.fecha || '';

      const quitarFecha = document.createElement('button');
      quitarFecha.type = 'button';
      quitarFecha.className = 'item-quitar-fecha';
      quitarFecha.textContent = 'Quitar fecha';
      quitarFecha.addEventListener('click', () => {
        fechaInput.value = '';
      });

      const guardar = document.createElement('button');
      guardar.type = 'button';
      guardar.className = 'item-save';
      guardar.textContent = 'Guardar';
      guardar.addEventListener('click', () =>
        guardarEdicionObjetivo(objetivo.id, inputEdicion.value, fechaInput.value)
      );

      const cancelar = document.createElement('button');
      cancelar.type = 'button';
      cancelar.className = 'item-cancel';
      cancelar.textContent = 'Cancelar';
      cancelar.addEventListener('click', () => cancelarEdicionObjetivo());

      inputEdicion.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          guardarEdicionObjetivo(objetivo.id, inputEdicion.value, fechaInput.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelarEdicionObjetivo();
        }
      });

      const filaFecha = document.createElement('div');
      filaFecha.className = 'item-edit-row';
      filaFecha.appendChild(fechaInput);
      filaFecha.appendChild(quitarFecha);
      filaFecha.appendChild(guardar);
      filaFecha.appendChild(cancelar);

      header.appendChild(inputEdicion);

      card.appendChild(header);
      card.appendChild(filaFecha);
      lista.appendChild(card);
      inputEdicion.focus();
      inputEdicion.select();
      return;
    }

    const nombre = document.createElement('span');
    nombre.className = 'objetivo-nombre';
    nombre.textContent = objetivo.texto;

    const progresoTexto = document.createElement('span');
    progresoTexto.className = 'objetivo-progreso-texto';
    progresoTexto.textContent = objetivo.pasos.length
      ? pct + '% (' + objetivo.pasos.filter((p) => p.hecho).length + '/' + objetivo.pasos.length + ')'
      : 'Sin pasos';

    header.appendChild(nombre);
    header.appendChild(progresoTexto);

    let fechaEl = null;
    if (objetivo.fecha) {
      const { texto: fechaTexto, vencida } = textoFechaLimite(objetivo.fecha);
      fechaEl = document.createElement('div');
      fechaEl.className = 'item-fecha' + (vencida ? ' vencida' : '');
      fechaEl.textContent = fechaTexto;
    }

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

    const editarObjetivoBtn = document.createElement('button');
    editarObjetivoBtn.type = 'button';
    editarObjetivoBtn.className = 'item-edit';
    editarObjetivoBtn.textContent = 'Editar objetivo';
    editarObjetivoBtn.addEventListener('click', () => editarObjetivo(objetivo.id));

    const borrarObjetivo = document.createElement('button');
    borrarObjetivo.type = 'button';
    borrarObjetivo.className = 'item-delete';
    borrarObjetivo.textContent = 'Eliminar objetivo';
    borrarObjetivo.addEventListener('click', async () => {
      const confirmado = await pedirConfirmacion('¿Eliminar este objetivo?');
      if (confirmado) deleteObjetivo(objetivo.id);
    });

    card.appendChild(header);
    if (fechaEl) card.appendChild(fechaEl);
    card.appendChild(barra);
    card.appendChild(pasoLista);
    card.appendChild(pasoForm);
    card.appendChild(editarObjetivoBtn);
    card.appendChild(borrarObjetivo);
    lista.appendChild(card);
  });
}

async function handleObjetivoSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('objetivo-texto');
  const fechaInput = document.getElementById('objetivo-fecha');
  const texto = input.value.trim();
  if (!texto) return;

  const nuevoObjetivo = { id: generateId(), texto, pasos: [] };
  if (fechaInput && fechaInput.value) nuevoObjetivo.fecha = fechaInput.value;

  plannerData.objetivos.push(nuevoObjetivo);
  input.value = '';
  if (fechaInput) fechaInput.value = '';
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

function editarObjetivo(id) {
  objetivoEnEdicionId = id;
  renderObjetivos();
}

function cancelarEdicionObjetivo() {
  objetivoEnEdicionId = null;
  renderObjetivos();
}

async function guardarEdicionObjetivo(id, nuevoTexto, nuevaFecha) {
  const texto = nuevoTexto.trim();
  if (!texto) {
    // No se permite dejar el objetivo sin texto; se descarta el cambio.
    cancelarEdicionObjetivo();
    return;
  }

  const objetivo = plannerData.objetivos.find((o) => o.id === id);
  if (!objetivo) {
    cancelarEdicionObjetivo();
    return;
  }

  objetivo.texto = texto;
  if (nuevaFecha) {
    objetivo.fecha = nuevaFecha;
  } else {
    delete objetivo.fecha;
  }
  objetivoEnEdicionId = null;
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
    borrar.addEventListener('click', async () => {
      const confirmado = await pedirConfirmacion('¿Eliminar este examen?');
      if (confirmado) deleteExamen(examen.id);
    });

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

// --- Calendario ---
//
// Vista de solo lectura: agrupa por fecha (clave 'YYYY-MM-DD') los
// elementos que ya tienen fecha en plannerData. No añade ningún campo
// nuevo ni toca savePlannerData — solo lee lo que ya existe.

function reunirElementosPorFecha() {
  const porFecha = {};

  function agregar(fecha, tipo, texto) {
    if (!fecha) return;
    if (!porFecha[fecha]) {
      porFecha[fecha] = { tareas: [], objetivos: [], examenes: [], habitos: [] };
    }
    porFecha[fecha][tipo].push(texto);
  }

  plannerData.tareas.forEach((t) => agregar(t.fecha, 'tareas', t.texto));
  plannerData.objetivos.forEach((o) => agregar(o.fecha, 'objetivos', o.texto));
  plannerData.examenes.forEach((e) => agregar(e.fecha, 'examenes', e.texto));
  plannerData.habitos.forEach((h) => {
    (h.fechas || []).forEach((fecha) => agregar(fecha, 'habitos', h.texto));
  });

  return porFecha;
}

const CALENDARIO_DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function renderCalendario() {
  const grid = document.getElementById('calendario-grid');
  const label = document.getElementById('calendario-mes-label');
  if (!grid || !label) return;

  const ano = calendarioFecha.getFullYear();
  const mes = calendarioFecha.getMonth();

  label.textContent = calendarioFecha.toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
  });

  const porFecha = reunirElementosPorFecha();
  const hoy = getTodayISO();

  grid.innerHTML = '';

  CALENDARIO_DIAS_SEMANA.forEach((nombre) => {
    const cabecera = document.createElement('div');
    cabecera.className = 'calendario-dia-nombre';
    cabecera.textContent = nombre;
    grid.appendChild(cabecera);
  });

  // El mes empieza en lunes: getDay() da 0=domingo..6=sábado, así que
  // se convierte a 0=lunes..6=domingo para calcular el hueco inicial.
  const primerDiaMes = new Date(ano, mes, 1);
  const huecoInicial = (primerDiaMes.getDay() + 6) % 7;
  const diasEnMes = new Date(ano, mes + 1, 0).getDate();

  for (let i = 0; i < huecoInicial; i++) {
    const vacio = document.createElement('div');
    vacio.className = 'calendario-dia vacio';
    grid.appendChild(vacio);
  }

  for (let dia = 1; dia <= diasEnMes; dia++) {
    const fechaISO = formatISODate(new Date(ano, mes, dia));
    const elementos = porFecha[fechaISO];

    const celda = document.createElement('div');
    celda.className = 'calendario-dia' + (fechaISO === hoy ? ' calendario-dia--hoy' : '');

    const numero = document.createElement('div');
    numero.className = 'calendario-dia-numero';
    numero.textContent = String(dia);
    celda.appendChild(numero);

    if (elementos) {
      const resumenPartes = [];
      const puntos = document.createElement('div');
      puntos.className = 'calendario-dia-puntos';

      [
        ['tareas', 'punto-tarea', 'Tarea'],
        ['objetivos', 'punto-objetivo', 'Objetivo'],
        ['examenes', 'punto-examen', 'Examen'],
        ['habitos', 'punto-habito', 'Hábito'],
      ].forEach(([tipo, clase, etiqueta]) => {
        elementos[tipo].forEach((texto) => {
          const punto = document.createElement('span');
          punto.className = 'leyenda-punto ' + clase;
          puntos.appendChild(punto);
          resumenPartes.push(etiqueta + ': ' + texto);
        });
      });

      if (resumenPartes.length > 0) {
        celda.title = resumenPartes.join('\n');
        celda.appendChild(puntos);
      }
    }

    grid.appendChild(celda);
  }
}

function cambiarMesCalendario(delta) {
  calendarioFecha = new Date(calendarioFecha.getFullYear(), calendarioFecha.getMonth() + delta, 1);
  renderCalendario();
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

  // Barras de orden/filtro (16.2.5): cada select actualiza su variable de
  // estado en memoria y vuelve a pintar solo su lista.
  const tareaOrdenEl = document.getElementById('tarea-orden');
  if (tareaOrdenEl) tareaOrdenEl.addEventListener('change', () => {
    tareaOrden = tareaOrdenEl.value;
    renderTareas();
  });
  const tareaFiltroEl = document.getElementById('tarea-filtro');
  if (tareaFiltroEl) tareaFiltroEl.addEventListener('change', () => {
    tareaFiltro = tareaFiltroEl.value;
    renderTareas();
  });

  const habitoOrdenEl = document.getElementById('habito-orden');
  if (habitoOrdenEl) habitoOrdenEl.addEventListener('change', () => {
    habitoOrden = habitoOrdenEl.value;
    renderHabitos();
  });
  const habitoFiltroEl = document.getElementById('habito-filtro');
  if (habitoFiltroEl) habitoFiltroEl.addEventListener('change', () => {
    habitoFiltro = habitoFiltroEl.value;
    renderHabitos();
  });

  const objetivoOrdenEl = document.getElementById('objetivo-orden');
  if (objetivoOrdenEl) objetivoOrdenEl.addEventListener('change', () => {
    objetivoOrden = objetivoOrdenEl.value;
    renderObjetivos();
  });
  const objetivoFiltroEl = document.getElementById('objetivo-filtro');
  if (objetivoFiltroEl) objetivoFiltroEl.addEventListener('change', () => {
    objetivoFiltro = objetivoFiltroEl.value;
    renderObjetivos();
  });

  // Navegación entre meses del calendario (16.2.11).
  const calendarioAnteriorEl = document.getElementById('calendario-mes-anterior');
  if (calendarioAnteriorEl) calendarioAnteriorEl.addEventListener('click', () => cambiarMesCalendario(-1));

  const calendarioSiguienteEl = document.getElementById('calendario-mes-siguiente');
  if (calendarioSiguienteEl) calendarioSiguienteEl.addEventListener('click', () => cambiarMesCalendario(1));
}

initPlanner();