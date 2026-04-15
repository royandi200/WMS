// api/v1/products/[id]/toggle.js
// PATCH /api/v1/products/:id/toggle  — activa / inactiva un producto
const { query }             = require('../../../_lib/db');
const { cors, verifyToken } = require('../../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'PATCH');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try { verifyToken(req); }
  catch (e) { return res.status(e.status || 401).json({ ok: false, error: e.message }); }

  const { id } = req.query;
  try {
    const rows = await query(`SELECT activo FROM productos WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length)
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    const nuevoEstado = rows[0].activo ? 0 : 1;
    await query(`UPDATE productos SET activo = ? WHERE id = ?`, [nuevoEstado, id]);
    return res.status(200).json({ ok: true, active: nuevoEstado === 1 });
  } catch (err) {
    console.error('[products/toggle]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al cambiar estado' });
  }
};
