// POST /api/v1/production/advance
// Body: { order_id, phase }  — acepta también nueva_fase por compatibilidad
// order_id puede ser id numérico o codigo_orden
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

const PHASES = ['F0','F1','F2','F3','F4','F5'];

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  let user;
  try { user = verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { order_id, phase, nueva_fase } = req.body || {};
    const targetPhase = phase || nueva_fase;
    if (!order_id || !targetPhase)
      return res.status(400).json({ ok: false, error: 'order_id y phase son requeridos' });
    if (!PHASES.includes(targetPhase))
      return res.status(400).json({ ok: false, error: `Fase inválida. Valores válidos: ${PHASES.join(', ')}` });

    const rows = await query(
      `SELECT * FROM ordenes_produccion WHERE id=? OR codigo_orden=? LIMIT 1`,
      [order_id, order_id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    const orden = rows[0];
    if (orden.estado === 'CERRADA') return res.status(409).json({ ok: false, error: 'La orden ya está cerrada' });

    const currentIdx = PHASES.indexOf(orden.fase);
    const targetIdx  = PHASES.indexOf(targetPhase);
    if (targetIdx <= currentIdx)
      return res.status(409).json({ ok: false, error: `No puedes retroceder de ${orden.fase} a ${targetPhase}` });

    await query(
      `UPDATE ordenes_produccion SET fase=? WHERE id=?`,
      [targetPhase, orden.id]
    );
    return res.status(200).json({ ok: true, data: { order_code: orden.codigo_orden, phase: targetPhase } });
  } catch (err) {
    console.error('[production/advance]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al avanzar fase' });
  }
};
