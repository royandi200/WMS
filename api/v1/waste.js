// GET/POST /api/v1/waste
const { createConnection, query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function findProduct(conn, value) {
  const term = String(value || '').trim();
  const [rows] = await conn.execute(
    `SELECT id, siigo_code, nombre
     FROM productos
     WHERE id = ? OR siigo_code = ?
     LIMIT 1`,
    [Number.isFinite(Number(term)) ? Number(term) : 0, term]
  );
  if (!rows.length) throw httpError(404, 'Producto no encontrado');
  return rows[0];
}

async function findOrder(conn, value) {
  if (!value) return null;
  const term = String(value).trim();
  const [rows] = await conn.execute(
    `SELECT id, codigo_orden FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1`,
    [Number.isFinite(Number(term)) ? Number(term) : 0, term]
  );
  return rows[0] || null;
}

async function ensureWasteTable(conn) {
  await conn.execute(
    `CREATE TABLE IF NOT EXISTS mermas (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       numero VARCHAR(40) NOT NULL UNIQUE,
       tipo VARCHAR(60) NOT NULL,
       producto_id INT UNSIGNED NOT NULL,
       lote VARCHAR(100) NULL,
       orden_produccion_id INT UNSIGNED NULL,
       cantidad DECIMAL(15,4) NOT NULL,
       motivo TEXT NULL,
       usuario_id INT UNSIGNED NULL,
       creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_mermas_creado_en (creado_en),
       INDEX idx_mermas_producto (producto_id),
       INDEX idx_mermas_lote (lote),
       INDEX idx_mermas_op (orden_produccion_id)
     )`
  );
}

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.WASTE_READ);
  const limit = Math.min(Number(req.query?.limit || 100), 200);
  const conn = await createConnection();
  try {
    await ensureWasteTable(conn);
  } finally {
    try { await conn.end(); } catch (_) {}
  }
  const rows = await query(
    `SELECT
       m.id,
       m.numero,
       m.tipo AS type,
       m.producto_id AS product_id,
       p.siigo_code AS sku,
       p.nombre AS product_name,
       m.lote AS lot_id,
       op.codigo_orden AS production_order_code,
       m.orden_produccion_id AS production_order_id,
       m.cantidad AS qty,
       m.motivo AS reason,
       m.usuario_id,
       u.nombre AS user_name,
       m.creado_en AS created_at
     FROM mermas m
     LEFT JOIN productos p ON p.id = m.producto_id
     LEFT JOIN ordenes_produccion op ON op.id = m.orden_produccion_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     ORDER BY m.creado_en DESC
     LIMIT ?`,
    [limit]
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePost(req, res) {
  const user = await requireCapability(req, CAPABILITIES.WASTE_REPORT);
  const body = req.body || {};
  const qty = Math.abs(Number(body.qty || body.cantidad));
  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, 'Cantidad de merma invalida');
  if (!body.lot_id && !body.production_order_id) throw httpError(400, 'Debes indicar lote u orden de produccion');

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();
    await ensureWasteTable(conn);
    const product = await findProduct(conn, body.product_id || body.sku);
    const order = await findOrder(conn, body.production_order_id);
    const type = body.type || (order ? 'PROCESO' : 'BODEGA');
    const numero = `MER-${Date.now()}`;
    const lot = body.lot_id || body.lote || null;

    await conn.execute(
      `INSERT INTO mermas
         (numero, tipo, producto_id, lote, orden_produccion_id, cantidad, motivo, usuario_id, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [numero, type, product.id, lot, order?.id || null, qty, body.reason || body.motivo || null, user.id]
    );

    if (lot) {
      const [stockUpdate] = await conn.execute(
        `UPDATE stock
         SET cantidad = cantidad - ?, actualizado_en = NOW()
         WHERE producto_id = ? AND lote = ? AND cantidad >= ?
         LIMIT 1`,
        [qty, product.id, lot, qty]
      );
      if (stockUpdate.affectedRows !== 1) throw httpError(409, `Stock insuficiente para merma de lote ${lot}`);
      await conn.execute(
        `UPDATE lots SET qty_current = qty_current - ? WHERE lpn = ? AND qty_current >= ?`,
        [qty, lot, qty]
      ).catch(() => {});
      await conn.execute(
        `UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', status) WHERE lpn = ?`,
        [lot]
      ).catch(() => {});
    }

    await conn.execute(
      `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
       VALUES ('ajuste', ?, NULL, ?, ?, 'merma_dashboard', ?)`,
      [product.id, lot, -qty, user.id]
    ).catch(() => {});

    await conn.commit();
    return res.status(200).json({ ok: true, data: { numero, sku: product.siigo_code, qty, lot_id: lot, production_order_id: order?.codigo_orden || null } });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    throw err;
  } finally {
    if (conn) {
      try { await conn.end(); } catch (_) {}
    }
  }
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[waste]', err.message);
    const detail = process.env.NODE_ENV === 'production' ? null : err.message;
    return res.status(500).json({ ok: false, error: detail || 'Error interno del servidor' });
  }
};
