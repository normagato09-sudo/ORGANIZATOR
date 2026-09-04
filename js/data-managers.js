/**
 * ORGANIZATOR - Gestores de Datos (Fase 2.1)
 * Lógica de acceso a datos para cada área
 */

// ============================================
// GESTOR COLE
// ============================================

class ColeDataManager {
  /**
   * Crea una nueva asignatura
   */
  static async createSubject(name, teacher = '', classroom = '') {
    const subject = {
      id: generateId(),
      name,
      teacher,
      classroom,
      color: '#D98E2C',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.COLE_SUBJECTS, subject);
    return subject;
  }

  /**
   * Obtiene todas las asignaturas
   */
  static async getAllSubjects() {
    return await db.getAll(STORES.COLE_SUBJECTS);
  }

  /**
   * Crea una tarea
   */
  static async createTask(title, subjectId, dueDate, priority = 2) {
    const task = {
      id: generateId(),
      area: 'cole',
      title,
      description: '',
      subjectId,
      dueDate,
      type: 'homework',
      submitted: false,
      grade: null,
      priority,
      status: 'pending',
      tags: '[]',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.COLE_TASKS, task);
    return task;
  }

  /**
   * Obtiene todas las tareas de Cole
   */
  static async getAllTasks() {
    return await db.getAll(STORES.COLE_TASKS);
  }

  /**
   * Obtiene tareas pendientes
   */
  static async getPendingTasks() {
    const all = await db.getAll(STORES.COLE_TASKS);
    return all.filter(t => t.status === 'pending');
  }

  /**
   * Crea un examen
   */
  static async createExam(title, subjectId, examDate, location = '', priority = 3) {
    const exam = {
      id: generateId(),
      area: 'cole',
      title,
      description: '',
      subjectId,
      examDate,
      location,
      content: '',
      duration: 60,
      grade: null,
      difficulty: 'medium',
      priority,
      status: 'pending',
      tags: '[]',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.COLE_EXAMS, exam);
    return exam;
  }

  /**
   * Obtiene todos los exámenes
   */
  static async getAllExams() {
    return await db.getAll(STORES.COLE_EXAMS);
  }

  /**
   * Obtiene exámenes próximos
   */
  static async getUpcomingExams() {
    const all = await db.getAll(STORES.COLE_EXAMS);
    const now = new Date();
    return all.filter(e => new Date(e.examDate) > now).sort((a, b) => 
      new Date(a.examDate) - new Date(b.examDate)
    );
  }
}

// ============================================
// GESTOR CESI
// ============================================

class CesiDataManager {
  /**
   * Crea una reunión
   */
  static async createMeeting(title, startTime, endTime, location = '', priority = 2) {
    const meeting = {
      id: generateId(),
      area: 'cesi',
      title,
      description: '',
      startTime,
      endTime,
      location,
      attendees: '[]',
      agenda: '',
      minutes: '',
      isOnline: false,
      meetingLink: '',
      priority,
      status: 'pending',
      tags: '[]',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.CESI_MEETINGS, meeting);
    return meeting;
  }

  /**
   * Obtiene todas las reuniones
   */
  static async getAllMeetings() {
    return await db.getAll(STORES.CESI_MEETINGS);
  }

  /**
   * Obtiene reuniones próximas
   */
  static async getUpcomingMeetings() {
    const all = await db.getAll(STORES.CESI_MEETINGS);
    const now = new Date();
    return all.filter(m => new Date(m.startTime) > now).sort((a, b) => 
      new Date(a.startTime) - new Date(b.startTime)
    );
  }

  /**
   * Crea una tarea
   */
  static async createTask(title, dueDate, assignee = '', priority = 2) {
    const task = {
      id: generateId(),
      area: 'cesi',
      title,
      description: '',
      dueDate,
      assignee,
      department: '',
      project: '',
      billable: false,
      estimatedHours: 0,
      actualHours: 0,
      priority,
      status: 'pending',
      tags: '[]',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.CESI_TASKS, task);
    return task;
  }

  /**
   * Obtiene todas las tareas
   */
  static async getAllTasks() {
    return await db.getAll(STORES.CESI_TASKS);
  }
}

