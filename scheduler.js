/**
 * ORGANIZATOR — Scheduler (algoritmo de huecos libres y auto-planificación)
 *
 * Módulo puro (sin DOM, sin async, sin IA): recibe datos planos —tareas,
 * eventos, horario personalizado— y decide EN QUÉ HUECO va cada tarea sin
 * hora fija. No inventa disponibilidad ni prioridades: solo aplica reglas
 * deterministas sobre los datos que ya existen en state.
 *
 * Por qué existe separado de la IA:
 * la IA es buena entendiendo lenguaje natural ("tengo que entregar esto
 * mañana"), pero calcular huecos libres restando horarios ocupados es
 * aritmética exacta — mejor resuelta con código normal, siempre igual,
 * siempre depurable, sin gastar tokens ni arriesgar horas inventadas.
 *
 * Flujo previsto de integración:
 *   1) La IA (api/ai.js + buildContext) interpreta el texto del usuario y
 *      devuelve tareas/eventos estructurados (título, fecha límite u hora
 *      fija, prioridad, duración estimada si se puede inferir).
 *   2) Ese resultado se guarda con addTask()/addEvent() como siempre.
 *   3) Para las tareas SIN hora fija, se llama a Scheduler.autoSchedule()
 *      con el estado actual (tasks, events, customSchedules).
 *   4) Scheduler devuelve las mismas tareas con scheduledDate/Start/End
 *      rellenos (o un aviso si no cupieron antes de su fecha límite).
 *   5) Esos campos se guardan en la tarea (updateTask) y a partir de ahí
 *      el renderizado del día/semana los pinta igual que un evento con hora.
 *
 * Este archivo no modifica `state` directamente ni sabe nada de
 * window.storage: trabaja con copias de los arrays que le pasan y
 * devuelve resultados. Quien lo llame decide cuándo persistir.
 */
