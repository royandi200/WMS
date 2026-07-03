// GET /api/v1/returns
const { query } = require('../_lib/db');
const { cors, requireRole } = require('../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
    const limit = Math.min(Number(req.query?.limit || 100), 200);
    const rows = await query(
      `SELECT
         d.id,
         d.numero,
         d.producto_id,
         p.siigo_code AS sku,
         p.nombre AS producto_nombre,
         d.lote,
         d.cliente_origen,
         d.cantidad,
         d.estado,
         d.observaciones,
         d.creado_en,
         u.nombre AS usuario_nombre
       FROM devoluciones d
       LEFT JOIN productos p ON p.id = d.producto_id
       LEFT JOIN usuarios u ON u.id = d.usuario_id
       ORDER BY d.creado_en DESC
       LIMIT ?`,
      [limit]
    );
    return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[returns]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al cargar devoluciones' });
  }
};
