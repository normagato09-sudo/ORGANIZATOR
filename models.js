/**
 * ORGANIZATOR - Modelos de Datos (Fase 2.1)
 * Estructuras de datos para todas las áreas
 */

// ============================================
// MODELOS BASE
// ============================================

/**
 * Base para todas las tareas/eventos
 * @typedef {Object} BaseItem
 * @property {string} id - ID único (UUID)
 * @property {string} area - Área a la que pertenece (cole, cesi, casa, etc.)
 * @property {string} title - Título/nombre del item
 * @property {string} description - Descripción detallada
 * @property {Date} createdAt - Fecha de creación
 * @property {Date} updatedAt - Fecha de última actualización
 * @property {number} priority - Prioridad: 1 (baja), 2 (media), 3 (alta), 4 (urgente)
 * @property {string} status - Estado: "pending", "completed", "cancelled"
 * @property {string} tags - Tags/etiquetas (JSON string)
 * @property {string} notes - Notas adicionales
 */

// ============================================
// 🏫 COLE - Educación
// ============================================

/**
 * Asignatura/Materia de Cole
 * @typedef {Object} ColeSubject
 * @property {string} id
 * @property {string} name - Nombre de la asignatura
 * @property {string} teacher - Profesor/a
 * @property {string} classroom - Aula/Edificio
 * @property {string} color - Color personalizado (hex)
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * Tarea/Deber de Cole
 * @typedef {Object} ColeTask
 * @extends BaseItem
 * @property {string} subjectId - ID de la asignatura
 * @property {Date} dueDate - Fecha de entrega
 * @property {string} type - "homework", "project", "essay"
 * @property {boolean} submitted - ¿Entregado?
 * @property {number} grade - Calificación (0-10)
 */

/**
 * Examen de Cole
 * @typedef {Object} ColeExam
 * @extends BaseItem
 * @property {string} subjectId - ID de la asignatura
 * @property {Date} examDate - Fecha y hora del examen
 * @property {string} location - Lugar del examen
 * @property {string} content - Contenido que entra en el examen
 * @property {number} duration - Duración en minutos
 * @property {number} grade - Calificación obtenida
 * @property {string} difficulty - "easy", "medium", "hard"
 */

/**
 * Trabajo de Cole
 * @typedef {Object} ColeWork
 * @extends BaseItem
 * @property {string} subjectId - ID de la asignatura
 * @property {Date} dueDate - Fecha de entrega
 * @property {string} type - "group", "individual", "presentation"
 * @property {number} grade - Calificación
 * @property {string[]} members - Miembros del grupo (si aplica)
 */

// ============================================
// 🤝 CESI - Empresa/Organización
// ============================================

/**
 * Reunión de CESI
 * @typedef {Object} CesiMeeting
 * @extends BaseItem
 * @property {Date} startTime - Hora de inicio
 * @property {Date} endTime - Hora de finalización
 * @property {string} location - Lugar de la reunión
 * @property {string} attendees - Asistentes (JSON string)
 * @property {string} agenda - Orden del día
 * @property {string} minutes - Actas de la reunión
 * @property {boolean} isOnline - ¿Es virtual?
 * @property {string} meetingLink - Enlace de la reunión (si es online)
 */

/**
 * Tarea de CESI
 * @typedef {Object} CesiTask
 * @extends BaseItem
 * @property {Date} dueDate - Fecha de vencimiento
 * @property {string} assignee - Asignado a (nombre/email)
 * @property {string} department - Departamento
 * @property {string} project - Proyecto/Cliente
 * @property {boolean} billable - ¿Es facurable?
 * @property {number} estimatedHours - Horas estimadas
 * @property {number} actualHours - Horas reales
 */

/**
 * Evento de CESI
 * @typedef {Object} CesiEvent
 * @extends BaseItem
 * @property {Date} startTime - Hora de inicio
 * @property {Date} endTime - Hora de finalización
 * @property {string} eventType - "conference", "training", "teambuilding", "other"
 * @property {string} location - Lugar del evento
 * @property {boolean} isAttending - ¿Voy a asistir?
 * @property {string} notes - Notas del evento
 */

// ============================================
// 🏠 CASA - Hogar
// ============================================

