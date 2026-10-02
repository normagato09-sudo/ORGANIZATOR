/**
 * ORGANIZATOR — Tests: errores de la IA con su causa real
 *
 * Antes, cualquier fallo de "Organizar mi día/semana" o del chat salía
 * como "error de conexión", fuera un límite de uso de Groq, una petición
 * demasiado grande o una respuesta cortada. Ahora:
 *  - api/ai.js devuelve { error, code } ('rate_limit', 'rate_limit_day',
 *    'too_large', 'truncated', 'upstream_network', 'upstream'...) y pide
 *    a Groq reasoning_effort "low";
 *  - callAI/parseAIJSON propagan ese código y iaErrorMessage lo explica;
 *  - día, semana y chat muestran ese mensaje.
 *
 * Suite Node pura: api/ai.js se ejecuta con un fetch simulado, y el
 * código del navegador se extrae literalmente de organizator.html.
 *
 * Uso:  node js/test-ia-errors.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Se normaliza CRLF→LF solo en memoria (core.autocrlf puede dejar CRLF en disco).
const html = fs.readFileSync(path.join(ROOT, 'organizator.html'), 'utf8').replace(/\r\n/g, '\n');
const schedulerSrc = fs.readFileSync(path.join(ROOT, 'js', 'scheduler.js'), 'utf8');

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el inicio de "${label}" en organizator.html — ¿cambió el código?`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`No se encontró el final de "${label}" en organizator.html — ¿cambió el código?`);
  return source.slice(start, end);
}

const sources = [
  ['config', extractBetween(html, 'const PRIORITIES = ', '\n\n/* ==================================================================\n   AJUSTES', 'PRIORITIES/DOW_*/MONTH_NAMES')],
  ['fechas', extractBetween(html, '/* ==================================================================\n   UTILIDADES DE FECHA', '\n\n/* ==================================================================\n   HORARIOS BLOQUEADOS', 'UTILIDADES DE FECHA')],
  ['horarios', extractBetween(html, 'function schedulesForDow(dow){', '\n}\n', 'schedulesForDow') + '\n}\n'],
  ['semana helpers', extractBetween(html, 'function dowOfDate(dateStr){', '\nfunction weekGoForward(){', 'dowOfDate/getWeekMonday/getWeekDays')],
  ['recurrencia', extractBetween(html, '/* ==================================================================\n   SANEAMIENTO DE EVENTOS/CATEGORÍAS IMPORTADOS', '\n\nfunction initSettingsDataIO(){', 'SANEAMIENTO + RECURRENCIA')],
  ['categorías + R-6', extractBetween(html, '/* ==================================================================\n   CATEGORÍAS DE EVENTOS (Fase 6A-3)', '\n\n/* ==================================================================\n   RECORDATORIOS — cálculo de remindAt', 'CATEGORÍAS + R-6')],
  ['CRUD', extractBetween(html, '/* ==================================================================\n   CRUD', '\n\n/* ==================================================================\n   RECORDATORIOS', 'CRUD')],
  ['esc', extractBetween(html, 'function esc(s){', '\n}\n\n/* ==================================================================\n   FILAS DE TAREA', 'esc') + '\n}'],
  ['propuestas IA', extractBetween(html, 'let iaProposals = [];', '\n/* ---------- Llamada a la IA', 'ciclo de vida de propuestas IA')],
  ['buildContext', extractBetween(html, 'function buildContext(scope, anchorDate, endDate){', '\nconst PLAN_ITEM_SCHEMA', 'buildContext')],
  ['constantes IA', extractBetween(html, 'const PLAN_ITEM_SCHEMA = `{', '\nfunction iaSetStatus(msg){', 'PLAN_ITEM_SCHEMA + IA_RULES')],
  ['planWeekProposals', extractBetween(html, 'function planWeekProposals(days, today, weekEnd, schedCtx){', '\n/* ---------- Validación de propuestas semanales', 'planWeekProposals')],
  ['validación + revalidación', extractBetween(html, 'function validateWeeklyProposal(item, applyDate, schedCtx, weekStart, weekEnd, deadline){', '\n/* ---------- Agenda visual', 'validateWeeklyProposal + revalidateIAProposalBeforeApply')],
  ['splice + agenda', extractBetween(html, 'function spliceProposalsIntoBlocks(blocks, placedProposals){', '\n\n/* ---------- Hilo único del asistente', 'spliceProposalsIntoBlocks + renderDayAgendaList')],
  ['renderIAItemHTML', extractBetween(html, 'function renderIAItemHTML(it, dateForApply, batchId){', '\nfunction wireIAProposalButtons(container){', 'renderIAItemHTML')],
  ['expire', extractBetween(html, 'function iaExpirePendingProposalsBeforeReset(){', '\n/** Franja real de una propuesta IA', 'iaExpirePendingProposalsBeforeReset')],
  ['applyIAProposal', extractBetween(html, '/** Franja real de una propuesta IA', '\n/* ---------- Organizar mi día', 'iaProposalSlot/findIAProposalSourceTask/applyIAProposal')],
  ['runIADay + runIAWeek', extractBetween(html, 'async function runIADay(){', '\n/* ---------- Chat con la IA', 'runIADay + runIAWeek')],
  ['badges', extractBetween(html, 'function renderEventContextBadges(eventContext){', '\n/* ---------- Semana: lo del día', 'renderEventContextBadges')],
];

