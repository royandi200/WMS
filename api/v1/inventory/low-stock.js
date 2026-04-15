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
      `SELECT
         s.producto_id  AS id,
         p.siigo_code   AS sku,
         p.nombre       AS name,
         p.unit_label   AS unit,
         SUM(s.cantidad)           AS stock,
         SUM(s.cantidad - s.reservada) AS disponible,
         p.stock_minimo AS min_stock
       FROM stock s
       JOIN productos p ON p.id = s.producto_id
       WHERE p.activo = 1
       GROUP BY s.producto_id, p.siigo_code, p.nombre, p.unit_label, p.stock_minimo
       HAVING SUM(s.cantidad) <= p.stock_minimo
       ORDER BY (SUM(s.cantidad) / GREATEST(p.stock_minimo, 1)) ASC
       LIMIT 50`
    );
    return res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    console.error('[inventory/low-stock]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