(function (global) {
  'use strict';

  /* ---------------- Configuración por defecto ----------------
     Todo esto son valores de partida razonables; en el futuro pueden
     venir de Ajustes (p.ej. "no programar nada antes de las 7:00" o
     "máximo 2h de tareas al día"). De momento son constantes explícitas
     para que el comportamiento sea predecible y fácil de ajustar. */
  const DEFAULTS = {
    dayStart: '07:00',       // no se programan tareas antes de esta hora
    dayEnd: '23:00',         // ni después de esta hora
    breakMinutes: 10,        // colchón mínimo entre un bloque y el siguiente
    maxDailyTaskMinutes: 180,// tope de minutos de TAREAS (no eventos fijos) por día
    horizonDays: 21,         // no busca huecos más allá de 21 días vista
    durationByPriority: { alta: 60, media: 45, baja: 30 }, // fallback si no hay estimatedMinutes
    priorityWeight: { alta: 3, media: 2, baja: 1 },
  };

  /* ---------------- Utilidades de fecha/hora ----------------
     Deliberadamente independientes de las funciones globales de
     organizator.html (misma lógica, copia local) para que este módulo
     se pueda cargar en cualquier orden y probar de forma aislada. */
  function pad(n) { return String(n).padStart(2, '0'); }
  function parseYMD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function fmtYMD(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(dateStr, n) { const d = parseYMD(dateStr); d.setDate(d.getDate() + n); return fmtYMD(d); }
  // Igual que dowOfDate() en organizator.html: 0=Lunes ... 6=Domingo
  function dowOfDate(dateStr) { return (parseYMD(dateStr).getDay() + 6) % 7; }
  function timeToMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
  function minToTime(min) { const h = Math.floor(min / 60), m = min % 60; return `${pad(h)}:${pad(m)}`; }
  function todayStr() { return fmtYMD(new Date()); }
  function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  /* ---------------- Cálculo de intervalos ocupados de un día ---------------- */

  /**
   * Devuelve los intervalos ocupados (en minutos desde 00:00) de un día
   * concreto, ya fusionados y ordenados: horario fijo del usuario +
   * eventos con hora + tareas que ya tienen bloque asignado ese día.
   * No incluye la propia tarea que se está intentando colocar (se excluye
   * por id con `excludeTaskId`).
   */
  function getBusyIntervals(dateStr, { events = [], tasks = [], customSchedules = [] }, excludeTaskId) {
    const intervals = [];
    const dow = dowOfDate(dateStr);

    // Horario fijo recurrente del usuario (escuela, trabajo, entrenos...)
    customSchedules
      .filter(s => Array.isArray(s.days) && s.days.includes(dow) && s.startTime && s.endTime)
      .forEach(s => intervals.push([timeToMin(s.startTime), timeToMin(s.endTime)]));

    // Eventos (incluye exámenes, reuniones...) que caen ese día
    events.forEach(e => {
      const start = e.date, end = e.endDate || e.date;
      if (dateStr < start || dateStr > end) return;
      if (e.allDay) { intervals.push([0, 24 * 60]); return; }
      if (e.startTime) {
        const s = timeToMin(e.startTime);
        const en = e.endTime ? timeToMin(e.endTime) : s + 60; // sin hora fin conocida: asume 1h
        intervals.push([s, en]);
      }
    });

    // Tareas que ya tienen bloque programado ese día (por una pasada anterior)
    tasks.forEach(t => {
      if (t.id === excludeTaskId) return;
      if (t.scheduledDate === dateStr && t.scheduledStart && t.scheduledEnd) {
        intervals.push([timeToMin(t.scheduledStart), timeToMin(t.scheduledEnd)]);
      }
    });

    return mergeIntervals(intervals);
  }

  function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
    const merged = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
      else merged.push(sorted[i].slice());
    }
    return merged;
  }

  /**
   * Resta los intervalos ocupados (ya con el colchón de breakMinutes
   * aplicado a cada lado) del rango [dayStart, dayEnd] y devuelve los
   * huecos libres resultantes como [inicio, fin] en minutos.
   */
  function getFreeSlots(dateStr, context, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts);
    const dayStartMin = timeToMin(cfg.dayStart);
    const dayEndMin = timeToMin(cfg.dayEnd);
    const busy = getBusyIntervals(dateStr, context, cfg.excludeTaskId)
      .map(([s, e]) => [Math.max(0, s - cfg.breakMinutes), Math.min(24 * 60, e + cfg.breakMinutes)]);
    const merged = mergeIntervals(busy);

    // Si es hoy, no tiene sentido ofrecer huecos que ya han pasado
    const floor = (dateStr === todayStr()) ? Math.max(dayStartMin, nowMin()) : dayStartMin;

    const free = [];
    let cursor = floor;
    for (const [s, e] of merged) {
      if (s > cursor) free.push([cursor, Math.min(s, dayEndMin)]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < dayEndMin) free.push([cursor, dayEndMin]);
    return free.filter(([s, e]) => e - s > 0);
  }

  /**
   * Minutos de tareas (no eventos) ya colocados ese día — para respetar
   * el tope diario (maxDailyTaskMinutes) y no sobrecargar un día.
   */
  function taskMinutesAlreadyScheduled(dateStr, tasks, excludeTaskId) {
    return tasks
      .filter(t => t.id !== excludeTaskId && t.scheduledDate === dateStr && t.scheduledStart && t.scheduledEnd)
      .reduce((sum, t) => sum + (timeToMin(t.scheduledEnd) - timeToMin(t.scheduledStart)), 0);
  }

  function estimateDuration(task, cfg) {
    if (task.estimatedMinutes && task.estimatedMinutes > 0) return task.estimatedMinutes;
    return cfg.durationByPriority[task.priority] || cfg.durationByPriority.media;
  }

  /**
   * Busca y asigna hueco para UNA tarea, entre hoy y su fecha límite
   * (o dentro del horizonte por defecto si no tiene fecha límite).
   * Devuelve una copia de la tarea con scheduledDate/scheduledStart/
   * scheduledEnd rellenos, o con schedulingWarning si no encajó.
   */
  function scheduleTask(task, context, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts);
    const duration = estimateDuration(task, cfg);
    const start = todayStr();
    const end = task.dueDate || addDays(start, cfg.horizonDays);
    const result = Object.assign({}, task, { estimatedMinutes: duration });
    delete result.schedulingWarning;

    let d = start;
    let placed = false;
    while (d <= end && !placed) {
      const usedToday = taskMinutesAlreadyScheduled(d, context.tasks, task.id);
      if (usedToday < cfg.maxDailyTaskMinutes) {
        const remainingBudget = cfg.maxDailyTaskMinutes - usedToday;
        const slots = getFreeSlots(d, context, Object.assign({}, cfg, { excludeTaskId: task.id }));
        const fit = slots.find(([s, e]) => (e - s) >= duration && (e - s) <= remainingBudget + (e - s) /* ver nota */);
        // Nota: el hueco puede ser más grande que el presupuesto restante;
        // lo que importa es que LA TAREA (duration) quepa dentro del
        // presupuesto que queda, no que el hueco entero quepa.
        const usable = slots.find(([s, e]) => (e - s) >= duration && duration <= remainingBudget);
        if (usable) {
          const s = usable[0];
          result.scheduledDate = d;
          result.scheduledStart = minToTime(s);
          result.scheduledEnd = minToTime(s + duration);
          placed = true;
        }
      }
      d = addDays(d, 1);
    }

    if (!placed) {
      // Fallback: si la tarea tiene fecha límite y no cupo respetando el
      // tope diario, se coloca en el primer hueco físico disponible el
      // día de la fecha límite (aunque supere el tope), y se avisa.
      const slots = task.dueDate ? getFreeSlots(task.dueDate, context, Object.assign({}, cfg, { excludeTaskId: task.id })) : [];
      const usable = slots.find(([s, e]) => (e - s) >= duration);
      if (usable) {
        result.scheduledDate = task.dueDate;
        result.scheduledStart = minToTime(usable[0]);
        result.scheduledEnd = minToTime(usable[0] + duration);
        result.schedulingWarning = 'Colocada el día límite superando tu tope diario habitual; revísalo.';
      } else {
        result.schedulingWarning = 'No se encontró ningún hueco libre suficiente antes de la fecha límite.';
      }
    }
    return result;
  }

  /**
   * Ordena tareas pendientes SIN hora fija (fecha límite primero, y a
   * igualdad de fecha, prioridad alta antes que media/baja) y las coloca
   * una a una, actualizando el contexto de trabajo entre medias para que
   * cada tarea nueva "vea" los huecos ya ocupados por las anteriores.
   */
  function autoSchedule(pendingTasks, context, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts);
    const sorted = pendingTasks.slice().sort((a, b) => {
      const da = a.dueDate || '9999-12-31', db = b.dueDate || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      return (cfg.priorityWeight[b.priority] || 0) - (cfg.priorityWeight[a.priority] || 0);
    });

    // Trabajamos sobre una copia mutable de context.tasks para que cada
    // scheduleTask() vea los huecos ya ocupados por las tareas anteriores
    // de esta misma pasada, sin tocar el `tasks` original que nos pasaron.
    const workingTasks = context.tasks.slice();
    const results = [];
    for (const task of sorted) {
      const scheduled = scheduleTask(task, Object.assign({}, context, { tasks: workingTasks }), cfg);
      results.push(scheduled);
      const idx = workingTasks.findIndex(t => t.id === scheduled.id);
      if (idx >= 0) workingTasks[idx] = scheduled; else workingTasks.push(scheduled);
    }
    return results;
  }

  /**
   * Reorganiza una tarea concreta: la libera de su hueco actual y vuelve
   * a buscarle sitio. Pensado para "el miércoles al final no puedo" o
   * cuando un nuevo evento fijo choca con una tarea ya programada.
   */
  function rescheduleTask(taskId, context, opts) {
    const task = context.tasks.find(t => t.id === taskId);
    if (!task) return null;
    const freed = Object.assign({}, task);
    delete freed.scheduledDate; delete freed.scheduledStart; delete freed.scheduledEnd;
    const workingTasks = context.tasks.map(t => t.id === taskId ? freed : t);
    return scheduleTask(freed, Object.assign({}, context, { tasks: workingTasks }), opts);
  }

  /**
   * Detecta tareas ya programadas cuyo bloque choca con un nuevo evento u
   * horario fijo (por ejemplo, tras añadir una reunión de última hora).
   * Devuelve los ids de tareas afectadas, listas para pasar a
   * rescheduleTask() una por una.
   */
  function findConflicts(dateStr, context) {
    const busyWithoutTasks = getBusyIntervals(dateStr, Object.assign({}, context, { tasks: [] }));
    return context.tasks
      .filter(t => t.scheduledDate === dateStr && t.scheduledStart && t.scheduledEnd)
      .filter(t => {
        const s = timeToMin(t.scheduledStart), e = timeToMin(t.scheduledEnd);
        return busyWithoutTasks.some(([bs, be]) => s < be && e > bs);
      })
      .map(t => t.id);
  }

  global.Scheduler = {
    DEFAULTS,
    getFreeSlots,
    scheduleTask,
    autoSchedule,
    rescheduleTask,
    findConflicts,
    // expuestas por si conviene reutilizarlas o testearlas por separado
    _internal: { timeToMin, minToTime, dowOfDate, mergeIntervals, getBusyIntervals },
  };
})(typeof window !== 'undefined' ? window : globalThis);
