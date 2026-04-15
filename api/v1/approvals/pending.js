// GET /api/v1/approvals/pending
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const rows = await query(
      `SELECT a.*, u.nombre AS solicitante_nombre
       FROM aprobaciones a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.estado = 'pendiente'
       ORDER BY a.creado_en DESC
       LIMIT 100`
    );
    return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
  } catch (err) {
    console.error('[approvals/pending]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
