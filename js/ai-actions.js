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
})(typeof window !== 'undefined' ? window : globalThis);
