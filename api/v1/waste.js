// GET/POST /api/v1/waste
const { query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { reportWaste } = require('../_lib/waste-workflow');

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.WASTE_READ);
  const requestedLimit = Number(req.query?.limit || 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200))
    : 100;
  const rows = await query(
    `SELECT
       m.id,
       m.numero,
       m.tipo AS type,
       m.producto_id AS product_id,
       p.siigo_code AS sku,
       p.nombre AS product_name,
       m.lote AS lot_id,
       op.codigo_orden AS production_order_code,
       m.orden_produccion_id AS production_order_id,
       m.referencia_externa AS external_reference,
       ub.codigo AS location_code,
       m.cantidad AS qty,
       m.motivo AS reason,
       m.usuario_id,
       u.nombre AS user_name,
       m.creado_en AS created_at
     FROM mermas m
     LEFT JOIN productos p ON p.id = m.producto_id
     LEFT JOIN ordenes_produccion op ON op.id = m.orden_produccion_id
     LEFT JOIN ubicaciones ub ON ub.id = m.ubicacion_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     ORDER BY m.creado_en DESC
     LIMIT ${limit}`
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePost(req, res) {
  const user = await requireCapability(req, CAPABILITIES.WASTE_REPORT);
  const result = await reportWaste(req.body || {}, user.id, { allowGeneratedReference: true });
  return res.status(200).json({ ok: true, data: result });
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[waste]', err.message);
    const detail = process.env.NODE_ENV === 'production' ? null : err.message;
    return res.status(500).json({ ok: false, error: detail || 'Error interno del servidor' });
  }
};
