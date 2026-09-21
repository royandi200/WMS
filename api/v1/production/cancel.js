const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { createConnection } = require('../../_lib/db');
const { notifyRoles } = require('../../_lib/builderbot-notifications');
const {
  cancelProductionOrder,
  normalizeProductionCancellation,
} = require('../../_lib/production-cancellation');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let conn;
  try {
    const user = await requireCapability(req, CAPABILITIES.PRODUCTION_RELEASE);
    const input = normalizeProductionCancellation(req.body || {});
    conn = await createConnection();
    await conn.beginTransaction();
    const data = await cancelProductionOrder(conn, { ...input, userId: user.id });
    await conn.commit();

    if (!data.duplicate) {
      data.notification = await notifyRoles({
        event: `production_cancelled:${data.order_id}`,
        roles: ['alistador'],
        fallbackRoles: [],
        excludeUserIds: [user.id],
        text: [
          '*Orden de produccion cancelada*',
          '',
          `Orden: *OP ID ${data.order_id}* | ${data.order_code}`,
          `Producto: ${data.product}`,
          `SKU: ${data.sku}`,
          `Motivo: ${data.reason}`,
          `Cancelo: ${user.nombre || 'Usuario WMS'}`,
          '',
          'La instruccion anterior ya no esta vigente. No alistes ni confirmes sus materiales.',
        ].join('\n'),
      }).catch((error) => [{ status: 'error', error: error.message }]);
    }
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[production/cancel]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al cancelar la orden de produccion' });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
};