/**
 * Tarea doméstica
 * @typedef {Object} HouseTask
 * @extends BaseItem
 * @property {Date} dueDate - Fecha límite
 * @property {string} room - Habitación/Área (cocina, baño, etc.)
 * @property {string} frequency - "once", "daily", "weekly", "biweekly", "monthly"
 * @property {string} assignee - Quién debe hacerlo
 * @property {number} estimatedMinutes - Minutos estimados
 * @property {boolean} isRecurring - ¿Es una tarea recurrente?
 * @property {Date} nextOccurrence - Próxima ocurrencia (si es recurrente)
 */

/**
 * Recordatorio del hogar
 * @typedef {Object} HouseReminder
 * @extends BaseItem
 * @property {Date} reminderDate - Fecha del recordatorio
 * @property {string} category - "maintenance", "cleaning", "appointment", "other"
 * @property {string} relatedItem - Item relacionado (nombre/ID)
 */

// ============================================
// 🛒 COMPRAS - Shopping List
// ============================================

/**
 * Producto en la lista de compras
 * @typedef {Object} ShoppingItem
 * @property {string} id
 * @property {string} listId - ID de la lista
 * @property {string} name - Nombre del producto
 * @property {string} category - Categoría (frutas, lácteos, limpieza, etc.)
 * @property {number} quantity - Cantidad
 * @property {string} unit - Unidad (kg, L, unidades, etc.)
 * @property {number} estimatedPrice - Precio estimado
 * @property {boolean} purchased - ¿Ya comprado?
 * @property {Date} addedDate - Fecha de adición
 * @property {Date} purchasedDate - Fecha de compra
 * @property {string} notes - Notas (marca, especificación, etc.)
 * @property {boolean} isRecurring - ¿Compra recurrente?
 */

/**
 * Lista de compras
 * @typedef {Object} ShoppingList
 * @property {string} id
 * @property {string} name - Nombre de la lista
 * @property {string} purpose - Propósito ("semanal", "fiesta", etc.)
 * @property {Date} createdDate - Fecha de creación
 * @property {Date} completedDate - Fecha de completación
 * @property {string} status - "active", "completed", "archived"
 * @property {Date} targetDate - Fecha prevista de compra
 * @property {number} totalEstimatedCost - Costo total estimado
 * @property {number} actualCost - Costo actual
 * @property {string} notes - Notas generales
 */

// ============================================
// 🌴 VACACIONES / FESTIVOS
// ============================================

/**
 * Período de vacaciones
 * @typedef {Object} VacationPeriod
 * @property {string} id
 * @property {string} title - Nombre de las vacaciones (verano, semana santa, etc.)
 * @property {Date} startDate - Fecha de inicio
 * @property {Date} endDate - Fecha de fin
 * @property {string} type - "vacation", "holiday", "break", "trip"
 * @property {string} location - Destino/Ubicación
 * @property {string} description - Descripción
 * @property {number} dayCount - Número de días (calculado)
 * @property {string} status - "planned", "ongoing", "completed"
 * @property {string} notes - Notas
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * Festivo/Día especial
 * @typedef {Object} Holiday
 * @property {string} id
 * @property {string} name - Nombre del festivo
 * @property {Date} date - Fecha del festivo
 * @property {string} country - País
 * @property {string} type - "holiday", "special", "personal"
 * @property {boolean} isOfficial - ¿Es festivo oficial?
 * @property {string} notes - Notas
 * @property {Date} createdAt
 */

/**
 * Viaje
 * @typedef {Object} Trip
 * @extends VacationPeriod
 * @property {string} destination - Destino principal
 * @property {string[]} stops - Paradas intermedias
 * @property {string} transport - Medio de transporte principal
 * @property {string} accommodation - Dónde se hospeda
 * @property {number} budget - Presupuesto total
 * @property {number} spent - Cantidad gastada
 * @property {string[]} checklist - Lista de cosas que llevar/preparar
 */

// ============================================
// 🧊 RUBIK - Cubo de Rubik
// ============================================

