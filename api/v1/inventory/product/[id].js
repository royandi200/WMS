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
      `SELECT
         s.*,
         p.siigo_code  AS sku,
         p.nombre      AS name,
         p.unit_label  AS unit,
         p.stock_minimo AS min_stock
       FROM stock s
       JOIN productos p ON p.id = s.producto_id
       WHERE s.producto_id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Producto no encontrado en inventario' });
    return res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    console.error('[inventory/product/:id]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
