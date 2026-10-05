// GET  /api/v1/production/confirm?order_id=  -> partidas reservadas + huella para revisar
// POST /api/v1/production/confirm             -> consume solo si la huella revisada sigue vigente
const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { query } = require('../../_lib/db');
const { confirmProductionMaterials } = require('../../_lib/production-workflow');
const { allocationFingerprint, loadAllocations } = require('../../_lib/production-pick-guide');

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.PRODUCTION_PICK);
  const reference = String(req.query?.order_id || '').trim().replace(/^op\s*(?:id)?\s*#?\s*/iu, '');
  if (!reference) return res.status(400).json({ ok: false, error: 'order_id requerido' });
  const orders = await query(
    `SELECT op.id, op.codigo_orden, op.estado, op.fase, op.cantidad_planeada,
            p.siigo_code AS producto_sku, p.nombre AS producto_nombre
       FROM ordenes_produccion op JOIN productos p ON p.id = op.producto_id
      WHERE op.id = ? OR op.codigo_orden = ? LIMIT 1`,
    [Number(reference) || 0, reference]
  );
  if (!orders.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
  const order = orders[0];
  if (order.estado !== 'APROBADA' || order.fase !== 'F0') {
    return res.status(409).json({ ok: false, error: `La orden esta ${order.estado} en fase ${order.fase}; no tiene materiales por confirmar` });
  }
  const rows = await loadAllocations({ execute: async (sql, params) => [await query(sql, params)] }, order.id);
  if (!rows.length) return res.status(409).json({ ok: false, error: 'La orden no tiene materiales reservados' });
  return res.status(200).json({ ok: true, data: {
    order,
    fingerprint: allocationFingerprint(rows),
    lines: rows.map(row => ({
      id: row.id, sku: row.sku, producto: row.producto, lote: row.lote,
      ubicacion: row.ubicacion, cantidad: Number(row.cantidad_reservada), unidad: row.unidad || 'und',
    })),
  } });
}

module.exports = async (req, res) => {
  cors(res, 'GET, POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_PICK);
    const orderId = req.body?.order_id || req.body?.codigo_orden;
    if (!orderId) return res.status(400).json({ ok: false, error: 'order_id requerido' });
    const reviewedFingerprint = String(req.body?.reviewed_fingerprint || '').trim();
    if (!reviewedFingerprint) {
      return res.status(400).json({ ok: false, error: 'Revisa y marca cada partida de materiales antes de confirmar' });
    }
    const data = await confirmProductionMaterials({ orderId, userId: user.id, reviewedFingerprint });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message, data: error.data });
    console.error('[production/confirm]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al confirmar materiales' });
  }
};
