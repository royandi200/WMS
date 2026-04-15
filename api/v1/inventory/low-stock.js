// GET /api/v1/inventory/low-stock
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const rows = await query(
      `SELECT i.producto_id as id, p.sku, p.nombre as name, p.unidad as unit,
              i.cantidad as stock, p.stock_min as min_stock, p.stock_max as max_stock
       FROM inventario i
       JOIN productos p ON p.id = i.producto_id
       WHERE i.cantidad <= p.stock_min AND p.activo = 1
       ORDER BY (i.cantidad / GREATEST(p.stock_min,1)) ASC
       LIMIT 50`
    );
    return res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    console.error('[inventory/low-stock]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener bajo stock' });
  }
};
