const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { closeProductionOrder } = require('../../_lib/production-close');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_CLOSE);
    const body = req.body || {};
    const data = await closeProductionOrder({
      orderId: body.order_id || body.codigo_orden,
      qtyReal: body.qty_real ?? body.cantidad_real,
      qtyWaste: body.qty_waste ?? body.merma,
      wasteReason: body.waste_reason || body.motivo_merma,
      locationId: body.ubicacion_id || body.location_id,
      expiryDate: body.fecha_venc || body.expiry_date,
      userId: user.id,
    });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, error: 'Ya existe lote para esta orden' });
    console.error('[production/close]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al cerrar produccion' });
  }
};
