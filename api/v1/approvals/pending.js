// GET /api/v1/approvals/pending
// Muestra movimientos de ajuste pendientes de revisión (sin voucher SIIGO)
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const rows = await query(
      `SELECT m.id, m.tipo, m.cantidad, m.lote, m.creado_en,
              p.nombre AS producto_nombre, p.siigo_code,
              bo.nombre AS bodega_orig_nombre,
              bd.nombre AS bodega_dest_nombre,
              u.nombre  AS usuario_nombre
       FROM movimientos m
       LEFT JOIN productos p   ON p.id = m.producto_id
       LEFT JOIN bodegas   bo  ON bo.id = m.bodega_orig
       LEFT JOIN bodegas   bd  ON bd.id = m.bodega_dest
       LEFT JOIN usuarios  u   ON u.id  = m.usuario_id
       WHERE m.tipo = 'ajuste' AND m.siigo_sync = 0
       ORDER BY m.creado_en DESC
       LIMIT 100`
    );
    return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
  } catch (err) {
    console.error('[approvals/pending]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
