const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { previewCustomerOrderMaterials } = require('../../_lib/production-material-availability');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    await requireCapability(req, CAPABILITIES.PRODUCTION_RELEASE);
    const data = await previewCustomerOrderMaterials({
      orderId: req.query?.pedido_cliente_id,
      itemId: req.query?.pedido_cliente_item_id,
    });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[production/availability]', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible comprobar los materiales' });
  }
};
