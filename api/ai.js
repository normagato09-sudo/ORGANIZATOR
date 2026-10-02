/**
 * ORGANIZATOR — Proxy de IA (Fase 6.5, migrado a Groq)
 *
 * Función serverless de Vercel que hace de intermediaria entre el navegador
 * y la API de Groq (modelos open-source, capa gratuita). El navegador NUNCA
 * ve la API key: esta función lee GROQ_API_KEY de las variables de entorno
 * de Vercel (solo accesibles en el servidor) y es la única que habla con
 * api.groq.com.
 *
 * organizator.html sigue construyendo el contexto (buildContext) y el
 * system prompt en el propio navegador — aquí solo se reenvía a Groq y se
 * devuelve el texto de la respuesta. No se guarda nada, no se toca
 * window.storage ni ningún dato del usuario.
 *
 * Contrato con el cliente (sin cambios respecto a la versión con Anthropic):
 *   POST /api/ai   body: { system?: string, prompt: string }
 *   → 200 { text: string }
 *   → 4xx/5xx { error: string, code: string, upstreamStatus?: number }
 *
 * `code` dice qué falló, para que el navegador lo explique (iaErrorMessage
 * en organizator.html): 'rate_limit' (límite por minuto), 'rate_limit_day'
 * (límite diario), 'too_large' (petición demasiado grande), 'truncated'
 * (respuesta cortada por MAX_TOKENS), 'upstream_network' (el servidor no
 * llegó a Groq), 'upstream' (cualquier otro error de Groq), 'config',
 * 'bad_request'.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const AI_MODEL = 'openai/gpt-oss-120b';
const MAX_TOKENS = 1800;
// gpt-oss razona antes de responder; con "low" gasta menos tokens en
// razonar, deja más margen a la respuesta dentro de MAX_TOKENS y consume
// menos del límite de tokens por minuto/día del plan gratuito.
const REASONING_EFFORT = 'low';

/** Clasifica un error HTTP de Groq a partir de su estado y su cuerpo. */
function classifyGroqError(status, detail) {
  const text = String(detail || '');
  if (status === 413 || /context_length_exceeded/i.test(text)) return 'too_large';
  if (status === 429) return /per day|\(TPD\)|\(RPD\)/i.test(text) ? 'rate_limit_day' : 'rate_limit';
  return 'upstream';
}

const ERROR_STATUS = { rate_limit: 429, rate_limit_day: 429, too_large: 413 };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Fallo de configuración del servidor, nunca del usuario.
    console.error('[api/ai] Falta la variable de entorno GROQ_API_KEY en Vercel');
    return res.status(500).json({ error: 'La IA no está configurada en el servidor todavía.', code: 'config' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const prompt = body && body.prompt;
  const system = body && body.system;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Falta el campo "prompt" en la petición.', code: 'bad_request' });
  }

  const messages = [];
  if (typeof system === 'string' && system.trim()) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: prompt });

  const payload = {
    model: AI_MODEL,
    max_tokens: MAX_TOKENS,
    reasoning_effort: REASONING_EFFORT,
    messages,
  };

  let groqRes;
  try {
    groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[api/ai] Error de red al contactar con Groq:', err);
    return res.status(502).json({ error: 'No se pudo contactar con la IA. Inténtalo de nuevo en un momento.', code: 'upstream_network' });
  }

  if (!groqRes.ok) {
    let detail = '';
    try { detail = await groqRes.text(); } catch (e) { /* noop */ }
    const code = classifyGroqError(groqRes.status, detail);
    console.error('[api/ai] Groq respondió con error', groqRes.status, code, detail);
    return res.status(ERROR_STATUS[code] || 502).json({
      error: 'La IA no pudo generar una respuesta ahora mismo (error ' + groqRes.status + ').',
      code,
      upstreamStatus: groqRes.status,
    });
  }

  let data;
  try {
    data = await groqRes.json();
  } catch (err) {
    console.error('[api/ai] Respuesta de Groq no es JSON válido:', err);
    return res.status(502).json({ error: 'Respuesta inválida de la IA.', code: 'upstream' });
  }

  const choice = data.choices && data.choices[0];
  const text = choice && choice.message && choice.message.content;
  // Cortada por MAX_TOKENS: el JSON llegaría incompleto, así que no se
  // devuelve como si fuera válido.
  if (choice && choice.finish_reason === 'length') {
    console.error('[api/ai] Respuesta de Groq cortada por max_tokens', data.usage || '');
    return res.status(502).json({ error: 'La respuesta de la IA llegó incompleta.', code: 'truncated' });
  }
  if (!text) {
    console.error('[api/ai] Groq devolvió una respuesta vacía', choice && choice.finish_reason);
    return res.status(502).json({ error: 'La IA devolvió una respuesta vacía.', code: 'upstream' });
  }

  return res.status(200).json({ text: text });
};

module.exports.classifyGroqError = classifyGroqError;
