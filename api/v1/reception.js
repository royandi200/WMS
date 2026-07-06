// GET/POST /api/v1/reception
const crypto = require('crypto');
const { createConnection, query } = require('../_lib/db');
const { cors, requireRole } = require('../_lib/auth');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function getDefaultBodega(conn) {
  const [rows] = await conn.execute(`SELECT id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 1`);
  if (!rows.length) throw httpError(500, 'No hay bodega activa configurada');
  return rows[0].id;
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

async function nextReceptionNumber(conn) {
  const [rows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM recepciones WHERE numero LIKE 'REC-DASH-%'`);
  return `REC-DASH-${String((rows[0]?.cnt || 0) + 1).padStart(6, '0')}`;
}

async function handleGet(req, res) {
  await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const limit = Math.min(Number(req.query?.limit || 100), 200);
  const rows = await query(
    `SELECT
       r.id,
       r.numero,
       r.proveedor_nombre,
       r.estado,
       r.observaciones,
       r.creado_en,
       r.completado_en,
       u.nombre AS usuario_nombre,
       ri.producto_id,
       p.siigo_code AS sku,
       p.nombre AS producto_nombre,
       ri.lote,
       ri.fecha_venc,
       ri.cantidad_esp,
       ri.cantidad_rec
     FROM recepciones r
     LEFT JOIN recepcion_items ri ON ri.recepcion_id = r.id
     LEFT JOIN productos p ON p.id = ri.producto_id
     LEFT JOIN usuarios u ON u.id = r.usuario_id
     ORDER BY COALESCE(r.completado_en, r.creado_en) DESC
     LIMIT ?`,
    [limit]
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePost(req, res) {
  const user = await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const body = req.body || {};
  const qtyTotal = Number(body.qty_total || body.cantidad || body.qty);
  const qtyDamaged = Number(body.qty_damaged || 0);
  if (!Number.isFinite(qtyTotal) || qtyTotal <= 0) throw httpError(400, 'Cantidad total invalida');
  if (!Number.isFinite(qtyDamaged) || qtyDamaged < 0 || qtyDamaged > qtyTotal) throw httpError(400, 'Cantidad danada invalida');

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const product = await findProduct(conn, body.product_id || body.sku);
    const bodegaId = await getDefaultBodega(conn);
    const qtyReceived = qtyTotal - qtyDamaged;
    const numero = await nextReceptionNumber(conn);
    const lpn = body.lot_id || body.lpn || `L-REC-${product.siigo_code}-${Date.now()}`;

    const [rec] = await conn.execute(
      `INSERT INTO recepciones (numero, bodega_id, proveedor_nombre, estado, usuario_id, observaciones, completado_en)
       VALUES (?, ?, ?, 'completada', ?, ?, NOW())`,
      [numero, bodegaId, body.supplier || body.proveedor || null, user.id, body.notes || null]
    );

    await conn.execute(
      `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, fecha_venc, cantidad_esp, cantidad_rec)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rec.insertId, product.id, lpn, body.expiry_date || null, qtyTotal, qtyReceived]
    );

    const lotId = crypto.randomUUID();
    await conn.execute(
      `INSERT INTO lots
         (id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier, origin, status, received_by, notes, expiry_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEPCION', 'DISPONIBLE', ?, ?, ?, NOW())`,
      [lotId, lpn, product.id, bodegaId, qtyReceived, qtyReceived, body.supplier || null, user.id, body.notes || null, body.expiry_date || null]
    );

    if (qtyReceived > 0) {
      await conn.execute(
        `INSERT INTO stock (producto_id, bodega_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
         VALUES (?, ?, ?, ?, ?, 0, NOW())
         ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad), actualizado_en = NOW()`,
        [product.id, bodegaId, lpn, body.expiry_date || null, qtyReceived]
      ).catch(async () => {
        await conn.execute(
          `INSERT INTO stock (producto_id, bodega_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
           VALUES (?, ?, ?, ?, ?, 0, NOW())`,
          [product.id, bodegaId, lpn, body.expiry_date || null, qtyReceived]
        );
      });
    }

    await conn.execute(
      `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
       VALUES ('entrada', ?, ?, ?, ?, ?, 'recepcion_dashboard', ?)`,
      [product.id, bodegaId, lpn, qtyReceived, rec.insertId, user.id]
    );

    await conn.commit();
    return res.status(200).json({ ok: true, data: { numero, sku: product.siigo_code, lote: lpn, cantidad_recibida: qtyReceived } });
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
    console.error('[reception]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
