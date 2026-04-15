// GET /api/v1/inventory/summary
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const [[totals]] = await query(
      `SELECT
         COUNT(DISTINCT s.producto_id)                          AS total_productos,
         SUM(s.cantidad)                                        AS total_unidades,
         SUM(CASE WHEN p.activo = 1 THEN 1 ELSE 0 END)         AS productos_activos,
         SUM(s.cantidad - s.reservada)                          AS disponible,
         SUM(s.reservada)                                       AS reservado
       FROM stock s
       LEFT JOIN productos p ON p.id = s.producto_id`
    );
    const [[{ cnt: bajo_stock }]] = await query(
      `SELECT COUNT(*) AS cnt
       FROM (
         SELECT s.producto_id
         FROM stock s
         JOIN productos p ON p.id = s.producto_id
         WHERE p.activo = 1
         GROUP BY s.producto_id
         HAVING SUM(s.cantidad) <= MAX(p.stock_minimo)
       ) sub`
    );
    const [[{ cnt: alertas }]] = await query(`SELECT COUNT(*) AS cnt FROM v_alertas_stock`);
    const [[{ cnt: vencimientos }]] = await query(`SELECT COUNT(*) AS cnt FROM v_vencimientos_proximos`);

    return res.status(200).json({
      ok: true,
      data: {
        total_productos:   Number(totals.total_productos)   || 0,
        total_unidades:    Number(totals.total_unidades)    || 0,
        productos_activos: Number(totals.productos_activos) || 0,
        disponible:        Number(totals.disponible)        || 0,
        reservado:         Number(totals.reservado)         || 0,
        bajo_stock:        Number(bajo_stock)               || 0,
        alertas_stock:     Number(alertas)                  || 0,
        vencimientos_proximos: Number(vencimientos)         || 0,
      }
    });
  } catch (err) {
    console.error('[inventory/summary]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
