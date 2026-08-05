// GET/POST /api/v1/returns
const { query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { createCustomerReturn } = require('../_lib/returns-workflow');

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.RETURNS_READ);
  const requestedLimit = Number(req.query?.limit || 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
    : 100;
  const rows = await query(
    `SELECT
       dv.id, dv.numero, dv.referencia_externa, dv.despacho_id,
       d.numero AS despacho_numero, d.siigo_invoice_name,
       dv.producto_id, p.siigo_code AS sku, p.nombre AS producto_nombre,
       dv.lote, dv.lote_origen, ub.codigo AS ubicacion,
       dv.cliente_origen, dv.cantidad, dv.estado, dv.observaciones,
       dv.creado_en, u.nombre AS usuario_nombre
     FROM devoluciones dv
     LEFT JOIN despachos d ON d.id = dv.despacho_id
     LEFT JOIN productos p ON p.id = dv.producto_id
     LEFT JOIN ubicaciones ub ON ub.id = dv.ubicacion_id
     LEFT JOIN usuarios u ON u.id = dv.usuario_id
     ORDER BY dv.creado_en DESC
     LIMIT ${limit}`
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePost(req, res) {
  const user = await requireCapability(req, CAPABILITIES.RETURNS_MANAGE);
  const result = await createCustomerReturn(req.body || {}, user.id);
  return res.status(200).json({ ok: true, data: result });
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[returns]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al procesar devolucion' });
  }
};
