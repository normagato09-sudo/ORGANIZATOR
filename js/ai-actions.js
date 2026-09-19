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

Reglas de idioma:
- Responde SIEMPRE en español, tanto en "answer" como en cualquier texto que generes. Nunca uses inglés.

Cómo distinguir la INTENCIÓN del usuario (AI-1.1 — antes de decidir ningún campo, decide primero a cuál de estas 5 categorías pertenece el mensaje):
1. CREAR TAREA (create_task): algo que el usuario tiene que HACER antes de una fecha, sin hora impuesta por él. Ej: "mañana tengo que estudiar biología", "tengo que hacer el trabajo de historia", "terminar el proyecto para el viernes".
2. CREAR EVENTO (create_event): algo que OCURRE en una fecha (y a veces hora) concreta — un examen, clase, cita, reunión, entreno, o un día marcado como festivo/libre/de cumpleaños/vacaciones. Ej: "tengo parcial de biología el jueves", "el lunes tengo médico", "el 24 es festivo" (día completo, sin hora), "cumpleaños de mi hermana el 10". Si el usuario da fecha pero ninguna hora para algo que "ocurre" ese día (un festivo, un cumpleaños, "estoy de vacaciones"), sigue siendo create_event con "allDay": true — nunca lo conviertas en una tarea.
3. MOVER/MODIFICAR (move_item): el usuario pide cambiar la fecha, hora o prioridad de algo que YA EXISTE (verbos como "mueve", "cambia", "pon... para otro día", "aplaza", "adelanta"). Ej: "mueve el examen al viernes". Nunca generes un create_task/create_event nuevo para esto: busca el elemento existente correspondiente en el contexto.
4. CANCELAR/ELIMINAR (cancel_item): el usuario pide quitar/anular algo que YA EXISTE (verbos como "cancela", "elimina", "quita", "ya no hay..."). Ej: "cancela el examen de biología".
5. SIN ACCIÓN (actions: []): el mensaje no pide crear, mover ni cancelar nada — comentarios sobre cómo se siente el usuario, confirmaciones o agradecimientos cortos, preguntas informativas. Ej: "hoy estoy cansado", "vale, entendido", "gracias", "genial". Devuelve siempre "actions": [] para estos casos, nunca inventes una acción solo por mencionarse una tarea o evento de pasada.
No generes más de una acción para un mismo hecho que el usuario haya contado una sola vez (no dupliques la misma tarea o el mismo evento en dos acciones).

Reglas de fechas y horas (muy importantes, no te las saltes nunca):
- Usa el valor de FECHA ACTUAL (indicado al principio del contexto) como referencia para calcular cualquier fecha relativa. NUNCA asumas ni inventes qué día es hoy por tu cuenta.
- "hoy" = FECHA ACTUAL. "mañana" = FECHA ACTUAL + 1 día. "pasado mañana" = FECHA ACTUAL + 2 días.
- Un día suelto sin mes ("el 10", "el día 15") se refiere al mes en curso de FECHA ACTUAL, salvo que ese día ya haya pasado este mes, en cuyo caso es ese día del mes siguiente.
- Una fecha con día y mes pero sin año ("10 de septiembre") se refiere al año en curso de FECHA ACTUAL, salvo que esa fecha ya haya pasado este año, en cuyo caso es el año siguiente.
- Días de la semana ("el viernes", "este viernes", "el próximo lunes", "la semana que viene"): calcula la fecha real correspondiente contando desde FECHA ACTUAL. "el próximo X" o "la semana que viene" siempre se refiere a la semana siguiente a la actual, no a la ocurrencia más próxima de esta misma semana si ya se usó "este X" para eso.
- Horas coloquiales: "a las 7 de la tarde" = 19:00, "a las 9 de la mañana" = 09:00, "a mediodía" = 12:00, "por la noche" sin más precisión = null (no inventes una hora exacta). Rangos como "de 18:00 a 20:00" van en startTime/endTime (o dueTime no aplica a rangos, usa create_event).
- Si el usuario no da ninguna hora para algo con fecha fija, es un evento de todo el día: usa "create_event" con "allDay": true y startTime/endTime null.
- Nunca dejes "date" (create_event) o "dueDate" (create_task) vacío si el usuario ha dado cualquier referencia temporal, por vaga que sea — resuélvela siempre a una fecha YYYY-MM-DD real usando FECHA ACTUAL.
- AI-1.2: si el contexto incluye una sección "PISTAS TEMPORALES YA RESUELTAS PARA ESTE MENSAJE", esos valores ya se calcularon correctamente en código a partir de FECHA ACTUAL (fecha relativa, día de la semana o fecha numérica, y hora si el mensaje la da) — úsalos tal cual en el campo date/dueDate/startTime/dueTime que corresponda, sin recalcularlos ni contradecirlos. Si esa sección menciona una franja horaria (mañana/tarde/noche) sin hora exacta, NO inventes una hora: deja startTime/dueTime en null.

Eventos implícitos y festivos (AI-1.3 — el mensaje puede describir un evento sin usar la palabra "evento"):
- Festivos/días no laborables: frases como "es festivo", "es fiesta", "es día festivo", "es día no laborable", "no trabajo" (ese día) describen un EVENTO de día completo, no una tarea ni un comentario sin acción. Usa "create_event" con "allDay": true y "startTime"/"endTime": null si el mensaje no da ninguna hora (si diera una hora, deja de ser de día completo: respeta esa hora y las reglas normales de allDay). Título breve, nunca la frase entera del usuario copiada tal cual: "Festivo", "Día festivo" o "Día no laborable" según encaje mejor.
- Citas/compromisos con otra persona o entidad (médico, dentista, reunión, clase, entreno, examen/parcial...) son EVENTOS aunque no se diga "evento": "tengo médico", "tengo dentista", "tengo reunión con X", "tengo una cita", "tengo examen de X" -> "create_event". Esto sigue siendo así incluso con la construcción "tengo que": "tengo que ir al médico"/"tengo que ir a la reunión" describe la MISMA cita que "tengo médico"/"tengo reunión" — es un compromiso que ocurre en un momento concreto, no una tarea que el usuario decide por su cuenta cuándo hacer, así que sigue siendo "create_event".
- En cambio, "tengo que" seguido de un verbo de trabajo/estudio genérico (estudiar, entregar, terminar, hacer, preparar, acabar...) SIN un sustantivo de cita/festivo sigue siendo "create_task", tal como ya establecen las reglas de arriba: "tengo que estudiar biología", "tengo que entregar el trabajo" son tareas, no eventos, aunque mencionen un día concreto. La sola presencia de una fecha en el mensaje NUNCA decide por sí sola si es tarea o evento: decide la naturaleza del hecho descrito (algo que OCURRE en un momento fijo = evento; algo que el usuario tiene que HACER, con margen de cuándo = tarea).
- Si el contexto incluye una sección "PISTA DE TIPO DE ACCIÓN", es solo orientativa (calculada en código a partir de palabras clave, sin entender el mensaje completo): úsala como apoyo, pero la decisión final sigue siendo tuya según las reglas de este apartado y las de arriba — puedes ignorarla si el resto del mensaje deja claro que no aplica.
- No conviertas en evento un comentario ambiguo o sobre el estado de ánimo del usuario solo porque mencione un día: "hoy estoy cansado", "mañana quizá descanse", "el lunes será un día largo" siguen sin generar ninguna acción ("actions": []), igual que "vale, entendido", "gracias" o "perfecto".

Tareas implícitas (AI-1.4 — el mensaje puede describir una tarea sin decir "tarea"):
- Expresiones de intención u obligación como "tengo que...", "necesito...", "debo...", "quiero...", "hay que...", "no olvidar...", "recuerda que tengo que..." seguidas de un verbo de acción pendiente (preparar, estudiar, revisar, entregar, enviar, comprar, llamar, terminar, hacer, organizar, reservar...) describen una TAREA que el usuario tiene que hacer, aunque no use la palabra "tarea": "mañana tengo que estudiar" -> "create_task", "tengo que entregar el trabajo el lunes" -> "create_task", "necesito comprar leche" -> "create_task", "no olvidar llamar a Ana" -> "create_task", "quiero preparar el examen" -> "create_task", "debo revisar el informe" -> "create_task".
- La regla que ya decide entre tarea y evento sigue siendo la misma de siempre (ver "Eventos implícitos y festivos" arriba y las reglas estrictas de abajo): un COMPROMISO/CITA/ACONTECIMIENTO que OCURRE en un momento (con otra persona, en un sitio, a una hora) es "create_event"; una ACCIÓN PENDIENTE que el usuario debe/quiere/necesita hacer POR SU CUENTA, con margen de cuándo, es "create_task" — nunca decidas por la mera presencia de "tengo que" a secas: "tengo que ir al médico"/"tengo que ir a la reunión" siguen siendo "create_event" (es la misma cita que "tengo médico"/"tengo reunión", ver arriba), mientras que "tengo que preparar la reunión" o "tengo que llamar al médico" SÍ son "create_task" (preparar algo o hacer una llamada es una acción que el usuario hace por su cuenta, no la cita en sí).
- Igual que con las fechas (AI-1.2) y los eventos implícitos (AI-1.3), no inventes ningún campo que el mensaje no dé: si no hay fecha, "dueDate": null; si no hay hora, "dueTime": null (nunca inventada, ni siquiera a partir de "por la mañana/tarde/noche" — ver regla de AI-1.2 sobre franjas horarias); si no hay ninguna pista de prioridad/duración/categoría/recordatorio/notas/ubicación en el mensaje, usa los valores por defecto de siempre (prioridad "media", el resto vacío/null), nunca los inventes a partir del tipo de tarea salvo "estimatedMinutes", que ya se te pide estimar de forma realista más abajo.
- Sigue siendo conservador: un comentario sin una acción pendiente clara ("hoy estoy cansado", "mañana quizá descanse", "estoy estudiando mucho", "vale, entendido", "qué día tan largo") no es una tarea — devuelve "actions": [] igual que con cualquier otro comentario sin petición de cambio.
- Si el contexto incluye una sección "PISTA DE TAREA IMPLÍCITA", es solo orientativa (igual criterio que la "PISTA DE TIPO DE ACCIÓN" de eventos/festivos de arriba): úsala como apoyo, pero la decisión final sigue siendo tuya según estas reglas.

Modificar, mover y cancelar de forma natural (AI-1.5 — sobre algo que YA EXISTE, nunca crea nada nuevo):
- Movimiento de fecha y/o hora: verbos como "mueve...", "pasa...", "pon... para/a...", "cambia... a/al...", "aplaza...", "adelanta...", "haz que... sea a..." sobre algo que ya aparece en la LISTA DE ELEMENTOS EXISTENTES son "move_item", nunca "create_event"/"create_task" nuevos: "mueve el examen de biología al viernes", "pasa la reunión al lunes", "pon el entrenamiento para mañana", "cambia el examen al próximo jueves", "cambia la reunión de las 10 a las 11", "pon el entrenamiento a las 19", "haz que el examen sea a las 10" -> "move_item". Usa "newDate"/"newTime" para la fecha/hora nueva ya resuelta (ver AI-1.2 más abajo); dejar el otro campo (newDate o newTime) en null si el usuario no lo cambia.
- Cambio de prioridad: "cambia la prioridad de...", "pon... como prioridad alta", "baja/sube la prioridad de..." sobre algo existente son "update_priority" (el tipo que YA existe para esto, con "newPriority") — nunca "move_item" para esto, "move_item" es solo fecha/hora.
- Cancelación: verbos como "cancela...", "elimina...", "borra...", "quita...", o construcciones como "ya no tengo...", "ya no hay...", "no tengo que... finalmente" sobre algo existente son "cancel_item": "cancela el examen de biología", "ya no tengo la reunión", "elimina la tarea de estudiar", "borra el evento de dentista", "no tengo que ir al médico finalmente" -> "cancel_item". Nunca generes un "create_task"/"create_event" a partir de una frase de cancelación, ni aunque mencione fecha, título o (como en el último ejemplo) un sustantivo de cita: cancelar una cosa que ya existe no es contarla de nuevo.
- Diferencia SIEMPRE crear de modificar/cancelar mirando si el hecho YA está en la LISTA DE ELEMENTOS EXISTENTES: "tengo un examen de biología el jueves" (no está en la lista todavía) -> "create_event"; "mueve el examen de biología al viernes" (ya está en la lista) -> "move_item"; "cancela el examen de biología" (ya está en la lista) -> "cancel_item". La sola coincidencia de palabras no basta: solo genera "move_item"/"cancel_item"/"update_priority" cuando puedas señalar con certeza a qué "id" de la lista te refieres.
- Identificación del elemento objetivo, en este orden: (1) un "id" que el propio usuario o el hilo de conversación ya dejó claro; (2) un elemento mencionado sin ambigüedad en el mensaje (por título); (3) un elemento identificable por título + fecha/hora coincidentes. Si hay varios candidatos igual de plausibles en la lista y no puedes distinguirlos con certeza, NO elijas uno al azar ni el primero de la lista: no generes la acción y explica la duda en "answer" (el mismo mecanismo que ya usa la regla de "targetId" de más abajo — no se añade ningún sistema nuevo de preguntas).
- Igual que con create_task/create_event (AI-1.2/AI-1.3/AI-1.4), reutiliza SIEMPRE las fechas/horas ya resueltas para "newDate"/"newTime" cuando el contexto traiga una sección "PISTAS TEMPORALES YA RESUELTAS" o "PISTA DE MODIFICACIÓN/CANCELACIÓN": no inventes una fecha, hora, prioridad, categoría, duración, recordatorio, nota ni ubicación que el mensaje no dé.
- Sigue siendo conservador: comentarios sin instrucción clara de cambio ("hoy estoy cansado", "qué día tan largo", "creo que mañana estaré ocupado", "vale, entendido", "gracias", "quizá cambie el examen" sin decir a qué ni cuándo) no generan ninguna acción — "actions": [].

