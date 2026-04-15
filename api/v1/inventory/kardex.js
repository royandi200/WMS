// GET /api/v1/inventory/kardex
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { producto_id, page = 1, limit = 50, desde, hasta } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let sql = `SELECT k.*, p.sku, p.nombre as product_name
               FROM kardex k
               LEFT JOIN productos p ON p.id = k.producto_id
               WHERE 1=1`;
    const args = [];
    if (producto_id) { sql += ` AND k.producto_id = ?`; args.push(producto_id); }
    if (desde)       { sql += ` AND k.fecha >= ?`;       args.push(desde); }
    if (hasta)       { sql += ` AND k.fecha <= ?`;       args.push(hasta); }
    sql += ` ORDER BY k.fecha DESC LIMIT ? OFFSET ?`;
    args.push(Number(limit), offset);

    const rows = await query(sql, args);
    const [[{ total }]] = [await query(
      `SELECT COUNT(*) as total FROM kardex WHERE 1=1${producto_id ? ' AND producto_id=?' : ''}`,
      producto_id ? [producto_id] : []
    )];
    return res.status(200).json({ ok: true, data: { rows, total: Number(total) } });
  } catch (err) {
    console.error('[inventory/kardex]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener kardex' });
  }
};
