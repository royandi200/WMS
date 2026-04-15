// api/v1/products/index.js
// GET  /api/v1/products  — listar productos
// POST /api/v1/products  — crear producto
const { query }       = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET, POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    verifyToken(req);
  } catch (e) {
    return res.status(e.status || 401).json({ ok: false, error: e.message });
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { search = '', type = '', active = 'true' } = req.query;
      let sql    = `SELECT * FROM productos WHERE 1=1`;
      const args = [];

      if (active === 'true')  { sql += ` AND activo = 1`; }
      if (active === 'false') { sql += ` AND activo = 0`; }
      if (type)   { sql += ` AND tipo = ?`;   args.push(type); }
      if (search) {
        sql += ` AND (sku LIKE ? OR nombre LIKE ?)`;
        args.push(`%${search}%`, `%${search}%`);
      }
      sql += ` ORDER BY nombre ASC`;

      const rows = await query(sql, args);
      const mapped = rows.map(row => ({
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
        siigo_active:row.siigo_activo,
        siigo_sync_at:row.siigo_sync_at,
        createdAt:   row.created_at,
      }));
      return res.status(200).json({ ok: true, data: mapped });
    } catch (err) {
      console.error('[products GET]', err.message);
      return res.status(500).json({ ok: false, error: 'Error al obtener productos' });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { sku, name, description, type, unit, min_stock = 0, max_stock = 0 } = req.body || {};
      if (!sku || !name || !type || !unit)
        return res.status(400).json({ ok: false, error: 'sku, name, type y unit son requeridos' });

      await query(
        `INSERT INTO productos (sku, nombre, descripcion, tipo, unidad, stock_min, stock_max, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [sku, name, description || null, type, unit, min_stock, max_stock]
      );
      const [row] = await query(`SELECT * FROM productos WHERE sku = ? LIMIT 1`, [sku]);
      const p = {
        id: row.id, sku: row.sku, name: row.nombre,
        description: row.descripcion, type: row.tipo, unit: row.unidad,
        min_stock: Number(row.stock_min), max_stock: Number(row.stock_max),
        active: true, createdAt: row.created_at,
      };
      return res.status(201).json({ ok: true, data: p });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ ok: false, error: 'El SKU ya existe' });
      console.error('[products POST]', err.message);
      return res.status(500).json({ ok: false, error: 'Error al crear producto' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
