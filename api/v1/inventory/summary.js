// GET /api/v1/inventory/summary
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const [totals] = await query(
      `SELECT COUNT(*) as total_productos,
              SUM(cantidad) as total_unidades,
              SUM(CASE WHEN p.activo=1 THEN 1 ELSE 0 END) as productos_activos
       FROM inventario i
       LEFT JOIN productos p ON p.id = i.producto_id`
    );
    const lowCount = await query(
      `SELECT COUNT(*) as cnt FROM inventario i
       JOIN productos p ON p.id = i.producto_id
       WHERE i.cantidad <= p.stock_min AND p.activo = 1`
    );
    return res.status(200).json({
      ok: true,
      data: {
        total_productos:  totals.total_productos  || 0,
        total_unidades:   Number(totals.total_unidades) || 0,
        productos_activos:totals.productos_activos || 0,
        bajo_stock:       lowCount[0]?.cnt || 0,
      }
    });
  } catch (err) {
    console.error('[inventory/summary]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener resumen' });
  }
};
