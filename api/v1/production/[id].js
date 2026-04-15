// GET /api/v1/production/:id
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { id } = req.query;
  try {
    const rows = await query(
      `SELECT op.*, p.sku, p.nombre as product_name
       FROM ordenes_produccion op
       LEFT JOIN productos p ON p.id = op.producto_id
       WHERE op.id = ? LIMIT 1`, [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    const materiales = await query(
      `SELECT om.*, pr.sku, pr.nombre as name, pr.unidad as unit
       FROM orden_materiales om
       JOIN productos pr ON pr.id = om.producto_id
       WHERE om.orden_id = ?`, [id]
    );
    return res.status(200).json({ ok: true, data: { ...rows[0], materiales } });
  } catch (err) {
    console.error('[production/:id]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener orden' });
  }
};
