// GET  /api/v1/products  — listar productos
// POST /api/v1/products  — crear producto
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

// Mapea una fila de la tabla `productos` al contrato que espera el frontend.
// Campos clave del frontend: id, sku, name, description, type, unit,
//   min_stock, max_stock, active, siigo_id, siigo_code, createdAt
// Nota: la tabla no tiene stock_minimo/max — se retorna 0 como valor por defecto
// hasta que se agregue esa columna al schema.
const toRow = (row) => ({
  id:           row.id,
  // sku es el alias público de siigo_code
  sku:          row.siigo_code,
  siigo_id:     row.siigo_id,
  siigo_code:   row.siigo_code,
  name:         row.nombre,
  description:  row.descripcion,
  // type: frontend usa MATERIA_PRIMA/PRODUCTO_TERMINADO/INSUMO/EMPAQUE;
  // BD usa Product/Service/Combo/ConsumerGood. Se conserva el valor real.
  type:         row.tipo_producto,
  unit_code:    row.unit_code,
  unit:         row.unit_label ?? row.unit_code ?? 'und',
  barcode:      row.barcode,
  referencia:   row.referencia,
  marca:        row.marca,
  precio_venta: Number(row.precio_venta || 0),
  control_stock:row.control_stock === 1,
  // min_stock / max_stock: columnas aún no existen en el schema.
  // Se exponen como 0 para que el frontend no crashee con undefined.
  min_stock:    Number(row.stock_minimo ?? row.min_stock ?? 0),
  max_stock:    Number(row.stock_maximo ?? row.max_stock ?? 0),
  active:       row.activo === 1,
  siigo_sync_at: row.siigo_synced_at,
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

      // Count query paralela
      let countSql = `SELECT COUNT(*) AS total FROM productos WHERE 1=1`;
      const countArgs = [];
      if (active === 'true')  countSql += ` AND activo = 1`;
      if (active === 'false') countSql += ` AND activo = 0`;
      if (type)   { countSql += ` AND tipo_producto = ?`; countArgs.push(type); }
      if (search) {
        countSql += ` AND (siigo_code LIKE ? OR nombre LIKE ? OR barcode LIKE ?)`;
        countArgs.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const countRows = await query(countSql, countArgs);

      return res.status(200).json({
        ok: true,
        data: { rows: rows.map(toRow), total: Number(countRows[0]?.total ?? 0) }
      });
    } catch (err) {
      console.error('[products GET]', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      // El frontend envía `sku` — lo aceptamos como alias de siigo_code
      const {
        sku, siigo_code,
        name, description,
        type = 'Product',
        unit_code = '94',
        unit,          // frontend manda `unit` (texto libre) → se guarda en unit_label
        barcode, referencia, marca, precio_venta
      } = req.body || {};

      const code = siigo_code || sku;
      if (!code || !name)
        return res.status(400).json({ ok: false, error: 'sku/siigo_code y name son requeridos' });

      await query(
        `INSERT INTO productos
           (siigo_code, nombre, descripcion, tipo_producto, unit_code, unit_label,
            barcode, referencia, marca, precio_venta, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          code, name, description || null, type,
          unit_code,
          unit || null,
          barcode || null, referencia || null, marca || null, precio_venta || null
        ]
      );
      const [row] = await query(`SELECT * FROM productos WHERE siigo_code = ? LIMIT 1`, [code]);
      return res.status(201).json({ ok: true, data: toRow(row) });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ ok: false, error: 'El código SKU ya existe' });
      console.error('[products POST]', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
