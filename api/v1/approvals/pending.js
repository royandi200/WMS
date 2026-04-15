// GET /api/v1/approvals/pending
// Lee solicitudes pendientes de cola_aprobaciones — tabla que escribe builderbot.js
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const rows = await query(
      `SELECT ca.id, ca.request_code, ca.accion AS tipo,
              ca.payload, ca.estado, ca.prioridad,
              ca.creado_en,
              u.nombre  AS usuario_nombre,
              u.phone   AS from_phone
       FROM cola_aprobaciones ca
       LEFT JOIN usuarios u ON u.id = ca.solicitado_por
       WHERE ca.estado = 'PENDIENTE'
       ORDER BY ca.prioridad DESC, ca.creado_en ASC
       LIMIT 100`
    );
    return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
  } catch (err) {
    console.error('[approvals/pending]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
