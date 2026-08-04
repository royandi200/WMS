const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { adjustProductionMaterials } = require('../../_lib/production-materials');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_PICK);
    const body = req.body || {};
    const data = await adjustProductionMaterials({
      orderId: body.order_id || body.codigo_orden,
      productTerm: body.product_id || body.sku || body.id_item,
      lot: body.lote || body.lpn || body.lot_id,
      locationId: body.ubicacion_id || body.location_id,
      locationCode: body.ubicacion || body.location_code,
      type: body.tipo || body.type,
      quantity: body.cantidad ?? body.quantity,
      reason: body.motivo || body.reason,
      userId: user.id,
    });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[production/material-adjustment]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al ajustar materiales de produccion' });
  }
};
