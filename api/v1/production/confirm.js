// POST /api/v1/production/confirm
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { orden_id, materiales } = req.body || {};
    if (!orden_id) return res.status(400).json({ ok: false, error: 'orden_id requerido' });

    await query(`UPDATE ordenes_produccion SET estado='MATERIALES_CONFIRMADOS' WHERE id=?`, [orden_id]);
    return res.status(200).json({ ok: true, orden_id });
  } catch (err) {
    console.error('[production/confirm]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al confirmar materiales' });
  }
};
