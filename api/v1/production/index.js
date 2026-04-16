// GET /api/v1/production  — listar órdenes de producción
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { estado, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let sql = `
      SELECT
        op.id,
        op.codigo_orden,
        op.producto_id,
        op.cantidad_planeada,
        op.cantidad_real,
        op.fase,
        op.estado,
        op.notas,
        op.creado_por,
        op.aprobado_por,
        op.materiales_conf_en,
        op.cerrado_en,
        op.creado_en,
        p.siigo_code AS sku,
        p.nombre     AS product_name
      FROM ordenes_produccion op
      LEFT JOIN productos p ON p.id = op.producto_id
      WHERE 1=1`;
    const args = [];
    if (estado) { sql += ` AND op.estado = ?`; args.push(estado); }
    sql += ` ORDER BY op.creado_en DESC LIMIT ? OFFSET ?`;
    args.push(Number(limit), offset);

    const rows = await query(sql, args);
    const countRows = await query(
      `SELECT COUNT(*) AS total FROM ordenes_produccion${estado ? ' WHERE estado=?' : ''}`,
      estado ? [estado] : []
    );
    return res.status(200).json({ ok: true, data: { rows, total: countRows[0].total } });
  } catch (err) {
    console.error('[production GET]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener producciones' });
  }
};