function makeSandbox() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.document = { getElementById: () => null, querySelectorAll: () => [] };
  sandbox.currentView = 'inicio';
  sandbox.iaSetStatus = () => {};
  sandbox.iaSetButtonsDisabled = () => {};
  sandbox.iaThreadAddPending = () => ({});
  sandbox.iaThreadResolve = () => {};
  sandbox.wireIAProposalButtons = () => {};
  sandbox.renderSemana = () => {};
  sandbox.renderInicio = () => {};
  sandbox.renderCalendar = () => {};
  sandbox.renderCurrentView = () => {};
  sandbox.showToast = () => {};
  sandbox.parseAIJSON = (raw) => raw; // callAI (mock) ya devuelve el objeto final
  sandbox.__aiResponse = null;
  sandbox.callAI = async (system, context) => { sandbox.__lastSystem = system; sandbox.__lastContext = context; return sandbox.__aiResponse; };
  sandbox.storage = { async get() { return null; }, async set() { return {}; } };
  vm.createContext(sandbox);
  vm.runInContext(schedulerSrc, sandbox, { filename: 'js/scheduler.js' });
  vm.runInContext(`var state = { tasks: [], events: [], customSchedules: [], eventCategories: [] };
    var uidSeq = 0; function uid(){ uidSeq += 1; return 'uid-' + uidSeq; }
    async function saveTasks(){} async function saveEvents(){} async function saveEventCategories(){}
    async function cancelRemindersForTaskAndOccurrences(){} async function cancelRemindersForTarget(){}
    function openActualMinutesModal(){}`, sandbox);
  sources.forEach(([label, src]) => vm.runInContext(src, sandbox, { filename: `organizator.html (${label})` }));
  vm.runInContext('this.__getIAProposals = function(){ return iaProposals; };', sandbox);
  return sandbox;
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

// Código del navegador de las llamadas a la IA (callAI, iaError,
// parseAIJSON, iaErrorMessage) y el chat (runIAActionChat).
const callAISrc = extractBetween(html, 'async function callAI(systemPrompt, userPrompt){', '\n\n/* ---------- Contexto real', 'callAI + iaErrorMessage');
const chatSrc = extractBetween(html, 'async function runIAActionChat(question){', '\n\n/* ---------- Wiring inicial', 'runIAActionChat');

