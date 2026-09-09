// GET /api/v1/production  — listar órdenes de producción
const { query } = require('../../_lib/db');
const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { await requireCapability(req, CAPABILITIES.PRODUCTION_READ); } catch (e) { return res.status(e.status || 401).json({ ok: false, error: e.message }); }

  try {
    const { estado, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let sql = `
      SELECT
        op.id,
        op.codigo_orden,
        op.producto_id,
        op.origen_tipo,
        op.referencia_cliente,
        op.cliente_final,
        op.cantidad_planeada,
        op.cantidad_real,
        (SELECT l.lpn FROM lots l
          WHERE l.production_order_id = op.id
          ORDER BY l.created_at ASC LIMIT 1) AS lpn_terminado,
        op.fase,
        op.estado,
        op.notas,
        op.creado_por,
        op.aprobado_por,
        op.materiales_conf_en,
        op.liberado_en,
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
    const orderIds = rows.map((row) => Number(row.id)).filter(Number.isInteger);
    const wasteRows = orderIds.length
      ? await query(
        `SELECT m.id, m.numero, m.tipo, m.orden_produccion_id, m.cantidad,
                m.motivo, m.estado, m.creado_en,
                p.siigo_code AS sku, p.nombre AS producto,
                COALESCE(NULLIF(p.unit_label, ''), 'und') AS unidad,
                u.nombre AS registrado_por
           FROM mermas m
           JOIN productos p ON p.id = m.producto_id
           LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.orden_produccion_id IN (${orderIds.map(() => '?').join(',')})
          ORDER BY m.creado_en, m.id`,
        orderIds
      )
      : [];
    const wasteByOrder = new Map();
    for (const waste of wasteRows) {
      const orderId = Number(waste.orden_produccion_id);
      if (!wasteByOrder.has(orderId)) wasteByOrder.set(orderId, []);
      wasteByOrder.get(orderId).push({ ...waste, cantidad: Number(waste.cantidad || 0) });
    }
    for (const row of rows) row.mermas = wasteByOrder.get(Number(row.id)) || [];
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
