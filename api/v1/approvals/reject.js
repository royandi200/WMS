// POST /api/v1/approvals/reject
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let decoded;
  try {
    decoded = verifyToken(req);
  } catch (e) {
    return res.status(e.status || 401).json({ ok: false, error: e.message });
  }

  const requestCode = req.body?.request_code || req.body?.codigo_solicitud || null;
  const reason = req.body?.reason || req.body?.motivo || null;
  if (!requestCode) return res.status(400).json({ ok: false, error: 'request_code requerido' });

  try {
    const rows = await query(
      `SELECT id, codigo_solicitud, estado
       FROM aprobaciones
       WHERE codigo_solicitud = ?
       LIMIT 1`,
      [requestCode]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Solicitud no encontrada' });
    }

    if (rows[0].estado !== 'PENDIENTE') {
      return res.status(409).json({ ok: false, error: 'La solicitud ya fue procesada' });
    }

    await query(
      `UPDATE aprobaciones
       SET estado = 'RECHAZADO', procesado_por = ?, procesado_en = NOW(), motivo_rechazo = ?
       WHERE codigo_solicitud = ? AND estado = 'PENDIENTE'`,
      [decoded.id, reason, requestCode]
    );

    return res.status(200).json({ ok: true, data: { codigo_solicitud: requestCode, estado: 'RECHAZADO' } });
  } catch (err) {
    console.error('[approvals/reject]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
