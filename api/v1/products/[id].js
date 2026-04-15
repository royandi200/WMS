// api/v1/products/[id].js
// GET  /api/v1/products/:id  — obtener producto por ID
// PUT  /api/v1/products/:id  — actualizar producto
const { query }             = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

// Usa las columnas reales de la tabla `productos` (ver database/schema.sql)
function mapRow(row) {
  return {
    id:           row.id,
    sku:          row.siigo_code,          // alias público
    siigo_id:     row.siigo_id,
    siigo_code:   row.siigo_code,
    name:         row.nombre,
    description:  row.descripcion,
    type:         row.tipo_producto,
    unit_code:    row.unit_code,
    unit:         row.unit_label ?? row.unit_code ?? 'und',
    barcode:      row.barcode,
    referencia:   row.referencia,
    marca:        row.marca,
    precio_venta: Number(row.precio_venta || 0),
    control_stock:row.control_stock === 1,
    min_stock:    Number(row.stock_minimo ?? row.min_stock ?? 0),
    max_stock:    Number(row.stock_maximo ?? row.max_stock ?? 0),
    active:       row.activo === 1 || row.activo === true,
    siigo_sync_at: row.siigo_synced_at,
    createdAt:    row.creado_en,
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
  // El frontend envía: { name, description, type, unit, min_stock, max_stock }
  // Columnas reales en BD: nombre, descripcion, tipo_producto, unit_label
  // Nota: min_stock/max_stock no existen aún en el schema — se ignoran por ahora
  // sin generar error, para no bloquear el flujo del frontend.
  if (req.method === 'PUT') {
    try {
      const { name, description, type, unit } = req.body || {};
      if (!name || !type)
        return res.status(400).json({ ok: false, error: 'name y type son requeridos' });

      await query(
        `UPDATE productos
         SET nombre = ?, descripcion = ?, tipo_producto = ?, unit_label = ?,
             actualizado_en = NOW()
         WHERE id = ?`,
        [name, description || null, type, unit || null, id]
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
