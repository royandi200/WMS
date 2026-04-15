// GET /api/v1/inventory/product/:id
const { query } = require('../../../_lib/db');
const { cors, verifyToken } = require('../../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { id } = req.query;
  try {
    const rows = await query(
      `SELECT i.*, p.sku, p.nombre as name, p.unidad as unit,
              p.stock_min as min_stock, p.stock_max as max_stock
       FROM inventario i
       JOIN productos p ON p.id = i.producto_id
       WHERE i.producto_id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Producto no encontrado en inventario' });
    return res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    console.error('[inventory/product/:id]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener stock' });
  }
};
