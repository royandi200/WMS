const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { prepareProductionReplenishment } = require('../../_lib/production-replenishment');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_RELEASE);
    const body = req.body || {};
    const data = await prepareProductionReplenishment({
      orderId: body.order_id || body.codigo_orden,
      quantity: body.target_quantity ?? body.cantidad_unidades,
      reason: body.reason || body.motivo,
      fullBomConfirmed: body.full_bom_confirmed ?? body.confirma_bom_completo,
      userId: user.id,
    });
    return res.status(data.already_prepared ? 200 : 201).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message, data: error.data });
    console.error('[production/replenishment-prepare]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al preparar la reposicion' });
  }
};
