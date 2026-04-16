// POST /api/v1/production/advance
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { orden_id, nueva_fase, notas } = req.body || {};
    if (!orden_id || !nueva_fase)
      return res.status(400).json({ ok: false, error: 'orden_id y nueva_fase son requeridos' });

    await query(
      `UPDATE ordenes_produccion SET fase=?, notas=CONCAT(IFNULL(notas,''), ' | ', ?) WHERE id=?`,
      [nueva_fase, notas || `Avance a ${nueva_fase}`, orden_id]
    );
    const rows = await query(`SELECT * FROM ordenes_produccion WHERE id=? LIMIT 1`, [orden_id]);
    return res.status(200).json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[production/advance]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al avanzar fase' });
  }
};
