// POST /api/v1/production/start
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { producto_id, cantidad, lote, fecha_inicio, notas } = req.body || {};
    if (!producto_id || !cantidad)
      return res.status(400).json({ ok: false, error: 'producto_id y cantidad son requeridos' });

    const result = await query(
      `INSERT INTO ordenes_produccion (producto_id, cantidad, lote, fecha_inicio, notas, estado)
       VALUES (?, ?, ?, ?, ?, 'INICIADA')`,
      [producto_id, cantidad, lote || null, fecha_inicio || new Date(), notas || null]
    );
    const rows = await query(`SELECT * FROM ordenes_produccion WHERE id = ? LIMIT 1`, [result.insertId]);
    return res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[production/start]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al iniciar producción' });
  }
};
