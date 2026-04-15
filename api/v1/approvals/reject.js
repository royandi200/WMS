// POST /api/v1/approvals/reject
// Elimina un movimiento de ajuste rechazado
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { id } = req.body;
  if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
  try {
    await query(`DELETE FROM movimientos WHERE id = ? AND tipo = 'ajuste' AND siigo_sync = 0`, [id]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[approvals/reject]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
