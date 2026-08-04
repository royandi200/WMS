const { createConnection } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { retryNotification, maskPhone } = require('../_lib/builderbot-notifications');

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    await requireCapability(req, CAPABILITIES.WEBHOOK_LOGS_READ);
    if (req.method === 'POST') {
      const data = await retryNotification(req.body?.notificacion_id || req.body?.id);
      return res.status(200).json({ ok: true, data });
    }
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 200);
    const conn = await createConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, evento, canal, destinatario, mensaje, estado, intentos,
                ultimo_error, creado_en, enviado_en
         FROM notificaciones_salida ORDER BY creado_en DESC LIMIT ${limit}`
      );
      return res.status(200).json({
        ok: true,
        data: { rows: rows.map((row) => ({ ...row, destinatario: maskPhone(row.destinatario) })) },
      });
    } finally {
      await conn.end().catch(() => {});
    }
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[notifications]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
