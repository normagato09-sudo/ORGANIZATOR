/**
 * ORGANIZATOR — Duration Learning (aprendizaje de duración real de tareas)
 *
 * Módulo puro (sin DOM, sin async, sin dependencias): analiza las tareas
 * ya completadas que tienen `actualMinutes` para sugerir duraciones más
 * realistas en tareas futuras parecidas.
 *
 * Tres campos distintos y con significado propio (no se confunden entre sí):
 *   - estimatedMinutes : lo que el usuario (o la IA) estimó al crear la tarea.
 *   - actualMinutes    : lo que realmente costó, indicado al completarla.
 *   - suggestedMinutes : un valor NUEVO, calculado aquí a partir del
 *                        historial de actualMinutes de tareas parecidas.
 *                        Este módulo nunca lee ni escribe estimatedMinutes
 *                        ni actualMinutes de las tareas originales: solo
 *                        calcula y devuelve suggestedMinutes en un objeto
 *                        aparte para que quien lo use decida qué hacer.
 *
 * Por qué existe separado del Scheduler y de la UI:
 * igual que scheduler.js separa la aritmética de huecos libres de la IA,
 * este módulo separa la aritmética de "cuánto suele llevar esto realmente"
 * de dónde se muestra o se usa esa sugerencia. Así se puede probar de forma
 * aislada (sin DOM) y reutilizar tanto en el formulario de tareas como en
 * el Scheduler o la IA más adelante, sin tocar ninguno de los dos todavía.
 *
 * Retrocompatibilidad:
 *   - No modifica `tasks` ni ningún objeto de tarea (siempre lee, nunca
 *     hace `Object.assign`/mutaciones sobre lo que le pasan).
 *   - Las tareas antiguas sin `actualMinutes`, sin `category` o sin
 *     `estimatedMinutes` se ignoran para las estadísticas, pero no
 *     provocan errores: simplemente no cuentan como muestra válida.
 *   - No depende de que exista `category`: si no existe, las funciones de
 *     categoría devuelven estadísticas vacías en vez de fallar.
 */