// ---------- api/ai.js con fetch simulado ----------
const handler = require(path.join(ROOT, 'api', 'ai.js'));
function groqResponse(status, body) {
  return { ok: status >= 200 && status < 300, status,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    async json() { return typeof body === 'string' ? JSON.parse(body) : body; } };
}
async function callHandler(fetchImpl, { key = 'test-key', body = { system: 's', prompt: 'p' } } = {}) {
  const prevFetch = global.fetch, prevKey = process.env.GROQ_API_KEY, prevErr = console.error;
  global.fetch = fetchImpl;
  if (key) process.env.GROQ_API_KEY = key; else delete process.env.GROQ_API_KEY;
  console.error = () => {}; // los logs del handler no ensucian la salida del test
  const out = { status: null, body: null, headers: {} };
  const res = { setHeader(k, v) { out.headers[k] = v; }, status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  try { await handler({ method: 'POST', body }, res); }
  finally { global.fetch = prevFetch; console.error = prevErr; if (prevKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = prevKey; }
  return out;
}
const TPM_429 = { error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 6000, Requested 4400.', type: 'tokens', code: 'rate_limit_exceeded' } };
const TPD_429 = { error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199000, Requested 4400.', type: 'tokens', code: 'rate_limit_exceeded' } };
const TOO_LARGE_413 = { error: { message: 'Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9500.', type: 'tokens', code: 'rate_limit_exceeded' } };
const CONTEXT_400 = { error: { message: 'Please reduce the length of the messages.', type: 'invalid_request_error', code: 'context_length_exceeded' } };
const ok = (content, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }] });

function makeBrowserSandbox() {
  const sb = { console, JSON, state: { ia: { enabled: true } } };
  vm.createContext(sb);
  vm.runInContext(callAISrc, sb, { filename: 'organizator.html (callAI)' });
  return sb;
}
const browserFetch = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, async json() { if (body === undefined) throw new Error('no json'); return body; } });

