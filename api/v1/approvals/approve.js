// POST /api/v1/approvals/approve
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  let user;
  try { user = verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { id } = req.body;
  if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });

  try {
    await query(
      `UPDATE aprobaciones SET estado='aprobado', aprobado_por=?, aprobado_en=NOW() WHERE id=? AND estado='pendiente'`,
      [user.id, id]
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[approvals/approve]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
