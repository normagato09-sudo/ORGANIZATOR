/**
 * ORGANIZATOR — Aviso diario a Mi Oficina (agente `organizator-examenes`)
 *
 * GET /api/aviso-diario  (lo llama Vercel Cron cada mañana, ver vercel.json)
 *
 * Mira los exámenes y entregas guardados (clave `exams` de user_data) y, si
 * hay algo cerca, manda UN aviso con la lista a Mi Oficina:
 *   - pruebas (examen, parcial…): a 7 días (normal), a 3 días y mañana (importante)
 *   - entregas pendientes (trabajo, deberes…): a 3 días, mañana (importante) y hoy (urgente)
 * Las entregas ya marcadas como «entregado» no se avisan.
 *
 * Variables: MI_OFICINA_URL y MI_OFICINA_CLAVE (sin ellas no se envía nada).
 * Opcional: ORGANIZATOR_EMAIL para mirar solo esa cuenta (si no, todas).
 * Si existe CRON_SECRET, solo Vercel puede llamarlo.
 */

const db = require('../lib/db');

const ENTREGAS = ['trabajo', 'exposicion', 'ejercicios', 'deberes'];
const NOMBRE_TIPO = {
  examen: 'Examen', parcial: 'Parcial', trimestral: 'Trimestral', final: 'Final', recuperacion: 'Recuperación',
  trabajo: 'Trabajo', exposicion: 'Exposición', ejercicios: 'Ejercicios', deberes: 'Deberes',
};
const NIVELES = ['normal', 'importante', 'urgente'];

/** Hoy en España como AAAA-MM-DD. */
function hoyEspana() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function diasEntre(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}
function cuando(n) {
  return n === 0 ? 'HOY' : n === 1 ? 'mañana' : `en ${n} días`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ error: 'No permitido' });
  }
  const base = process.env.MI_OFICINA_URL;
  const clave = process.env.MI_OFICINA_CLAVE;
  if (!base || !clave) return res.status(200).json({ ok: true, nota: 'Mi Oficina sin configurar' });

  try {
    const sql = db.getSql();
    const email = process.env.ORGANIZATOR_EMAIL || null;
    const filas = await sql`
      SELECT d.key, d.value FROM user_data d JOIN users u ON u.id = d.user_id
      WHERE d.key IN ('exams', 'subjects') AND (${email}::text IS NULL OR lower(u.email) = lower(${email}))`;
    const examenes = filas.filter((f) => f.key === 'exams').flatMap((f) => (Array.isArray(f.value) ? f.value : []));
    const asignaturas = new Map(
      filas.filter((f) => f.key === 'subjects').flatMap((f) => (Array.isArray(f.value) ? f.value : [])).map((s) => [s.id, s.name]),
    );

    const hoy = hoyEspana();
    const lineas = [];
    let nivel = 0;
    for (const e of examenes) {
      if (!e || typeof e.date !== 'string') continue;
      const n = diasEntre(hoy, e.date);
      const entrega = ENTREGAS.includes(e.type);
      if (entrega && e.deliveryStatus === 'entregado') continue;
      let aviso = -1;
      if (entrega) aviso = n === 0 ? 2 : n === 1 || n === 3 ? 1 : -1;
      else aviso = n === 1 || n === 3 ? 1 : n === 7 ? 0 : -1;
      if (aviso < 0) continue;
      nivel = Math.max(nivel, aviso);
      const asig = asignaturas.get(e.subjectId);
      lineas.push({
        n,
        texto: `• ${NOMBRE_TIPO[e.type] || 'Examen'} ${cuando(n)}${e.time ? ` a las ${e.time}` : ''}: ${e.title}${asig ? ` (${asig})` : ''}`,
      });
    }
    if (lineas.length === 0) return res.status(200).json({ ok: true, avisos: 0 });
    lineas.sort((a, b) => a.n - b.n);

    const primero = lineas[0];
    const titulo = lineas.length === 1
      ? primero.texto.slice(2)
      : `Tienes ${lineas.length} exámenes o entregas cerca (el primero ${cuando(primero.n)})`;
    await fetch(`${base.replace(/\/$/, '')}/api/eventos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify({ agente: 'organizator-examenes', nivel: NIVELES[nivel], titulo: titulo.slice(0, 200), texto: lineas.map((l) => l.texto).join('\n') }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status(200).json({ ok: true, avisos: lineas.length });
  } catch (err) {
    console.error('aviso-diario', err);
    return res.status(500).json({ error: 'No se pudo preparar el aviso' });
  }
};
