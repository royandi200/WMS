// GET  /api/v1/products  — listar productos
// POST /api/v1/products  — crear producto
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

// Mapea una fila de producto + métricas dashboard al contrato que espera el frontend.
const toRow = (row) => ({
  id:             row.id ?? row.producto_id,
  sku:            row.siigo_code ?? row.sku,
  siigo_id:       row.siigo_id,
  siigo_code:     row.siigo_code ?? row.sku,
  name:           row.nombre,
  description:    row.descripcion,
  type:           row.tipo_producto,
  unit_code:      row.unit_code,
  unit:           row.unit_label ?? row.unit_code ?? 'und',
  barcode:        row.barcode,
  referencia:     row.referencia,
  marca:          row.marca,
  precio_venta:   Number(row.precio_venta || 0),
  control_stock:  row.control_stock === 1,
  min_stock:      Number(row.stock_minimo ?? row.min_stock ?? 0),
  max_stock:      Number(row.stock_maximo ?? row.max_stock ?? 0),
  active:         row.activo === 1,
  siigo_sync_at:  row.siigo_synced_at,
  createdAt:      row.creado_en,

  // métricas dashboard
  disponible:          Number(row.disponible ?? 0),
  cuarentena:          Number(row.cuarentena ?? 0),
  reservado:           Number(row.reservado ?? 0),
  total_fisico:        Number(row.total_fisico ?? 0),
  lotes_activos:       Number(row.lotes_activos ?? 0),
  proximo_vencimiento: row.proximo_vencimiento ?? null,
  ultimo_movimiento:   row.ultimo_movimiento ?? null,
  semaforo:            row.semaforo ?? 'OK',
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

      let sql = `
        SELECT
          p.*,
          vd.producto_id,
          vd.sku,
          vd.disponible,
          vd.cuarentena,
          vd.reservado,
          vd.total_fisico,
          vd.lotes_activos,
          vd.proximo_vencimiento,
          vd.ultimo_movimiento,
          vd.semaforo
        FROM productos p
        LEFT JOIN v_dashboard_productos vd
          ON vd.producto_id = p.id
        WHERE 1=1
      `;
      const args = [];

      if (active === 'true')  sql += ` AND p.activo = 1`;
      if (active === 'false') sql += ` AND p.activo = 0`;
      if (type) {
        sql += ` AND p.tipo_producto = ?`;
        args.push(type);
      }
      if (search) {
        sql += ` AND (p.siigo_code LIKE ? OR p.nombre LIKE ? OR p.barcode LIKE ?)`;
        args.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      sql += ` ORDER BY p.nombre ASC LIMIT ? OFFSET ?`;
      args.push(Number(limit), offset);

      const rows = await query(sql, args);

      let countSql = `SELECT COUNT(*) AS total FROM productos p WHERE 1=1`;
      const countArgs = [];

      if (active === 'true')  countSql += ` AND p.activo = 1`;
      if (active === 'false') countSql += ` AND p.activo = 0`;
      if (type) {
        countSql += ` AND p.tipo_producto = ?`;
        countArgs.push(type);
      }
      if (search) {
        countSql += ` AND (p.siigo_code LIKE ? OR p.nombre LIKE ? OR p.barcode LIKE ?)`;
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
