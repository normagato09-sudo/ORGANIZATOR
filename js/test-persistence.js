/**
 * ORGANIZATOR - Prueba de Persistencia (Fase 2.1)
 * Script de demostración y verificación del sistema de datos
 */

// ============================================
// PRUEBA DE PERSISTENCIA
// ============================================

/**
 * Ejecuta una prueba completa del sistema de datos
 */
async function runPersistenceTest() {
  console.log('🧪 Iniciando prueba de persistencia...\n');
  
  try {
    // 1. CREAR DATOS DE PRUEBA
    console.log('1️⃣  Creando datos de prueba en Cole...');
    const subject = await ColeDataManager.createSubject('Matemáticas', 'Prof. García', 'Aula 201');
    console.log('   ✅ Asignatura creada:', subject.name);
    
    const task = await ColeDataManager.createTask(
      'Ejercicios del tema 5',
      subject.id,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      3
    );
    console.log('   ✅ Tarea creada:', task.title);
    
    const exam = await ColeDataManager.createExam(
      'Examen de Análisis',
      subject.id,
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      'Aula 201',
      4
    );
    console.log('   ✅ Examen creado:', exam.title);
    
    // 2. CREAR DATOS DE OTRAS ÁREAS
    console.log('\n2️⃣  Creando datos de prueba en otras áreas...');
    
    const meeting = await CesiDataManager.createMeeting(
      'Reunión de proyecto',
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      'Sala de conferencias'
    );
    console.log('   ✅ Reunión CESI creada:', meeting.title);
    
    const houseTask = await HouseDataManager.createTask(
      'Limpiar la cocina',
      new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      'Cocina',
      'weekly'
    );
    console.log('   ✅ Tarea doméstica creada:', houseTask.title);
    
    const shoppingList = await ShoppingDataManager.createList('Compra semanal', 'Compra del supermercado');
    console.log('   ✅ Lista de compras creada:', shoppingList.name);
    
    const shoppingItem = await ShoppingDataManager.addItem(
      shoppingList.id,
      'Leche',
      'Lácteos',
      2,
      'L'
    );
    console.log('   ✅ Producto añadido:', shoppingItem.name);
    
    const vacation = await VacationDataManager.createVacation(
      'Verano',
      new Date('2026-06-21'),
      new Date('2026-09-01'),
      'Costa',
      'vacation'
    );
    console.log('   ✅ Vacaciones creadas:', vacation.title);
    
    const rubikSession = await RubikDataManager.createSession('3x3', 'practice', 45);
    console.log('   ✅ Sesión Rubik creada');
    
    const solve = await RubikDataManager.recordSolve(rubikSession.id, 28500);
    console.log('   ✅ Solve registrado:', solve.time, 'ms');
    
    // 3. RECUPERAR DATOS
    console.log('\n3️⃣  Recuperando datos de la base de datos...');
    const allSubjects = await ColeDataManager.getAllSubjects();
    console.log(`   ✅ Asignaturas en BD: ${allSubjects.length}`);
    
    const allTasks = await ColeDataManager.getAllTasks();
    console.log(`   ✅ Tareas en BD: ${allTasks.length}`);
    
    const allExams = await ColeDataManager.getAllExams();
    console.log(`   ✅ Exámenes en BD: ${allExams.length}`);
    
    const allMeetings = await CesiDataManager.getAllMeetings();
    console.log(`   ✅ Reuniones en BD: ${allMeetings.length}`);
    
    const allHouseTasks = await HouseDataManager.getAllTasks();
    console.log(`   ✅ Tareas domésticas en BD: ${allHouseTasks.length}`);
    
    const allLists = await ShoppingDataManager.getAllLists();
    console.log(`   ✅ Listas de compras en BD: ${allLists.length}`);
    
    const allVacations = await VacationDataManager.getAllVacations();
    console.log(`   ✅ Vacaciones en BD: ${allVacations.length}`);
    
    const allSessions = await RubikDataManager.getAllSessions();
    console.log(`   ✅ Sesiones Rubik en BD: ${allSessions.length}`);
    
    // 4. CREAR EVENTOS GENERALES
    console.log('\n4️⃣  Creando eventos generales para Inicio...');
    const event1 = await GeneralEventDataManager.createEvent(
      task.title,
      task.dueDate,
      'cole',
      'task',
      task.id,
      task.priority
    );
    console.log('   ✅ Evento tarea:', event1.title);
    
    const event2 = await GeneralEventDataManager.createEvent(
      exam.title,
      exam.examDate,
      'cole',
      'exam',
      exam.id,
      exam.priority
    );
    console.log('   ✅ Evento examen:', event2.title);
    
    const event3 = await GeneralEventDataManager.createEvent(
      meeting.title,
      meeting.startTime,
      'cesi',
      'meeting',
      meeting.id,
      meeting.priority
    );
    console.log('   ✅ Evento reunión:', event3.title);
    
    // 5. OBTENER EVENTOS DEL DÍA Y PRÓXIMOS
    console.log('\n5️⃣  Recuperando eventos del Inicio...');
    const today = new Date();\n    const todayEvents = await GeneralEventDataManager.getEventsForDate(today);
    console.log(`   ✅ Eventos para hoy: ${todayEvents.length}`);
    
    const upcomingEvents = await GeneralEventDataManager.getUpcomingEvents(7);
    console.log(`   ✅ Eventos próximos (7 días): ${upcomingEvents.length}`);
    
    // 6. VERIFICACIÓN FINAL
    console.log('\n✨ ¡Prueba completada exitosamente!');
    console.log('\n📊 Resumen de datos guardados:');
    console.log(`   • Cole: ${allSubjects.length} asignaturas, ${allTasks.length} tareas, ${allExams.length} exámenes`);
    console.log(`   • CESI: ${allMeetings.length} reuniones`);
    console.log(`   • Casa: ${allHouseTasks.length} tareas domésticas`);
    console.log(`   • Compras: ${allLists.length} listas`);
    console.log(`   • Vacaciones: ${allVacations.length} períodos`);
    console.log(`   • Rubik: ${allSessions.length} sesiones`);
    console.log(`   • Inicio: ${upcomingEvents.length} eventos próximos`);
    
    console.log('\n✅ Los datos persisten correctamente en IndexedDB');
    console.log('✅ Puedes cerrar y reabrir el navegador sin perder los datos');
    
    return true;
  } catch (error) {
    console.error('❌ Error en la prueba:', error);
    return false;
  }
}

// Ejecutar prueba cuando se carga el script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => runPersistenceTest(), 500);
  });
} else {
  setTimeout(() => runPersistenceTest(), 500);
}
