// GET /api/v1/inventory/kardex
// Lee de la tabla `kardex` (nueva) — action descriptivo por handler
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { sku, page = 1, limit = 30, desde, hasta } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE 1=1';
    const args = [];

    if (sku) {
      where += ' AND p.siigo_code = ?';
      args.push(sku);
    }
    if (desde) { where += ' AND k.created_at >= ?'; args.push(desde); }
    if (hasta) { where += ' AND k.created_at <= ?'; args.push(hasta); }

    const rows = await query(
      `SELECT
         k.id,
         CASE
           WHEN COALESCE(k.action, '') <> '' THEN k.action
           WHEN k.reference LIKE 'orden_produccion:%' AND k.qty < 0 THEN 'CONSUMO_MATERIAL'
           WHEN k.reference LIKE 'recepcion:%' AND k.qty > 0 THEN 'INGRESO_RECEPCION'
           WHEN k.reference LIKE 'despacho:%' AND k.qty < 0 THEN 'DESPACHO'
           ELSE 'AJUSTE_MANUAL'
         END AS action,
         k.qty,
         k.balance_after,
         k.reference,
         k.notes,
         k.created_at,
         p.siigo_code   AS sku,
         p.nombre       AS product_name,
         l.lpn          AS lot_lpn,
         u.nombre       AS usuario,
         a.nombre       AS aprobado_por
       FROM kardex k
       JOIN  productos p ON p.id = k.product_id
       LEFT JOIN lots    l ON l.id = k.lot_id
       LEFT JOIN usuarios u ON u.id = k.user_id
       LEFT JOIN usuarios a ON a.id = k.approved_by
       ${where}
       ORDER BY k.created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, Number(limit), offset]
    );

    const countRows = await query(
      `SELECT COUNT(*) AS total
       FROM kardex k
       JOIN productos p ON p.id = k.product_id
       ${where}`,
      args
    );

    return res.status(200).json({
      ok: true,
      data: { rows, total: Number(countRows[0]?.total ?? 0) }
    });
  } catch (err) {
    console.error('[inventory/kardex]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