// ============================================
// GESTOR CASA
// ============================================

class HouseDataManager {
  /**
   * Crea una tarea doméstica
   */
  static async createTask(title, dueDate, room = '', frequency = 'once', priority = 2) {
    const task = {
      id: generateId(),
      area: 'casa',
      title,
      description: '',
      dueDate,
      room,
      frequency,
      assignee: '',
      estimatedMinutes: 30,
      isRecurring: frequency !== 'once',
      nextOccurrence: dueDate,
      priority,
      status: 'pending',
      tags: '[]',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.HOUSE_TASKS, task);
    return task;
  }

  /**
   * Obtiene todas las tareas
   */
  static async getAllTasks() {
    return await db.getAll(STORES.HOUSE_TASKS);
  }

  /**
   * Obtiene tareas pendientes
   */
  static async getPendingTasks() {
    const all = await db.getAll(STORES.HOUSE_TASKS);
    return all.filter(t => t.status === 'pending');
  }
}

// ============================================
// GESTOR COMPRAS
// ============================================

class ShoppingDataManager {
  /**
   * Crea una lista de compras
   */
  static async createList(name, purpose = '', targetDate = null) {
    const list = {
      id: generateId(),
      name,
      purpose,
      createdDate: new Date(),
      completedDate: null,
      status: 'active',
      targetDate: targetDate || new Date(),
      totalEstimatedCost: 0,
      actualCost: 0,
      notes: ''
    };
    await db.set(STORES.SHOPPING_LISTS, list);
    return list;
  }

  /**
   * Obtiene todas las listas
   */
  static async getAllLists() {
    return await db.getAll(STORES.SHOPPING_LISTS);
  }

  /**
   * Obtiene listas activas
   */
  static async getActiveLists() {
    const all = await db.getAll(STORES.SHOPPING_LISTS);
    return all.filter(l => l.status === 'active');
  }

  /**
   * Añade un producto a una lista
   */
  static async addItem(listId, name, category = '', quantity = 1, unit = '') {
    const item = {
      id: generateId(),
      listId,
      name,
      category,
      quantity,
      unit,
      estimatedPrice: 0,
      purchased: false,
      addedDate: new Date(),
      purchasedDate: null,
      notes: '',
      isRecurring: false
    };
    await db.set(STORES.SHOPPING_ITEMS, item);
    return item;
  }

  /**
   * Obtiene items de una lista
   */
  static async getListItems(listId) {
    return await db.query(STORES.SHOPPING_ITEMS, 'listId', listId);
  }

  /**
   * Marca un item como comprado
   */
  static async markItemPurchased(itemId, purchased = true) {
    const item = await db.get(STORES.SHOPPING_ITEMS, itemId);
    if (item) {
      item.purchased = purchased;
      item.purchasedDate = purchased ? new Date() : null;
      await db.set(STORES.SHOPPING_ITEMS, item);
    }
  }
}

// ============================================
// GESTOR VACACIONES
// ============================================

class VacationDataManager {
  /**
   * Crea un período de vacaciones
   */
  static async createVacation(title, startDate, endDate, location = '', type = 'vacation') {
    const vacation = {
      id: generateId(),
      title,
      startDate,
      endDate,
      type,
      location,
      description: '',
      dayCount: Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)),
      status: 'planned',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.VACATIONS, vacation);
    return vacation;
  }

  /**
   * Obtiene todas las vacaciones
   */
  static async getAllVacations() {
    return await db.getAll(STORES.VACATIONS);
  }

  /**
   * Obtiene vacaciones próximas
   */
  static async getUpcomingVacations() {
    const all = await db.getAll(STORES.VACATIONS);
    const now = new Date();
    return all.filter(v => new Date(v.endDate) > now).sort((a, b) => 
      new Date(a.startDate) - new Date(b.startDate)
    );
  }

  /**
   * Crea un festivo
   */
  static async createHoliday(name, date, country = 'ES', isOfficial = true) {
    const holiday = {
      id: generateId(),
      name,
      date,
      country,
      type: 'holiday',
      isOfficial,
      notes: '',
      createdAt: new Date()
    };
    await db.set(STORES.HOLIDAYS, holiday);
    return holiday;
  }

  /**
   * Obtiene todos los festivos
   */
  static async getAllHolidays() {
    return await db.getAll(STORES.HOLIDAYS);
  }
}

