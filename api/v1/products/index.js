// GET  /api/v1/products  — listar productos
// POST /api/v1/products  — crear producto
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

const toRow = (row) => ({
  id:           row.id,
  siigo_id:     row.siigo_id,
  siigo_code:   row.siigo_code,
  name:         row.nombre,
  description:  row.descripcion,
  type:         row.tipo_producto,
  unit_code:    row.unit_code,
  unit_label:   row.unit_label,
  barcode:      row.barcode,
  referencia:   row.referencia,
  marca:        row.marca,
  precio_venta: Number(row.precio_venta || 0),
  control_stock:row.control_stock === 1,
  active:       row.activo === 1,
  createdAt:    row.creado_en,
});

module.exports = async (req, res) => {
  cors(res, 'GET, POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { search = '', type = '', active = 'true', page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);
      let sql = `SELECT * FROM productos WHERE 1=1`;
      const args = [];

      if (active === 'true')  { sql += ` AND activo = 1`; }
      if (active === 'false') { sql += ` AND activo = 0`; }
      if (type)   { sql += ` AND tipo_producto = ?`; args.push(type); }
      if (search) {
        sql += ` AND (siigo_code LIKE ? OR nombre LIKE ? OR barcode LIKE ?)`;
        args.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      sql += ` ORDER BY nombre ASC LIMIT ? OFFSET ?`;
      args.push(Number(limit), offset);

      const rows = await query(sql, args);
      const countRows = await query(
        `SELECT COUNT(*) AS total FROM productos WHERE 1=1` +
        (active === 'true' ? ' AND activo=1' : active === 'false' ? ' AND activo=0' : '') +
        (type ? ' AND tipo_producto=?' : '') +
        (search ? ' AND (siigo_code LIKE ? OR nombre LIKE ? OR barcode LIKE ?)' : ''),
        [...(type ? [type] : []), ...(search ? [`%${search}%`,`%${search}%`,`%${search}%`] : [])]
      );
      return res.status(200).json({ ok: true, data: { rows: rows.map(toRow), total: Number(countRows[0]?.total ?? 0) } });
    } catch (err) {
      console.error('[products GET]', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { siigo_code, name, description, type = 'Product', unit_code = '94', barcode, referencia, marca, precio_venta } = req.body || {};
      if (!siigo_code || !name)
        return res.status(400).json({ ok: false, error: 'siigo_code y name son requeridos' });

      await query(
        `INSERT INTO productos (siigo_code, nombre, descripcion, tipo_producto, unit_code, barcode, referencia, marca, precio_venta, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [siigo_code, name, description || null, type, unit_code, barcode || null, referencia || null, marca || null, precio_venta || null]
      );
      const [row] = await query(`SELECT * FROM productos WHERE siigo_code = ? LIMIT 1`, [siigo_code]);
      return res.status(201).json({ ok: true, data: toRow(row) });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ ok: false, error: 'El código SIIGO ya existe' });
      console.error('[products POST]', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
