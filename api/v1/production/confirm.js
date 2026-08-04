const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { confirmProductionMaterials } = require('../../_lib/production-workflow');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_PICK);
    const orderId = req.body?.order_id || req.body?.codigo_orden;
    if (!orderId) return res.status(400).json({ ok: false, error: 'order_id requerido' });
    const data = await confirmProductionMaterials({ orderId, userId: user.id });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message, data: error.data });
    console.error('[production/confirm]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al confirmar materiales' });
  }
};
