/**
 * ORGANIZATOR — Proxy de IA (Fase 6.5)
 *
 * Función serverless de Vercel que hace de intermediaria entre el navegador
 * y la API de Anthropic. El navegador NUNCA ve la API key: esta función lee
 * ANTHROPIC_API_KEY de las variables de entorno de Vercel (solo accesibles
 * en el servidor) y es la única que habla con api.anthropic.com.
 *
 * organizator.html sigue construyendo el contexto (buildContext) y el
 * system prompt en el propio navegador — aquí solo se reenvía tal cual a
 * Anthropic y se devuelve el texto de la respuesta. No se guarda nada,
 * no se toca window.storage ni ningún dato del usuario.
 *
 * Contrato con el cliente:
 *   POST /api/ai   body: { system?: string, prompt: string }
 *   → 200 { text: string }
 *   → 4xx/5xx { error: string }
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const AI_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1800;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallo de configuración del servidor, nunca del usuario.
    console.error('[api/ai] Falta la variable de entorno ANTHROPIC_API_KEY en Vercel');
    return res.status(500).json({ error: 'La IA no está configurada en el servidor todavía.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const prompt = body && body.prompt;
  const system = body && body.system;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Falta el campo "prompt" en la petición.' });
  }

  const payload = {
    model: AI_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  };
  if (typeof system === 'string' && system.trim()) {
    payload.system = system;
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[api/ai] Error de red al contactar con Anthropic:', err);
    return res.status(502).json({ error: 'No se pudo contactar con la IA. Inténtalo de nuevo en un momento.' });
  }

  if (!anthropicRes.ok) {
    let detail = '';
    try { detail = await anthropicRes.text(); } catch (e) { /* noop */ }
    console.error('[api/ai] Anthropic respondió con error', anthropicRes.status, detail);
    return res.status(502).json({ error: 'La IA no pudo generar una respuesta ahora mismo (error ' + anthropicRes.status + ').' });
  }

  let data;
  try {
    data = await anthropicRes.json();
  } catch (err) {
    console.error('[api/ai] Respuesta de Anthropic no es JSON válido:', err);
    return res.status(502).json({ error: 'Respuesta inválida de la IA.' });
  }

  const textBlock = Array.isArray(data.content) ? data.content.find(b => b && b.type === 'text') : null;
  if (!textBlock || !textBlock.text) {
    return res.status(502).json({ error: 'La IA devolvió una respuesta vacía.' });
  }

  return res.status(200).json({ text: textBlock.text });
};
