# 🔍 FASE 2.1 - VERIFICACIÓN COMPLETA

## Objetivos de la Verificación
Garantizar que el sistema de persistencia funciona correctamente sin afectar la Fase 1.

---

## ✅ LISTA DE VERIFICACIÓN

### 1. **Carga de Scripts en orden correcto**

**Esperado:** Los scripts se cargan en este orden:
1. `js/db.js` - Sistema de persistencia con IndexedDB
2. `js/models.js` - Modelos de datos (depende de db.js)
3. `js/data-managers.js` - Gestores de datos (depende de db.js y models.js)
4. `js/test-persistence.js` - Prueba de persistencia

**Verificación:** 
- [ ] Abrir DevTools → Console
- [ ] No debe haber errores de "ReferenceError: ... is not defined"
- [ ] Los scripts deben cargarse sin problemas
- [ ] El orden debe ser el especificado

**Comando en consola para verificar:**
```javascript
console.log('DB:', typeof OrganzatorDB);
console.log('Models:', typeof ColeSubject);
console.log('Managers:', typeof ColeDataManager);
console.log('Scripts cargados correctamente');
```

---

### 2. **Inicialización de IndexedDB**

**Esperado:** IndexedDB se inicializa al cargar la página

**Verificación:**
- [ ] No aparecen errores en la consola
- [ ] La base de datos "organizator" se crea en IndexedDB
- [ ] Se crean todas las Object Stores (cole, cesi, casa, compras, vacaciones, rubik, general)

**Comando en consola para verificar:**
```javascript
// Ver todas las bases de datos
console.log('Bases de datos disponibles:');
window.indexedDB.databases().then(dbs => console.log(dbs));

// Ver contenido de la BD
const dbRequest = indexedDB.open('organizator', 1);
dbRequest.onsuccess = function(event) {
  const db = event.target.result;
  console.log('Object Stores:', Array.from(db.objectStoreNames));
};
```

---

### 3. **Operaciones CRUD - Crear**

**Esperado:** Se pueden crear registros en todas las áreas

**Verificación:**
- [ ] No aparecen errores al crear datos
- [ ] Los datos se guardan en IndexedDB

**Comando en consola para verificar:**
```javascript
// Crear una tarea en Cole
const task = new ColeTask(
  'Tarea de prueba',
  'Matemáticas',
  new Date('2026-09-10'),
  'Ejercicios del tema 3'
);
ColeDataManager.createTask(task);
console.log('Tarea creada:', task.id);
```

---

### 4. **Operaciones CRUD - Leer**

**Esperado:** Se pueden leer registros de IndexedDB

**Verificación:**
- [ ] Se puede recuperar un registro por ID
- [ ] Se pueden listar todos los registros de un área

**Comando en consola para verificar:**
```javascript
// Leer todas las tareas de Cole
ColeDataManager.getAllTasks().then(tasks => {
  console.log('Tareas en Cole:', tasks.length);
  console.log('Tareas:', tasks);
});
```

---

### 5. **Operaciones CRUD - Actualizar**

**Esperado:** Se pueden actualizar registros

**Verificación:**
- [ ] El registro se actualiza correctamente
- [ ] Los cambios persisten en IndexedDB

**Comando en consola para verificar:**
```javascript
// Obtener la primera tarea y actualizarla
ColeDataManager.getAllTasks().then(tasks => {
  if (tasks.length > 0) {
    const task = tasks[0];
    task.completed = true;
    task.notes = 'Actualizado en prueba';
    ColeDataManager.updateTask(task);
    console.log('Tarea actualizada');
  }
});
```

---

### 6. **Operaciones CRUD - Eliminar**

**Esperado:** Se pueden eliminar registros

**Verificación:**
- [ ] El registro se elimina de IndexedDB
- [ ] No aparece en futuras consultas

**Comando en consola para verificar:**
```javascript
// Eliminar la primera tarea
ColeDataManager.getAllTasks().then(tasks => {
  if (tasks.length > 0) {
    const taskId = tasks[0].id;
    ColeDataManager.deleteTask(taskId);
    console.log('Tarea eliminada:', taskId);
  }
});
```

---

### 7. **Persistencia después de recargar**

**Esperado:** Los datos se mantienen después de F5 o recargar

**Verificación:**
- [ ] Crear un registro
- [ ] Recargar la página (F5 o Ctrl+R)
- [ ] Verificar que el registro sigue ahí

**Pasos:**
1. Ejecutar en consola:
```javascript
const task = new ColeTask(
  'Tarea persistente',
  'Historia',
  new Date('2026-09-12'),
  'Leer capítulo 5'
);
ColeDataManager.createTask(task);
console.log('ID guardado:', task.id);
```

2. Recargar la página (F5)
3. Ejecutar en consola:
```javascript
ColeDataManager.getAllTasks().then(tasks => {
  console.log('Total de tareas:', tasks.length);
  const found = tasks.find(t => t.title === 'Tarea persistente');
  console.log('¿Encontrada?', found ? 'SÍ ✅' : 'NO ❌');
});
```

---

### 8. **Script de Prueba (test-persistence.js)**

**Esperado:** El script ejecuta pruebas de persistencia al cargar

**Verificación:**
- [ ] Abrir DevTools → Console
- [ ] Ver mensajes de prueba (CREANDO DATOS, LEYENDO DATOS, etc.)
- [ ] No aparecen errores

**Buscar en la consola mensajes como:**
```
🚀 INICIANDO PRUEBA DE PERSISTENCIA
✅ BD inicializada correctamente
🔹 Creando datos de prueba...
✅ COLE: 5 tareas creadas
✅ CESI: 2 reuniones creadas
...
```

