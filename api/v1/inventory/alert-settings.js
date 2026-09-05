const { createConnection } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');
const { DEFAULT_DWELL_DAYS } = require('../../_lib/inventory-aging');
const {
  normalizeProductId,
  normalizeMinimumStock,
  normalizeConfiguredDwellDays,
} = require('../../_lib/product-alert-settings');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function handleGet(req, res) {
  await requireRole(req, ['Admin']);
  const search = String(req.query?.search || '').trim().slice(0, 80);
  const args = [];
  let filter = '';
  if (search) {
    filter = 'AND (p.siigo_code LIKE ? OR p.nombre LIKE ?)';
    args.push(`%${search}%`, `%${search}%`);
  }
  const conn = await createConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT p.id, p.siigo_code AS sku, p.nombre,
              COALESCE(NULLIF(p.unit_label, ''), 'und') AS unidad,
              p.stock_minimo, p.permanencia_max_dias,
              COALESCE(SUM(CASE
                WHEN l.status = 'DISPONIBLE'
                 AND (l.expiry_date IS NULL OR l.expiry_date >= CURDATE())
                 AND u.id IS NOT NULL AND u.activa = 1 AND b.activa = 1
                THEN GREATEST(s.cantidad - COALESCE(s.reservada, 0), 0)
                ELSE 0 END), 0) AS disponible
         FROM productos p
         LEFT JOIN stock s ON s.producto_id = p.id
         LEFT JOIN lots l ON l.product_id = s.producto_id AND BINARY l.lpn = BINARY s.lote
         LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.bodega_id = s.bodega_id
         LEFT JOIN bodegas b ON b.id = s.bodega_id
        WHERE p.activo = 1 ${filter}
        GROUP BY p.id, p.siigo_code, p.nombre, p.unit_label,
                 p.stock_minimo, p.permanencia_max_dias
        ORDER BY p.siigo_code
        LIMIT 500`,
      args
    );
    return res.status(200).json({
      ok: true,
      data: {
        default_dwell_days: DEFAULT_DWELL_DAYS,
        rows: rows.map((row) => ({
          ...row,
          stock_minimo: Number(row.stock_minimo || 0),
          permanencia_max_dias: Number(row.permanencia_max_dias || DEFAULT_DWELL_DAYS),
          disponible: Number(row.disponible || 0),
        })),
      },
    });
  } finally {
    await conn.end().catch(() => {});
  }
}

async function handlePut(req, res) {
  const actor = await requireRole(req, ['Admin']);
  const productId = normalizeProductId(req.body?.product_id);
  const minimumStock = normalizeMinimumStock(req.body?.stock_minimo);
  const dwellDays = normalizeConfiguredDwellDays(req.body?.permanencia_max_dias);
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT id, siigo_code, nombre, stock_minimo, permanencia_max_dias
         FROM productos WHERE id = ? AND activo = 1 LIMIT 1 FOR UPDATE`,
      [productId]
    );
    if (!rows.length) throw httpError(404, 'Producto activo no encontrado');
    const product = rows[0];
    const previousMinimum = Number(product.stock_minimo || 0);
    const previousDwellDays = Number(product.permanencia_max_dias || DEFAULT_DWELL_DAYS);
    const changed = previousMinimum !== minimumStock || previousDwellDays !== dwellDays;
    if (changed) {
      await conn.execute(
        `UPDATE productos
            SET stock_minimo = ?, permanencia_max_dias = ?, actualizado_en = NOW()
          WHERE id = ?`,
        [minimumStock, dwellDays, productId]
      );
      await conn.execute(
        `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
         VALUES ('inventario', 'INFO', 'Cambio de umbrales de alerta por SKU', ?, ?, NOW())`,
        [actor.id, JSON.stringify({
          producto_id: productId,
          sku: product.siigo_code,
          anterior: { stock_minimo: previousMinimum, permanencia_max_dias: previousDwellDays },
          nuevo: { stock_minimo: minimumStock, permanencia_max_dias: dwellDays },
          canal: 'dashboard',
        })]
      );
    }
    await conn.commit();
    return res.status(200).json({
      ok: true,
      data: {
        id: productId,
        sku: product.siigo_code,
        nombre: product.nombre,
        stock_minimo: minimumStock,
        permanencia_max_dias: dwellDays,
        changed,
      },
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = async (req, res) => {
  cors(res, 'GET, PUT');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'PUT') return await handlePut(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[inventory/alert-settings]', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible administrar los umbrales de alerta' });
  }
};