(function (global) {
  'use strict';

  /* ---------------- Configuración por defecto ----------------
     minSamples: número mínimo de tareas completadas parecidas que hacen
     falta antes de atrevernos a sugerir una duración. Con menos muestras
     que esto, `suggestDuration` devuelve null en vez de arriesgar un
     número poco fiable.
     recentWindow: cuántas de las muestras más recientes se usan para
     calcular la "tendencia reciente" frente a la media histórica. */
  const DEFAULTS = {
    minSamples: 3,
    recentWindow: 3,
  };

  /* ---------------- Utilidades numéricas puras ---------------- */

  function mean(numbers) {
    if (!numbers.length) return null;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return sum / numbers.length;
  }

  function median(numbers) {
    if (!numbers.length) return null;
    const sorted = numbers.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function round(n) {
    return n === null || n === undefined ? null : Math.round(n);
  }

  /* ---------------- Selección de muestras válidas ----------------
     Una tarea solo cuenta como "muestra" si está completada y su
     actualMinutes es un número utilizable. Tareas sin completar, con
     actualMinutes vacío/null o con valores inválidos (0, negativos, no
     numéricos) se descartan silenciosamente: así el módulo es tolerante
     con datos antiguos que no tenían este campo. */
  function isValidSample(task) {
    return (
      !!task &&
      task.done === true &&
      Number.isFinite(task.actualMinutes) &&
      task.actualMinutes > 0
    );
  }

  function toSample(task) {
    return {
      minutes: task.actualMinutes,
      // createdAt se usa solo como referencia temporal para ordenar
      // muestras (no hay `completedAt` en el modelo actual). Si faltara,
      // se trata como "más antigua posible" para no romper el orden.
      createdAt: Number.isFinite(task.createdAt) ? task.createdAt : 0,
      taskId: task.id,
    };
  }

  /* ---------------- Tendencia reciente ----------------
     Compara la media de las últimas `recentWindow` muestras (por orden
     cronológico) con la media histórica completa. Un margen del 10%
     (mínimo 1 minuto) evita marcar como "tendencia" ruido insignificante.
     Devuelve 'up' | 'down' | 'stable' | null (null si no hay datos
     suficientes para comparar). */
  function computeTrend(samplesAsc, overallMean, recentWindow) {
    if (samplesAsc.length < 2 || overallMean === null) return null;
    const recentMinutes = samplesAsc.slice(-recentWindow).map((s) => s.minutes);
    const recentMean = mean(recentMinutes);
    if (recentMean === null) return null;

    const diff = recentMean - overallMean;
    const threshold = Math.max(1, overallMean * 0.1);
    if (diff > threshold) return 'up';
    if (diff < -threshold) return 'down';
    return 'stable';
  }

  /* ---------------- Similitud entre tareas ----------------
     normalizeTitle: pasa un título a una forma comparable (minúsculas,
     sin tildes, sin puntuación, sin espacios repetidos) para que
     "Repasar Tema 3", "repasar tema 3." y "REPASAR TEMA 3" cuenten como
     la misma tarea a efectos estadísticos. */
  function normalizeTitle(title) {
    return String(title || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita tildes/diacríticos
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Dos tareas se consideran "similares" si su título normalizado coincide. */
  function isSimilarTask(taskA, taskB) {
    if (!taskA || !taskB) return false;
    const a = normalizeTitle(taskA.title);
    const b = normalizeTitle(taskB.title);
    return a.length > 0 && a === b;
  }

  /**
   * getStats(tasks, key, options)
   * ------------------------------
   * Calcula estadísticas de duración real sobre las tareas de `tasks` que
   * sean muestras válidas (ver isValidSample) y cumplan el criterio `key`.
   *
   * `key` acepta dos formas:
   *   - función `(task) => boolean`: criterio explícito y flexible
   *     (por ejemplo, para "tareas similares a esta").
   *   - string: se compara directamente con `task.category` (igualdad
   *     exacta). Útil para agrupar "todas las tareas de la categoría X".
   *
   * Devuelve:
   *   {
   *     count,   // número de muestras usadas
   *     mean,    // media en minutos (redondeada) o null si count === 0
   *     median,  // mediana en minutos (redondeada) o null si count === 0
   *     trend,   // 'up' | 'down' | 'stable' | null
   *     samples  // array de minutos reales usados, en orden cronológico
   *   }
   */
  function getStats(tasks, key, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const list = Array.isArray(tasks) ? tasks : [];

    const matcher =
      typeof key === 'function'
        ? key
        : (task) => !!task && task.category === key;

    const samples = list
      .filter((task) => isValidSample(task) && matcher(task))
      .map(toSample)
      .sort((a, b) => a.createdAt - b.createdAt);

    const minutes = samples.map((s) => s.minutes);
    const avg = mean(minutes);

    return {
      count: samples.length,
      mean: round(avg),
      median: round(median(minutes)),
      trend: computeTrend(samples, avg, opts.recentWindow),
      samples: minutes,
    };
  }

  /**
   * getStatsForSimilarTasks(task, tasks, options)
   * Estadísticas de tareas completadas con el mismo título normalizado
   * que `task` (excluyendo la propia `task` si ya estuviera en la lista).
   */
  function getStatsForSimilarTasks(task, tasks, options) {
    if (!task) return getStats([], () => false, options);
    return getStats(
      tasks,
      (other) => other.id !== task.id && isSimilarTask(task, other),
      options
    );
  }

  /**
   * getStatsForCategory(category, tasks, options)
   * Estadísticas de tareas completadas con `task.category === category`.
   * Si `category` es vacío/null/undefined (tarea sin categoría, o modelo
   * antiguo sin ese campo), devuelve estadísticas vacías sin lanzar error.
   */
  function getStatsForCategory(category, tasks, options) {
    if (!category) {
      return { count: 0, mean: null, median: null, trend: null, samples: [] };
    }
    return getStats(tasks, (task) => task.category === category, options);
  }

  /** Elige qué valor de unas stats ya calculadas usar como sugerencia
   * final. Se prioriza la mediana por ser más robusta frente a valores
   * atípicos (un día excepcionalmente largo o corto no la desvía tanto
   * como a la media). */
  function pickSuggestedMinutes(stats) {
    return stats.median !== null ? stats.median : stats.mean;
  }

  /**
   * suggestDuration(task, tasks, options)
   * ---------------------------------------
   * Sugiere una duración para `task`, en minutos, basada en el histórico
   * de tareas ya completadas — SOLO si hay muestras suficientes
   * (options.minSamples, por defecto DEFAULTS.minSamples = 3).
   *
   * Orden de prioridad (se detiene en el primero que tenga muestras
   * suficientes):
   *   1) Tareas similares por título — criterio más específico.
   *   2) Tareas de la misma categoría, si `task.category` existe.
   *
   * No modifica `task` ni `tasks` en ningún caso. Devuelve:
   *   {
   *     suggestedMinutes,          // número entero de minutos
   *     basis: 'similar'|'category',
   *     stats                      // el objeto devuelto por getStats
   *   }
   * o `null` si no hay datos suficientes en ninguno de los dos criterios
   * (por ejemplo: tarea nueva sin historial, o pocas muestras todavía).
   *
   * Nota: esta función es puramente informativa. No decide por sí sola
   * cambiar `estimatedMinutes` de ninguna tarea; eso queda para quien la
   * llame (Scheduler o UI), en un paso posterior.
   */
  function suggestDuration(task, tasks, options) {
    if (!task || !Array.isArray(tasks)) return null;
    const opts = Object.assign({}, DEFAULTS, options);

    const similarStats = getStatsForSimilarTasks(task, tasks, opts);
    if (similarStats.count >= opts.minSamples) {
      return {
        suggestedMinutes: pickSuggestedMinutes(similarStats),
        basis: 'similar',
        stats: similarStats,
      };
    }

    if (task.category) {
      const categoryStats = getStatsForCategory(task.category, tasks, opts);
      if (categoryStats.count >= opts.minSamples) {
        return {
          suggestedMinutes: pickSuggestedMinutes(categoryStats),
          basis: 'category',
          stats: categoryStats,
        };
      }
    }

    return null;
  }

  /* ---------------- Patrones generales (Paso 4E) ----------------
     Cuatro patrones adicionales, todos calculados SOLO a partir de campos
     reales que ya existen en las tareas (nunca se inventan ni se
     aproximan): scheduledDate/scheduledStart de tareas completadas,
     category, y la comparación estimatedMinutes vs actualMinutes.
     Cada función devuelve `null` si no hay muestras suficientes
     (options.minSamples) — igual criterio que el resto del módulo — para
     que quien la use nunca muestre un patrón poco fiable. */

  const DOW_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  /** 0=Lunes ... 6=Domingo, igual criterio que dowOfDate() en scheduler.js.
   * Devuelve null si dateStr no tiene forma "YYYY-MM-DD" válida. */
  function dowOfDateStr(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) return null;
    return (date.getDay() + 6) % 7;
  }

  /**
   * getBusiestDaysOfWeek(tasks, options)
   * Cuenta, entre las tareas completadas (done === true) que tienen
   * `scheduledDate` (el día en que realmente se hicieron), cuántas caen
   * en cada día de la semana. Devuelve una lista ordenada de mayor a
   * menor, o null si el total de muestras no llega a minSamples.
   */
  function getBusiestDaysOfWeek(tasks, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const list = Array.isArray(tasks) ? tasks : [];
    const counts = new Array(7).fill(0);
    let total = 0;
    list.forEach((task) => {
      if (!task || task.done !== true) return;
      const dow = dowOfDateStr(task.scheduledDate);
      if (dow === null) return;
      counts[dow] += 1;
      total += 1;
    });
    if (total < opts.minSamples) return null;
    return counts
      .map((count, i) => ({ day: DOW_LABELS[i], count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  function hourSlotLabel(hour) {
    const start = String(hour).padStart(2, '0');
    const end = String((hour + 1) % 24).padStart(2, '0');
    return `${start}:00–${end}:00`;
  }

  /**
   * getBusyHourSlots(tasks, options)
   * Igual que getBusiestDaysOfWeek pero agrupando por la hora de
   * `scheduledStart` de las tareas completadas. Devuelve franjas de 1h
   * ordenadas de mayor a menor frecuencia, o null si no hay muestras
   * suficientes.
   */
  function getBusyHourSlots(tasks, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const list = Array.isArray(tasks) ? tasks : [];
    const counts = {};
    let total = 0;
    list.forEach((task) => {
      if (!task || task.done !== true) return;
      const time = task.scheduledStart;
      if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return;
      const hour = Number(time.slice(0, 2));
      if (!Number.isFinite(hour)) return;
      counts[hour] = (counts[hour] || 0) + 1;
      total += 1;
    });
    if (total < opts.minSamples) return null;
    return Object.keys(counts)
      .map((h) => ({ slot: hourSlotLabel(Number(h)), count: counts[h] }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * getCategoryDurationRanking(tasks, options)
   * Usa getStatsForCategory sobre cada categoría real presente en `tasks`
   * (nunca inventa nombres de categoría) y devuelve las que llegan a
   * minSamples, ordenadas de mayor a menor duración media. null si
   * ninguna categoría llega al mínimo.
   */
  function getCategoryDurationRanking(tasks, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const list = Array.isArray(tasks) ? tasks : [];
    const categories = Array.from(new Set(
      list
        .map((t) => (t && t.category) ? String(t.category).trim() : '')
        .filter((c) => c.length > 0)
    ));
    const ranked = categories
      .map((category) => {
        const stats = getStatsForCategory(category, list, opts);
        return { category, mean: stats.mean, median: stats.median, count: stats.count };
      })
      .filter((entry) => entry.count >= opts.minSamples && entry.mean !== null)
      .sort((a, b) => b.mean - a.mean);
    return ranked.length ? ranked : null;
  }

  /** Muestra válida para comparar estimado vs real: tarea completada con
   * ambos campos numéricos y utilizables. */
  function isOverEstimateSample(task) {
    return (
      !!task &&
      task.done === true &&
      Number.isFinite(task.estimatedMinutes) && task.estimatedMinutes > 0 &&
      Number.isFinite(task.actualMinutes) && task.actualMinutes > 0
    );
  }

  /**
   * getTasksOverEstimate(tasks, options)
   * Agrupa tareas completadas por título normalizado (misma noción de
   * "tarea parecida" que isSimilarTask) y, para los grupos con muestras
   * suficientes, compara la media de estimatedMinutes con la media de
   * actualMinutes. Solo incluye grupos donde el real supera al estimado
   * por un margen significativo (mismo criterio del 10%, mínimo 1 minuto,
   * que usa computeTrend) — así no se marca como "patrón" el ruido
   * normal de estimar a ojo. Devuelve la lista ordenada de mayor a menor
   * desviación, o null si no hay ningún grupo que cumpla el criterio.
   */
  function getTasksOverEstimate(tasks, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const list = Array.isArray(tasks) ? tasks : [];
    const withBoth = list.filter(isOverEstimateSample);

    const groups = new Map();
    withBoth.forEach((task) => {
      const key = normalizeTitle(task.title);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { title: task.title, estimated: [], actual: [] });
      const g = groups.get(key);
      g.estimated.push(task.estimatedMinutes);
      g.actual.push(task.actualMinutes);
    });

    const ranked = [];
    groups.forEach((g) => {
      if (g.actual.length < opts.minSamples) return;
      const avgEstimated = mean(g.estimated);
      const avgActual = mean(g.actual);
      const overrun = avgActual - avgEstimated;
      const threshold = Math.max(1, avgEstimated * 0.1);
      if (overrun <= threshold) return;
      ranked.push({
        title: g.title,
        avgEstimated: round(avgEstimated),
        avgActual: round(avgActual),
        overrunMinutes: round(overrun),
        count: g.actual.length,
      });
    });

    ranked.sort((a, b) => b.overrunMinutes - a.overrunMinutes);
    return ranked.length ? ranked : null;
  }

  const DurationLearning = {
    DEFAULTS,
    normalizeTitle,
    isSimilarTask,
    getStats,
    getStatsForSimilarTasks,
    getStatsForCategory,
    suggestDuration,
    getBusiestDaysOfWeek,
    getBusyHourSlots,
    getCategoryDurationRanking,
    getTasksOverEstimate,
    // expuestas por si conviene reutilizarlas o testearlas por separado
    _internal: { mean, median, isValidSample, computeTrend, pickSuggestedMinutes, dowOfDateStr, isOverEstimateSample },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DurationLearning;
  }
  global.DurationLearning = DurationLearning;
})(typeof window !== 'undefined' ? window : globalThis);