// ============================================
// GESTOR RUBIK
// ============================================

class RubikDataManager {
  /**
   * Crea una sesión de entrenamiento
   */
  static async createSession(cubeType = '3x3', sessionType = 'practice', durationMinutes = 0) {
    const session = {
      id: generateId(),
      date: new Date(),
      sessionType,
      durationMinutes,
      cubeType,
      cubeBrand: '',
      solveCount: 0,
      averageTime: 0,
      bestTime: 0,
      worstTime: 0,
      method: 'CFOP',
      trainingFocus: '',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.set(STORES.RUBIK_SESSIONS, session);
    return session;
  }

  /**
   * Obtiene todas las sesiones
   */
  static async getAllSessions() {
    return await db.getAll(STORES.RUBIK_SESSIONS);
  }

  /**
   * Registra un solve individual
   */
  static async recordSolve(sessionId, time, cubeType = '3x3', dnf = false, plus2 = false) {
    const solve = {
      id: generateId(),
      sessionId,
      cubeType,
      time,
      sequence: 1,
      dnf,
      plus2,
      scramble: '',
      method: 'CFOP',
      notes: '',
      timestamp: new Date()
    };
    await db.set(STORES.RUBIK_SOLVES, solve);
    return solve;
  }

  /**
   * Obtiene solves de una sesión
   */
  static async getSessionSolves(sessionId) {
    return await db.query(STORES.RUBIK_SOLVES, 'sessionId', sessionId);
  }

  /**
   * Crea un registro de cubo
   */
  static async createCube(name, type = '3x3', brand = '', isMain = false) {
    const cube = {
      id: generateId(),
      name,
      type,
      brand,
      model: '',
      color: '',
      isMain,
      acquiredDate: new Date(),
      totalSolves: 0,
      personalBest: 0,
      condition: 'new',
      notes: '',
      createdAt: new Date()
    };
    await db.set(STORES.RUBIK_CUBES, cube);
    return cube;
  }

  /**
   * Obtiene todos los cubos
   */
  static async getAllCubes() {
    return await db.getAll(STORES.RUBIK_CUBES);
  }
}

// ============================================
// GESTOR GENERAL (EVENTOS PARA INICIO)
// ============================================

class GeneralEventDataManager {
  /**
   * Crea un evento general
   */
  static async createEvent(title, startDate, area, type, sourceId, priority = 2) {
    const event = {
      id: generateId(),
      title,
      startDate,
      endDate: startDate,
      area,
      type,
      sourceId,
      priority,
      color: this._getAreaColor(area),
      completed: false,
      description: ''
    };
    await db.set(STORES.GENERAL_EVENTS, event);
    return event;
  }

  /**
   * Obtiene eventos del día
   */
  static async getEventsForDate(date) {
    const all = await db.getAll(STORES.GENERAL_EVENTS);
    const dateStr = date.toISOString().split('T')[0];
    return all.filter(e => {
      const eventDateStr = new Date(e.startDate).toISOString().split('T')[0];
      return eventDateStr === dateStr;
    }).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  }

  /**
   * Obtiene próximos eventos
   */
  static async getUpcomingEvents(days = 7) {
    const all = await db.getAll(STORES.GENERAL_EVENTS);
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    
    return all
      .filter(e => {
        const eventDate = new Date(e.startDate);
        return eventDate >= now && eventDate <= futureDate && !e.completed;
      })
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  }

  /**
   * Obtiene color según el área
   * @private
   */
  static _getAreaColor(area) {
    const colors = {
      'cole': '#D98E2C',
      'cesi': '#6B4FE0',
      'casa': '#B5623B',
      'compras': '#3E8C5B',
      'vacaciones': '#2F6FE0',
      'rubik': '#1E9E8C'
    };
    return colors[area] || '#1B1F23';
  }
}
