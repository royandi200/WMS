// GET /api/v1/webhook/logs  — usa siigo_sync_log como fuente de logs
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { page = 1, limit = 50, status, desde, hasta } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE 1=1';
    const args = [];
    if (status) { where += ' AND status_code = ?'; args.push(Number(status)); }
    if (desde)  { where += ' AND creado_en >= ?';  args.push(desde); }
    if (hasta)  { where += ' AND creado_en <= ?';  args.push(hasta); }

    const rows = await query(
      `SELECT id, entidad, entidad_id, operacion, endpoint, metodo_http,
              siigo_id, status_code, error_msg, duracion_ms, creado_en
       FROM siigo_sync_log ${where}
       ORDER BY creado_en DESC LIMIT ? OFFSET ?`,
      [...args, Number(limit), offset]
    );
    const countRows = await query(
      `SELECT COUNT(*) AS total FROM siigo_sync_log ${where}`, args
    );
    return res.status(200).json({ ok: true, data: { rows, total: Number(countRows[0]?.total ?? 0) } });
  } catch (err) {
    console.error('[webhook/logs]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
