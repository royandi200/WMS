const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { releaseProductionOrder } = require('../../_lib/production-workflow');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_RELEASE);
    const body = req.body || {};
    const data = await releaseProductionOrder({
      product: body.product_id || body.sku,
      quantity: body.qty_planned || body.cantidad_planeada,
      originType: body.origen_tipo || body.origin_type,
      customerReference: body.referencia_cliente || body.customer_reference,
      finalCustomer: body.cliente_final || body.final_customer,
      notes: body.notas || body.notes,
      userId: user.id,
    });
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message, data: error.data });
    console.error('[production/start]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al liberar produccion' });
  }
};