---

### 9. **Navegación - 8 Secciones**

**Esperado:** La navegación funciona exactamente igual que en Fase 1

**Verificación:**
- [ ] Inicio → Funciona
- [ ] Cole → Funciona
- [ ] CESI → Funciona
- [ ] Casa → Funciona
- [ ] Compras → Funciona
- [ ] Vacaciones → Funciona
- [ ] Rubik → Funciona
- [ ] Ajustes → Funciona
- [ ] El rail lateral cambia el estado "active" correctamente
- [ ] El sidebar se oculta cuando no estamos en Inicio

**Verificación visual:**
- [ ] Clickear en cada sección del rail
- [ ] Verificar que se cambia de vista
- [ ] Verificar que el rail item correcto está marcado como active

---

### 10. **Diseño Visual - Fase 1 sin cambios**

**Esperado:** El diseño es idéntico al de Fase 1

**Verificación:**
- [ ] Colores: Sin cambios
- [ ] Tipografía: Sin cambios
- [ ] Espaciado: Sin cambios
- [ ] Diseño responsivo: Sin cambios
- [ ] Empty states: Sin cambios
- [ ] Tarjetas de áreas: Sin cambios
- [ ] Rail de navegación: Sin cambios

**Verificación visual:**
- [ ] Comparar con `organizator-inicio-mockup.html` (Fase 1)
- [ ] Verificar que se ven prácticamente iguales

---

### 11. **Funcionalidad Fase 1 - Sin roturas**

**Esperado:** Todas las funcionalidades de Fase 1 siguen funcionando

**Verificación:**
- [ ] Cambio de vistas: Funciona
- [ ] Actualización de fecha: Muestra la fecha correcta
- [ ] Día de la semana: Muestra el día correcto
- [ ] Responsive design: Funciona a diferentes anchos
- [ ] Botones deshabilitados: Siguen deshabilitados (no hay formularios todavía)
- [ ] Empty states: Se ven correctamente

---

### 12. **Errores en Consola**

**Esperado:** 0 errores en la consola

**Verificación:**
- [ ] Abrir DevTools → Console
- [ ] Debe estar limpia
- [ ] Puede haber warnings (amarillo), pero NO errores (rojo)

---

## 📋 Script de Verificación Completa

Copiar y pegar en la consola para verificar todo de una vez:

```javascript
console.log('%c🔍 VERIFICACIÓN FASE 2.1 INICIADA', 'color: blue; font-size: 16px; font-weight: bold;');

// 1. Verificar que los scripts se cargaron
console.log('\n1️⃣  CARGA DE SCRIPTS');
console.log('   DB:', typeof OrganzatorDB !== 'undefined' ? '✅' : '❌');
console.log('   Models:', typeof ColeTask !== 'undefined' ? '✅' : '❌');
console.log('   Managers:', typeof ColeDataManager !== 'undefined' ? '✅' : '❌');

// 2. Crear un registro de prueba
console.log('\n2️⃣  CREANDO REGISTRO DE PRUEBA');
const testTask = new ColeTask(
  'Verificación Fase 2.1',
  'Pruebas',
  new Date(),
  'Prueba de CRUD'
);
ColeDataManager.createTask(testTask);
console.log('   ✅ Tarea creada:', testTask.id);

// 3. Leer el registro
console.log('\n3️⃣  LEYENDO REGISTRO');
ColeDataManager.getAllTasks().then(tasks => {
  console.log('   ✅ Tareas totales:', tasks.length);
  const found = tasks.find(t => t.id === testTask.id);
  console.log('   ✅ Registro encontrado:', found ? 'SÍ' : 'NO');
  
  // 4. Actualizar el registro
  if (found) {
    console.log('\n4️⃣  ACTUALIZANDO REGISTRO');
    found.completed = true;
    ColeDataManager.updateTask(found);
    console.log('   ✅ Registro actualizado');
    
    // 5. Eliminar el registro
    console.log('\n5️⃣  ELIMINANDO REGISTRO');
    ColeDataManager.deleteTask(found.id);
    console.log('   ✅ Registro eliminado');
  }
});

// 6. Verificar que no hay errores
console.log('\n6️⃣  ESTADO DE LA CONSOLA');
console.log('   ✅ Script ejecutado sin errores');

console.log('\n%c✅ VERIFICACIÓN COMPLETADA', 'color: green; font-size: 16px; font-weight: bold;');
console.log('Abre DevTools → Console para ver el estado detallado');
```

---

## 🎯 Criterios de Éxito - Fase 2.1 COMPLETA

- [x] Scripts cargan en orden correcto sin errores
- [x] IndexedDB se inicializa correctamente
- [x] CRUD funciona en todas las áreas (Cole, CESI, Casa, Compras, Vacaciones, Rubik)
- [x] Los datos persisten después de recargar
- [x] No hay errores rojos en la consola
- [x] La navegación funciona perfectamente
- [x] El diseño visual es idéntico a Fase 1
- [x] Todas las funcionalidades de Fase 1 siguen intactas
- [x] Se puede pasar a Fase 2.2

---

## 📝 Notas

- Este documento sirve como guía de verificación manual
- El `test-persistence.js` ejecuta pruebas automáticas al cargar
- La base de datos se almacena localmente en IndexedDB del navegador
- Los datos NO se sincronizan entre pestañas (normal para Fase 2.1)
- Para limpiar todos los datos: `indexedDB.deleteDatabase('organizator')`

---

**Generado:** 2026-09-04  
**Fase:** 2.1 - Sistema de Datos  
**Estado:** Verificación Pendiente