/**
 * Sesión de entrenamiento de Rubik
 * @typedef {Object} RubikSession
 * @property {string} id
 * @property {Date} date - Fecha de la sesión
 * @property {string} sessionType - "speedcubing", "solving", "practice", "freestyle"
 * @property {number} durationMinutes - Duración en minutos
 * @property {string} cubeType - Tipo de cubo (2x2, 3x3, 4x4, etc.)
 * @property {string} cubeBrand - Marca del cubo
 * @property {number} solveCount - Número de solves
 * @property {number} averageTime - Promedio de tiempo (ms)
 * @property {number} bestTime - Mejor tiempo (ms)
 * @property {number} worstTime - Peor tiempo (ms)
 * @property {string} method - Método usado (CFOP, Roux, ZZ, etc.)
 * @property {string} trainingFocus - Foco del entrenamiento (F2L, OLL, PLL, etc.)
 * @property {string} notes - Notas de la sesión
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * Solve individual de Rubik
 * @typedef {Object} RubikSolve
 * @property {string} id
 * @property {string} sessionId - ID de la sesión
 * @property {string} cubeType - Tipo de cubo
 * @property {number} time - Tiempo en milisegundos
 * @property {number} sequence - Número de solve en la sesión
 * @property {boolean} dnf - ¿DNF (Did Not Finish)?
 * @property {boolean} plus2 - ¿Penalty +2?
 * @property {string} scramble - Fórmula del scramble
 * @property {string} method - Método usado
 * @property {string} notes - Notas del solve
 * @property {Date} timestamp - Fecha y hora
 */

/**
 * Cubo de Rubik (equipo)
 * @typedef {Object} RubikCube
 * @property {string} id
 * @property {string} name - Nombre personalizado del cubo
 * @property {string} type - "2x2", "3x3", "4x4", "5x5", etc.
 * @property {string} brand - Marca
 * @property {string} model - Modelo específico
 * @property {string} color - Color/Imagen
 * @property {boolean} isMain - ¿Es el cubo principal?
 * @property {Date} acquiredDate - Fecha de adquisición
 * @property {number} totalSolves - Total de solves realizados
 * @property {number} personalBest - PB personal
 * @property {string} condition - "new", "good", "worn", "damaged"
 * @property {string} notes - Notas
 * @property {Date} createdAt
 */

/**
 * Estadísticas de Rubik
 * @typedef {Object} RubikStats
 * @property {string} id
 * @property {Date} periodStart - Inicio del período
 * @property {Date} periodEnd - Fin del período
 * @property {number} totalSolves - Total de solves en el período
 * @property {number} totalSessionTime - Tiempo total en sesiones
 * @property {number} bestAverage5 - Mejor promedio de 5
 * @property {number} bestAverage12 - Mejor promedio de 12
 * @property {number} bestAverage50 - Mejor promedio de 50
 * @property {number} currentAverage - Promedio actual
 * @property {string} mostUsedMethod - Método más usado
 * @property {string} favoriteSession - Mejor tipo de sesión
 * @property {Object} progressByType - Progreso por tipo de cubo
 * @property {Date} lastUpdated
 */

// ============================================
// 📅 EVENTOS GENERALES (Para Inicio)
// ============================================

/**
 * Evento general que puede aparecer en el Inicio
 * Estructura común para mostrar en el calendario/línea de tiempo
 * @typedef {Object} GeneralEvent
 * @property {string} id - ID único
 * @property {string} title - Título del evento
 * @property {Date} startDate - Fecha/hora de inicio
 * @property {Date} endDate - Fecha/hora de fin (opcional)
 * @property {string} area - Área de origen (cole, cesi, casa, rubik, compras, vacaciones)
 * @property {string} type - Tipo específico (exam, meeting, task, solve, etc.)
 * @property {string} sourceId - ID del item original en su área
 * @property {string} priority - Prioridad (1-4 o baja/media/alta/urgente)
 * @property {string} color - Color de presentación (heredado del área)
 * @property {boolean} completed - ¿Completado?
 * @property {string} description - Descripción breve
 */

// ============================================
// UTILIDADES
// ============================================

/**
 * Genera un UUID v4 simple
 * @returns {string}
 */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Crea un objeto base de item
 * @param {string} area - Área
 * @param {Partial<BaseItem>} overrides - Propiedades a sobrescribir
 * @returns {BaseItem}
 */
function createBaseItem(area, overrides = {}) {
  const now = new Date();
  return {
    id: generateId(),
    area,
    title: '',
    description: '',
    createdAt: now,
    updatedAt: now,
    priority: 2,
    status: 'pending',
    tags: '[]',
    notes: '',
    ...overrides
  };
}
