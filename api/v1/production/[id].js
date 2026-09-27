// GET /api/v1/production/:id
const { query } = require('../../_lib/db');
const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { assignedFinishedLot } = require('../../_lib/production-lot');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { await requireCapability(req, CAPABILITIES.PRODUCTION_READ); } catch (e) { return res.status(e.status || 401).json({ ok: false, error: e.message }); }

  const { id } = req.query;
  try {
    const rows = await query(
      `SELECT op.*, p.siigo_code AS sku, p.nombre AS product_name,
              (SELECT l.lpn FROM lots l
               WHERE l.production_order_id = op.id
               ORDER BY l.created_at ASC LIMIT 1) AS lpn_terminado
       FROM ordenes_produccion op
       LEFT JOIN productos p ON p.id = op.producto_id
       WHERE op.id = ? LIMIT 1`, [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    if (rows[0].estado === 'EN_PROCESO' && rows[0].materiales_conf_en) {
      rows[0].lpn_terminado = assignedFinishedLot(rows[0].codigo_orden);
    }
    return res.status(200).json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[production/:id]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener orden' });
  }
};