(async () => {
  section('A — api/ai.js: un código por cada causa');
  {
    let sentPayload = null;
    const okRes = await callHandler(async (url, init) => { sentPayload = JSON.parse(init.body); return groqResponse(200, ok('{"a":1}')); });
    check('A. respuesta normal: 200 con el texto', okRes.status === 200 && okRes.body.text === '{"a":1}');
    check('A. pide a Groq reasoning_effort "low"', !!sentPayload && sentPayload.reasoning_effort === 'low');
    check('A. mantiene max_tokens', !!sentPayload && sentPayload.max_tokens === 1800);

    const tpm = await callHandler(async () => groqResponse(429, TPM_429));
    check('A. 429 por minuto → 429 rate_limit', tpm.status === 429 && tpm.body.code === 'rate_limit' && tpm.body.upstreamStatus === 429);
    const tpd = await callHandler(async () => groqResponse(429, TPD_429));
    check('A. 429 por día → rate_limit_day', tpd.status === 429 && tpd.body.code === 'rate_limit_day');
    const big = await callHandler(async () => groqResponse(413, TOO_LARGE_413));
    check('A. 413 → too_large', big.status === 413 && big.body.code === 'too_large');
    const ctx = await callHandler(async () => groqResponse(400, CONTEXT_400));
    check('A. contexto demasiado largo (400) → too_large', ctx.body.code === 'too_large');
    const other = await callHandler(async () => groqResponse(503, 'Service Unavailable'));
    check('A. otro error de Groq → 502 upstream con su estado', other.status === 502 && other.body.code === 'upstream' && other.body.upstreamStatus === 503);
    const net = await callHandler(async () => { throw new Error('ECONNRESET'); });
    check('A. sin conexión con Groq → upstream_network', net.status === 502 && net.body.code === 'upstream_network');
    const cut = await callHandler(async () => groqResponse(200, ok('{"summary":"a","days":[{"da', 'length')));
    check('A. respuesta cortada (finish_reason length) → truncated, no se devuelve el JSON roto', cut.status === 502 && cut.body.code === 'truncated' && !cut.body.text);
    const empty = await callHandler(async () => groqResponse(200, ok('')));
    check('A. respuesta vacía → upstream', empty.status === 502 && empty.body.code === 'upstream');
    const noKey = await callHandler(async () => groqResponse(200, ok('x')), { key: null });
    check('A. sin GROQ_API_KEY → config', noKey.status === 500 && noKey.body.code === 'config');
    check('A. classifyGroqError exportada', typeof handler.classifyGroqError === 'function' && handler.classifyGroqError(429, JSON.stringify(TPD_429)) === 'rate_limit_day');
  }

  section('B — navegador: callAI y parseAIJSON propagan el código');
  {
    const codeOf = async (sb) => { try { await sb.callAI('s', 'p'); return 'sin error'; } catch (e) { return e.code; } };
    let sb = makeBrowserSandbox();
    sb.fetch = browserFetch(429, { error: 'x', code: 'rate_limit', upstreamStatus: 429 });
    check('B. 429 de api/ai → rate_limit', await codeOf(sb) === 'rate_limit');
    sb = makeBrowserSandbox();
    sb.fetch = async () => { throw new TypeError('Failed to fetch'); };
    check('B. sin conexión → network', await codeOf(sb) === 'network');
    sb = makeBrowserSandbox();
    sb.fetch = browserFetch(504);
    check('B. respuesta no-JSON (p.ej. timeout de Vercel) → upstream', await codeOf(sb) === 'upstream');
    sb = makeBrowserSandbox();
    sb.fetch = browserFetch(502, { error: 'x', code: 'upstream', upstreamStatus: 503 });
    let err = null; try { await sb.callAI('s', 'p'); } catch (e) { err = e; }
    check('B. upstream conserva el estado de Groq en el mensaje', !!err && sb.iaErrorMessage(err).includes('error 503'));
    sb = makeBrowserSandbox();
    sb.state.ia.enabled = false;
    check('B. IA desactivada → disabled', await codeOf(sb) === 'disabled');
    let parseErr = null; try { sb.parseAIJSON('{"summary": "a", "days": [{"da'); } catch (e) { parseErr = e; }
    check('B. JSON incompleto → invalid_json', !!parseErr && parseErr.code === 'invalid_json');
    check('B. parseAIJSON sigue leyendo JSON con ```json', sb.parseAIJSON('```json\n{"a":1}\n```').a === 1);
  }

  section('C — iaErrorMessage: un mensaje distinto para cada causa');
  {
    const sb = makeBrowserSandbox();
    const msg = (code) => sb.iaErrorMessage({ code });
    check('C. network habla de conexión', /conexión/.test(msg('network')));
    check('C. rate_limit: esperar un minuto', /límite de uso/.test(msg('rate_limit')) && /minuto/.test(msg('rate_limit')));
    check('C. rate_limit_day: mañana', /diario/.test(msg('rate_limit_day')) && /mañana/.test(msg('rate_limit_day')));
    check('C. too_large: demasiado grande', /demasiado grande/.test(msg('too_large')));
    check('C. truncated e invalid_json: incompleta', /incompleta/.test(msg('truncated')) && msg('invalid_json') === msg('truncated'));
    const codes = ['network', 'rate_limit', 'rate_limit_day', 'too_large', 'truncated', 'upstream_network', 'upstream', 'config', 'disabled'];
    check('C. ningún código comparte mensaje con otro', new Set(codes.map(msg)).size === codes.length);
    check('C. solo "network" habla de la conexión del usuario', codes.filter(c => /tu conexión/.test(msg(c))).join() === 'network');
    check('C. un error sin código no se presenta como "conexión"', !/conexión/.test(sb.iaErrorMessage(new Error('x'))));
  }

  section('D — día, semana y chat muestran ese mensaje');
  {
    const withError = (code) => {
      const sb = makeSandbox();
      vm.runInContext(callAISrc, sb, { filename: 'organizator.html (callAI)' });
      vm.runInContext(chatSrc, sb, { filename: 'organizator.html (runIAActionChat)' });
      sb.__resolved = [];
      sb.iaThreadResolve = (el, html) => sb.__resolved.push(html);
      sb.console = { error() {}, log: console.log };
      vm.runInContext(`callAI = async function(){ throw iaError(${JSON.stringify(code)}, 'x'); }`, sb);
      sb.AIActions = { runIAAction: async () => { throw sb.iaError(code, 'x'); } };
      return sb;
    };
    let sb = withError('rate_limit');
    await sb.runIAWeek();
    check('D. semana: mensaje de límite de uso, no de conexión', sb.__resolved.length === 1 && sb.__resolved[0].includes('límite de uso') && !sb.__resolved[0].includes('error de conexión'));
    sb = withError('truncated');
    await sb.runIADay();
    check('D. día: respuesta incompleta', sb.__resolved.length === 1 && sb.__resolved[0].includes('incompleta'));
    sb = withError('rate_limit_day');
    await sb.runIAActionChat('organízame la tarde');
    check('D. chat: límite diario', sb.__resolved.length === 1 && sb.__resolved[0].includes('mañana'));
  }

  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
