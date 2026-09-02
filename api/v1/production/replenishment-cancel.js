const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { cancelProductionReplenishment } = require('../../_lib/production-replenishment');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_RELEASE);
    const body = req.body || {};
    const data = await cancelProductionReplenishment({
      replenishmentId: body.replenishment_id || body.codigo_reposicion,
      orderId: body.order_id || body.codigo_orden,
      userId: user.id,
    });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[production/replenishment-cancel]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al cancelar la reposicion' });
  }
};
