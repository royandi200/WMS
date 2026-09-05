// GET /api/v1/inventory/low-stock
const { query } = require('../../_lib/db');
const { cors, requireAuth } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { await requireAuth(req); } catch (e) { return res.status(e.status || 401).json({ ok: false, error: e.message }); }

  try {
    const rows = await query(
      `SELECT
         p.id            AS id,
         p.siigo_code   AS sku,
         p.nombre       AS name,
         p.unit_label   AS unit,
         COALESCE(SUM(CASE
           WHEN l.status = 'DISPONIBLE'
            AND (l.expiry_date IS NULL OR l.expiry_date >= CURDATE())
            AND u.id IS NOT NULL AND u.activa = 1 AND b.activa = 1
           THEN GREATEST(s.cantidad - COALESCE(s.reservada, 0), 0)
           ELSE 0 END), 0) AS stock,
         COALESCE(SUM(CASE
           WHEN l.status = 'DISPONIBLE'
            AND (l.expiry_date IS NULL OR l.expiry_date >= CURDATE())
            AND u.id IS NOT NULL AND u.activa = 1 AND b.activa = 1
           THEN GREATEST(s.cantidad - COALESCE(s.reservada, 0), 0)
           ELSE 0 END), 0) AS disponible,
         p.stock_minimo AS min_stock
       FROM productos p
       LEFT JOIN stock s ON s.producto_id = p.id
       LEFT JOIN lots l ON l.product_id = s.producto_id AND BINARY l.lpn = BINARY s.lote
       LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.bodega_id = s.bodega_id
       LEFT JOIN bodegas b ON b.id = s.bodega_id
       WHERE p.activo = 1 AND p.control_stock = 1 AND p.stock_minimo > 0
       GROUP BY p.id, p.siigo_code, p.nombre, p.unit_label, p.stock_minimo
       HAVING disponible <= p.stock_minimo
       ORDER BY (disponible / GREATEST(p.stock_minimo, 1)) ASC
       LIMIT 50`
    );
    return res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    console.error('[inventory/low-stock]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
