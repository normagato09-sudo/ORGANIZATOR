/**
 * ORGANIZATOR — Capa de acciones de IA (Fase 7)
 *
 * Sustituye/complementa a runIAChat(): en vez de que la IA solo conteste
 * texto y proponga bloques que hay que aprobar a mano ("Añadir al plan"),
 * esta capa deja que la IA devuelva ACCIONES estructuradas (crear tarea,
 * crear evento, mover algo, cancelar algo, cambiar prioridad) que la app
 * aplica directamente, y para las tareas sin hora fija llama a
 * Scheduler (js/scheduler.js) para decidir cuándo hacerlas.
 *
 * Depende de globals ya definidos en organizator.html:
 *   state, addTask, addEvent, updateTask, updateEvent, deleteTask,
 *   deleteEvent, callAI, parseAIJSON, todayStr, esc, AREAS,
 *   currentView, renderInicio (o renderCurrentView)
 * y de window.Scheduler (js/scheduler.js), que debe cargarse antes.
 *
 * Este archivo NO decide horas por su cuenta ni inventa datos: la IA solo
 * interpreta lenguaje natural y identifica QUÉ hay que hacer; el CUÁNDO
 * para tareas sin hora lo calcula siempre Scheduler con datos reales.
 */
(function (global) {
  'use strict';

  /* ---------------- Esquema de acciones que puede devolver la IA ---------------- */
  const ACTION_SCHEMA = `{
  "answer": string,
  "actions": [
    {
      "op": "create_task" | "create_event" | "move_item" | "cancel_item" | "update_priority",

      // create_task — para algo sin hora fija que hay que HACER antes de una fecha:
      "title": string,
      "dueDate": "YYYY-MM-DD" | null,
      "dueTime": "HH:MM" | null,
      "priority": "alta" | "media" | "baja",
      "estimatedMinutes": number | null,
      "area": "cole" | "cesi" | "casa" | "compras" | "vacaciones" | "rubik" | null,
      "notes": string | null,

      // create_event — para algo con fecha/hora YA fija (examen, reunión, entreno):
      "date": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD" | null,
      "allDay": boolean,
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "location": string | null,

      // move_item / cancel_item / update_priority — sobre algo que YA EXISTE:
      "targetId": string,
      "targetKind": "task" | "event",
      "newDate": "YYYY-MM-DD" | null,
      "newTime": "HH:MM" | null,
      "newPriority": "alta" | "media" | "baja" | null
    }
  ]
}`;

  const ACTION_RULES = `Eres el asistente de organización integrado en ORGANIZATOR. El usuario te habla en lenguaje natural sobre tareas, exámenes, reuniones, entrenamientos y cambios de planes. Tu trabajo es traducir eso en ACCIONES estructuradas, nunca en texto libre para que alguien lo aplique a mano.

Reglas estrictas, sin excepción:
- Usa "create_event" SOLO cuando el usuario da una fecha (y normalmente hora) fija de algo que ocurre en un momento concreto: examen, reunión, clase, entreno, cita.
- Usa "create_task" para algo que hay que HACER antes de una fecha límite pero sin hora impuesta por el usuario (una tarea, un trabajo, "terminar el proyecto", "estudiar para..."). En ese caso deja "dueTime": null y NO inventes una hora — el sistema decidirá el hueco por su cuenta a partir de "estimatedMinutes". Estima "estimatedMinutes" de forma realista según el tipo de tarea (una entrega corta ~30-45min, estudiar para un examen ~60min, un proyecto grande ~90-120min).
- Usa "move_item" o "cancel_item" SOLO cuando el usuario se refiere a algo que ya existe en el contexto (LISTA DE ELEMENTOS EXISTENTES). Copia "targetId" EXACTO tal como aparece ahí, nunca lo inventes ni lo abrevies. Si no encuentras con certeza a qué elemento existente se refiere, no generes esa acción: explica la duda en "answer" en vez de adivinar.
- Usa "update_priority" para cambios de importancia sobre un elemento existente (mismo cuidado con "targetId").
- Si el usuario solo pregunta o comenta algo sin pedir ningún cambio, devuelve "actions": [] y responde en "answer".
- "answer" es siempre una frase breve en texto plano (sin markdown) confirmando o explicando lo que has entendido.
- No inventes tareas, eventos, horas, IDs ni prioridades que no estén en el contexto o en el mensaje del usuario.
- Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown ni bloques de código.`;

  /* ---------------- Contexto con IDs (para poder referenciar elementos existentes) ---------------- */
  function buildActionContext() {
    const today = global.todayStr();
    const horizonEnd = (function () {
      const d = new Date(); d.setDate(d.getDate() + 13);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    const pend = global.state.tasks.filter(t => !t.done);
    const eventsInRange = global.state.events.filter(e => (e.endDate || e.date) >= today && e.date <= horizonEnd);
    const tasksInRange = pend.filter(t => !t.dueDate || (t.dueDate >= today && t.dueDate <= horizonEnd) || t.dueDate < today);

    const lines = [];
    lines.push(`FECHA ACTUAL: ${today}.`);
    lines.push('');
    lines.push('LISTA DE ELEMENTOS EXISTENTES (usa estos "id" literalmente si el usuario pide mover, cancelar o repriorizar algo de aquí):');
    if (!tasksInRange.length && !eventsInRange.length) {
      lines.push('(no hay tareas ni eventos próximos)');
    } else {
      tasksInRange.forEach(t => lines.push(
        `- id:${t.id} [tarea] "${t.title}" — vence ${t.dueDate || 'sin fecha'}` +
        (t.scheduledDate ? `, programada ${t.scheduledDate} ${t.scheduledStart}-${t.scheduledEnd}` : (t.dueTime ? `, hora fija ${t.dueTime}` : ', sin hora asignada aún')) +
        `, prioridad ${t.priority || 'media'}`
      ));
      eventsInRange.forEach(e => lines.push(
        `- id:${e.id} [evento] "${e.title}" — ${e.date}${e.endDate && e.endDate !== e.date ? ' a ' + e.endDate : ''}` +
        (e.allDay ? ', todo el día' : (e.startTime ? `, ${e.startTime}${e.endTime ? '-' + e.endTime : ''}` : ', sin hora'))
      ));
    }

    lines.push('');
    lines.push('HORARIO PERSONALIZADO DEL USUARIO (bloques fijos recurrentes, no tocar):');
    lines.push(global.state.customSchedules.length
      ? global.state.customSchedules.map(s => `- ${s.name}: ${s.startTime}-${s.endTime} (${s.days.join(',')})`).join('\n')
      : '(sin bloques fijos definidos)');

    return lines.join('\n');
  }

  /* ---------------- Aplicar el resultado de la IA ---------------- */

  function schedulerContext() {
    return { tasks: global.state.tasks, events: global.state.events, customSchedules: global.state.customSchedules };
  }

  async function applyCreateTask(a) {
    await global.addTask({
      area: a.area || null,
      title: a.title,
      dueDate: a.dueDate || null,
      dueTime: a.dueTime || '',
      priority: a.priority || 'media',
      notes: a.notes || '',
      estimatedMinutes: a.estimatedMinutes || null,
    });
    const created = global.state.tasks[global.state.tasks.length - 1];

    // Si el propio usuario/IA no fijó una hora, dejamos que el algoritmo
    // decida el hueco real usando los datos de agenda ya existentes.
    if (!created.dueTime) {
      const scheduled = global.Scheduler.scheduleTask(created, schedulerContext());
      await global.updateTask(created.id, {
        scheduledDate: scheduled.scheduledDate || null,
        scheduledStart: scheduled.scheduledStart || null,
        scheduledEnd: scheduled.scheduledEnd || null,
        estimatedMinutes: scheduled.estimatedMinutes,
        schedulingWarning: scheduled.schedulingWarning || null,
      });
      return scheduled.scheduledDate
        ? `"${created.title}" programada el ${scheduled.scheduledDate} de ${scheduled.scheduledStart} a ${scheduled.scheduledEnd}.`
        : `"${created.title}" guardada, pero no encontré hueco libre antes de su fecha límite — revísalo.`;
    }
    return `"${created.title}" añadida para ${created.dueDate || 'sin fecha'} a las ${created.dueTime}.`;
  }

  async function applyCreateEvent(a) {
    await global.addEvent({
      area: a.area || null,
      title: a.title,
      date: a.date,
      endDate: a.endDate || '',
      allDay: !!a.allDay,
      startTime: a.startTime || '',
      endTime: a.endTime || '',
      location: a.location || '',
      notes: '',
    });
    // Un evento nuevo puede chocar con tareas ya programadas ese día:
    // las reorganizamos automáticamente en vez de dejar el choque.
    await reconcileConflicts(a.date);
    return `"${a.title}" añadido el ${a.date}${a.startTime ? ' a las ' + a.startTime : ''}.`;
  }

  async function reconcileConflicts(dateStr) {
    const conflictIds = global.Scheduler.findConflicts(dateStr, schedulerContext());
    for (const id of conflictIds) {
      const rescheduled = global.Scheduler.rescheduleTask(id, schedulerContext());
      if (rescheduled) {
        await global.updateTask(id, {
          scheduledDate: rescheduled.scheduledDate || null,
          scheduledStart: rescheduled.scheduledStart || null,
          scheduledEnd: rescheduled.scheduledEnd || null,
          schedulingWarning: rescheduled.schedulingWarning || null,
        });
      }
    }
    return conflictIds.length;
  }

  async function applyMoveItem(a) {
    if (a.targetKind === 'event') {
      const ev = global.state.events.find(e => e.id === a.targetId);
      if (!ev) return null;
      await global.updateEvent(ev.id, {
        date: a.newDate || ev.date,
        startTime: a.newTime || ev.startTime,
      });
      await reconcileConflicts(a.newDate || ev.date);
      return `He movido "${ev.title}" a ${a.newDate || ev.date}${a.newTime ? ' a las ' + a.newTime : ''}.`;
    }
    const task = global.state.tasks.find(t => t.id === a.targetId);
    if (!task) return null;
    if (a.newTime) {
      // Hora explícita del usuario: se fija tal cual, deja de depender del scheduler.
      await global.updateTask(task.id, {
        dueDate: a.newDate || task.dueDate, dueTime: a.newTime,
        scheduledDate: null, scheduledStart: null, scheduledEnd: null,
      });
      return `He movido "${task.title}" a ${a.newDate || task.dueDate} a las ${a.newTime}.`;
    }
    // Sin hora explícita: liberamos su hueco actual y dejamos que el
    // algoritmo le busque uno nuevo (posiblemente con nueva fecha límite).
    await global.updateTask(task.id, {
      dueDate: a.newDate || task.dueDate,
      scheduledDate: null, scheduledStart: null, scheduledEnd: null,
    });
    const updated = global.state.tasks.find(t => t.id === task.id);
    const scheduled = global.Scheduler.scheduleTask(updated, schedulerContext());
    await global.updateTask(task.id, {
      scheduledDate: scheduled.scheduledDate || null,
      scheduledStart: scheduled.scheduledStart || null,
      scheduledEnd: scheduled.scheduledEnd || null,
      schedulingWarning: scheduled.schedulingWarning || null,
    });
    return scheduled.scheduledDate
      ? `He movido "${task.title}" — reorganizada para el ${scheduled.scheduledDate} de ${scheduled.scheduledStart} a ${scheduled.scheduledEnd}.`
      : `He quitado "${task.title}" de donde estaba, pero no encontré otro hueco libre a tiempo.`;
  }

  async function applyCancelItem(a) {
    if (a.targetKind === 'event') {
      const ev = global.state.events.find(e => e.id === a.targetId);
      if (!ev) return null;
      await global.deleteEvent(ev.id);
      return `He eliminado "${ev.title}".`;
    }
    const task = global.state.tasks.find(t => t.id === a.targetId);
    if (!task) return null;
    await global.deleteTask(task.id);
    return `He eliminado "${task.title}".`;
  }

  async function applyUpdatePriority(a) {
    if (a.targetKind !== 'task') return null;
    const task = global.state.tasks.find(t => t.id === a.targetId);
    if (!task || !a.newPriority) return null;
    await global.updateTask(task.id, { priority: a.newPriority });
    return `Prioridad de "${task.title}" cambiada a ${a.newPriority}.`;
  }

  /* ---------------- Punto de entrada desde el chat ---------------- */
  async function runIAAction(message) {
    const context = buildActionContext();
    const raw = await global.callAI(ACTION_RULES + '\n\nEsquema exacto:\n' + ACTION_SCHEMA,
      `MENSAJE DEL USUARIO: ${message}\n\n${context}`);
    const data = global.parseAIJSON(raw);
    const notes = [];
    for (const a of (data.actions || [])) {
      try {
        let note = null;
        switch (a.op) {
          case 'create_task': note = await applyCreateTask(a); break;
          case 'create_event': note = await applyCreateEvent(a); break;
          case 'move_item': note = await applyMoveItem(a); break;
          case 'cancel_item': note = await applyCancelItem(a); break;
          case 'update_priority': note = await applyUpdatePriority(a); break;
        }
        if (note) notes.push(note);
      } catch (err) {
        console.error('[ai-actions] Fallo aplicando acción', a, err);
      }
    }
    if (typeof global.renderInicio === 'function' && global.currentView === 'inicio') global.renderInicio();
    return { answer: data.answer || '', applied: notes };
  }

  global.AIActions = { runIAAction, buildActionContext, ACTION_SCHEMA, ACTION_RULES };
})(typeof window !== 'undefined' ? window : globalThis);