Reglas estrictas, sin excepción:
- "title" es SIEMPRE obligatorio en "create_task" y en "create_event": un texto breve y claro que describa de qué se trata (ej: "Médico", "Examen de matemáticas", "Entregar trabajo"). Nunca lo dejes vacío, null ni lo omitas — resúmelo tú mismo a partir de lo que ha escrito el usuario si no lo da con esas palabras exactas.
- Usa "create_event" SOLO cuando el usuario da una fecha (y normalmente hora) fija de algo que ocurre en un momento concreto: examen, reunión, clase, entreno, cita.
- Usa "create_task" para algo que hay que HACER antes de una fecha límite pero sin hora impuesta por el usuario (una tarea, un trabajo, "terminar el proyecto", "estudiar para..."). En ese caso deja "dueTime": null y NO inventes una hora — el sistema decidirá el hueco por su cuenta a partir de "estimatedMinutes". Estima "estimatedMinutes" de forma realista según el tipo de tarea (una entrega corta ~30-45min, estudiar para un examen ~60min, un proyecto grande ~90-120min).
- Usa "move_item" o "cancel_item" SOLO cuando el usuario se refiere a algo que ya existe en el contexto (LISTA DE ELEMENTOS EXISTENTES). Copia "targetId" EXACTO tal como aparece ahí, nunca lo inventes ni lo abrevies. Si no encuentras con certeza a qué elemento existente se refiere, no generes esa acción: explica la duda en "answer" en vez de adivinar.
- Usa "update_priority" para cambios de importancia sobre un elemento existente (mismo cuidado con "targetId").
- Si el usuario solo pregunta o comenta algo sin pedir ningún cambio, devuelve "actions": [] y responde en "answer".
- "answer" es siempre una frase breve en texto plano (sin markdown) confirmando o explicando lo que has entendido.
- No inventes tareas, eventos, horas, IDs ni prioridades que no estén en el contexto o en el mensaje del usuario.
- Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown ni bloques de código.`;

  /* ==================================================================
     AI-1.2 — Resolución determinista de fechas y horas naturales
     Funciones PURAS (no leen `state` ni tocan el DOM): toman el mensaje
     del usuario y la FECHA ACTUAL ya calculada por buildActionContext
     (nunca `new Date()` como fuente de verdad de "hoy") y devuelven
     "YYYY-MM-DD"/"HH:MM" ya resueltos, o null si el mensaje no trae esa
     información — nunca inventan una fecha/hora que el usuario no dio.
     No sustituyen a la IA: solo le entregan, ya calculadas en código
     (fiable y testeable), las mismas referencias temporales que
     ACTION_RULES ya le pedía calcular por su cuenta — ver
     buildTemporalHints() y su uso en runIAAction(), más abajo. No crean
     ningún tipo de acción nuevo ni cambian ACTION_SCHEMA.

     Política de "este X" / "el próximo X" (documentada aquí porque no
     existía como código antes de AI-1.2, solo como texto en
     ACTION_RULES — ver "Días de la semana" más arriba, sin cambiar ese
     criterio):
       - "el X" / "este X": la ocurrencia de X más próxima a partir de
         HOY incluido (si HOY ya es X, es HOY mismo) — de 0 a 6 días vista.
       - "el próximo X" / "X que viene" / "la semana que viene": la
         ocurrencia de X de la semana siguiente a esa más próxima, nunca
         la de esta semana — se calcula sumando 7 días exactos a la
         ocurrencia más próxima, nunca al revés.
     ================================================================== */
  const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  // Mismo orden que Date.prototype.getDay() (0=domingo..6=sábado): se usa
  // SOLO para reconocer el nombre del día en el texto del usuario: la
  // fecha resultante siempre se calcula desde FECHA ACTUAL real (parseada
  // de forma segura más abajo), nunca desde la posición de este array.
  const WEEKDAY_NAMES_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** 'YYYY-MM-DD' -> Date en HORA LOCAL (nunca UTC). Evita el desfase
   * clásico de `new Date('YYYY-MM-DD')`, que JS interpreta como
   * medianoche UTC: en una zona horaria con offset negativo, leer luego
   * getDate()/getDay() puede devolver el día ANTERIOR al que dice la
   * cadena. Aquí se construye siempre con el constructor (año, mes,
   * día), que usa hora local de principio a fin. */
  function parseYMDLocal(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Fecha de calendario inválida (p.ej. "2026-02-30"): new Date la
    // "normaliza" a otro día (2 de marzo) en vez de fallar — se detecta
    // y se rechaza aquí para no devolver silenciosamente una fecha distinta.
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
    return d;
  }
  /** Date en hora local -> 'YYYY-MM-DD', simétrico de parseYMDLocal
   * (usa getFullYear/getMonth/getDate locales, nunca los UTC). */
  function formatYMDLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }
  function addDaysLocal(dateStr, days) {
    const d = parseYMDLocal(dateStr);
    if (!d) return null;
    d.setDate(d.getDate() + days);
    return formatYMDLocal(d);
  }
  /** true si (year, month 1-12, day) es una fecha real del calendario —
   * comprobación por "ida y vuelta" con Date, igual criterio que
   * isValidYMDDate() ya usado en organizator.html (UX-8/recurrencia),
   * redefinido aquí en local para que este bloque siga siendo autónomo
   * (no depende de globals de organizator.html, solo de FECHA ACTUAL que
   * le pasan como parámetro). Rechaza "31 de febrero", "31 de abril",
   * etc. en vez de normalizarlas a otra fecha. */
  function isValidCalendarDate(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  }

  /** "hoy" / "mañana" / "pasado mañana", relativas a `todayStr` (nunca a
   * `new Date()`). Devuelve null si el mensaje no usa ninguna de las tres.
   * El "mañana" (día siguiente) suelto se excluye deliberadamente cuando
   * va precedido de "la " ("por la mañana", "a las 8 de la mañana"): ahí
   * "mañana" es la FRANJA del día (resolveDayPart) o parte de una hora en
   * formato AM (resolveTimeExpression), nunca "el día de mañana" — sin
   * esta exclusión, "el jueves por la mañana" resolvería mal a "mañana"
   * (día siguiente) en vez de al jueves. */
  function resolveRelativeDate(message, todayStr) {
    const m = String(message || '').toLowerCase();
    if (/\bpasado\s+mañana\b/.test(m)) return addDaysLocal(todayStr, 2);
    if (/(?<!la\s)\bmañana\b/.test(m)) return addDaysLocal(todayStr, 1);
    if (/\bhoy\b/.test(m)) return todayStr;
    return null;
  }

  /** "el lunes" / "este viernes" / "el próximo lunes" / "la semana que
   * viene" (+ día), relativas a `todayStr`. Ver política documentada en
   * la cabecera de este bloque. Devuelve null si no hay ningún nombre de
   * día de la semana en el mensaje. */
  function resolveWeekdayDate(message, todayStr) {
    const m = String(message || '').toLowerCase();
    const dowIndex = WEEKDAY_NAMES_ES.findIndex(name => new RegExp(`\\b${name}\\b`).test(m));
    if (dowIndex === -1) return null;
    const today = parseYMDLocal(todayStr);
    if (!today) return null;
    const isNext = /\bpróximo\b|\bpróxima\b|que viene/.test(m);
    let diff = (dowIndex - today.getDay() + 7) % 7;
    if (isNext) diff += 7;
    return addDaysLocal(todayStr, diff);
  }

  /** "24/10" o "24-10" (día/mes numérico, SIN año) o "24 de octubre"
   * (día + nombre de mes, SIN año). Sin año dado: usa el año en curso de
   * `todayStr`, salvo que esa fecha ya haya pasado este año (entonces el
   * año siguiente) — mismo criterio que ya describía ACTION_RULES antes
   * de AI-1.2. Si la combinación día+mes no es una fecha real en NINGÚN
   * año cercano (p.ej. "31 de febrero"), devuelve null: nunca se inventa
   * una fecha válida distinta. */
  function resolveNumericDayMonth(message, todayStr) {
    const m = String(message || '').toLowerCase();
    let day = null, month = null;
    const monthNamesAlt = MONTH_NAMES_ES.join('|');
    const nameMatch = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${monthNamesAlt})\\b`, 'i').exec(m);
    if (nameMatch) {
      day = Number(nameMatch[1]);
      month = MONTH_NAMES_ES.indexOf(nameMatch[2].toLowerCase()) + 1;
    } else {
      const numMatch = /\b(\d{1,2})[/-](\d{1,2})\b(?!\d)/.exec(m);
      if (numMatch) { day = Number(numMatch[1]); month = Number(numMatch[2]); }
    }
    if (day === null || month === null) return null;
    const today = parseYMDLocal(todayStr);
    if (!today) return null;
    const thisYear = today.getFullYear();
    // Hasta 4 años (cubre el ciclo bisiesto de "29 de febrero") antes de
    // concluir que la combinación día+mes es imposible.
    const candidates = [thisYear, thisYear + 1, thisYear + 2, thisYear + 3]
      .filter(y => isValidCalendarDate(y, month, day))
      .map(y => `${y}-${pad2(month)}-${pad2(day)}`);
    if (!candidates.length) return null; // imposible en cualquier año (31 de febrero, etc.)
    return candidates.find(c => c >= todayStr) || candidates[candidates.length - 1];
  }

  /** "el 24" (día suelto, sin mes): mes en curso de `todayStr` salvo que
   * ese día ya haya pasado, en cuyo caso el mes siguiente — mismo
   * criterio que ACTION_RULES ya describía antes de AI-1.2. Deja pasar
   * "24/10"/"24-10"/"24 de octubre" a resolveNumericDayMonth (no los
   * captura aquí). */
  function resolveNumericDayOnly(message, todayStr) {
    const m = String(message || '').toLowerCase();
    const monthNamesAlt = MONTH_NAMES_ES.join('|');
    const re = new RegExp(`\\bel\\s+(?:d[ií]a\\s+)?(\\d{1,2})\\b(?!\\s*[/-]\\s*\\d)(?!\\s+de\\s+(?:${monthNamesAlt}))`, 'i');
    const found = re.exec(m);
    if (!found) return null;
    const day = Number(found[1]);
    if (day < 1 || day > 31) return null;
    const today = parseYMDLocal(todayStr);
    if (!today) return null;
    for (let offset = 0; offset < 24; offset++) {
      let year = today.getFullYear();
      let month = today.getMonth() + 1 + offset;
      while (month > 12) { month -= 12; year++; }
      if (!isValidCalendarDate(year, month, day)) continue;
      const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
      if (candidate >= todayStr) return candidate;
    }
    return null;
  }

  /** Cualquier referencia de FECHA reconocible en `message`, probada en
   * orden de especificidad (relativa > día de la semana > numérica con
   * mes > numérica suelta). Devuelve "YYYY-MM-DD" o null. */
  function resolveDateExpression(message, todayStr) {
    return resolveRelativeDate(message, todayStr)
      || resolveWeekdayDate(message, todayStr)
      || resolveNumericDayMonth(message, todayStr)
      || resolveNumericDayOnly(message, todayStr);
  }

  /** "a las 17", "a las 17:30", "a las 5 de la tarde", "a las 8 de la
   * mañana", "a las 9 de la noche", "a mediodía", "a medianoche".
   * Devuelve "HH:MM" o null si el mensaje no da ninguna hora — nunca
   * inventa una hora a partir de una franja del día (ver resolveDayPart). */
  function resolveTimeExpression(message) {
    const m = String(message || '').toLowerCase();
    const re = /\ba\s+las\s+(\d{1,2})(?::(\d{2}))?(?:\s+de\s+la\s+(mañana|tarde|noche|madrugada))?\b/;
    const found = re.exec(m);
    if (found) {
      let hour = Number(found[1]);
      const minute = found[2] ? Number(found[2]) : 0;
      const period = found[3] || null;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      if (period === 'tarde' || period === 'noche') {
        if (hour >= 1 && hour <= 11) hour += 12;
      } else if (period === 'mañana' || period === 'madrugada') {
        if (hour === 12) hour = 0;
      }
      if (hour > 23) return null;
      return `${pad2(hour)}:${pad2(minute)}`;
    }
    if (/\ba\s+mediod[ií]a\b/.test(m)) return '12:00';
    if (/\ba\s+medianoche\b/.test(m)) return '00:00';
    return null;
  }

  /** "por la mañana" / "por la tarde" / "por la noche": una franja del
   * día SIN hora exacta. Se documenta como información aparte de
   * resolveTimeExpression a propósito (requisito AI-1.2 punto 5): el
   * esquema actual no tiene un campo para "franja del día", así que esto
   * NUNCA debe traducirse en un HH:MM inventado — solo se usa para que
   * buildTemporalHints() avise de que hay una franja mencionada, sin
   * fabricar una hora. */
  function resolveDayPart(message) {
    const m = String(message || '').toLowerCase();
    if (/\bpor\s+la\s+mañana\b/.test(m)) return 'mañana';
    if (/\bpor\s+la\s+tarde\b/.test(m)) return 'tarde';
    if (/\bpor\s+la\s+noche\b/.test(m)) return 'noche';
    return null;
  }

  /** Texto adicional de contexto con las referencias temporales del
   * mensaje YA resueltas en código (fiable, testeado) para que la IA no
   * tenga que recalcularlas — ver el nuevo bullet "AI-1.2" en
   * ACTION_RULES. Devuelve '' si el mensaje no contiene ninguna
   * referencia temporal reconocible (no añade nada al contexto en ese
   * caso: ver requisito AI-1.2 de no inventar fecha/hora ausentes). */
  function buildTemporalHints(message, todayStr) {
    if (typeof message !== 'string' || !message.trim() || !todayStr) return '';
    const date = resolveDateExpression(message, todayStr);
    const time = resolveTimeExpression(message);
    const dayPart = resolveDayPart(message);
    if (!date && !time && !dayPart) return '';
    const lines = ['PISTAS TEMPORALES YA RESUELTAS PARA ESTE MENSAJE (calculadas a partir de FECHA ACTUAL; cópialas tal cual, no las recalcules):'];
    if (date) lines.push(`- Fecha detectada en el mensaje: ${date}`);
    if (time) lines.push(`- Hora detectada en el mensaje: ${time}`);
    if (dayPart && !time) lines.push(`- Franja horaria mencionada: ${dayPart} (el usuario NO dio una hora exacta; no inventes ninguna hora — deja startTime/dueTime en null, o usa allDay si aplica).`);
    return lines.join('\n');
  }

  /* ==================================================================
     AI-1.3 — Reconocimiento de eventos implícitos/festivos
     Heurística PURA por palabras clave (no lee `state`, no toca el DOM,
     no repite NADA de la resolución de fecha/hora de AI-1.2: solo mira
     el TEXTO del mensaje para detectar si describe un festivo/día no
     laborable o una cita/compromiso, y usa resolveDateExpression/
     resolveTimeExpression de AI-1.2 tal cual, sin reimplementarlos, para
     ver si ya hay fecha/hora resuelta).
     Esta heurística NO decide la acción final por su cuenta — solo
     construye una pista orientativa ("PISTA DE TIPO DE ACCIÓN") que se
     añade al contexto, igual que buildTemporalHints hace con las fechas.
     La clasificación real (create_task vs create_event, y todo lo demás)
     la sigue haciendo la IA según ACTION_RULES (ver el apartado "Eventos
     implícitos y festivos" ahí arriba) — así no se crea un segundo
     sistema paralelo de acciones, solo se enriquece el contexto que ya
     recibe el único sistema existente (ACTION_SCHEMA/runIAAction).
     Por diseño es conservadora: casos ambiguos como "tengo que ir al
     médico" (construcción "tengo que" típica de tarea, pero sustantivo
     de cita) se detectan igualmente por el sustantivo de cita, pero la
     heurística nunca es la única fuente de verdad — ACTION_RULES le pide
     a la IA que la trate como orientativa, no vinculante.
     ================================================================== */
  // Sustantivos de cita/compromiso reconocidos como "esto es un EVENTO,
  // no algo que decides tú cuándo hacer": los mismos tipos de ejemplo que
  // ya usaban ACTION_RULES antes de AI-1.3 (examen, reunión, entreno,
  // cita) más médico/dentista/parcial/clase, pedidos explícitamente por
  // AI-1.3.
  const IMPLICIT_EVENT_NOUNS = ['médico', 'dentista', 'reuni[oó]n', 'cita', 'examen', 'parcial', 'entreno', 'clase'];

  /** true si el mensaje describe un festivo/día no laborable ("es
   * festivo", "es fiesta", "día no laborable", "no trabajo") — patrón
   * léxico simple, sin ambigüedad real (a diferencia de "tengo que"). */
  function isHolidayMessage(message) {
    const m = String(message || '').toLowerCase();
    return /\bes\s+(un\s+)?(d[ií]a\s+)?(festivo|fiesta)\b/.test(m)
      || /\bd[ií]a\s+(festivo|no\s+laborable)\b/.test(m)
      || /\bno\s+laborable\b/.test(m)
      || /\bno\s+trabajo\b/.test(m)
      || /\bno\s+trabajamos\b/.test(m);
  }

  /** true si el mensaje menciona una cita/compromiso reconocible (ver
   * IMPLICIT_EVENT_NOUNS), con o sin la construcción "tengo que" delante
   * ("tengo médico" y "tengo que ir al médico" son la MISMA cita: ver
   * cabecera del bloque). No distingue "tengo que + verbo genérico"
   * (estudiar, entregar...) porque ninguno de esos verbos está en
   * IMPLICIT_EVENT_NOUNS — esos casos devuelven false aquí, tal como
   * pide AI-1.3 (siguen siendo tarea, no evento). */
  function isAppointmentMessage(message) {
    const m = String(message || '').toLowerCase();
    const nounsAlt = IMPLICIT_EVENT_NOUNS.join('|');
    const re = new RegExp(`\\btengo\\s+(?:que\\s+(?:ir\\s+(?:al|a\\s+la|a)\\s+)?)?(?:un\\s+|una\\s+)?(?:${nounsAlt})\\b`, 'i');
    return re.test(m);
  }

  /** Texto adicional de contexto con la pista de tipo de acción (AI-1.3),
   * o '' si el mensaje no encaja con ningún patrón reconocido — en ese
   * caso no se añade nada (la IA decide solo con ACTION_RULES, como
   * hasta ahora). Nunca inventa fecha/hora: solo reutiliza
   * resolveDateExpression/resolveTimeExpression de AI-1.2 (no las
   * repite) para poder avisar, cuando aplica, de que un festivo sin hora
   * detectada debería ser allDay. */
  function buildImplicitEventHints(message, todayStr) {
    if (typeof message !== 'string' || !message.trim()) return '';
    const holiday = isHolidayMessage(message);
    const appointment = !holiday && isAppointmentMessage(message);
    if (!holiday && !appointment) return '';
    const hasTime = !!resolveTimeExpression(message);
    const hasDate = !!resolveDateExpression(message, todayStr);
    const lines = ['PISTA DE TIPO DE ACCIÓN PARA ESTE MENSAJE (orientativa, basada en palabras clave — la decisión final la haces tú según ACTION_RULES):'];
    if (holiday) {
      lines.push('- Parece describir un FESTIVO/DÍA NO LABORABLE: probablemente "create_event" de día completo (usa "allDay": true y startTime/endTime null si el mensaje no da ninguna hora; título breve, ej. "Festivo").');
    } else {
      lines.push('- Parece describir una CITA/COMPROMISO (médico, dentista, reunión, examen, clase...), no una tarea a hacer por iniciativa propia: probablemente "create_event", aunque use construcciones como "tengo que".');
    }
    if (!hasDate) lines.push('- El mensaje no trae ninguna fecha reconocible: no inventes una, deja el campo de fecha vacío o pide más información en "answer" si hace falta.');
    if (holiday && !hasTime) lines.push('- No se detectó ninguna hora en el mensaje: no la inventes, usa un evento de día completo.');
    return lines.join('\n');
  }

  /* ==================================================================
     AI-1.4 — Reconocimiento de tareas implícitas
     Heurística PURA por palabras clave (mismo criterio que el bloque
     AI-1.3 justo arriba, del que además depende: reutiliza
     isHolidayMessage/isAppointmentMessage para NO marcar como tarea un
     mensaje que AI-1.3 ya reconoció como evento/festivo, evitando pistas
     contradictorias en el mismo contexto). No modifica `state`, no toca
     el DOM, no crea tareas directamente, no persiste nada, no llama a
     Scheduler, no toca reminders/recurrencia/propuestas IA: solo
     construye una pista de texto orientativa ("PISTA DE TIPO DE
     ACCIÓN"), igual que buildImplicitEventHints. Reutiliza
     resolveDateExpression/resolveTimeExpression de AI-1.2 tal cual (no
     las reimplementa) para saber si ya hay fecha/hora resuelta.
     La clasificación real (create_task vs cualquier otra cosa) la sigue
     haciendo la IA según ACTION_RULES (ver "Tareas implícitas" ahí
     arriba) — esta heurística nunca crea la acción por su cuenta, así
     que no es un segundo sistema paralelo de acciones.
     ================================================================== */
  // Expresiones de intención/obligación reconocidas ("esto suena a algo
  // que el usuario tiene que hacer"), pedidas explícitamente por AI-1.4.
  const IMPLICIT_TASK_MARKERS = ['tengo que', 'necesito', 'debo', 'quiero', 'hay que', 'no olvidar'];
  // Verbos de acción pendiente ("qué es lo que hay que hacer"), también
  // pedidos explícitamente por AI-1.4. Se exige la combinación
  // marcador+verbo (nunca el marcador solo) para que la heurística sea
  // conservadora, tal como pide el enunciado: "necesito ayuda" o "quiero
  // mucho a mi familia" no traen ninguno de estos verbos, así que no se
  // marcan como tarea.
  const IMPLICIT_TASK_VERBS = ['preparar', 'estudiar', 'revisar', 'entregar', 'enviar', 'comprar', 'llamar', 'terminar', 'hacer', 'organizar', 'reservar'];

  /** true si el mensaje combina un marcador de intención/obligación con
   * un verbo de acción pendiente (ver listas de arriba) — nunca solo uno
   * de los dos, para no disparar con frases ambiguas ("necesito
   * descansar", "quiero mucho a mi familia"). */
  function isTaskMessage(message) {
    const m = String(message || '').toLowerCase();
    const hasMarker = IMPLICIT_TASK_MARKERS.some(marker => new RegExp(`\\b${marker}\\b`).test(m));
    if (!hasMarker) return false;
    const verbsAlt = IMPLICIT_TASK_VERBS.join('|');
    return new RegExp(`\\b(?:${verbsAlt})\\b`).test(m);
  }

  /** Texto adicional de contexto con la pista de tarea implícita
   * (AI-1.4), o '' si el mensaje no encaja o si AI-1.3 ya lo reconoció
   * como evento/festivo (evita mandarle a la IA dos pistas
   * contradictorias — "PISTA DE TIPO DE ACCIÓN" solo aparece una vez por
   * mensaje: o la de AI-1.3, o la de AI-1.4, nunca las dos). Nunca
   * inventa fecha/hora: solo avisa de que faltan (para que la IA no las
   * invente tampoco), reutilizando resolveDateExpression/
   * resolveTimeExpression de AI-1.2. */
  function buildImplicitTaskHints(message, todayStr) {
    if (typeof message !== 'string' || !message.trim()) return '';
    if (isHolidayMessage(message) || isAppointmentMessage(message)) return '';
    if (!isTaskMessage(message)) return '';
    const hasDate = !!resolveDateExpression(message, todayStr);
    const hasTime = !!resolveTimeExpression(message);
    // Cabecera propia y distinta de la "PISTA DE TIPO DE ACCIÓN" de AI-1.3
    // (buildImplicitEventHints, más arriba) a propósito: así un mensaje
    // que ya recibió la pista de evento/festivo de AI-1.3 nunca se
    // confunde con esta (aunque ya se corta antes por el chequeo de
    // isHolidayMessage/isAppointmentMessage de arriba), y los tests de
    // AI-1.3 que comprueban la ausencia de su propia cabecera en mensajes
    // sin cita/festivo no se ven afectados por esta pista, distinta, de AI-1.4.
    const lines = ['PISTA DE TAREA IMPLÍCITA PARA ESTE MENSAJE (orientativa, basada en palabras clave — la decisión final la haces tú según ACTION_RULES):'];
    lines.push('- Parece describir una TAREA pendiente del usuario (algo que tiene que/necesita/debe/quiere hacer por su cuenta, con margen de cuándo), no un evento ni una cita: probablemente "create_task".');
    if (!hasDate) lines.push('- El mensaje no trae ninguna fecha límite reconocible: no inventes una, deja "dueDate" en null.');
    if (!hasTime) lines.push('- No se detectó ninguna hora en el mensaje: no la inventes, deja "dueTime" en null (el sistema decidirá el hueco con Scheduler si hace falta).');
    return lines.join('\n');
  }

  /* ==================================================================
     AI-1.5 — Modificar/mover/cancelar naturalmente
     Heurística PURA por palabras clave (mismo criterio que los bloques
     AI-1.3/AI-1.4 justo arriba, de los que además depende: reutiliza
     isHolidayMessage/isAppointmentMessage/isTaskMessage para NO marcar
     como modificación/cancelación un mensaje que ya encaje mejor como
     creación implícita, y resolveDateExpression/resolveTimeExpression de
     AI-1.2 tal cual, sin reimplementarlos). No modifica `state`, no toca
     el DOM, no persiste nada, no llama a Scheduler, no toca reminders/
     recurrencia/propuestas IA: solo construye una pista de texto
     orientativa ("PISTA DE MODIFICACIÓN/CANCELACIÓN"), igual que
     buildImplicitEventHints/buildImplicitTaskHints.
     A propósito, esta heurística NUNCA intenta adivinar A QUÉ elemento
     existente se refiere el mensaje (ni por título, ni por posición, ni
     por ningún otro medio): identificar el "targetId" real sigue siendo
     estrictamente responsabilidad de la IA a partir de la LISTA DE
     ELEMENTOS EXISTENTES que ya construye buildActionContext() (sin
     tocar) — así no se inventan IDs ni se elige un candidato ambiguo al
     azar, y no se crea un segundo sistema de resolución de referencias
     paralelo al que ya define ACTION_RULES/applyMoveItem/applyCancelItem.
     La clasificación real (move_item vs cancel_item vs cualquier otra
     cosa) la sigue haciendo la IA según ACTION_RULES (ver "Modificar,
     mover y cancelar de forma natural" ahí arriba).
     ================================================================== */
  // Verbos/expresiones de movimiento (fecha y/o hora) sobre algo
  // existente, pedidos explícitamente por AI-1.5.
  const MOVE_VERB_CUES = ['mueve', 'mover', 'pasa', 'pasar', 'cambia', 'cambiar', 'pon', 'poner', 'aplaza', 'aplazar', 'adelanta', 'adelantar', 'reprograma', 'reprogramar'];
  // Verbos/expresiones de cancelación sobre algo existente, pedidos
  // explícitamente por AI-1.5.
  const CANCEL_VERB_CUES = ['cancela', 'cancelar', 'elimina', 'eliminar', 'borra', 'borrar', 'quita', 'quitar'];

  function wordCueMatches(cues, m) {
    return cues.some(cue => new RegExp(`\\b${cue}\\b`).test(m));
  }

  /** true si el mensaje pide cancelar/eliminar algo existente ("cancela
   * el examen", "ya no tengo la reunión", "no tengo que ir al médico
   * finalmente"). Se comprueba ANTES que isMoveMessage/isPriorityMessage
   * en buildModificationHints: una frase de cancelación manda sobre
   * cualquier otra lectura. */
  function isCancelMessage(message) {
    const m = String(message || '').toLowerCase();
    if (wordCueMatches(CANCEL_VERB_CUES, m)) return true;
    if (/\bya\s+no\s+(tengo|hay)\b/.test(m)) return true;
    if (/\bno\s+tengo\s+que\b[\s\S]*\bfinalmente\b/.test(m) || /\bfinalmente\b[\s\S]*\bno\s+tengo\s+que\b/.test(m)) return true;
    return false;
  }

  /** true si el mensaje pide cambiar la PRIORIDAD de algo existente
   * ("cambia la prioridad del trabajo a alta", "baja la prioridad de
   * X") — esto es "update_priority" (el tipo que YA existe para esto),
   * nunca "move_item" (que es solo fecha/hora). Se comprueba antes que
   * isMoveMessage para que "cambia la prioridad..." no se confunda con
   * un cambio de fecha/hora solo por compartir el verbo "cambia". */
  function isPriorityChangeMessage(message) {
    const m = String(message || '').toLowerCase();
    return /\bprioridad\b/.test(m) && wordCueMatches(['cambia', 'cambiar', 'pon', 'poner', 'sube', 'subir', 'baja', 'bajar'], m);
  }

  /** true si el mensaje pide mover la fecha y/o hora de algo existente
   * ("mueve el examen al viernes", "pon el entrenamiento a las 19",
   * "haz que el examen sea a las 10"). No se dispara para cambios de
   * prioridad (ver isPriorityChangeMessage) ni para cancelaciones (ver
   * isCancelMessage, comprobada antes en buildModificationHints). */
  function isMoveMessage(message) {
    const m = String(message || '').toLowerCase();
    if (wordCueMatches(MOVE_VERB_CUES, m)) return true;
    if (/\bhaz\s+que\b[\s\S]*\bsea\b/.test(m)) return true;
    return false;
  }

  /** Texto adicional de contexto con la pista de modificación/
   * cancelación (AI-1.5), o '' si el mensaje no encaja con ningún patrón
   * de mover/cancelar/repriorizar. Cuando SÍ encaja, tiene prioridad
   * sobre las pistas de creación implícita de AI-1.3/AI-1.4 — por eso NO
   * se corta aquí por isHolidayMessage/isAppointmentMessage/isTaskMessage
   * (al revés que buildImplicitTaskHints con AI-1.3): "no tengo que ir
   * al médico finalmente" contiene el mismo patrón de cita que "tengo
   * que ir al médico" (AI-1.3), pero es una CANCELACIÓN, no una cita
   * nueva, así que AI-1.5 debe ganar ahí. Quién gana cuando ambas
   * heurísticas dispararían a la vez lo decide runIAAction() (más abajo)
   * al componer el contexto, no esta función. Nunca inventa fecha/hora:
   * solo reutiliza resolveDateExpression/resolveTimeExpression de AI-1.2. */
  function buildModificationHints(message, todayStr) {
    if (typeof message !== 'string' || !message.trim()) return '';
    const cancel = isCancelMessage(message);
    const priority = !cancel && isPriorityChangeMessage(message);
    const move = !cancel && !priority && isMoveMessage(message);
    if (!cancel && !priority && !move) return '';
    const lines = ['PISTA DE MODIFICACIÓN/CANCELACIÓN PARA ESTE MENSAJE (orientativa, basada en palabras clave — la decisión final la haces tú según ACTION_RULES):'];
    if (cancel) {
      lines.push('- Parece pedir CANCELAR/ELIMINAR algo que ya existe: probablemente "cancel_item" sobre el elemento correspondiente de la LISTA DE ELEMENTOS EXISTENTES — nunca generes un "create_task"/"create_event" nuevo para esto.');
    } else if (priority) {
      lines.push('- Parece pedir un cambio de PRIORIDAD sobre algo que ya existe: probablemente "update_priority" (con "newPriority"), no "move_item".');
    } else {
      const newDate = resolveDateExpression(message, todayStr);
      const newTime = resolveTimeExpression(message);
      lines.push('- Parece pedir MOVER la fecha y/o hora de algo que ya existe: probablemente "move_item" sobre el elemento correspondiente de la LISTA DE ELEMENTOS EXISTENTES — nunca generes un "create_task"/"create_event" nuevo para esto.');
      if (newDate) lines.push(`- Nueva fecha detectada en el mensaje: ${newDate} (úsala en "newDate", no la recalcules).`);
      if (newTime) lines.push(`- Nueva hora detectada en el mensaje: ${newTime} (úsala en "newTime", no la recalcules).`);
      if (!newDate && !newTime) lines.push('- No se detectó ninguna fecha ni hora nueva reconocible en el mensaje: no inventes ninguna.');
    }
    lines.push('- Identifica el elemento objetivo SOLO si puedes señalarlo con certeza (id explícito, título inequívoco, o título + fecha/hora coincidentes) en la LISTA DE ELEMENTOS EXISTENTES; si hay varios candidatos igual de plausibles, no elijas ninguno al azar: no generes la acción y explica la duda en "answer".');
    return lines.join('\n');
  }

  /* ==================================================================
     AI-2.1 — Detección de necesidad de formulario inteligente
     Infraestructura PURA, todavía SIN integrar en runIAAction() ni en
     ningún flujo real: esta fase solo prepara detectSmartFormIntent(),
     que decide si un mensaje corto ("parcial de biología", "estudiar
     biología"...) parece describir una tarea/evento nuevo aunque falten
     datos para crearla directamente — sin abrir ningún formulario, sin
     tocar el DOM, sin `state`, sin llamar a Scheduler/reminders/
     recurrence/propuestas IA. No sustituye a AI-1 (create_task/
     create_event ya resueltos directamente por runIAAction siguen
     funcionando exactamente igual): es un helper adicional, pensado para
     que una fase posterior (fuera de AI-2.1) decida cuándo abrir un
     formulario con estos datos ya precargados.
     Reutiliza SIN duplicar: IMPLICIT_EVENT_NOUNS/IMPLICIT_TASK_VERBS
     (AI-1.3/AI-1.4, mismas constantes, no una copia), WEEKDAY_NAMES_ES/
     MONTH_NAMES_ES (AI-1.2), isHolidayMessage/isAppointmentMessage
     (AI-1.3), isTaskMessage (AI-1.4), isMoveMessage/isCancelMessage/
     isPriorityChangeMessage (AI-1.5) y resolveDateExpression/
     resolveTimeExpression (AI-1.2) — ningún parser de fechas/horas ni
     ninguna clasificación tarea/evento nuevos, solo se combinan los ya
     existentes con un criterio distinto (fragmentos cortos SIN verbo
     "tengo"/marcador de obligación, que AI-1.3/1.4 no cubren porque
     están pensados para frases completas).
     ================================================================== */
  // Frases de incertidumbre: si el propio usuario ya expresa que no está
  // seguro ("quizá cambie el examen"), no hay una intención de creación
  // clara que ofrecer en un formulario — más vale no proponer nada que
  // proponer algo basado en una duda del propio usuario.
  const SMART_FORM_UNCERTAINTY_MARKERS = ['quizá', 'quizás', 'tal vez', 'puede que', 'a lo mejor'];

  function hasUncertaintyMarker(message) {
    const m = String(message || '').toLowerCase();
    // Ojo: \b (límite de palabra de JS) solo reconoce [A-Za-z0-9_] como
    // "carácter de palabra" — "quizá" termina en á, así que un \b final
    // ahí NUNCA encuentra límite (á ya cuenta como no-palabra) y la
    // condición no dispara nunca. Se usan lookarounds explícitos contra
    // el alfabeto español en vez de \b para que sí funcione con acentos.
    return SMART_FORM_UNCERTAINTY_MARKERS.some(w => new RegExp(`(?<![a-záéíóúñ])${w}(?![a-záéíóúñ])`).test(m));
  }

  /** true si el mensaje menciona, SUELTO (sin exigir "tengo" delante, a
   * diferencia de isAppointmentMessage de AI-1.3), alguno de los
   * sustantivos de cita/festivo ya reconocidos por AI-1.3
   * (IMPLICIT_EVENT_NOUNS, misma constante, no una copia) — pensado para
   * fragmentos cortos tipo "parcial de biología" o "examen de
   * matemáticas", donde no hay una frase completa que analizar. */
  function hasEventNounFragment(message) {
    const m = String(message || '').toLowerCase();
    return IMPLICIT_EVENT_NOUNS.some(noun => new RegExp(`\\b${noun}\\b`).test(m));
  }

  /** true si el mensaje menciona, SUELTO (sin exigir un marcador de
   * obligación delante, a diferencia de isTaskMessage de AI-1.4), alguno
   * de los verbos de tarea ya reconocidos por AI-1.4 (IMPLICIT_TASK_VERBS,
   * misma constante, no una copia) — pensado para fragmentos cortos tipo
   * "estudiar biología" o "hacer la compra". */
  function hasTaskVerbFragment(message) {
    const m = String(message || '').toLowerCase();
    return IMPLICIT_TASK_VERBS.some(verb => new RegExp(`\\b${verb}\\b`).test(m));
  }

  /** Quita del texto las referencias de fecha/hora ya reconocibles por
   * AI-1.2 (mismos nombres de día/mes, mismas expresiones de "hoy/
   * mañana/pasado mañana/a las HH:MM/por la tarde...") para quedarse con
   * el resto como título candidato — NO vuelve a calcular ninguna fecha
   * ni hora aquí (eso lo siguen haciendo exclusivamente
   * resolveDateExpression/resolveTimeExpression, llamados aparte en
   * detectSmartFormIntent): esto es solo limpieza de texto para el
   * título, nunca una segunda fuente de verdad temporal. */
  function stripDateTimePhrasesForTitle(message) {
    const weekdayAlt = WEEKDAY_NAMES_ES.join('|');
    const monthAlt = MONTH_NAMES_ES.join('|');
    const patterns = [
      /\bpasado\s+mañana\b/gi,
      /(?<!la\s)\bmañana\b/gi,
      /\bhoy\b/gi,
      new RegExp(`\\bla\\s+semana\\s+que\\s+viene\\b`, 'gi'),
      new RegExp(`\\b(el\\s+)?(pr[oó]ximo\\s+|pr[oó]xima\\s+)?(este\\s+|esta\\s+)?(${weekdayAlt})\\b`, 'gi'),
      new RegExp(`\\bel\\s+\\d{1,2}\\s+de\\s+(${monthAlt})\\b`, 'gi'),
      /\bel\s+\d{1,2}\b/gi,
      /\b\d{1,2}[/-]\d{1,2}\b/g,
      /\ba\s+las\s+\d{1,2}(:\d{2})?(\s+de\s+la\s+(mañana|tarde|noche|madrugada))?\b/gi,
      /\ba\s+mediod[ií]a\b/gi,
      /\ba\s+medianoche\b/gi,
      /\bpor\s+la\s+(mañana|tarde|noche)\b/gi,
    ];
    let text = ` ${message} `;
    for (const re of patterns) text = text.replace(re, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    text = text.replace(/^(el|la|los|las|para|a|de)\s+/i, '').replace(/\s+(el|la|para|a|de)$/i, '');
    return text.trim();
  }

  /** Título candidato para el formulario inteligente: el mensaje sin las
   * referencias de fecha/hora ya reconocidas, con la primera letra en
   * mayúscula — nunca resumido, reescrito ni inventado. Devuelve null si
   * no queda ningún texto sustantivo tras la limpieza. */
  function extractTitleForSmartForm(message) {
    const cleaned = stripDateTimePhrasesForTitle(message);
    if (!cleaned) return null;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  /** Punto de entrada de AI-2.1. Devuelve `null` si el mensaje no
   * representa una intención de creación incompleta (comentario sin
   * acción, mensaje ambiguo, o algo que en realidad es mover/cancelar/
   * repriorizar un elemento ya existente — eso lo sigue resolviendo
   * AI-1.5, no un formulario de creación nuevo), o un objeto de
   * "formulario pendiente" cuando sí corresponde:
   *   { type: 'event'|'task', fields: {...}, missingFields: [...], sourceText }
   * `context.todayStr` (string 'YYYY-MM-DD', opcional) es la ÚNICA
   * fuente de FECHA ACTUAL que usa esta función para resolver fechas
   * relativas — igual que AI-1.2, nunca `new Date()`; si no se pasa,
   * simplemente no se resuelve ninguna fecha (no se inventa "hoy" como
   * sustituto). Es una función pura: no modifica `state`, no toca el
   * DOM, no persiste nada, no abre modales, no crea tareas/eventos, no
   * llama a Scheduler ni a reminders/recurrence/propuestas IA. */
  function detectSmartFormIntent(message, context) {
    if (typeof message !== 'string' || !message.trim()) return null;
    const ctx = context || {};
    if (hasUncertaintyMarker(message)) return null;
    // Mover/cancelar/repriorizar algo YA existente no es una intención de
    // CREAR nada nuevo: eso lo resuelve AI-1.5 (move_item/cancel_item/
    // update_priority), un formulario de creación no aplica aquí.
    if (isCancelMessage(message) || isMoveMessage(message) || isPriorityChangeMessage(message)) return null;

    const eventSignal = isHolidayMessage(message) || isAppointmentMessage(message) || hasEventNounFragment(message);
    const taskSignal = isTaskMessage(message) || hasTaskVerbFragment(message);
    // Ninguna señal (comentario, "no acción") o señales contradictorias
    // (evento Y tarea a la vez): no se adivina, se devuelve null.
    if (eventSignal === taskSignal) return null;

    const title = extractTitleForSmartForm(message);
    if (!title) return null;

    const todayStr = typeof ctx.todayStr === 'string' ? ctx.todayStr : null;
    const dateStr = todayStr ? resolveDateExpression(message, todayStr) : null;
    const timeStr = resolveTimeExpression(message);

    const fields = { title };
    if (dateStr) fields.date = dateStr;
    if (timeStr) fields.time = timeStr;

    if (eventSignal) {
      const missingFields = [];
      if (!fields.title) missingFields.push('title');
      if (!fields.date) missingFields.push('date');
      return { type: 'event', fields, missingFields, sourceText: message };
    }
    // taskSignal: la fecha de una tarea puede quedar pendiente a propósito
    // (el usuario la completa en el formulario) — nunca es un campo
    // "obligatorio que falta", así que no entra en missingFields.
    const missingFields = [];
    if (!fields.title) missingFields.push('title');
    return { type: 'task', fields, missingFields, sourceText: message };
  }

  /* ==================================================================
     AI-2.2 — Construir el prefill normalizado
     Capa de NORMALIZACIÓN pura entre AI-2.1 (detectSmartFormIntent) y
     AI-2.3 (openSmartFormFromChat): toma el "formulario pendiente" que
     ya devolvió detectSmartFormIntent() y lo aplana/valida a la forma
     exacta que esperan los formularios existentes — NO vuelve a
     interpretar lenguaje natural, NO vuelve a resolver fechas/horas (no
     llama a resolveDateExpression/resolveTimeExpression ni a ningún
     otro parser: los valores ya vienen resueltos en `intent.fields`),
     NO llama a la IA, NO toca el DOM, NO modifica `state`, NO persiste
     nada y NO modifica el objeto `intent` que recibe (solo lee de él).
     Arquitectura de esta fase: AI-2.1 detecta -> AI-2.2 normaliza ->
     AI-2.3 abre el modal existente con ese prefill ya normalizado.
     ================================================================== */
  function isValidSmartFormString(v) {
    return typeof v === 'string' && v.trim().length > 0;
  }
  function isValidSmartFormDateString(v) {
    // Formato + rango de mes/día (01-12/01-31) — NO es un segundo
    // cálculo de calendario (no comprueba días por mes ni años
    // bisiestos, eso ya lo garantiza resolveDateExpression al producir
    // el valor): solo descarta cadenas con forma de fecha pero un mes/
    // día imposible a simple vista, en vez de dejarlas pasar tal cual.
    return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
  }
  function isValidSmartFormTimeString(v) {
    return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  }
  function isValidSmartFormPriority(v) {
    return v === 'alta' || v === 'media' || v === 'baja';
  }
  function isValidSmartFormEstimatedMinutes(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  }

  /** Devuelve `value` tal cual si pasa `validator`, o `undefined` en
   * cualquier otro caso (ausente, null, tipo incorrecto, formato
   * inválido) — nunca fabrica un valor por defecto. */
  function pickValidSmartFormField(value, validator) {
    return (value !== undefined && value !== null && validator(value)) ? value : undefined;
  }

  /** Punto de entrada de AI-2.2. `intent` es el objeto que ya devuelve
   * detectSmartFormIntent() (AI-2.1) — nunca se modifica, solo se lee.
   * `context` (opcional) permite complementar con datos EXPLÍCITOS ya
   * conocidos por quien llama (p.ej. una prioridad/categoría que el
   * propio chat ya hubiera confirmado por otra vía) — nunca se usa para
   * inventar nada: cada campo se valida igual, venga de `intent.fields`
   * o de `context`, y `intent.fields` manda si ambos lo traen.
   * Devuelve `null` si `intent` no es un formulario pendiente válido
   * (null, sin `type`, o `type` distinto de 'event'/'task'). Si es
   * válido, devuelve un objeto NUEVO (nunca el mismo `intent.fields`
   * por referencia) con únicamente los campos presentes y válidos:
   *   event: { type, title?, date?, time? }
   *   task:  { type, title?, date?, time?, priority?, estimatedMinutes?, categoryId? }
   * Ningún campo aparece si no estaba ya presente y era válido — nunca
   * "undefined"/"null" como valor, nunca una fecha/hora/prioridad
   * inventada. */
  function buildSmartFormPrefill(intent, context) {
    if (!intent || typeof intent !== 'object') return null;
    if (intent.type !== 'event' && intent.type !== 'task') return null;
    const fields = (intent.fields && typeof intent.fields === 'object') ? intent.fields : {};
    const ctx = (context && typeof context === 'object') ? context : {};

    const prefill = { type: intent.type };
    const title = pickValidSmartFormField(fields.title, isValidSmartFormString) ?? pickValidSmartFormField(ctx.title, isValidSmartFormString);
    const date = pickValidSmartFormField(fields.date, isValidSmartFormDateString) ?? pickValidSmartFormField(ctx.date, isValidSmartFormDateString);
    const time = pickValidSmartFormField(fields.time, isValidSmartFormTimeString) ?? pickValidSmartFormField(ctx.time, isValidSmartFormTimeString);
    if (title !== undefined) prefill.title = title;
    if (date !== undefined) prefill.date = date;
    if (time !== undefined) prefill.time = time;

    // Solo las tareas admiten priority/estimatedMinutes/categoryId en su
    // prefill normalizado (ver "Reglas" de AI-2.2): el de eventos se
    // limita a title/date/time a propósito — endDate/endTime/allDay/
    // categoryId/location/notes/recurrence/reminder nunca se inventan
    // para un evento, ni siquiera si `context` los trajera.
    if (intent.type === 'task') {
      const priority = pickValidSmartFormField(fields.priority, isValidSmartFormPriority) ?? pickValidSmartFormField(ctx.priority, isValidSmartFormPriority);
      const estimatedMinutes = pickValidSmartFormField(fields.estimatedMinutes, isValidSmartFormEstimatedMinutes) ?? pickValidSmartFormField(ctx.estimatedMinutes, isValidSmartFormEstimatedMinutes);
      const categoryId = pickValidSmartFormField(fields.categoryId, isValidSmartFormString) ?? pickValidSmartFormField(ctx.categoryId, isValidSmartFormString);
      if (priority !== undefined) prefill.priority = priority;
      if (estimatedMinutes !== undefined) prefill.estimatedMinutes = estimatedMinutes;
      if (categoryId !== undefined) prefill.categoryId = categoryId;
    }

    return prefill;
  }

  /* ==================================================================
     AI-2.6 — Aclaraciones inteligentes cuando falten datos
     Capa de VALIDACIÓN pura entre AI-2.1/AI-2.2 (detección + prefill) y
     AI-2.3 (abrir el modal): decide si falta algún dato REALMENTE
     necesario para interpretar con certeza qué formulario abrir y con
     qué — nunca inventa el dato que falta, solo devuelve una pregunta
     breve para que el chat se la haga al usuario ANTES de abrir nada.
     No modifica `intent` (solo lo lee), no toca `state`, no toca el
     DOM, no persiste nada, no llama a Scheduler/reminders/recurrence/
     propuestas IA, no llama a la IA (callAI) ni crea tareas/eventos.
     Reutiliza SIN duplicar: intent.missingFields ya calculado por AI-2.1
     (detectSmartFormIntent) para eventos, e isCancelMessage/isMoveMessage/
     isPriorityChangeMessage (AI-1.5) e isHolidayMessage/isAppointmentMessage/
     hasEventNounFragment (AI-1.3/AI-2.1) e isTaskMessage/hasTaskVerbFragment
     (AI-1.4/AI-2.1) para el caso en que AI-2.1 no haya devuelto ningún
     "formulario pendiente" (intent null) — ningún parser ni clasificación
     nuevos, solo se combinan los ya existentes con un criterio distinto.

     Regla fundamental (sección 1 del encargo): distingue dato REALMENTE
     necesario (bloquea identificar qué quiere el usuario — para eventos,
     la FECHA) de dato opcional (hora, prioridad, duración, categoría,
     recordatorio, ubicación, notas — el formulario ya funciona sin
     ellos, así que nunca se pregunta por ellos aquí). La fecha de una
     TAREA tampoco se pregunta nunca (sección 3 del encargo): el usuario
     puede completarla luego en el formulario.

     Casos con intent NO null (ya es 'event' o 'task'): el título nunca
     falta aquí — si faltara, detectSmartFormIntent ya habría devuelto
     null en vez de un intent con type (ver AI-2.1, `if (!title) return
     null;`) — así que solo queda comprobar la fecha del evento.

     Casos con intent null: puede ser (a) un comentario/mensaje sin
     acción, (b) un mensaje de mover/cancelar/repriorizar ya resuelto por
     AI-1.5 (nunca debe generar Smart Form ni aclaración: sección 12,
     casos "Modificación"/"Cancelación"), (c) un mensaje con señales de
     evento Y de tarea a la vez (contradictorias: ni AI-2.1 ni aquí se
     adivina, se pregunta), o (d) un mensaje ambiguo que sí parece pedir
     apuntar algo pero sin decir claramente el qué ("Lo de mañana", "Eso
     del jueves", "Apúntame lo de Juan": una referencia demostrativa
     vaga — "lo de"/"eso de"/"esto de" — sin ningún sustantivo de cita ni
     verbo de tarea reconocible). Solo (c) y (d) generan aclaración; (a) y
     (b) siguen devolviendo `null` (sin preguntar nada). */

  /** true si el mensaje usa una referencia demostrativa vaga ("lo de...",
   * "eso del...", "esto de...") sin decir qué es "lo"/"eso"/"esto" —
   * patrón léxico simple, pensado solo para los mensajes ambiguos del
   * encargo (sección 5): "Lo de mañana", "Eso del jueves", "Apúntame lo
   * de Juan". No intenta adivinar a qué se refiere, solo detecta que la
   * referencia está ahí sin resolver. */
  function isVagueReferenceMessage(message) {
    const m = String(message || '').toLowerCase();
    return /\b(lo|eso|esto)\s+del?\b/.test(m);
  }

  /** Punto de entrada de AI-2.6. `intent` es el objeto que ya devuelve
   * detectSmartFormIntent() (AI-2.1), o `null` si no detectó ningún
   * formulario pendiente — nunca se modifica, solo se lee. `context`
   * (opcional) puede traer `message` (el texto original del usuario,
   * necesario para el caso (c)/(d) de arriba cuando `intent` es null: si
   * no se pasa, esos casos simplemente no generan aclaración, nunca se
   * inventa una pregunta a partir de nada). Devuelve `null` si no hace
   * falta aclaración, o un objeto NUEVO `{ field, question }` si sí hace
   * falta — nunca reutiliza ni modifica ningún objeto de entrada. */
  function getSmartFormClarification(intent, context) {
    const ctx = (context && typeof context === 'object') ? context : {};
    const message = typeof ctx.message === 'string' ? ctx.message : '';

    if (intent && typeof intent === 'object' && (intent.type === 'event' || intent.type === 'task')) {
      if (intent.type === 'event') {
        const missing = Array.isArray(intent.missingFields) ? intent.missingFields : [];
        if (missing.includes('date')) {
          return { field: 'date', question: '¿Qué día es el evento?' };
        }
      }
      // 'task': ni fecha ni hora son obligatorias para abrir el
      // formulario (sección 3/4 del encargo) — se completan luego ahí.
      return null;
    }

    // intent null: nunca preguntar sobre un mensaje de mover/cancelar/
    // repriorizar (eso ya lo resuelve AI-1.5 por su cuenta) ni sobre un
    // comentario sin ninguna señal reconocible.
    if (!message.trim()) return null;
    if (isCancelMessage(message) || isMoveMessage(message) || isPriorityChangeMessage(message)) return null;

    const eventSignal = isHolidayMessage(message) || isAppointmentMessage(message) || hasEventNounFragment(message);
    const taskSignal = isTaskMessage(message) || hasTaskVerbFragment(message);
    if (eventSignal && taskSignal) {
      return { field: 'type', question: '¿Es una tarea o un evento?' };
    }
    if (isVagueReferenceMessage(message)) {
      return { field: 'target', question: '¿Qué quieres apuntar?' };
    }
    return null;
  }

  /* ==================================================================
     AI-2.8 — Protección contra duplicados en Smart Forms
     Capa de COMPARACIÓN pura, sin estado propio: decide si una propuesta
     de Smart Form (lo que se va a enviar de verdad — título/fecha/hora
     ya editados a mano si el usuario los cambió, NUNCA el intent
     original de AI-2.1/prefill de AI-2.2, ver AI-2.2 y el comentario de
     `smartFormOrigin` en openTaskModal/openEventModal de organizator.html)
     corresponde a una tarea/evento que YA EXISTE en `state.tasks`/
     `state.events` — para que el submit real (openTaskModal/openEventModal,
     UX-8/AI-2.4) pueda evitar crear un segundo elemento equivalente.
     No modifica `state`, no toca el DOM, no persiste nada, no llama a
     Scheduler/reminders/recurrence/propuestas IA, no llama a la IA
     (callAI) ni crea/borra tareas/eventos por su cuenta: solo COMPARA y
     devuelve el elemento existente equivalente (o null). La decisión de
     qué hacer con ese resultado (bloquear el submit, avisar al usuario)
     es responsabilidad de quien llama, no de este bloque.
     No busca por posición/índice de array: recorre el contenido de
     `state.tasks`/`state.events` completo, en cualquier orden, buscando
     una coincidencia semántica — nunca asume que el "mismo mensaje
     procesado dos veces" produce el elemento en la misma posición.
     No reimplementa ningún parser de fecha/hora (usa tal cual los
     valores YA resueltos que trae la propuesta, igual que AI-2.2) ni
     ninguna clasificación tarea/evento nueva. */

  /** Normaliza un título para comparar por CONTENIDO tolerando
   * diferencias superficiales de whitespace/mayúsculas (sección 2 del
   * encargo): recorta espacios al principio/final, colapsa espacios
   * repetidos (o cualquier otro whitespace, tabs/saltos de línea
   * incluidos) a uno solo, y pasa a minúsculas. Deliberadamente NO hace
   * nada más agresivo (no quita acentos, signos de puntuación ni
   * palabras): eso cambiaría el significado del título, algo que el
   * encargo pide explícitamente evitar. */
  function normalizeSmartFormTitle(title) {
    return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /** Compara dos valores opcionales ya normalizados (fecha 'YYYY-MM-DD'
   * u hora 'HH:MM', o ausentes/null/''): iguales solo si AMBOS están
   * ausentes, o si ambos están presentes y son idénticos. Si solo uno de
   * los dos trae valor, se consideran DISTINTOS — un dato ausente nunca
   * "coincide" con uno presente, así que nunca se adivina una
   * coincidencia a partir de información que falta en un solo lado. */
  function smartFormOptionalFieldsMatch(a, b) {
    const av = (a === undefined || a === null || a === '') ? null : a;
    const bv = (b === undefined || b === null || b === '') ? null : b;
    if (av === null && bv === null) return true;
    if (av === null || bv === null) return false;
    return av === bv;
  }

  /** Aplana una propuesta de Smart Form (o un task/event ya existente,
   * ver smartFormCandidateFromExistingItem más abajo) a la forma mínima
   * que se compara: { type, title, date, time, [allDay] } — `allDay`
   * solo se incluye (y solo importa) para eventos, tal como pide la
   * sección 1 del encargo ("para eventos, respetar también allDay si
   * forma parte del contexto disponible"); si `raw.allDay` no viene
   * dado, se trata como `false` (nunca como "desconocido"), igual que ya
   * hace siempre el propio formulario de evento (el checkbox "Todo el
   * día" es booleano, nunca ambiguo). Devuelve `null` si no hay un
   * título utilizable tras normalizar (nunca compara un candidato vacío
   * contra nada). */
  function smartFormCandidateFromRaw(raw) {
    if (!raw || (raw.type !== 'task' && raw.type !== 'event')) return null;
    const title = normalizeSmartFormTitle(raw.title);
    if (!title) return null;
    const candidate = {
      type: raw.type,
      title,
      date: (raw.date && String(raw.date).trim()) || null,
      time: (raw.time && String(raw.time).trim()) || null,
    };
    if (raw.type === 'event') candidate.allDay = !!raw.allDay;
    return candidate;
  }

  /** Mismo aplanado que smartFormCandidateFromRaw, pero leyendo los
   * nombres de campo REALES del modelo de datos ya existente (nunca
   * cambia esa estructura, solo la lee): tareas usan `dueDate`/
   * `dueTime`, eventos usan `date`/`startTime`/`allDay` — ver
   * ACTION_SCHEMA y buildActionContext más abajo, que ya usan estos
   * mismos nombres. */
  function smartFormCandidateFromExistingItem(type, item) {
    if (type === 'task') {
      return smartFormCandidateFromRaw({ type: 'task', title: item.title, date: item.dueDate, time: item.dueTime });
    }
    return smartFormCandidateFromRaw({ type: 'event', title: item.title, date: item.date, time: item.startTime, allDay: item.allDay });
  }

  /** Punto de entrada de AI-2.8. `raw` es la propuesta FINAL de Smart
   * Form tal como se va a enviar — la fuente de verdad sigue siendo
   * siempre lo que hay en el formulario (sección 8 del encargo), nunca
   * el intent/prefill original: `{ type: 'task'|'event', title, date,
   * time, allDay }` (allDay solo se usa para eventos). `existing` es
   * `{ tasks, events }` (normalmente `state.tasks`/`state.events`
   * reales) — nunca se modifica aquí, solo se lee. Devuelve el elemento
   * existente equivalente si lo hay (comparando por título normalizado +
   * fecha/hora, y allDay para eventos — ver smartFormCandidateFromRaw),
   * o `null` si no hay ningún duplicado, incluyendo cuando `existing` no
   * trae ninguna tarea/evento todavía. Es determinista: la misma entrada
   * siempre da el mismo resultado, sin depender del orden de los
   * arrays. */
  function findExistingSmartFormEquivalent(raw, existing) {
    const candidate = smartFormCandidateFromRaw(raw);
    if (!candidate) return null;
    const ex = (existing && typeof existing === 'object') ? existing : {};
    const pool = candidate.type === 'task' ? ex.tasks : ex.events;
    if (!Array.isArray(pool)) return null;
    for (const item of pool) {
      const itemCandidate = smartFormCandidateFromExistingItem(candidate.type, item);
      if (!itemCandidate) continue;
      if (itemCandidate.title !== candidate.title) continue;
      if (!smartFormOptionalFieldsMatch(candidate.date, itemCandidate.date)) continue;
      if (!smartFormOptionalFieldsMatch(candidate.time, itemCandidate.time)) continue;
      if (candidate.type === 'event' && candidate.allDay !== itemCandidate.allDay) continue;
      return item;
    }
    return null;
  }

  /* ==================================================================
     AI-3.1 — Definir intención de planificación
     Capa de DETECCIÓN pura, sin estado propio: decide si un mensaje del
     usuario expresa una intención de PLANIFICAR/ORGANIZAR trabajo en el
     calendario (repartir tareas pendientes, sacar huecos, hacerse un
     horario...), sin analizar todavía huecos reales del calendario, sin
     recoger restricciones detalladas, sin generar propuestas y sin
     crear/mover/cancelar nada — eso es responsabilidad de fases
     posteriores de AI-3 (AI-3.2 en adelante), que consumirán este
     helper sin que él sepa nada de ellas. No modifica `state`, no toca
     el DOM, no llama a callAI, no llama a Scheduler, no toca el sistema
     de batches ni recordatorios, no abre Smart Forms.
     Reutiliza SIN duplicar: isCancelMessage/isMoveMessage/
     isPriorityChangeMessage (AI-1.5, mismas funciones, no una copia)
     para no robarle a AI-1.5 ningún mensaje de mover/cancelar/
     repriorizar claro (sección 6 del encargo: "no rompas la precedencia
     actual de AI-1.5") — nunca se reimplementa esa clasificación aquí.
     No repite ningún parser de fechas/horas de AI-1.2: esta fase no
     necesita resolver NINGUNA fecha todavía (eso, si hace falta, lo hará
     una fase posterior), así que no se llama a resolveDateExpression/
     resolveTimeExpression en absoluto.
     ================================================================== */

  // Raíces de verbos de planificación EXPLÍCITOS (sección 2 del
  // encargo), reconocidas por su raíz común para cubrir imperativo con
  // clítico ("organízame", "planifícame"), infinitivo ("organizar",
  // "planificar", "distribuir", "repartir") y primera persona
  // ("organizo") con una sola expresión cada una — la vocal con tilde
  // cambia según la conjugación (organízame/planifícame llevan tilde por
  // el clítico "-me", el resto no), así que se acepta [ií]/[uú] en esa
  // posición en vez de un \b ciego que solo reconociera una de las dos
  // formas (mismo motivo por el que AI-2.1 ya tuvo que dejar de usar \b
  // a secas con "quizá" — ver hasUncertaintyMarker).
  const PLANNING_VERB_STEMS = [
    /\borgan[ií]z\w*/i,
    /\bplanif[ií]c\w*/i,
    /\bdistrib[uú]\w*/i,
    /\brepart\w*/i,
  ];
  // Frases de planificación explícitas que no encajan en una sola raíz
  // de verbo (pedidas explícitamente por la sección 2 del encargo):
  // "hazme/quiero/necesito un plan", "ponme/quiero/necesito un
  // horario", "sacar tiempo (para...)", "encontrar/buscar huecos".
  const PLANNING_PHRASES = [
    /\b(?:hazme|haz|quiero|necesito)\s+un\s+plan\b/i,
    /\b(?:ponme|pon|quiero|necesito)\s+un\s+horario\b/i,
    /\bsacar\s+tiempo\b/i,
    /\b(?:encontrar|buscar)\s+huecos?\b/i,
  ];

  /** true si el mensaje contiene alguna raíz de verbo o frase de
   * planificación EXPLÍCITA (ver arriba) — la señal más fuerte que
   * reconoce esta fase, siempre produce confidence "high" en
   * detectPlanningIntent(). */
  function hasExplicitPlanningPhrase(message) {
    const m = String(message || '').toLowerCase();
    return PLANNING_VERB_STEMS.some(re => re.test(m)) || PLANNING_PHRASES.some(re => re.test(m));
  }

  // Sobrecarga de trabajo/tiempo expresada en primera persona (sección 4
  // del encargo): por sí sola NUNCA basta ("tengo mucho trabajo" no es
  // planning, sección 3/5) — solo se combina con una petición de ayuda
  // clara (ver HELP_REQUEST_MARKERS) para producir una señal MÁS DÉBIL
  // que hasExplicitPlanningPhrase (confidence "medium"), pensada para
  // mensajes que piden ayuda genérica sin usar ninguno de los verbos de
  // PLANNING_VERB_STEMS/PLANNING_PHRASES.
  const WORKLOAD_MARKERS = [
    /\btengo\s+(?:mucho|mucha|muchos|muchas|demasiad[oa]s?|\d+)\s+(?:trabajo|tareas?|cosas?)\b/i,
    /\btengo\s+(?:trabajo|tareas?|cosas?)\s+pendientes?\b/i,
  ];
  // Peticiones de ayuda genéricas (sin especificar el verbo de
  // planificación) — "ayúdame" a secas, o una pregunta directa de tipo
  // "¿cómo lo organizo/reparto/distribuyo?". Este último patrón ya
  // contiene una raíz de PLANNING_VERB_STEMS (así que en la práctica
  // hasExplicitPlanningPhrase ya lo detectaría primero, con confidence
  // "high"); se deja aquí también por claridad y para no depender del
  // orden de evaluación si una fase futura reutiliza este helper suelto.
  const HELP_REQUEST_MARKERS = [
    /\bay[uú]dame\b/i,
    /\bc[oó]mo\s+(?:lo|los|la|las)?\s*(?:organizo|reparto|distribuyo)\b/i,
  ];

  /** true si el mensaje combina una queja de sobrecarga de trabajo/
   * tiempo (WORKLOAD_MARKERS) con una petición de ayuda genérica
   * (HELP_REQUEST_MARKERS) — señal de planificación MÁS DÉBIL que
   * hasExplicitPlanningPhrase, nunca se activa con la queja sola. */
  function hasWorkloadWithHelpRequest(message) {
    const m = String(message || '').toLowerCase();
    return WORKLOAD_MARKERS.some(re => re.test(m)) && HELP_REQUEST_MARKERS.some(re => re.test(m));
  }

  /** Punto de entrada de AI-3.1. Devuelve `null` si `message` no
   * representa con suficiente claridad una intención de PLANIFICAR/
   * ORGANIZAR trabajo en el calendario (comentarios vagos, preguntas
   * sin petición clara, o cualquier mensaje que ya resuelve mejor otra
   * fase existente — creación normal de AI-1/AI-2, o una modificación/
   * cancelación clara de AI-1.5, que esta función nunca le "roba" a
   * AI-1.5 — ver guarda de abajo). Si sí hay intención clara, devuelve:
   *   { type: 'planning', sourceText: message, confidence: 'high'|'medium' }
   * Es una función PURA: no lee `state`, no toca el DOM, no llama a
   * callAI, no crea ni modifica ninguna tarea/evento, no calcula
   * fechas/huecos, no genera ninguna propuesta — solo clasifica el
   * TEXTO del mensaje. Determinista: la misma entrada siempre produce
   * la misma salida. */
  function detectPlanningIntent(message, context) {
    if (typeof message !== 'string' || !message.trim()) return null;
    // Sección 6 del encargo: nunca le quita un mensaje a AI-1.5 — un
    // "mueve el examen al viernes" o un "cancela el examen de biología"
    // siguen siendo, respectivamente, una modificación/cancelación
    // clara, nunca una intención de planificación nueva, aunque
    // compartieran alguna palabra por casualidad con las de arriba.
    if (isCancelMessage(message) || isMoveMessage(message) || isPriorityChangeMessage(message)) return null;

    if (hasExplicitPlanningPhrase(message)) {
      return { type: 'planning', sourceText: message, confidence: 'high' };
    }
    if (hasWorkloadWithHelpRequest(message)) {
      return { type: 'planning', sourceText: message, confidence: 'medium' };
    }
    return null;
  }

  /* ==================================================================
     AI-3.2 — Recoger restricciones de planificación
     Capa de EXTRACCIÓN pura, sin estado propio: una vez AI-3.1
     (detectPlanningIntent) ya decidió que un mensaje expresa intención
     de planificar, este bloque recoge del TEXTO las restricciones que
     condicionarán esa planificación (fechas, días de la semana, franja
     horaria preferida, disponibilidad diaria, duración máxima de
     sesión, prioridad, tareas referenciadas, fechas excluidas y
     cualquier otra restricción relevante sin campo estructurado propio
     todavía). Esta fase NO planifica, NO busca huecos reales del
     calendario, NO genera ninguna propuesta, NO crea/mueve/edita/
     cancela nada, NO toca Scheduler, NO toca el sistema de batches, NO
     toca recordatorios, NO abre Smart Forms — eso es AI-3.3 en
     adelante, que consumirá el objeto que devuelve este helper sin que
     él sepa nada de ellas.
     Reutiliza SIN duplicar: resolveDateExpression/resolveRelativeDate/
     resolveWeekdayDate/resolveNumericDayOnly/resolveTimeExpression y
     los helpers de fecha puros (parseYMDLocal/formatYMDLocal/
     addDaysLocal/isValidCalendarDate/pad2) de AI-1.2, WEEKDAY_NAMES_ES
     (AI-1.2) e isPriorityChangeMessage (AI-1.5) — ninguno se
     reimplementa aquí. normalizeSmartFormTitle (AI-2.8) se reutiliza
     tal cual para comparar el título de una tarea existente contra el
     mensaje sin inventar un segundo comparador de texto.
     No lee `state`, no toca el DOM, no llama a callAI/Scheduler, no usa
     el sistema de batches, no abre Smart Forms, no modifica
     `context.tasks`/`context.events` (solo los LEE), no modifica
     ACTION_SCHEMA ni ningún formato de acción existente. Determinista:
     la misma entrada siempre produce la misma salida. */

  // Mismo orden que recurrence.daysOfWeek ya usa en toda la app (0=Lunes
  // .. 6=Domingo — ver R-5.1 en organizator.html, DOW_SHORT/
  // DOW_FULL_MONFIRST) — a propósito DISTINTO del orden de
  // WEEKDAY_NAMES_ES de AI-1.2 (0=domingo..6=sábado, el mismo que
  // Date.prototype.getDay(), usado solo para resolver FECHAS con
  // resolveWeekdayDate/resolveDateExpression, nunca para daysOfWeek). No
  // se reutiliza WEEKDAY_NAMES_ES para esta numeración a propósito: son
  // dos convenciones numéricas distintas para el mismo nombre de día, y
  // mezclarlas sería justo el bug que la sección 3 del encargo pide
  // evitar ("usa la misma convención numérica existente en
  // recurrence.daysOfWeek — NO inventes otra numeración").
  const WEEKDAY_NAMES_MONFIRST_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  // "entre <día> y <día>" (sección 2 del encargo): rango de FECHA
  // concreto de una sola semana — compartido entre
  // extractDateRangeConstraint (que lo resuelve a dateFrom/dateTo) y
  // extractDaysOfWeekConstraint (que lo DESCARTA antes de su barrido
  // suelto de días, para no duplicar esos mismos dos días como si
  // fueran también una preferencia recurrente de días de la semana —
  // ver "No confundas daysOfWeek con dateFrom/dateTo", sección 3).
  const WEEKDAY_RANGE_ENTRE_Y_RE = /\bentre\s+(?:domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\s+y\s+(?:domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/gi;
  // "hasta X" / "desde X" (sección 2 del encargo) — regexes compartidas
  // entre extractDateRangeConstraint (que las resuelve a un límite de
  // dateFrom/dateTo) y extractDaysOfWeekConstraint/extractExclusions
  // (que las descartan del texto antes de sus propios barridos, por el
  // mismo motivo que WEEKDAY_RANGE_ENTRE_Y_RE de arriba: un día de la
  // semana mencionado solo para acotar una fecha — "hasta el viernes" —
  // nunca debe colarse también como una preferencia recurrente de
  // daysOfWeek).
  const HASTA_CLAUSE_RE = /\bhasta\s+el\s+[a-záéíóúñ0-9]+(?:\s+de\s+[a-záéíóúñ]+)?\b/gi;
  const DESDE_CLAUSE_RE = /\bdesde\s+(?:el\s+)?[a-záéíóúñ0-9]+(?:\s+de\s+[a-záéíóúñ]+)?\b/gi;
  // Frases de exclusión reconocidas (sección 9 del encargo) — declaradas
  // aquí arriba (en vez de junto a extractExclusions, más abajo) porque
  // extractDateRangeConstraint y extractDaysOfWeekConstraint TAMBIÉN
  // las necesitan para descartar su texto: "no puedo el martes" o
  // "excepto el 15" son restricciones NEGATIVAS (justo lo contrario de
  // lo que pide el usuario) y nunca deben interpretarse como que el
  // propio día/fecha mencionado ahí es un dateFrom/dateTo o un
  // daysOfWeek positivos — esa es la única función de
  // extractExclusions, más abajo. SIN flag "g" a propósito: extractExclusions
  // reutiliza estos mismos objetos de regex con `.exec()` en cada
  // llamada (no crea copias) — con "g" arrastrarían `lastIndex` entre
  // llamadas sucesivas y dejarían de encontrar coincidencias que sí
  // están ahí. stripAllMatches (más abajo) construye su propia copia
  // con "g" cada vez que necesita `.replace()`, así que no hace falta
  // que estas lo tengan ya puesto.
  const EXCLUSION_PATTERNS = [
    /\bno\s+puedo\s+el\s+[a-záéíóúñ0-9]+(?:\s+de\s+[a-záéíóúñ]+)?/i,
    /\bel\s+[a-záéíóúñ0-9]+\s+no\s+puedo\b/i,
    /\bexcepto\s+el\s+[a-záéíóúñ0-9]+(?:\s+de\s+[a-záéíóúñ]+)?/i,
    /\bno\s+tengo\s+tiempo\s+el\s+[a-záéíóúñ0-9]+(?:\s+de\s+[a-záéíóúñ]+)?/i,
  ];

  function dedupeSortNumbers(arr) {
    return [...new Set(arr)].sort((a, b) => a - b);
  }

  /** Quita TODAS las apariciones de `re` en `text` (fuerza el flag "g",
   * cualesquiera que sean los flags de `re`, así las mismas regexes
   * declaradas arriba sirven tanto para detectar con `.exec()` — sin
   * "g", para no arrastrar estado entre llamadas — como para limpiar
   * con `.replace()` aquí, sin duplicar ningún patrón). */
  function stripAllMatches(text, re) {
    return String(text || '').replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), ' ');
  }

  /** 'YYYY-MM-DD' del lunes de la semana (lunes-domingo) que contiene
   * `dateStr` — reutiliza parseYMDLocal/addDaysLocal (AI-1.2) tal cual,
   * no reimplementa el cálculo de fecha en sí, solo compone el
   * desplazamiento a partir de Date.prototype.getDay() (0=domingo..
   * 6=sábado, igual que WEEKDAY_NAMES_ES). Devuelve null si `dateStr`
   * no es una fecha válida. */
  function mondayOfWeekContaining(dateStr) {
    const d = parseYMDLocal(dateStr);
    if (!d) return null;
    const dow = d.getDay();
    const diffToMonday = dow === 0 ? 6 : dow - 1;
    return addDaysLocal(dateStr, -diffToMonday);
  }

  /** Rango de fechas (sección 2 del encargo): `{ dateFrom, dateTo }`,
   * cada uno 'YYYY-MM-DD' o null. Sin `todayStr` (sin FECHA ACTUAL de
   * referencia) nunca resuelve nada — mismo criterio que AI-1.2, nunca
   * `new Date()` como sustituto. Prueba, en orden de especificidad,
   * "la semana que viene"/"esta semana" (semana completa lunes-domingo,
   * compuesta a partir de mondayOfWeekContaining + addDaysLocal),
   * "entre <día> y <día>" (misma semana, primer día resuelto con
   * resolveWeekdayDate de AI-1.2 y el segundo derivado por diferencia
   * de índice — nunca resuelto por separado, para no acabar en semanas
   * distintas), "del N al M" (ambos días del mismo mes/año, anclado al
   * mes/año que ya resolvió resolveNumericDayOnly para el primero),
   * "hasta X" (solo límite superior) y "desde X" (solo límite inferior)
   * — y, si nada de eso encaja, cae a una única fecha concreta ya
   * soportada por AI-1.2 (resolveDateExpression), con dateFrom=dateTo. */
  function extractDateRangeConstraint(message, todayStr) {
    const m = String(message || '').toLowerCase();
    if (!todayStr) return { dateFrom: null, dateTo: null };

    if (/\bla\s+semana\s+que\s+viene\b/.test(m) || /\bpr[oó]xima\s+semana\b/.test(m)) {
      const thisMonday = mondayOfWeekContaining(todayStr);
      const nextMonday = thisMonday ? addDaysLocal(thisMonday, 7) : null;
      if (nextMonday) return { dateFrom: nextMonday, dateTo: addDaysLocal(nextMonday, 6) };
    }
    if (/\besta\s+semana\b/.test(m)) {
      const monday = mondayOfWeekContaining(todayStr);
      if (monday) return { dateFrom: monday, dateTo: addDaysLocal(monday, 6) };
    }

    const entreMatch = /\bentre\s+(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\s+y\s+(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/.exec(m);
    if (entreMatch) {
      const startIdx = WEEKDAY_NAMES_ES.indexOf(entreMatch[1]);
      const endIdx = WEEKDAY_NAMES_ES.indexOf(entreMatch[2]);
      const startDate = resolveWeekdayDate(entreMatch[1], todayStr);
      if (startDate && startIdx !== -1 && endIdx !== -1) {
        const diff = (endIdx - startIdx + 7) % 7;
        return { dateFrom: startDate, dateTo: addDaysLocal(startDate, diff) };
      }
    }

    const delAlMatch = /\bdel\s+(\d{1,2})\s+al\s+(\d{1,2})\b/.exec(m);
    if (delAlMatch) {
      const dayTo = Number(delAlMatch[2]);
      const dateFrom = resolveNumericDayOnly(`el ${delAlMatch[1]}`, todayStr);
      if (dateFrom) {
        const [y, mo] = dateFrom.split('-').map(Number);
        const candidate = `${y}-${pad2(mo)}-${pad2(dayTo)}`;
        const dateTo = isValidCalendarDate(y, mo, dayTo) && candidate >= dateFrom ? candidate : dateFrom;
        return { dateFrom, dateTo };
      }
    }

    const hastaMatch = new RegExp(HASTA_CLAUSE_RE.source, 'i').exec(m);
    if (hastaMatch) {
      const dateTo = resolveDateExpression(hastaMatch[0], todayStr);
      if (dateTo) return { dateFrom: null, dateTo };
    }

    const desdeMatch = new RegExp(DESDE_CLAUSE_RE.source, 'i').exec(m);
    if (desdeMatch) {
      const dateFrom = resolveDateExpression(desdeMatch[0], todayStr);
      if (dateFrom) return { dateFrom, dateTo: null };
    }

    // Fallback: una única fecha concreta ya soportada por AI-1.2
    // (resolveDateExpression) — pero NUNCA a partir del texto de una
    // cláusula de EXCLUSIÓN (sección 9): "excepto el viernes" o "no
    // puedo el martes" son justo lo contrario de pedir esa fecha, así
    // que se descartan aquí antes de intentar resolver nada (esa
    // información ya la recoge, por separado, extractExclusions más
    // abajo, en excludedDates/notes).
    let cleanedForFallback = message;
    EXCLUSION_PATTERNS.forEach(re => { cleanedForFallback = stripAllMatches(cleanedForFallback, re); });
    const single = resolveDateExpression(cleanedForFallback, todayStr);
    if (single) return { dateFrom: single, dateTo: single };

    return { dateFrom: null, dateTo: null };
  }

  /** Días de la semana (sección 3 del encargo): array de números 0-6
   * (convención recurrence.daysOfWeek, ver WEEKDAY_NAMES_MONFIRST_ES
   * arriba), sin duplicados y en orden ascendente determinista.
   * "todos los días laborables" -> [0,1,2,3,4] (lunes a viernes).
   * "de <día> a <día>" -> el rango RECURRENTE completo entre ambos
   * (distinto de "entre <día> y <día>", que la sección 2 trata como un
   * rango de FECHA concreto de una sola semana, nunca como un patrón
   * semanal — por eso ese tramo se descarta del mensaje antes del
   * barrido suelto de más abajo, para no duplicar esos mismos dos días
   * aquí). Si no hay "de...a..." ni "laborables", recoge cualquier
   * nombre de día suelto mencionado ("lunes y miércoles", "martes por
   * la tarde"...). Devuelve [] si no se menciona ningún día. */
  function extractDaysOfWeekConstraint(message) {
    const m = String(message || '').toLowerCase();
    if (/\bd[ií]as\s+laborables\b/.test(m)) return [0, 1, 2, 3, 4];

    const rangeMatch = /\bde\s+(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\s+a\s+(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/.exec(m);
    if (rangeMatch) {
      const startIdx = WEEKDAY_NAMES_MONFIRST_ES.indexOf(rangeMatch[1]);
      const endIdx = WEEKDAY_NAMES_MONFIRST_ES.indexOf(rangeMatch[2]);
      if (startIdx !== -1 && endIdx !== -1) {
        const days = [];
        let i = startIdx;
        for (let steps = 0; steps <= 6; steps++) {
          days.push(i);
          if (i === endIdx) break;
          i = (i + 1) % 7;
        }
        return dedupeSortNumbers(days);
      }
    }

    // Descarta, ANTES del barrido suelto, cualquier tramo ya "reclamado"
    // por otra restricción (rango de fecha "entre X y Y", límites
    // "hasta X"/"desde X", o una cláusula de EXCLUSIÓN): el día de la
    // semana que aparece ahí solo acota o excluye una fecha, nunca es
    // además una preferencia recurrente de daysOfWeek — mismo criterio
    // que la fallback de extractDateRangeConstraint de arriba con las
    // exclusiones, aplicado aquí también a "hasta"/"desde".
    let stripped = m;
    [WEEKDAY_RANGE_ENTRE_Y_RE, HASTA_CLAUSE_RE, DESDE_CLAUSE_RE, ...EXCLUSION_PATTERNS].forEach(re => {
      stripped = stripAllMatches(stripped, re);
    });
    const found = [];
    WEEKDAY_NAMES_MONFIRST_ES.forEach((name, idx) => {
      if (new RegExp(`\\b${name}\\b`, 'i').test(stripped)) found.push(idx);
    });
    return dedupeSortNumbers(found);
  }

  // Franjas del día reconocidas (sección 4 del encargo), con sus
  // valores canónicos — comprobadas en este orden fijo (morning,
  // afternoon, night) para que el array resultante salga siempre en el
  // mismo orden determinista, independientemente de en qué orden
  // aparezcan las frases en el mensaje. "por la mañana" exige el prefijo
  // "por la" a propósito (nunca "mañana" suelta): es la misma
  // disambiguación que ya resuelve resolveDayPart/resolveRelativeDate de
  // AI-1.2 para que "mañana" (fecha, día siguiente) nunca se confunda
  // con "por la mañana" (franja del día) — ver el ejemplo explícito del
  // encargo, "mañana por la tarde" -> fecha de mañana + ['afternoon'],
  // nunca ['morning','afternoon']. "al mediodía" se mapea a 'afternoon'
  // (no hay un valor canónico propio de "mediodía" entre los cuatro
  // permitidos; en el uso habitual en español "mediodía" ya linda con
  // el arranque de la tarde).
  const DAY_PART_RULES = [
    { canonical: 'morning', re: /\bpor\s+la\s+ma[ñn]ana\b/i },
    { canonical: 'afternoon', re: /\bpor\s+la\s+tarde\b|\btardes\b|\bal\s+mediod[ií]a\b/i },
    { canonical: 'night', re: /\bpor\s+la\s+noche\b|\bnoches\b/i },
  ];
  // Marcadores de NEGACIÓN sobre una franja del día ("no quiero estudiar
  // por la noche"): si aparecen en el mensaje, se suprime POR COMPLETO
  // la extracción de preferredDayParts (nunca se intenta distinguir qué
  // franja concreta se negó — sección 15 del encargo, "sé
  // conservador": mejor no estructurar nada que estructurar una
  // preferencia CONTRARIA a la que pidió el usuario). La restricción en
  // sí, si coincide con una de las frases reconocidas de la sección 10,
  // se conserva en `notes` (ver extractFreeformNotes).
  const DAY_PART_NEGATION_MARKERS = [/\bno\s+quiero\b/i, /\bno\s+me\s+gusta\b/i, /\bprefiero\s+no\b/i, /\bevit(?:a|ar|o)\b/i];

  function extractPreferredDayParts(message) {
    const m = String(message || '').toLowerCase();
    if (DAY_PART_NEGATION_MARKERS.some(re => re.test(m))) return [];
    const found = [];
    DAY_PART_RULES.forEach(rule => {
      if (rule.re.test(m) && !found.includes(rule.canonical)) found.push(rule.canonical);
    });
    return found;
  }

  // Palabras numéricas en español reconocidas para disponibilidad/
  // duración (secciones 5/6 del encargo) — solo las necesarias para los
  // ejemplos dados ("una hora"), sin ánimo de cubrir todo el sistema
  // numeral español (eso sería adivinar más de lo que el encargo pide).
  const SPANISH_NUMBER_WORDS = { media: 0.5, un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  function parseSpanishNumberToken(tok) {
    const t = String(tok || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SPANISH_NUMBER_WORDS, t)) return SPANISH_NUMBER_WORDS[t];
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function numberAndUnitToMinutes(numTok, unitTok) {
    const num = parseSpanishNumberToken(numTok);
    if (num === null) return null;
    const isHour = /^horas?$/i.test(String(unitTok || ''));
    return Math.round(num * (isHour ? 60 : 1));
  }
  const NUMBER_ALT = '(\\d+(?:[.,]\\d+)?|media|un|una|uno|dos|tres|cuatro|cinco|seis)';
  const UNIT_ALT = '(minutos?|min|horas?)';

  /** Disponibilidad diaria (sección 5 del encargo), en minutos, o null
   * si el mensaje no la indica explícitamente — nunca se inventa. Exige
   * un cualificador de "por día" (al día/diario/diarios/cada día/cada
   * mañana/cada tarde/cada noche) DESPUÉS del número+unidad, para no
   * confundirse con duraciones de una sola sesión (sección 6). */
  function extractAvailableMinutesPerDay(message) {
    const m = String(message || '').toLowerCase();
    const re = new RegExp(`\\b${NUMBER_ALT}\\s*${UNIT_ALT}\\b[^.]*?\\b(?:al\\s+d[ií]a|diarios?|cada\\s+d[ií]a|cada\\s+ma[ñn]ana|cada\\s+tarde|cada\\s+noche)\\b`, 'i');
    const match = re.exec(m);
    return match ? numberAndUnitToMinutes(match[1], match[2]) : null;
  }

  /** Duración máxima de una sesión (sección 6 del encargo), en minutos,
   * o null si no se indica. Reconoce tres formas de la misma idea
   * ("máximo N", "más de N" dentro de una negación de sesiones largas,
   * "N ... como máximo") — nunca se confunde con
   * availableMinutesPerDay (esta función nunca exige un cualificador de
   * "por día", esa nunca acepta "máximo"/"más de"/"como máximo"). */
  function extractMaxSessionMinutes(message) {
    const m = String(message || '').toLowerCase();
    const match =
      new RegExp(`\\bm[aá]ximo\\s+${NUMBER_ALT}\\s*${UNIT_ALT}\\b`, 'i').exec(m) ||
      new RegExp(`\\bm[aá]s\\s+de\\s+${NUMBER_ALT}\\s*${UNIT_ALT}\\b`, 'i').exec(m) ||
      new RegExp(`\\b${NUMBER_ALT}\\s*${UNIT_ALT}\\s+como\\s+m[aá]ximo\\b`, 'i').exec(m) ||
      new RegExp(`\\b${NUMBER_ALT}\\s*${UNIT_ALT}\\s+m[aá]ximo\\b`, 'i').exec(m);
    return match ? numberAndUnitToMinutes(match[1], match[2]) : null;
  }

  // Prioridad global de planificación (sección 7 del encargo) — mapeo
  // EXACTO pedido, comprobado en este orden fijo (si un mensaje
  // coincidiera con más de uno, gana el primero de la lista, siempre el
  // mismo, determinista). "prioridad alta"/"alta prioridad" se añaden a
  // 'urgent' porque son la forma en que la propia app ya nombra la
  // prioridad más alta de una tarea (priority: 'alta', ver R-1) — el
  // valor canónico más cercano de los cuatro permitidos.
  const PRIORITY_RULES = [
    { canonical: 'urgent', res: [/\burgentes?\b/i, /\bprioridad\s+alta\b/i, /\balta\s+prioridad\b/i] },
    { canonical: 'important', res: [/\bimportantes?\b/i] },
    { canonical: 'shortest', res: [/\blo\s+m[aá]s\s+corto\b/i, /\btareas?\s+cortas?\s+primero\b/i] },
    { canonical: 'earliest', res: [/\blo\s+antes\s+posible\b/i, /\bcuanto\s+antes\b/i] },
  ];
  function extractPriorityConstraint(message) {
    const m = String(message || '').toLowerCase();
    const rule = PRIORITY_RULES.find(r => r.res.some(re => re.test(m)));
    return rule ? rule.canonical : null;
  }

  /** Tareas referenciadas (sección 8 del encargo): compara, con
   * normalizeSmartFormTitle (AI-2.8, reutilizado tal cual — mismo
   * comparador de texto que ya usa la protección de duplicados, no se
   * inventa un segundo), el título de cada tarea de `tasks` contra el
   * propio mensaje — solo entra en `taskIds` cuando el título
   * normalizado de la tarea aparece LITERALMENTE dentro del mensaje
   * normalizado (correspondencia clara, nunca una adivinanza por
   * palabras sueltas). Nunca se basa en la posición del array: el
   * resultado se ordena alfabéticamente por id, así que el orden de
   * `tasks` no afecta al resultado. Nunca modifica `tasks`. */
  function extractReferencedTaskIds(message, tasks) {
    if (!Array.isArray(tasks) || !tasks.length) return [];
    const normalizedMessage = normalizeSmartFormTitle(message);
    if (!normalizedMessage) return [];
    const ids = [];
    for (const t of tasks) {
      if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.title !== 'string') continue;
      const normalizedTitle = normalizeSmartFormTitle(t.title);
      if (normalizedTitle && normalizedMessage.includes(normalizedTitle) && !ids.includes(t.id)) {
        ids.push(t.id);
      }
    }
    return ids.sort();
  }

  // EXCLUSION_PATTERNS ya está declarada más arriba (la reutilizan
  // también extractDateRangeConstraint/extractDaysOfWeekConstraint —
  // ver comentario junto a su declaración).
  const WEEKDAY_EN_BY_ES = { domingo: 'Sunday', lunes: 'Monday', martes: 'Tuesday', miércoles: 'Wednesday', jueves: 'Thursday', viernes: 'Friday', sábado: 'Saturday' };

  /** Fechas excluidas (sección 9 del encargo): `{ excludedDates, notes }`.
   * Si la cláusula de exclusión nombra un DÍA DE LA SEMANA suelto (sin
   * más contexto que lo ancle a una fecha concreta), NUNCA se inventa
   * una fecha — aunque resolveDateExpression (AI-1.2) SÍ sabría
   * resolver "el martes" a la ocurrencia más próxima, aquí se descarta
   * deliberadamente esa resolución para las exclusiones (a propósito
   * MÁS conservador que dateFrom/dateTo) y se conserva como texto
   * estructurado en `notes` ("exclude weekday: Tuesday"), tal como pide
   * el encargo. Si en cambio la cláusula da una fecha concreta (numérica
   * o relativa: "el 15", "el 15 de octubre", "mañana"...), sí se
   * resuelve con resolveDateExpression (AI-1.2), reutilizado tal cual. */
  function extractExclusions(message, todayStr) {
    const excludedDates = [];
    const notes = [];
    for (const re of EXCLUSION_PATTERNS) {
      const match = re.exec(message);
      if (!match) continue;
      const clause = match[0];
      const clauseLower = clause.toLowerCase();
      const weekdayHit = WEEKDAY_NAMES_ES.find(name => new RegExp(`\\b${name}\\b`, 'i').test(clauseLower));
      if (weekdayHit) {
        const note = `exclude weekday: ${WEEKDAY_EN_BY_ES[weekdayHit]}`;
        if (!notes.includes(note)) notes.push(note);
        continue;
      }
      if (todayStr) {
        const resolved = resolveDateExpression(clause, todayStr);
        if (resolved && !excludedDates.includes(resolved)) excludedDates.push(resolved);
      }
    }
    return { excludedDates, notes };
  }

  // Frases de la sección 10 del encargo (restricciones relevantes sin
  // campo estructurado propio todavía) — reconocidas literalmente, tal
  // como las da el encargo como ejemplo: no es un sistema general de
  // resumen de texto libre (eso sí sería "adivinar", sección 15), solo
  // conserva la frase original tal cual cuando encaja con un patrón
  // reconocido.
  const NOTE_PHRASE_PATTERNS = [
    /\bno\s+quiero\s+estudiar\s+por\s+la\s+noche\b/i,
    /\bprefiero\s+concentrar\s+las\s+tareas\s+dif[ií]ciles\s+por\s+la\s+tarde\b/i,
    /\blos\s+fines\s+de\s+semana\s+prefiero\s+descansar\b/i,
  ];
  function extractFreeformNotes(message) {
    const notes = [];
    NOTE_PHRASE_PATTERNS.forEach(re => {
      const match = re.exec(message);
      if (match && !notes.includes(match[0])) notes.push(match[0]);
    });
    return notes;
  }

  /** Punto de entrada de AI-3.2. Devuelve SIEMPRE el mismo objeto
   * estable de 12 campos (nunca `null` para un mensaje válido, ver
   * sección 1 del encargo) — cada campo permanece en su valor "vacío"
   * (`null`/`[]`) si el mensaje no aporta esa restricción explícita,
   * nunca se inventa. `context` es opcional: `{ today, tasks, events }`
   * — `context.events` NUNCA se lee (esta fase no necesita nada de los
   * eventos todavía); `context.tasks` solo se LEE (nunca se modifica).
   * Sin `context.today`, todo lo que dependa de una fecha de referencia
   * (dateFrom/dateTo, excludedDates) se queda en null/[], el resto de
   * campos se extrae igual. Es una función PURA: no lee `state`, no
   * toca el DOM, no llama a callAI/Scheduler, no usa el sistema de
   * batches, no abre Smart Forms. Determinista: la misma entrada
   * siempre produce la misma salida (estructuralmente, no por
   * identidad de objeto/array). */
  function extractPlanningConstraints(message, context) {
    const result = {
      dateFrom: null, dateTo: null, timeFrom: null, timeTo: null,
      daysOfWeek: [], preferredDayParts: [], availableMinutesPerDay: null,
      maxSessionMinutes: null, priority: null, taskIds: [], excludedDates: [], notes: [],
    };
    if (typeof message !== 'string' || !message.trim()) return result;
    const ctx = (context && typeof context === 'object') ? context : {};
    const todayStr = (typeof ctx.today === 'string' && ctx.today) ? ctx.today : null;

    const range = extractDateRangeConstraint(message, todayStr);
    result.dateFrom = range.dateFrom;
    result.dateTo = range.dateTo;
    // timeFrom/timeTo: el encargo no da ninguna regla/ejemplo de
    // extracción para ellos (a diferencia de cada uno de los demás
    // campos, con su propia sección) — se dejan siempre en null en esta
    // fase, sin inventar ninguna, en vez de adivinar un criterio no
    // pedido (sección 15).
    result.daysOfWeek = extractDaysOfWeekConstraint(message);
    result.preferredDayParts = extractPreferredDayParts(message);
    result.availableMinutesPerDay = extractAvailableMinutesPerDay(message);
    result.maxSessionMinutes = extractMaxSessionMinutes(message);
    // Sección 7 del encargo: nunca convierte un cambio de prioridad de
    // UNA tarea concreta (AI-1.5, "cambia la prioridad de X a alta") en
    // una regla global de planificación.
    result.priority = isPriorityChangeMessage(message) ? null : extractPriorityConstraint(message);
    result.taskIds = extractReferencedTaskIds(message, ctx.tasks);
    const exclusions = extractExclusions(message, todayStr);
    result.excludedDates = exclusions.excludedDates;
    result.notes = [...new Set([...exclusions.notes, ...extractFreeformNotes(message)])];
    return result;
  }

  /* ==================================================================
     AI-3.3 — Analizar huecos disponibles del calendario
     Capa de ANÁLISIS pura, sin estado propio: a partir de las
     restricciones ya extraídas por AI-3.2 (extractPlanningConstraints)
     y de los datos reales de tasks/events/customSchedules, calcula QUÉ
     intervalos de tiempo están realmente disponibles — sin decidir
     todavía qué tarea va en qué hueco, sin generar ninguna propuesta,
     sin crear/mover/cancelar nada, sin tocar Scheduler (solo CONSUME
     sus utilidades puras, ver abajo), sin tocar el sistema de batches,
     recordatorios ni Smart Forms. Eso es AI-3.4 en adelante, que
     consumirá exclusivamente el objeto que devuelve este helper.

     Reutiliza SIN duplicar el "horario realmente disponible de la
     aplicación" ya existente (investigado antes de escribir esto):
       - js/scheduler.js ya es el ÚNICO sitio de la app que calcula
         huecos libres. Su config (Scheduler.DEFAULTS.dayStart/dayEnd,
         '07:00'/'23:00') es la única "jornada" ya definida en todo
         ORGANIZATOR — no hay ninguna otra configuración de horario de
         estudio/trabajo en ningún sitio, así que se reutiliza tal cual
         como ventana base del día (documentado con una nota, tal como
         pide la sección 4 del encargo, en vez de inventar una jornada
         nueva).
       - Scheduler.DEFAULTS.dayStart/dayEnd + Scheduler._internal
         (dowOfDate, timeToMin, minToTime, mergeIntervals) se reutilizan
         DIRECTAMENTE: son las mismas funciones puras que ya usa
         getBusyIntervals/getFreeSlots, nunca reimplementadas aquí.
         dowOfDate ya usa la convención 0=lunes..6=domingo (NUNCA
         Date.prototype.getDay() a secas) — es la MISMA convención que
         recurrence.daysOfWeek (ver R-5.1), así que no hace falta ni
         inventar ni convertir nada.
       - Deliberadamente NO se reutiliza Scheduler.getFreeSlots/
         buildDayBlocks/scheduleTask/autoSchedule/rescheduleTask/
         findConflicts: todas esas funciones llaman por dentro a
         todayStr()/nowMin() (día/hora REAL del sistema, vía `new
         Date()`) para no ofrecer huecos ya pasados de HOY — perfecto
         para auto-planificar en tiempo real, pero rompería el
         determinismo estricto que exige esta fase (sección 16 del
         encargo: "no usar Date.now()", "la misma entrada debe producir
         exactamente el mismo resultado"). Por eso este bloque solo
         consume las piezas PURAS de Scheduler (_internal + DEFAULTS,
         ninguna de las cuales toca la hora real) y construye su propio
         barrido de intervalos ocupados↔libres sobre esas piezas.
       - Scheduler.getBusyIntervals (el pariente más cercano de lo que
         necesita esta fase) tampoco se reutiliza TAL CUAL para
         occupiedSlots: es pura y sin dependencia de la hora real, pero
         fusiona los intervalos SIN conservar de qué tarea/evento/bloqueo
         viene cada uno — y el contrato de AI-3.3 exige sourceType/
         sourceId por intervalo (trazabilidad que Scheduler.js nunca
         necesitó). Reimplementar esa función no es una opción (no se
         puede modificar Scheduler.js — sección 21 del encargo), así que
         computeDayOccupied() de aquí abajo replica sus MISMAS reglas
         exactas (mismo criterio de customSchedules/events/tasks, mismo
         trato de allDay+blocksSchedule) pero SIN fusionar y SIN perder
         el origen de cada intervalo — la única duplicación real de todo
         este bloque, documentada aquí porque es estrictamente necesaria
         para cumplir el contrato de salida.
       - Eventos: exactamente el mismo criterio que Scheduler.js ya usa
         (y que eventsForScheduler()/resolveEventBlocksSchedule() de
         organizator.html ya resuelven antes de pasarle los eventos a
         Scheduler): `e.blocksSchedule !== false` — un evento allDay sin
         este campo (undefined, incluida una categoría huérfana/borrada:
         resolveEventBlocksSchedule() ya devuelve `true` en ese caso)
         sigue bloqueando el día completo, exactamente igual que
         Scheduler.getBusyIntervals. AI-3.3 NUNCA resuelve categoryId por
         su cuenta (ai-actions.js no conoce eventCategories, igual que
         Scheduler.js): asume que `context.events` llega con
         blocksSchedule ya resuelto por quien llama, cuando corresponda.
       - Reutiliza parseYMDLocal/formatYMDLocal/addDaysLocal (AI-1.2)
         para iterar el rango de fechas y validar YYYY-MM-DD, sin
         reimplementar aritmética de calendario.

     Pureza (sección 1 del encargo): no modifica `state`, no modifica
     `context.tasks`/`context.events`/`context.customSchedules`, no
     modifica `constraints`, no toca el DOM, no llama a callAI, no crea/
     edita/mueve/cancela nada, no toca batches/Apply/Discard/reminders/
     Smart Forms/Scheduler (solo lo consume)/ACTION_SCHEMA/persistencia.
     ================================================================== */

  const PLANNING_AVAILABILITY_EMPTY = Object.freeze({
    dateFrom: null, dateTo: null, availableSlots: [], occupiedSlots: [],
    excludedDates: [], skippedDates: [], totalAvailableMinutes: 0, notes: [],
  });
  // Tope defensivo de días a analizar por llamada (sección 15, "ser
  // conservador"): ninguna fase anterior de AI-3 genera rangos así de
  // largos, pero un `constraints` construido a mano (o por una fase
  // futura) con un rango absurdo no debe colgar el análisis. No cambia
  // el contrato de dateFrom/dateTo (siguen siendo los del encargo); solo
  // limita cuántas fechas se ANALIZAN de verdad, documentado en notes.
  const PLANNING_AVAILABILITY_MAX_DAYS = 366;

  function isValidYMDStringLocal(v) {
    return typeof v === 'string' && parseYMDLocal(v) !== null;
  }
  function isValidHHMMStringLocal(v) {
    return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  }

  /** Intervalos OCUPADOS de un día, CON su origen (sourceType/sourceId,
   * en minutos desde 00:00, sin fusionar todavía) — mismas reglas
   * exactas que Scheduler.js->getBusyIntervals (ver cabecera del
   * bloque): horario fijo (customSchedules) que caiga ese día de la
   * semana, eventos que abarquen esa fecha (allDay bloquea el día
   * completo salvo blocksSchedule===false; con hora, su propio
   * intervalo, o +60min si falta endTime — igual que Scheduler.js), y
   * tareas — con DOS orígenes distintos y mutuamente excluyentes en la
   * práctica (una tarea con `dueTime` propio nunca llega a tener
   * scheduledStart/scheduledEnd: Scheduler solo programa tareas SIN
   * hora fija, ver applyCreateTask en este mismo archivo): ya
   * programadas por Scheduler (scheduledDate/scheduledStart/
   * scheduledEnd) o con hora+duración propias del usuario (dueDate +
   * dueTime + estimatedMinutes válidos — sección 6 del encargo: nunca
   * se inventa un bloqueo para una tarea sin ambos datos). No depende
   * de la posición de ningún array (recorre por valor, identifica por
   * id). No modifica `tasks`/`events`/`customSchedules`. */
  function computeDayOccupied(dateStr, dow, tasks, events, customSchedules) {
    const raw = [];
    customSchedules.forEach(s => {
      if (!s || typeof s !== 'object') return;
      if (Array.isArray(s.days) && s.days.includes(dow) && isValidHHMMStringLocal(s.startTime) && isValidHHMMStringLocal(s.endTime)) {
        const start = global.Scheduler._internal.timeToMin(s.startTime);
        const end = global.Scheduler._internal.timeToMin(s.endTime);
        if (end > start) raw.push({ start, end, sourceType: 'blocked', sourceId: (s.id != null ? s.id : null) });
      }
    });
    events.forEach(e => {
      if (!e || typeof e !== 'object' || !e.date) return;
      const start = e.date, end = e.endDate || e.date;
      if (dateStr < start || dateStr > end) return;
      const sourceId = e.id != null ? e.id : null;
      if (e.allDay) {
        if (e.blocksSchedule !== false) raw.push({ start: 0, end: 24 * 60, sourceType: 'event', sourceId });
        return;
      }
      if (isValidHHMMStringLocal(e.startTime)) {
        const s = global.Scheduler._internal.timeToMin(e.startTime);
        const en = isValidHHMMStringLocal(e.endTime) ? global.Scheduler._internal.timeToMin(e.endTime) : s + 60;
        if (en > s) raw.push({ start: s, end: en, sourceType: 'event', sourceId });
      }
    });
    tasks.forEach(t => {
      if (!t || typeof t !== 'object') return;
      const sourceId = t.id != null ? t.id : null;
      if (t.scheduledDate === dateStr && isValidHHMMStringLocal(t.scheduledStart) && isValidHHMMStringLocal(t.scheduledEnd)) {
        const s = global.Scheduler._internal.timeToMin(t.scheduledStart);
        const en = global.Scheduler._internal.timeToMin(t.scheduledEnd);
        if (en > s) raw.push({ start: s, end: en, sourceType: 'task', sourceId });
        return;
      }
      if (t.dueDate === dateStr && isValidHHMMStringLocal(t.dueTime) && typeof t.estimatedMinutes === 'number' && Number.isFinite(t.estimatedMinutes) && t.estimatedMinutes > 0) {
        const s = global.Scheduler._internal.timeToMin(t.dueTime);
        raw.push({ start: s, end: s + t.estimatedMinutes, sourceType: 'task', sourceId });
      }
    });
    // Recorta a [0, 24h] (por si algún dato mal formado produjera un
    // intervalo fuera de rango) y descarta cualquier intervalo
    // degenerado (fin <= inicio) antes de devolverlo.
    return raw
      .map(o => ({ start: Math.max(0, o.start), end: Math.min(24 * 60, o.end), sourceType: o.sourceType, sourceId: o.sourceId }))
      .filter(o => o.end > o.start);
  }

  /** Resta `mergedBusy` (intervalos [inicio,fin] ya fusionados, en
   * minutos) de la ventana [windowStart, windowEnd] y devuelve los
   * huecos libres resultantes, también como [inicio,fin]. Barrido de
   * intervalos genérico y minúsculo (no es lógica específica de
   * planificación): Scheduler.js no lo expone como pieza aislada
   * (getFreeSlots mezcla este mismo cálculo con el "no ofrecer huecos
   * de hoy que ya pasaron", que aquí no se quiere — ver cabecera del
   * bloque), así que se resuelve aquí con la misma aritmética mínima de
   * siempre en vez de tocar Scheduler.js. */
  function subtractBusyFromWindow(windowStart, windowEnd, mergedBusy) {
    if (windowEnd <= windowStart) return [];
    const free = [];
    let cursor = windowStart;
    for (const [s, e] of mergedBusy) {
      const cs = Math.max(s, windowStart), ce = Math.min(e, windowEnd);
      if (ce <= cs) continue;
      if (cs > cursor) free.push([cursor, cs]);
      cursor = Math.max(cursor, ce);
    }
    if (cursor < windowEnd) free.push([cursor, windowEnd]);
    return free.filter(([s, e]) => e > s);
  }

  /** Divide cada intervalo libre en segmentos de como máximo
   * `capMinutes` (sección 9 del encargo: maxSessionMinutes NUNCA
   * elimina disponibilidad, solo la reparte en trozos más pequeños que
   * SIGUEN sumando el mismo total) — el último segmento de cada
   * intervalo puede quedar más corto. Sin `capMinutes` (null/<=0),
   * devuelve los intervalos tal cual. Esto NO es todavía "generar
   * sesiones de planificación" (AI-3.4): no decide qué tarea va en cada
   * segmento, solo expresa la MISMA disponibilidad real en bloques más
   * pequeños. */
  function splitBySessionCap(freeIntervals, capMinutes) {
    if (typeof capMinutes !== 'number' || !Number.isFinite(capMinutes) || capMinutes <= 0) return freeIntervals;
    const out = [];
    freeIntervals.forEach(([s, e]) => {
      let cursor = s;
      while (cursor < e) {
        const segEnd = Math.min(cursor + capMinutes, e);
        out.push([cursor, segEnd]);
        cursor = segEnd;
      }
    });
    return out;
  }

  /** Punto de entrada de AI-3.3. `context` es `{ tasks, events,
   * customSchedules }` (todos opcionales, tratados como `[]` si faltan
   * o no son arrays — nunca se lanza por su ausencia); `constraints` es
   * el objeto que ya devuelve AI-3.2 (extractPlanningConstraints) o
   * cualquier objeto compatible con esa forma. Devuelve SIEMPRE el
   * mismo objeto estable de 8 campos (nunca `null`) — si falta
   * `constraints.dateFrom`/`dateTo`, o el rango es inválido
   * (dateFrom > dateTo, o cualquiera de los dos no es una fecha
   * YYYY-MM-DD real), devuelve el objeto VACÍO estable tal cual
   * (sección 2 del encargo), sin inventar ninguna fecha. No modifica
   * `context`/`constraints` ni ninguno de sus arrays/objetos internos.
   * No lee `state`, no toca el DOM, no llama a callAI, no llama a nada
   * de Scheduler que dependa de la hora real (ver cabecera del
   * bloque). Determinista: la misma entrada siempre produce el mismo
   * resultado, nunca usa `Date.now()`/`new Date()` sin argumentos, no
   * depende del orden de `context.tasks`/`context.events`. */
  function analyzePlanningAvailability(context, constraints) {
    const ctx = (context && typeof context === 'object') ? context : {};
    const cons = (constraints && typeof constraints === 'object') ? constraints : {};

    const dateFrom = isValidYMDStringLocal(cons.dateFrom) ? cons.dateFrom : null;
    const dateTo = isValidYMDStringLocal(cons.dateTo) ? cons.dateTo : null;
    if (!dateFrom || !dateTo || dateFrom > dateTo) return PLANNING_AVAILABILITY_EMPTY;
    // Sin Scheduler cargado no hay ninguna base fiable de "horario
    // disponible" que consultar (sección 4/15: nunca se inventa una
    // jornada) — se devuelve el objeto vacío en vez de fabricar algo.
    if (!global.Scheduler || !global.Scheduler._internal || !global.Scheduler.DEFAULTS) return PLANNING_AVAILABILITY_EMPTY;

    const result = {
      dateFrom, dateTo, availableSlots: [], occupiedSlots: [],
      excludedDates: [], skippedDates: [], totalAvailableMinutes: 0, notes: [],
    };
    const notes = [];
    const addNote = (text) => { if (!notes.includes(text)) notes.push(text); };

    const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];
    const events = Array.isArray(ctx.events) ? ctx.events : [];
    const customSchedules = Array.isArray(ctx.customSchedules) ? ctx.customSchedules : [];

    const excludedSet = new Set(Array.isArray(cons.excludedDates) ? cons.excludedDates.filter(isValidYMDStringLocal) : []);
    const daysOfWeekSet = (Array.isArray(cons.daysOfWeek) && cons.daysOfWeek.length)
      ? new Set(cons.daysOfWeek.filter(n => Number.isInteger(n) && n >= 0 && n <= 6))
      : null;

    // Sección 11: preferredDayParts — ORGANIZATOR no tiene todavía
    // ninguna franja horaria segura definida para "mañana/tarde/noche"
    // (resolveDayPart de AI-1.2 solo detecta la FRASE, nunca la
    // convierte en HH:MM) — nunca se inventa una, solo se documenta.
    if (Array.isArray(cons.preferredDayParts) && cons.preferredDayParts.length) {
      addNote('preferredDayParts no recorta la disponibilidad: ORGANIZATOR todavía no tiene una franja horaria segura definida para "morning"/"afternoon"/"night".');
    }

    // Ventana base del día: Scheduler.DEFAULTS.dayStart/dayEnd (única
    // "jornada" ya existente en la app — ver cabecera del bloque),
    // recortada con timeFrom/timeTo si vienen y son seguros.
    const baseStart = global.Scheduler._internal.timeToMin(global.Scheduler.DEFAULTS.dayStart);
    const baseEnd = global.Scheduler._internal.timeToMin(global.Scheduler.DEFAULTS.dayEnd);
    addNote(`Disponibilidad calculada sobre el horario general de la app (${global.Scheduler.DEFAULTS.dayStart}–${global.Scheduler.DEFAULTS.dayEnd}) más los bloques de horario personalizado existentes; ORGANIZATOR no tiene todavía una jornada de estudio/trabajo configurable independiente de esa.`);

    let windowStart = baseStart;
    let windowEnd = baseEnd;
    const hasTimeFrom = isValidHHMMStringLocal(cons.timeFrom);
    const hasTimeTo = isValidHHMMStringLocal(cons.timeTo);
    let skipAllForBadTimeRange = false;
    if (hasTimeFrom && hasTimeTo && global.Scheduler._internal.timeToMin(cons.timeFrom) >= global.Scheduler._internal.timeToMin(cons.timeTo)) {
      // Sección 10: cruza medianoche (o es directamente inválido) — no
      // existe ninguna estructura en ORGANIZATOR que represente huecos
      // "de un día al siguiente" de forma segura, así que ninguna fecha
      // del rango puede analizarse con esa restricción sin adivinar.
      addNote('timeFrom/timeTo cruza medianoche o es inválido (timeFrom no es anterior a timeTo): no hay ninguna estructura existente para representarlo con seguridad, así que no se analiza ninguna fecha con esa restricción.');
      skipAllForBadTimeRange = true;
    } else {
      if (hasTimeFrom) windowStart = Math.max(windowStart, global.Scheduler._internal.timeToMin(cons.timeFrom));
      if (hasTimeTo) windowEnd = Math.min(windowEnd, global.Scheduler._internal.timeToMin(cons.timeTo));
    }

    const maxSessionMinutes = (typeof cons.maxSessionMinutes === 'number' && Number.isFinite(cons.maxSessionMinutes) && cons.maxSessionMinutes > 0) ? cons.maxSessionMinutes : null;
    const availableMinutesPerDay = (typeof cons.availableMinutesPerDay === 'number' && Number.isFinite(cons.availableMinutesPerDay) && cons.availableMinutesPerDay > 0) ? cons.availableMinutesPerDay : null;

    let dayCount = 0;
    let truncatedByCap = false;
    let d = dateFrom;
    while (d <= dateTo) {
      dayCount++;
      if (dayCount > PLANNING_AVAILABILITY_MAX_DAYS) { truncatedByCap = true; break; }

      if (excludedSet.has(d)) {
        result.excludedDates.push(d);
        d = addDaysLocal(d, 1);
        continue;
      }
      if (skipAllForBadTimeRange) {
        result.skippedDates.push(d);
        d = addDaysLocal(d, 1);
        continue;
      }

      const dow = global.Scheduler._internal.dowOfDate(d);
      if (daysOfWeekSet && !daysOfWeekSet.has(dow)) {
        // Sección 3: fuera de los días pedidos — ni excluida ni
        // "saltada" (no falta información: simplemente no se pidió).
        d = addDaysLocal(d, 1);
        continue;
      }

      const occupiedRaw = computeDayOccupied(d, dow, tasks, events, customSchedules);
      occupiedRaw.forEach(o => {
        result.occupiedSlots.push({ date: d, start: global.Scheduler._internal.minToTime(o.start), end: global.Scheduler._internal.minToTime(o.end), sourceType: o.sourceType, sourceId: o.sourceId });
      });

      const mergedBusy = global.Scheduler._internal.mergeIntervals(occupiedRaw.map(o => [o.start, o.end]));
      const freeRaw = subtractBusyFromWindow(windowStart, windowEnd, mergedBusy);
      const freeFinal = splitBySessionCap(freeRaw, maxSessionMinutes);
      freeFinal.forEach(([s, e]) => {
        result.availableSlots.push({ date: d, start: global.Scheduler._internal.minToTime(s), end: global.Scheduler._internal.minToTime(e), minutes: e - s });
      });

      if (availableMinutesPerDay !== null) {
        const dayTotal = freeFinal.reduce((sum, [s, e]) => sum + (e - s), 0);
        if (dayTotal > availableMinutesPerDay) {
          addNote(`availableMinutesPerDay (${availableMinutesPerDay} min) es menor que la disponibilidad real de al menos un día del rango; AI-3.3 no decide qué parte usar (eso corresponde a AI-3.4).`);
        }
      }

      d = addDaysLocal(d, 1);
    }

    if (truncatedByCap) {
      addNote(`El rango pedido supera ${PLANNING_AVAILABILITY_MAX_DAYS} días; solo se analizaron los primeros ${PLANNING_AVAILABILITY_MAX_DAYS} (límite defensivo).`);
    }

    result.availableSlots.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    result.occupiedSlots.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    result.totalAvailableMinutes = result.availableSlots.reduce((sum, s) => sum + s.minutes, 0);
    result.notes = notes;
    return result;
  }

  /* ==================================================================
     AI-3.4 — Generar propuesta de planificación
     Capa de ASIGNACIÓN pura, sin estado propio: convierte las
     restricciones de AI-3.2 (extractPlanningConstraints) y los huecos
     ya analizados por AI-3.3 (analyzePlanningAvailability) en una
     propuesta concreta de qué tarea iría en qué intervalo — sin crear,
     mover ni cancelar nada todavía, sin tocar Scheduler/batches/
     iaProposals/reminders/Smart Forms/persistencia, sin llamar a
     callAI. Eso es AI-3.5/AI-3.6 en adelante, que consumirán
     exclusivamente el objeto que devuelve este helper (nunca con `id`/
     `source`/`batchId`/`status`: esos campos son del sistema de
     batches/propuestas de AI-3.5, no de esta fase).

     Reutiliza SIN duplicar:
       - isValidYMDStringLocal/isValidHHMMStringLocal (AI-3.3, mismas
         funciones, no una copia) para validar fechas/horas.
       - global.Scheduler._internal.timeToMin/minToTime/dowOfDate
         (mismas piezas puras que ya reutiliza AI-3.3, nunca las
         funciones de Scheduler que dependen de la hora real — ver
         cabecera del bloque AI-3.3 para la explicación completa de por
         qué).
       - El campo `priority` de las tareas ('alta'/'media'/'baja', ya
         validado por isValidSmartFormPriority en AI-2.2) es la ÚNICA
         estructura de prioridad que ya existe en ORGANIZATOR — no se
         inventa ninguna nueva.
       - `context.tasks` es la MISMA fuente/forma de datos que ya
         consumen buildActionContext/schedulerContext más abajo en este
         archivo (t.id/t.title/t.done/t.priority/t.dueDate/
         t.estimatedMinutes) — no se inventa un estado distinto de
         "pendiente" al que ya usa toda la app (`!task.done`, la ÚNICA
         fuente de verdad para "completada", ver organizator.html
         "task.done es la única fuente de verdad para completada").
       - `availability.availableSlots` (AI-3.3) es la ÚNICA fuente de
         disponibilidad consumida: este bloque NUNCA vuelve a calcular
         huecos, ni consulta Scheduler directamente.

     Tareas recurrentes (`task.recurrence` presente) quedan
     deliberadamente FUERA de esta fase: decidir con seguridad a qué
     OCURRENCIA concreta de una serie recurrente correspondería una
     fecha límite requeriría reutilizar isDateInRecurrence/
     getNextRecurrenceDate (R-2), que viven en organizator.html, fuera
     del alcance de ai-actions.js y explícitamente fuera del alcance de
     esta fase ("no tocar recurrence") — en vez de duplicar o adivinar
     esa lógica aquí, esas tareas simplemente no se consideran
     candidatas todavía (conservador, sección 15 de AI-3.3, mismo
     espíritu aplicado aquí).

     Pureza: no modifica `context`/`constraints`/`availability` ni
     ninguno de sus arrays/objetos internos, no modifica `tasks`/
     `events`, no lee `state`, no toca el DOM, no llama a callAI, no
     toca Scheduler/batches/iaProposals/reminders/Smart Forms/
     persistencia/ACTION_SCHEMA. Determinista: nunca usa `Date.now()`/
     `Math.random()`/posición de array — el desempate final siempre es
     el `id` de la tarea (sección 8 del encargo).
     ================================================================== */

  const PLANNING_PROPOSAL_EMPTY = Object.freeze({
    dateFrom: null, dateTo: null, proposals: [], totalMinutes: 0,
    plannedTaskIds: [], unplannedTaskIds: [], notes: [],
  });

  function isPositiveFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  }

  /** Comparador determinista de desempate final (sección 8 del
   * encargo): por `id` de tarea, nunca por posición de array. */
  function compareByTaskId(a, b) {
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  /** Orden BASE determinista cuando no hay (o ya no aplica) una
   * preferencia de `constraints.priority` más específica: fecha límite
   * más próxima primero (información real de la propia tarea, nunca
   * inventada — las tareas sin fecha límite utilizable van después de
   * las que sí la tienen), y como desempate final, el id. */
  function comparePlanningBase(a, b) {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    return compareByTaskId(a, b);
  }

  /** Sección 7 del encargo: orden de candidatas según
   * `constraints.priority`. El modelo de tareas de ORGANIZATOR solo
   * tiene un campo `priority` con tres niveles (alta/media/baja) — no
   * una distinción separada "urgente" vs "importante" — así que 'urgent'
   * e 'important' usan intencionadamente el MISMO campo real (favorecen
   * primero 'alta', luego 'media', luego 'baja'): no se inventa una
   * segunda estructura de prioridad que ORGANIZATOR no tiene. 'shortest'
   * favorece menor `estimatedMinutes` (ya validado numérico positivo en
   * este punto). 'earliest' favorece la fecha límite más próxima
   * (idéntico criterio que comparePlanningBase, hecho explícito aquí
   * por claridad). Cualquier empate cae siempre en comparePlanningBase,
   * que ya termina en el id como desempate final. */
  function comparePlanningWithPriority(a, b, priorityMode) {
    if (priorityMode === 'urgent' || priorityMode === 'important') {
      const rank = (p) => (p === 'alta' ? 0 : (p === 'baja' ? 2 : 1));
      const diff = rank(a.priority) - rank(b.priority);
      if (diff !== 0) return diff;
    } else if (priorityMode === 'shortest') {
      if (a.estimatedMinutes !== b.estimatedMinutes) return a.estimatedMinutes - b.estimatedMinutes;
    }
    // 'earliest' (y cualquier otro valor no reconocido) cae directamente
    // en comparePlanningBase, que YA ordena por fecha límite más
    // próxima primero — no se inventa un criterio nuevo para 'earliest'.
    return comparePlanningBase(a, b);
  }

  /** Razón corta y determinista (sección 14 del encargo) — nunca texto
   * generado por IA, siempre una de un conjunto fijo de frases según
   * qué criterio real decidió el orden de esta tarea. Todos los
   * segmentos de una misma tarea comparten la misma razón base; si la
   * tarea se dividió en varias sesiones (maxSessionMinutes), se añade
   * "(parte N de M)" para que quede claro sin inventar nada nuevo. */
  function buildPlanningReason(task, priorityMode, segmentIndex, segmentCount) {
    let base;
    if (priorityMode === 'urgent' && task.priority === 'alta') base = 'Prioridad urgente: tarea de prioridad alta planificada primero.';
    else if (priorityMode === 'important' && task.priority === 'alta') base = 'Prioridad importante: tarea de prioridad alta planificada primero.';
    else if (priorityMode === 'shortest') base = 'Prioridad shortest: duración más corta planificada primero.';
    else if (priorityMode === 'earliest' && task.dueDate) base = 'Prioridad earliest: fecha límite más próxima planificada primero.';
    else if (task.dueDate) base = 'Planificada dentro de la fecha límite de la tarea, en el primer hueco disponible compatible.';
    else base = 'Planificada en el primer hueco disponible compatible con su duración.';
    return segmentCount > 1 ? `${base} (parte ${segmentIndex + 1} de ${segmentCount})` : base;
  }

  /** Intenta colocar `task` (con `estimatedMinutes` ya validado) dentro
   * de `workingSlots` (array de `{date,startMin,endMin,cursor}`, MUTADO
   * en sitio — cada slot representa cuánto queda libre a partir de
   * `cursor`, avanzando según se van asignando minutos) y `dayUsage`
   * (Map fecha->minutos ya asignados ese día, para respetar
   * `availableMinutesPerDay`). Recorre los huecos en orden cronológico
   * (sección 13 del encargo), nunca coloca nada después de
   * `task.dueDate` si la tarea tiene una, nunca excede
   * `maxSessionMinutes` por segmento ni el presupuesto diario restante.
   * Todo o nada: si al final queda duración sin colocar, deshace TODAS
   * las mutaciones de esta tarea (nunca dejar una tarea "a medias") y
   * devuelve `{ success:false }`; si se coloca por completo, devuelve
   * `{ success:true, segments }` con las mutaciones ya aplicadas. */
  function tryPlaceTaskInSlots(task, workingSlots, dayUsage, maxSessionMinutes, availableMinutesPerDay) {
    const cursorSnapshot = workingSlots.map(s => s.cursor);
    const dayUsageSnapshot = new Map(dayUsage);

    let remaining = task.estimatedMinutes;
    const segments = [];
    for (const slot of workingSlots) {
      if (remaining <= 0) break;
      if (task.dueDate && slot.date > task.dueDate) continue;
      const slotFree = slot.endMin - slot.cursor;
      if (slotFree <= 0) continue;
      const dayUsed = dayUsage.get(slot.date) || 0;
      const dayBudgetLeft = (availableMinutesPerDay !== null) ? Math.max(0, availableMinutesPerDay - dayUsed) : Infinity;
      if (dayBudgetLeft <= 0) continue;
      let segCap = remaining;
      if (maxSessionMinutes !== null) segCap = Math.min(segCap, maxSessionMinutes);
      const segMinutes = Math.min(segCap, slotFree, dayBudgetLeft);
      if (segMinutes <= 0) continue;
      segments.push({ date: slot.date, startMin: slot.cursor, endMin: slot.cursor + segMinutes, minutes: segMinutes });
      slot.cursor += segMinutes;
      dayUsage.set(slot.date, dayUsed + segMinutes);
      remaining -= segMinutes;
    }

    if (remaining > 0) {
      workingSlots.forEach((s, i) => { s.cursor = cursorSnapshot[i]; });
      dayUsage.clear();
      dayUsageSnapshot.forEach((v, k) => dayUsage.set(k, v));
      return { success: false };
    }
    return { success: true, segments };
  }

  /** Punto de entrada de AI-3.4. `context` es `{ tasks, events,
   * customSchedules }` (solo se lee `tasks`; `events`/
   * `customSchedules` no se usan en esta fase — la disponibilidad ya
   * viene resuelta en `availability`). `constraints` es el objeto de
   * AI-3.2 (extractPlanningConstraints) o compatible; `availability` es
   * el objeto de AI-3.3 (analyzePlanningAvailability) o compatible.
   * Devuelve SIEMPRE el mismo objeto estable de 7 campos (nunca
   * `null`). Si `availability` no trae un `dateFrom`/`dateTo` válidos o
   * `availableSlots` no es un array, devuelve el objeto VACÍO estable
   * (sección 15 del encargo) — nunca inventa fechas ni huecos. No
   * modifica ninguno de sus argumentos. Determinista: la misma entrada
   * siempre produce el mismo resultado, sin depender del orden de
   * `context.tasks` ni de `availability.availableSlots`. */
  function generatePlanningProposal(context, constraints, availability) {
    const ctx = (context && typeof context === 'object') ? context : {};
    const cons = (constraints && typeof constraints === 'object') ? constraints : {};
    const avail = (availability && typeof availability === 'object') ? availability : {};

    const dateFrom = isValidYMDStringLocal(avail.dateFrom) ? avail.dateFrom : null;
    const dateTo = isValidYMDStringLocal(avail.dateTo) ? avail.dateTo : null;
    if (!dateFrom || !dateTo || dateFrom > dateTo || !Array.isArray(avail.availableSlots)) return PLANNING_PROPOSAL_EMPTY;
    if (!global.Scheduler || !global.Scheduler._internal) return PLANNING_PROPOSAL_EMPTY;

    const notes = [];
    const addNote = (text) => { if (!notes.includes(text)) notes.push(text); };
    const timeToMin = global.Scheduler._internal.timeToMin;
    const minToTime = global.Scheduler._internal.minToTime;
    const dowOfDate = global.Scheduler._internal.dowOfDate;

    if (Array.isArray(cons.preferredDayParts) && cons.preferredDayParts.length) {
      addNote('preferredDayParts no se aplica aquí directamente: AI-3.3 ya documenta que ORGANIZATOR no tiene una franja horaria segura definida para "morning"/"afternoon"/"night", así que esta fase solo usa los huecos reales que ya vienen en availability.availableSlots.');
    }

    // Sección 3: si constraints.taskIds trae ids concretos, la selección
    // se restringe a esos DESDE EL PRINCIPIO (nunca se inventa un id,
    // nunca se resuelve por posición); si no, se consideran todas las
    // tareas pendientes. Se calcula ANTES del filtro de sección 2/12
    // para que una tarea sin duración fuera del alcance pedido por
    // taskIds no aparezca en unplannedTaskIds (mismo criterio que una
    // tarea sin duración normal y corriente que no fue referenciada: si
    // no hay taskIds, se considera; si los hay, solo esas).
    const hasTaskIdsFilter = Array.isArray(cons.taskIds) && cons.taskIds.length > 0;
    const idFilterSet = hasTaskIdsFilter ? new Set(cons.taskIds.filter(id => typeof id === 'string')) : null;
    if (hasTaskIdsFilter) {
      const tasksArrForCheck = Array.isArray(ctx.tasks) ? ctx.tasks : [];
      const knownIds = new Set(tasksArrForCheck.filter(t => t && typeof t.id === 'string').map(t => t.id));
      const unresolvable = [...idFilterSet].filter(id => !knownIds.has(id));
      if (unresolvable.length) addNote('constraints.taskIds hace referencia a algún id que no corresponde a ninguna tarea real: se ignora, nunca se inventa.');
    }

    // Sección 2/12: candidatas = tareas pendientes (!done), planificables
    // (con id/title reales, sin recurrencia — ver cabecera del bloque),
    // dentro del alcance de taskIds si aplica, y con duración
    // determinable. Nunca se depende de la posición del array: se
    // recorre por valor y se identifica siempre por id. Una tarea
    // pendiente/planificable pero SIN duración determinable (sección 5
    // del encargo: nunca se le inventa una) va a `missingDurationIds` en
    // vez de a `eligible` — y de ahí, más abajo, DIRECTAMENTE a
    // `unplannedTaskIds` (nunca se pierde, nunca se inventa nada).
    const tasksArr = Array.isArray(ctx.tasks) ? ctx.tasks : [];
    const eligible = [];
    const missingDurationIds = [];
    tasksArr.forEach(t => {
      if (!t || typeof t !== 'object') return;
      if (typeof t.id !== 'string' || !t.id) return;
      if (typeof t.title !== 'string' || !t.title.trim()) return;
      if (t.done === true) return; // completada — nunca planificable (única fuente de verdad, ver cabecera)
      if (t.recurrence) return; // fuera de alcance de esta fase, ver cabecera del bloque
      if (idFilterSet && !idFilterSet.has(t.id)) return; // fuera del alcance pedido por taskIds
      const duration = isPositiveFiniteNumber(t.estimatedMinutes) ? t.estimatedMinutes : null;
      const dueDate = isValidYMDStringLocal(t.dueDate) ? t.dueDate : null;
      if (duration === null) { missingDurationIds.push(t.id); return; }
      eligible.push({ id: t.id, priority: (t.priority === 'alta' || t.priority === 'media' || t.priority === 'baja') ? t.priority : 'media', estimatedMinutes: duration, dueDate });
    });
    if (missingDurationIds.length) {
      addNote('Hay tareas pendientes sin una duración determinable (falta estimatedMinutes válido y positivo): no se les inventa ninguna, quedan sin planificar.');
    }

    // Sección 8: orden determinista antes de planificar — nunca por
    // posición de array, nunca Date.now()/Math.random(), desempate
    // final siempre por id (ver comparePlanningBase/comparePlanningWithPriority).
    const candidates = eligible.slice().sort((a, b) => comparePlanningWithPriority(a, b, cons.priority));

    // Sección 4: disponibilidad SOLO desde availability.availableSlots —
    // nunca se vuelve a calcular. Se clona a una forma de trabajo local
    // (en minutos, con `cursor` propio) para poder ir consumiéndola sin
    // tocar el array/objetos originales, y se filtra defensivamente
    // contra dateFrom/dateTo/excludedDates/daysOfWeek de `constraints`
    // (nunca generar propuestas en fechas excluidas, fuera de rango o en
    // días no permitidos, aunque `availability` viniera inconsistente).
    const excludedSet = new Set(Array.isArray(cons.excludedDates) ? cons.excludedDates.filter(isValidYMDStringLocal) : []);
    const daysOfWeekSet = (Array.isArray(cons.daysOfWeek) && cons.daysOfWeek.length)
      ? new Set(cons.daysOfWeek.filter(n => Number.isInteger(n) && n >= 0 && n <= 6))
      : null;
    const workingSlots = avail.availableSlots
      .filter(s => s && isValidYMDStringLocal(s.date) && isValidHHMMStringLocal(s.start) && isValidHHMMStringLocal(s.end))
      .map(s => ({ date: s.date, startMin: timeToMin(s.start), endMin: timeToMin(s.end), cursor: timeToMin(s.start) }))
      .filter(s => s.endMin > s.startMin)
      .filter(s => s.date >= dateFrom && s.date <= dateTo)
      .filter(s => !excludedSet.has(s.date))
      .filter(s => !daysOfWeekSet || daysOfWeekSet.has(dowOfDate(s.date)))
      .sort((a, b) => (a.date === b.date) ? (a.startMin - b.startMin) : (a.date < b.date ? -1 : 1));

    const maxSessionMinutes = isPositiveFiniteNumber(cons.maxSessionMinutes) ? cons.maxSessionMinutes : null;
    const availableMinutesPerDay = isPositiveFiniteNumber(cons.availableMinutesPerDay) ? cons.availableMinutesPerDay : null;

    const proposals = [];
    const plannedTaskIds = [];
    // Las tareas pendientes/planificables pero sin duración determinable
    // (sección 5 del encargo) ya quedan aquí desde el principio: nunca
    // se planifican, así que van directas a unplannedTaskIds.
    const unplannedTaskIds = missingDurationIds.slice();

    if (!workingSlots.length) {
      if (candidates.length) addNote('No hay ningún hueco disponible dentro del rango/restricciones analizadas: ninguna tarea candidata pudo planificarse.');
      candidates.forEach(c => unplannedTaskIds.push(c.id));
    } else {
      const dayUsage = new Map();
      candidates.forEach(task => {
        const attempt = tryPlaceTaskInSlots(task, workingSlots, dayUsage, maxSessionMinutes, availableMinutesPerDay);
        if (attempt.success) {
          const segmentCount = attempt.segments.length;
          attempt.segments.forEach((seg, i) => {
            proposals.push({
              taskId: task.id,
              date: seg.date,
              startTime: minToTime(seg.startMin),
              endTime: minToTime(seg.endMin),
              minutes: seg.minutes,
              reason: buildPlanningReason(task, cons.priority, i, segmentCount),
            });
          });
          plannedTaskIds.push(task.id);
        } else {
          unplannedTaskIds.push(task.id);
          if (task.dueDate) addNote('Alguna tarea con fecha límite no encontró disponibilidad suficiente antes de esa fecha: queda sin planificar, nunca se planifica después del límite.');
          else addNote('Alguna tarea candidata no encontró disponibilidad suficiente (junto con maxSessionMinutes/availableMinutesPerDay, si aplican) para cubrir toda su duración: queda sin planificar, nunca se divide de forma insegura.');
        }
      });
    }

    proposals.sort((a, b) => {
      const key = a.date + a.startTime, keyB = b.date + b.startTime;
      if (key !== keyB) return key < keyB ? -1 : 1;
      return a.taskId < b.taskId ? -1 : (a.taskId > b.taskId ? 1 : 0);
    });

    return {
      dateFrom, dateTo, proposals,
      totalMinutes: proposals.reduce((sum, p) => sum + p.minutes, 0),
      plannedTaskIds: [...new Set(plannedTaskIds)].sort(),
      unplannedTaskIds: [...new Set(unplannedTaskIds)].sort(),
      notes,
    };
  }

  /* ==================================================================
     AI-3.5 — Mostrar propuesta mediante batches
     Capa de CONVERSIÓN: transforma el resultado PURO de AI-3.4
     (generatePlanningProposal) en un batch del sistema EXISTENTE de
     propuestas IA (`iaProposals`, organizator.html — "IA — ASISTENTE
     PERSONAL": nextIAProposalId/nextIABatchId/getIAProposalById/
     getIAProposalsByBatchId/validateIAProposalBatch/etc., ya usado por
     runIADay/runIAWeek desde antes de AI-3). NO reemplaza ni reimplementa
     ese sistema, NO crea una segunda estructura de batches, NO aplica ni
     descarta nada — solo prepara la propuesta pendiente para que ese
     ciclo de vida ya existente (pending -> applied|discarded) pueda
     operar sobre ella exactamente igual que sobre cualquier otra.

     Investigación previa (sección 1 del encargo) — resumen de lo
     encontrado en organizator.html, reutilizado tal cual, sin duplicar:
       - `let iaProposals = []` (transitorio, NUNCA se persiste en
         window.storage — comentario explícito en el propio código: "no
         se guarda en window.storage") — así que esta fase no necesita
         ser `async` ni tocar persistencia (sección 13 del encargo): el
         propio sistema existente ya no la usa para esto.
       - `nextIAProposalId()`/`nextIABatchId()`: contadores incrementales
         del propio módulo ('ia-N'/'ia-batch-N') — el ÚNICO mecanismo
         existente para generar id/batchId. Son `function` declaradas en
         el `<script>` principal de organizator.html (que carga DESPUÉS
         de ai-actions.js — ver orden de `<script src="...">`), así que
         no existen todavía cuando ESTE archivo se evalúa, pero SÍ
         existen ya en `global`/`window` para cuando `createPlanningProposalBatch()`
         se LLAME de verdad (una función no ejecuta su cuerpo hasta que
         se invoca) — mismo patrón que ya usa el resto de ai-actions.js
         con `global.addTask`/`global.Scheduler`/`global.eventsForScheduler`,
         nunca referenciados en la carga del módulo, solo dentro de
         funciones.
       - Ciclo de vida de una propuesta: `status` empieza SIEMPRE en
         `'pending'`; las únicas transiciones permitidas (
         IA_PROPOSAL_ALLOWED_TRANSITIONS) son pending->applied y
         pending->discarded, gestionadas por `setIAProposalStatus()` —
         esta fase NUNCA llama a esa función ni fija otro status.
       - `validateIAProposalBatch(batchId)` (ya existente) exige
         únicamente `p.id && p.batchId===batchId && p.source && p.status`
         — el contrato mínimo que este bloque debe cumplir, sin inventar
         ningún campo adicional obligatorio.
       - `source`: los valores YA existentes son `'day'`/`'week'`
         (runIADay/runIAWeek). No existe ninguna fuente para
         planificación todavía, así que se añade UNA nueva, claramente
         identificable y documentada aquí: `'planning'`.
       - Metadata de batch: no existe ningún registro de batch aparte de
         un `batchId` compartido entre varias entradas de `iaProposals`
         (no hay un array `iaBatches` ni un objeto de batch independiente)
         — no se inventa esa arquitectura ahora (sección 12 del encargo:
         "si el sistema actual no tiene metadata de batch, no crear ahora
         una arquitectura nueva solo para esto").
       - `applyIAProposal(it, date)` (Apply real, existente) asume
         SIEMPRE crear una entidad NUEVA a partir de `it.title`/`it.time`
         (evento si `it.time`, tarea si no) — un contrato que NO encaja
         con una propuesta de AI-3.4 (que apunta a una tarea YA
         EXISTENTE por `taskId`, con `startTime`/`endTime`, sin
         `title`/`time` propios). AI-3.5 NO toca `applyIAProposal` (fuera
         de alcance, sección 14 del encargo): las propuestas de
         `source:'planning'` quedan con status `pending`, listas para que
         una fase AI-3.6 posterior les dé un Apply específico (asignar
         `scheduledDate`/`scheduledStart`/`scheduledEnd` a la tarea
         `taskId` en vez de crear una entidad nueva) — documentado aquí,
         NO implementado en esta fase.
       - Render: no existe un renderer GENÉRICO que pinte cualquier
         `iaProposal` `pending` sin importar su `source` (renderDayAgendaList/
         renderIAItemHTML/getWeekIAProposalsForDate están atados a
         `source:'day'`/`'week'` y generan su HTML a la vez que crean la
         propuesta, no después). Por eso esta fase no puede "aparecer" en
         ninguna pantalla todavía sin tocar organizator.html — y no lo
         hace (fuera del alcance permitido, sección 20 del encargo): dejar
         la estructura de datos correcta y compatible con los helpers
         existentes (getIAProposalById/getIAProposalsByBatchId/
         validateIAProposalBatch/getIAProposalBatchSummary, todos
         genéricos por `id`/`batchId`, sin importar `source`) es
         "compatible con ese sistema", que es lo único que pide esta fase.

     Reutiliza SIN duplicar: isValidYMDStringLocal/isValidHHMMStringLocal
     (AI-3.3) para validar cada propuesta antes de aceptarla.

     Pureza relativa: esta función SÍ tiene un efecto colateral
     deliberado e inevitable (generar ids únicos vía
     global.nextIAProposalId()/nextIABatchId(), que mutan sus contadores
     internos en organizator.html — el MISMO efecto que ya tiene crear
     cualquier propuesta IA existente) — pero NUNCA modifica
     `planningProposal`/`context`/ninguno de sus arrays u objetos
     internos, NUNCA muta `iaProposals` directamente (no puede: es una
     variable `let` del `<script>` principal de organizator.html, fuera
     del alcance léxico de ai-actions.js — devuelve `{ batchId,
     proposals }` para que el llamador haga `iaProposals.push(...batch.proposals)`,
     el mismo idioma que YA usa el resto del sistema en cada sitio donde
     crea una propuesta), no toca el DOM, no llama a callAI, no toca
     Scheduler/reminders/Smart Forms/ACTION_SCHEMA.
     ================================================================== */

  /** Validación estructural de una entrada de
   * `planningProposal.proposals` (AI-3.4) antes de aceptarla — nunca
   * recalcula ni reinterpreta el contenido (sección 6 del encargo: "no
   * modificar estos valores"), solo comprueba que tiene la forma que
   * `generatePlanningProposal` ya garantiza para una entrada válida. */
  function isValidPlanningProposalEntry(p) {
    return !!p && typeof p === 'object'
      && typeof p.taskId === 'string' && p.taskId.length > 0
      && isValidYMDStringLocal(p.date)
      && isValidHHMMStringLocal(p.startTime)
      && isValidHHMMStringLocal(p.endTime)
      && p.startTime < p.endTime
      && typeof p.minutes === 'number' && Number.isFinite(p.minutes) && p.minutes > 0
      && typeof p.reason === 'string' && p.reason.length > 0;
  }

  /** Punto de entrada de AI-3.5. `planningProposal` es el objeto que ya
   * devuelve AI-3.4 (generatePlanningProposal) o compatible;
   * `context` es opcional, `{ tasks, ... }` — si `context.tasks` es un
   * array, cada `taskId` de cada propuesta debe corresponder a una
   * tarea real de ese array (nunca se inventa, nunca se resuelve por
   * título/posición — sección 11 del encargo); sin `context.tasks` no
   * se puede comprobar esa correspondencia, así que se confía en lo que
   * ya validó AI-3.4 (no es responsabilidad de esta fase volver a
   * analizar tareas). Devuelve `{ batchId, proposals }` — nunca un
   * batch vacío: si `planningProposal.proposals` no es un array no
   * vacío, si el mecanismo de ids del sistema
   * (global.nextIABatchId/nextIAProposalId) no está disponible, si
   * CUALQUIER propuesta es estructuralmente inválida, o si CUALQUIER
   * `taskId` no corresponde a una tarea real de `context.tasks` (cuando
   * se puede comprobar), devuelve `null` de forma atómica — nunca crea
   * un batch parcial ni dos veces la misma propuesta a partir de una
   * sola entrada (transformación 1:1, sección 6 del encargo). No
   * modifica `planningProposal`/`context` ni ninguno de sus arrays/
   * objetos internos: construye siempre objetos nuevos. */
  function createPlanningProposalBatch(planningProposal, context) {
    const pp = (planningProposal && typeof planningProposal === 'object') ? planningProposal : {};
    const ctx = (context && typeof context === 'object') ? context : {};

    if (!Array.isArray(pp.proposals) || !pp.proposals.length) return null;
    if (typeof global.nextIABatchId !== 'function' || typeof global.nextIAProposalId !== 'function') return null;
    if (!pp.proposals.every(isValidPlanningProposalEntry)) return null;

    if (Array.isArray(ctx.tasks)) {
      const knownTaskIds = new Set(ctx.tasks.filter(t => t && typeof t.id === 'string').map(t => t.id));
      if (!pp.proposals.every(p => knownTaskIds.has(p.taskId))) return null;
    }

    // A partir de aquí ya está todo validado: se generan los ids reales
    // (único punto donde esta función muta algo, y solo el contador
    // interno del propio sistema existente) y se construyen objetos
    // NUEVOS — transformación 1:1, ninguna propuesta se fusiona, se
    // divide ni se pierde.
    const batchId = global.nextIABatchId();
    const proposals = pp.proposals.map(p => ({
      id: global.nextIAProposalId(),
      batchId,
      source: 'planning',
      status: 'pending',
      taskId: p.taskId,
      date: p.date,
      startTime: p.startTime,
      endTime: p.endTime,
      minutes: p.minutes,
      reason: p.reason,
    }));

    return { batchId, proposals };
  }

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
    const DOW_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const todayDow = DOW_ES[new Date(today + 'T00:00:00').getDay()];
    lines.push(`FECHA ACTUAL: ${today} (${todayDow}).`);
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
    // Fase 6A-3: usa eventsForScheduler() (definida en organizator.html)
    // si está disponible, para que blocksSchedule llegue ya resuelto a
    // Scheduler igual que en el resto de la app. No toca buildActionContext
    // (el texto que lee la IA) ni el Chat: solo el contexto interno que
    // se pasa a Scheduler.scheduleTask/findConflicts/rescheduleTask.
    const events = (typeof global.eventsForScheduler === 'function') ? global.eventsForScheduler() : global.state.events;
    return { tasks: global.state.tasks, events, customSchedules: global.state.customSchedules };
  }

  async function applyCreateTask(a) {
    await global.addTask({
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

  /* ==================================================================
     AI-3.6 — Aplicar/descartar de forma segura
     Conecta las propuestas `source:'planning'` (AI-3.5) con el sistema
     EXISTENTE de Apply/Discard de 5D (organizator.html — "IA — ASISTENTE
     PERSONAL"). NO crea un segundo sistema de Apply/Discard, NO añade un
     array de batches nuevo, NO toca ACTION_SCHEMA/Scheduler/reminders/
     Smart Forms/persistencia/recurrence/AI-3.4/AI-3.5.

     Colocado deliberadamente AQUÍ (junto a applyCreateTask/applyMoveItem/
     applyCancelItem/applyUpdatePriority, que ya siguen exactamente el
     mismo patrón de mutación real vía global.state/global.updateTask) y
     NO junto a createPlanningProposalBatch (AI-3.5): los tests de AI-3.5
     extraen su propio bloque por CONTENIDO usando como delimitador el
     inicio de la sección "Contexto con IDs" que sigue inmediatamente
     después — insertar AI-3.6 ahí en medio ampliaría esa extracción y
     rompería sus comprobaciones de que "AI-3.5 no llama a
     setIAProposalStatus/Scheduler" (esas llamadas SÍ existen, a propósito,
     en AI-3.6). Esta ubicación evita ese solape sin tocar ningún test
     existente.

     Investigación previa reutilizada tal cual, sin duplicar:
       - `getIAProposalFromBatch(id, batchId)` (ya existente): ÚNICO punto
         de acceso por IDs estables — nunca por posición del array (esta
         fase nunca indexa `iaProposals` a mano).
       - `IA_PROPOSAL_ALLOWED_TRANSITIONS`/`setIAProposalStatus()` (ya
         existentes): pending->applied y pending->discarded siguen siendo
         las ÚNICAS transiciones permitidas; esta fase no las reimplementa,
         solo las invoca.
       - Discard YA funciona sin cambios para `source:'planning'`:
         `setIAProposalStatus(id, 'discarded')` no distingue por `source`,
         no toca la tarea real y ya deja la propuesta inaplicable (una vez
         'discarded', `IA_PROPOSAL_ALLOWED_TRANSITIONS.discarded` es
         `undefined`, así que ninguna transición posterior es válida). Por
         eso AI-3.6 no añade ninguna función de discard: el wiring de
         organizator.html (wireIAProposalButtons) ya vale tal cual para
         cualquier `source`.
       - `getPendingIAProposalsByBatchId(batchId)` (ya existente):
         reutilizado para detectar conflictos entre propuestas PENDIENTES
         del mismo batch antes de aplicar (punto 5 del encargo).
       - `global.state.tasks`/`global.updateTask` (mismo patrón que
         applyCreateTask/applyMoveItem, arriba en este mismo archivo): a
         diferencia de `applyIAProposal` (organizator.html, `source:`
         `'day'`/`'week'`), que SIEMPRE crea una entidad NUEVA a partir de
         `it.title`/`it.time` (nunca encaja con una propuesta de
         planificación, que apunta a una tarea YA EXISTENTE por `taskId`),
         Apply de AI-3.6 escribe `scheduledDate`/`scheduledStart`/
         `scheduledEnd` sobre esa tarea existente vía `global.updateTask`
         — nunca `global.addTask`, nunca una segunda tarea/ocurrencia.
       - `global.Scheduler._internal.getBusyIntervals(date, ctx,
         excludeTaskId)` (ya existente, mismo contrato que usa
         `revalidateIAProposalBeforeApply` en organizator.html para
         source:'day'/'week'): aquí se usa con `excludeTaskId = taskId`
         real de la propuesta, más simple que la técnica de "sonda" que
         usan aquellas (no tienen un taskId real que excluir; esta sí).

     Resultado siempre explícito — `{ status, reason? }`, con `status` uno
     de: 'applied' | 'already_applied' | 'invalid' | 'stale' | 'conflict'
     | 'discarded' | 'not_found'. Nunca aplica de forma silenciosa ni
     parcial: cualquier validación fallida corta ANTES de mutar `state`
     o `iaProposals`. */

  /** Misma forma estructural que `isValidPlanningProposalEntry` (AI-3.5),
   * aplicada aquí sobre una propuesta YA CONVERTIDA en iaProposal (con
   * id/batchId/source/status añadidos) — nunca recalcula taskId/date/
   * startTime/endTime/reason, solo comprueba que siguen teniendo forma
   * válida antes de aplicar. */
  function isPlanningProposalStructurallyValid(p) {
    return !!p && typeof p === 'object'
      && typeof p.taskId === 'string' && p.taskId.length > 0
      && isValidYMDStringLocal(p.date)
      && isValidHHMMStringLocal(p.startTime)
      && isValidHHMMStringLocal(p.endTime)
      && p.startTime < p.endTime;
  }

  /** Dos propuestas de planning "chocan" si caen el mismo día y sus
   * franjas [startTime,endTime) se solapan — mismo criterio de solape
   * que ya usa AI-3.4 internamente para no proponer huecos encimados. */
  function planningProposalsOverlap(a, b) {
    if (a.date !== b.date) return false;
    return a.startTime < b.endTime && b.startTime < a.endTime;
  }

  /** Revalidación justo antes de aplicar (punto 3 del encargo): ¿el hueco
   * EXACTO de esta propuesta sigue libre AHORA MISMO contra el estado
   * real actual? Excluye la propia tarea objetivo de su cálculo de huecos
   * ocupados (getBusyIntervals ya soporta `excludeTaskId` para esto) para
   * no chocar consigo misma si ya tenía otro bloque asignado antes.
   * Pureza relativa: lee `global.state`/`global.Scheduler`, no los muta.
   * Devuelve { valid: true } o { valid: false, reason: string }. */
  function revalidatePlanningProposalBeforeApply(proposal) {
    if (!global.Scheduler || !global.Scheduler._internal) return { valid: true };
    const { timeToMin, getBusyIntervals } = global.Scheduler._internal;
    const startMin = timeToMin(proposal.startTime);
    const endMin = timeToMin(proposal.endTime);
    const busy = getBusyIntervals(proposal.date, schedulerContext(), proposal.taskId);
    const invades = busy.some(([bs, be]) => startMin < be && endMin > bs);
    if (invades) {
      return { valid: false, reason: 'Ya no encaja: el calendario cambió desde que se generó esta propuesta.' };
    }
    return { valid: true };
  }

  /** Punto de entrada de AI-3.6. Localiza la propuesta EXCLUSIVAMENTE por
   * `id`+`batchId` (nunca por posición de `iaProposals`) vía
   * `getIAProposalFromBatch` (ya existente). Todas las validaciones de la
   * sección "SEGURIDAD/ATOMICIDAD" del encargo cortan ANTES de tocar
   * `state`/`iaProposals`; ninguna deja un cambio a medias. */
  async function applyPlanningProposal(id, batchId) {
    if (typeof global.getIAProposalFromBatch !== 'function') {
      return { status: 'not_found', reason: 'El sistema de propuestas IA no está disponible.' };
    }
    const proposal = global.getIAProposalFromBatch(id, batchId);
    if (!proposal) {
      return { status: 'not_found', reason: 'La propuesta no existe o no pertenece a ese batch.' };
    }
    if (proposal.source !== 'planning') {
      return { status: 'invalid', reason: 'Esta propuesta no es de planificación (AI-3.6 no aplica).' };
    }

    // Transiciones ya resueltas por el sistema existente: una propuesta
    // descartada nunca vuelve a aplicarse; una ya aplicada es un no-op
    // explícito (idempotencia por `status`, punto 6 del encargo).
    if (proposal.status === 'discarded') {
      return { status: 'discarded', reason: 'Esta propuesta ya fue descartada.' };
    }
    if (proposal.status === 'applied') {
      return { status: 'already_applied', reason: 'Esta propuesta ya se había aplicado antes.' };
    }
    if (proposal.status !== 'pending') {
      return { status: 'invalid', reason: 'La propuesta tiene un estado desconocido.' };
    }

    if (!isPlanningProposalStructurallyValid(proposal)) {
      return { status: 'invalid', reason: 'La propuesta ya no tiene una forma válida.' };
    }

    if (!global.state || !Array.isArray(global.state.tasks)) {
      return { status: 'invalid', reason: 'No se pudo comprobar el estado actual de las tareas.' };
    }
    const targetTask = global.state.tasks.find(t => t.id === proposal.taskId);
    if (!targetTask) {
      return { status: 'invalid', reason: 'La tarea de esta propuesta ya no existe.' };
    }
    if (targetTask.done) {
      return { status: 'invalid', reason: 'La tarea ya se completó — no tiene sentido programarla.' };
    }

    // Idempotencia defensiva (punto 6 del encargo, capa extra sobre el
    // chequeo de `status` de arriba): si la tarea YA tiene exactamente
    // este resultado, no se vuelve a escribir nada — mismo espíritu que
    // el "already" de applyIAProposal (organizator.html) para
    // source:'day'/'week'.
    if (targetTask.scheduledDate === proposal.date
      && targetTask.scheduledStart === proposal.startTime
      && targetTask.scheduledEnd === proposal.endTime) {
      if (typeof global.setIAProposalStatus === 'function') global.setIAProposalStatus(proposal.id, 'applied');
      return { status: 'already_applied', reason: 'Esta propuesta ya se había aplicado antes.' };
    }

    // Conflicto entre propuestas PENDIENTES del mismo batch (punto 5 del
    // encargo): se detecta ANTES de mutar nada, nunca después. AI-3.4 ya
    // genera propuestas sin solapes entre sí, pero Apply no confía
    // ciegamente en esa garantía de generación.
    if (typeof global.getPendingIAProposalsByBatchId === 'function') {
      const siblings = global.getPendingIAProposalsByBatchId(batchId)
        .filter(p => p.id !== proposal.id && p.source === 'planning');
      const clash = siblings.find(s => planningProposalsOverlap(proposal, s));
      if (clash) {
        return { status: 'conflict', reason: 'Choca con otra propuesta pendiente del mismo batch.' };
      }
    }

    const revalidation = revalidatePlanningProposalBeforeApply(proposal);
    if (!revalidation.valid) {
      return { status: 'stale', reason: revalidation.reason };
    }

    await global.updateTask(targetTask.id, {
      scheduledDate: proposal.date,
      scheduledStart: proposal.startTime,
      scheduledEnd: proposal.endTime,
    });

    if (typeof global.setIAProposalStatus !== 'function' || !global.setIAProposalStatus(proposal.id, 'applied')) {
      return { status: 'invalid', reason: 'No se pudo marcar la propuesta como aplicada.' };
    }

    return { status: 'applied' };
  }

  /** AI-1.1: si el modelo devuelve la misma acción repetida para un único
   * mensaje del usuario (idéntica en todos sus campos), solo se aplica
   * una vez — un mismo hecho contado una sola vez no debe traducirse en
   * dos altas/cambios idénticos. Compara por contenido completo
   * (JSON.stringify), no por posición ni por "op" a secas (dos
   * create_task con títulos distintos NO son duplicados entre sí). No
   * reordena ni modifica ninguna acción, solo filtra duplicados exactos
   * manteniendo la primera aparición — sigue siendo el mismo
   * ACTION_SCHEMA/runIAAction de siempre, esto es solo una guarda previa
   * a aplicar. */
  function dedupeActions(actions) {
    const seen = new Set();
    const result = [];
    for (const a of actions) {
      const key = JSON.stringify(a);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(a);
    }
    return result;
  }

  /* ---------------- Punto de entrada desde el chat ---------------- */
  async function runIAAction(message) {
    const context = buildActionContext();
    // AI-1.2: pistas de fecha/hora ya resueltas en código (deterministas,
    // basadas en la misma FECHA ACTUAL que ya usa buildActionContext —
    // nunca en new Date()), añadidas al contexto SIN tocar
    // buildActionContext() ni su contrato. Si el mensaje no trae ninguna
    // referencia temporal reconocible, buildTemporalHints() devuelve ''
    // y el contexto queda exactamente igual que antes de AI-1.2.
    const temporalHints = buildTemporalHints(message, global.todayStr());
    // AI-1.5: si el mensaje encaja con un patrón de mover/cancelar/
    // repriorizar algo EXISTENTE (ver bloque AI-1.5 más abajo), esa
    // lectura tiene prioridad sobre las pistas de creación implícita de
    // AI-1.3/AI-1.4 — un mensaje como "no tengo que ir al médico
    // finalmente" comparte palabras con el patrón de cita de AI-1.3
    // ("tengo que ir al médico") pero es una CANCELACIÓN, no una cita
    // nueva. Por eso las pistas de AI-1.3/1.4 se omiten para estos
    // mensajes, evitando pistas contradictorias en el mismo contexto.
    const isModificationMessage = isCancelMessage(message) || isPriorityChangeMessage(message) || isMoveMessage(message);
    // AI-1.3: pista orientativa de si el mensaje describe un festivo o
    // una cita/compromiso implícitos (heurística por palabras clave,
    // ver cabecera del bloque AI-1.3 más arriba) — reutiliza
    // resolveDateExpression/resolveTimeExpression de AI-1.2 tal cual,
    // no las reimplementa. Si el mensaje no encaja con ningún patrón,
    // buildImplicitEventHints() devuelve '' y el contexto no cambia.
    const implicitEventHints = isModificationMessage ? '' : buildImplicitEventHints(message, global.todayStr());
    // AI-1.4: pista orientativa de si el mensaje describe una tarea
    // implícita (heurística por palabras clave, ver cabecera del bloque
    // AI-1.4 más arriba) — reutiliza resolveDateExpression/
    // resolveTimeExpression de AI-1.2 tal cual y nunca se solapa con la
    // pista de AI-1.3 (buildImplicitTaskHints ya comprueba
    // isHolidayMessage/isAppointmentMessage internamente). Si el mensaje
    // no encaja, buildImplicitTaskHints() devuelve '' y el contexto no cambia.
    const implicitTaskHints = isModificationMessage ? '' : buildImplicitTaskHints(message, global.todayStr());
    // AI-1.5: pista orientativa de si el mensaje pide mover/cancelar/
    // repriorizar algo existente — ver cabecera del bloque AI-1.5 más
    // abajo. Nunca intenta identificar el targetId por su cuenta: eso
    // sigue siendo tarea exclusiva de la IA a partir de la LISTA DE
    // ELEMENTOS EXISTENTES de buildActionContext (sin tocar).
    const modificationHints = buildModificationHints(message, global.todayStr());
    const hintBlocks = [temporalHints, implicitEventHints, implicitTaskHints, modificationHints].filter(Boolean);
    const fullContext = hintBlocks.length ? `${context}\n\n${hintBlocks.join('\n\n')}` : context;
    const raw = await global.callAI(ACTION_RULES + '\n\nEsquema exacto:\n' + ACTION_SCHEMA,
      `MENSAJE DEL USUARIO: ${message}\n\n${fullContext}`);
    const data = global.parseAIJSON(raw);
    const notes = [];
    for (const a of dedupeActions(data.actions || [])) {
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
  // AI-2.3: detectSmartFormIntent (AI-2.1) se expone como propiedad
  // ADICIONAL sobre el mismo objeto, en una sentencia aparte, para que
  // organizator.html (runIAActionChat) pueda llamarla al conectar el
  // chat con los formularios existentes — sin tocar ni una letra de la
  // línea de arriba (`global.AIActions = { runIAAction,
  // buildActionContext, ACTION_SCHEMA, ACTION_RULES };`), que sigue
  // siendo exactamente la misma que ya comprueban test-event-categories.js
  // y toda la suite AI-1.x/AI-2.1 con su propia regex literal.
  global.AIActions.detectSmartFormIntent = detectSmartFormIntent;
  // AI-2.2: mismo criterio exacto que detectSmartFormIntent justo arriba
  // — propiedad ADICIONAL sobre el mismo objeto, sin tocar la línea del
  // export principal, para que organizator.html (openSmartFormFromChat,
  // AI-2.3) pueda normalizar el prefill sin leer intent.fields directamente.
  global.AIActions.buildSmartFormPrefill = buildSmartFormPrefill;
  // AI-2.6: mismo criterio exacto que detectSmartFormIntent/
  // buildSmartFormPrefill justo arriba — propiedad ADICIONAL sobre el
  // mismo objeto, sin tocar la línea del export principal, para que
  // organizator.html (runIAActionChat) pueda comprobar si falta algún
  // dato necesario antes de abrir el formulario.
  global.AIActions.getSmartFormClarification = getSmartFormClarification;
  // AI-2.8: mismo criterio exacto que detectSmartFormIntent/
  // buildSmartFormPrefill/getSmartFormClarification justo arriba —
  // propiedad ADICIONAL sobre el mismo objeto, sin tocar la línea del
  // export principal, para que organizator.html (openTaskModal/
  // openEventModal) pueda comprobar duplicados antes de crear.
  global.AIActions.findExistingSmartFormEquivalent = findExistingSmartFormEquivalent;
  // AI-3.1: mismo criterio exacto que las adiciones de arriba —
  // propiedad ADICIONAL sobre el mismo objeto, sin tocar la línea del
  // export principal, para que fases futuras de AI-3 (todavía sin
  // conectar a ningún flujo real, ver cabecera del bloque AI-3.1) puedan
  // reutilizar esta detección de intención de planificación.
  global.AIActions.detectPlanningIntent = detectPlanningIntent;
  // AI-3.2: mismo criterio exacto que las adiciones de arriba —
  // propiedad ADICIONAL sobre el mismo objeto, sin tocar la línea del
  // export principal, para que fases futuras de AI-3 (todavía sin
  // conectar a ningún flujo real) puedan reutilizar la extracción de
  // restricciones de planificación.
  global.AIActions.extractPlanningConstraints = extractPlanningConstraints;
  // AI-3.3: mismo criterio exacto que las adiciones de arriba —
  // propiedad ADICIONAL sobre el mismo objeto, sin tocar la línea del
  // export principal, para que fases futuras de AI-3 (todavía sin
  // conectar a ningún flujo real) puedan reutilizar el análisis de
  // huecos disponibles.
  global.AIActions.analyzePlanningAvailability = analyzePlanningAvailability;
  // AI-3.4: mismo criterio exacto que las adiciones de arriba —
  // propiedad ADICIONAL sobre el mismo objeto, sin tocar la línea del
  // export principal, para que fases futuras de AI-3 (todavía sin
  // conectar a ningún flujo real) puedan reutilizar la generación de
  // propuestas de planificación.
  global.AIActions.generatePlanningProposal = generatePlanningProposal;
  // AI-3.5: mismo criterio exacto que las adiciones de arriba —
  // propiedad ADICIONAL sobre el mismo objeto, sin tocar la línea del
  // export principal ni ninguno de los exports de AI-3.1/AI-3.2/AI-3.3/
  // AI-3.4, para conectar la propuesta pura de AI-3.4 con el sistema
  // existente de batches de propuestas IA.
  global.AIActions.createPlanningProposalBatch = createPlanningProposalBatch;
  // AI-3.6: mismo criterio exacto que las adiciones de arriba — propiedad
  // ADICIONAL sobre el mismo objeto, sin tocar la línea del export
  // principal ni ninguno de los exports de AI-3.1/AI-3.2/AI-3.3/AI-3.4/
  // AI-3.5, para conectar los batches de AI-3.5 con el Apply/Discard
  // existente de 5D.
  global.AIActions.applyPlanningProposal = applyPlanningProposal;
})(typeof window !== 'undefined' ? window : globalThis);
