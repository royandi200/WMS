// api/v1/products/[id].js
// GET   /api/v1/products/:id
// PUT   /api/v1/products/:id
// PATCH /api/v1/products/:id/toggle  ← manejado por toggle.js
const { query }             = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

function mapRow(row) {
  return {
    id:          row.id,
    sku:         row.sku,
    name:        row.nombre,
    description: row.descripcion,
    type:        row.tipo,
    unit:        row.unidad,
    min_stock:   Number(row.stock_min),
    max_stock:   Number(row.stock_max),
    active:      row.activo === 1 || row.activo === true,
    siigo_id:    row.siigo_id,
    siigo_code:  row.siigo_code,
    createdAt:   row.created_at,
  };
}

module.exports = async (req, res) => {
  cors(res, 'GET, PUT');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try { verifyToken(req); }
  catch (e) { return res.status(e.status || 401).json({ ok: false, error: e.message }); }

  const { id } = req.query;

  // ── GET
  if (req.method === 'GET') {
    try {
      const rows = await query(`SELECT * FROM productos WHERE id = ? LIMIT 1`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
      return res.status(200).json({ ok: true, data: mapRow(rows[0]) });
    } catch (err) {
      console.error('[products/:id GET]', err.message);
      return res.status(500).json({ ok: false, error: 'Error al obtener producto' });
    }
  }

  // ── PUT (actualizar)
  if (req.method === 'PUT') {
    try {
      const { name, description, type, unit, min_stock, max_stock } = req.body || {};
      if (!name || !type || !unit)
        return res.status(400).json({ ok: false, error: 'name, type y unit son requeridos' });

      await query(
        `UPDATE productos
         SET nombre=?, descripcion=?, tipo=?, unidad=?, stock_min=?, stock_max=?
         WHERE id=?`,
        [name, description || null, type, unit, min_stock ?? 0, max_stock ?? 0, id]
      );
      const rows = await query(`SELECT * FROM productos WHERE id = ? LIMIT 1`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
      return res.status(200).json({ ok: true, data: mapRow(rows[0]) });
    } catch (err) {
      console.error('[products/:id PUT]', err.message);
      return res.status(500).json({ ok: false, error: 'Error al actualizar producto' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
