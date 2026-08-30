// api/chat.js
//
// Proxy hacia la API de Anthropic. La clave de API vive SOLO aquí (variable
// de entorno del servidor) y nunca llega al navegador. Además exige sesión
// (requireAuth) para que solo cuentas con sesión iniciada puedan usar el chat.

const { requireAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const userId = await requireAuth(req, res);
  if (!userId) return; // requireAuth ya respondió 401

  try {
    const { system, messages, tools } = req.body || {};

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system,
        messages,
        tools,
      }),
    });

    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (e) {
    console.error('chat proxy error', e);
    res.status(500).json({ error: 'No se ha podido contactar con el organizador.' });
  }
};
