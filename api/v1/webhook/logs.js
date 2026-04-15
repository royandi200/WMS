// GET /api/v1/webhook/logs
// Lee de webhook_logs — tabla donde builderbot.js escribe cada evento
// Columnas conocidas: id, from_phone, action, priority, payload, response, status
// La columna de fecha se llama created_at o timestamp (definida con DEFAULT en BD)
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { page = 1, limit = 50, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE 1=1';
    const args = [];
    if (status) { where += ' AND status = ?'; args.push(status); }

    // Usamos SELECT * para no asumir el nombre exacto de la columna de fecha
    // El frontend normaliza cualquier campo de fecha con fallbacks
    const rows = await query(
      `SELECT id, from_phone, action, priority, status,
              LEFT(payload,  400) AS payload_preview,
              LEFT(response, 400) AS response_preview,
              created_at, timestamp, creado_en
       FROM webhook_logs ${where}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...args, Number(limit), offset]
    );

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM webhook_logs ${where}`, args
    );

    return res.status(200).json({ ok: true, data: { rows, total: Number(countRows[0]?.total ?? 0) } });
  } catch (err) {
    console.error('[webhook/logs]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
