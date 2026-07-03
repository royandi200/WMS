// GET/POST /api/v1/dispatch
const crypto = require('crypto');
const { createConnection, query } = require('../_lib/db');
const { cors, requireRole } = require('../_lib/auth');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fmtNumber(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

async function getDefaultBodega(conn) {
  const [rows] = await conn.execute(`SELECT id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 1`);
  if (!rows.length) throw httpError(500, 'No hay bodega activa configurada');
  return rows[0].id;
}

async function lotIdByLpn(conn, lpn) {
  const [rows] = await conn.execute(`SELECT id FROM lots WHERE lpn = ? LIMIT 1`, [lpn]);
  return rows[0]?.id || null;
}

async function logKardex(conn, { productId, userId, qty, lotId, balanceAfter, reference, notes }) {
  await conn.execute(
    `INSERT INTO kardex
       (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after, reference, notes, approved_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'DESPACHO', ?, ?, ?, ?, ?, NOW())`,
    [crypto.randomUUID(), crypto.randomUUID(), lotId || null, productId, userId, qty, balanceAfter, reference, notes || null, userId]
  ).catch(() => {});
}

async function getProductByLot(conn, lpn) {
  const [rows] = await conn.execute(
    `SELECT l.product_id, l.bodega_id, p.siigo_code, p.nombre
     FROM lots l
     JOIN productos p ON p.id = l.product_id
     WHERE l.lpn = ?
     LIMIT 1`,
    [lpn]
  );
  if (!rows.length) throw httpError(404, 'Lote no encontrado');
  return rows[0];
}

async function insertDispatch(conn, { numero, customer, bodegaId, productId, lpn, qty, userId, notes }) {
  let dispatchId = null;
  try {
    const [inserted] = await conn.execute(
      `INSERT INTO despachos
         (numero, cliente_nombre, bodega_id, producto_id, lote, cantidad, estado, usuario_id, observaciones, creado_en, despachado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'despachado', ?, ?, NOW(), NOW())`,
      [numero, customer || null, bodegaId, productId, lpn, qty, userId, notes || null]
    );
    dispatchId = inserted.insertId;
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR' && err.code !== 'ER_UNKNOWN_COLUMN') throw err;
    const [inserted] = await conn.execute(
      `INSERT INTO despachos
         (numero, cliente_nombre, bodega_id, estado, usuario_id, observaciones, creado_en, despachado_en)
       VALUES (?, ?, ?, 'despachado', ?, ?, NOW(), NOW())`,
      [numero, customer || null, bodegaId, userId, notes || null]
    );
    dispatchId = inserted.insertId;
  }

  await conn.execute(
    `INSERT INTO despacho_items (despacho_id, producto_id, lote, cantidad_sol, cantidad_des)
     VALUES (?, ?, ?, ?, ?)`,
    [dispatchId, productId, lpn, qty, qty]
  ).catch(() => {});

  return dispatchId;
}

async function handleGet(req, res) {
  await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const limit = Math.min(Number(req.query?.limit || 100), 200);
  const columns = await query(`SHOW COLUMNS FROM despachos`).catch(() => []);
  const hasDirectItems = columns.some((c) => c.Field === 'producto_id')
    && columns.some((c) => c.Field === 'lote')
    && columns.some((c) => c.Field === 'cantidad');

  const itemProduct = hasDirectItems ? 'COALESCE(di.producto_id, d.producto_id)' : 'di.producto_id';
  const itemLot = hasDirectItems ? 'COALESCE(di.lote, d.lote)' : 'di.lote';
  const itemQty = hasDirectItems ? 'COALESCE(di.cantidad_des, d.cantidad)' : 'di.cantidad_des';

  const rows = await query(
    `SELECT
       d.id,
       d.numero,
       d.cliente_nombre,
       d.estado,
       d.creado_en,
       d.despachado_en,
       d.usuario_id,
       u.nombre AS usuario_nombre,
       ${itemProduct} AS producto_id,
       p.siigo_code AS sku,
       p.nombre AS producto_nombre,
       ${itemLot} AS lote,
       ${itemQty} AS cantidad
     FROM despachos d
     LEFT JOIN despacho_items di ON di.despacho_id = d.id
     LEFT JOIN productos p ON p.id = ${itemProduct}
     LEFT JOIN usuarios u ON u.id = d.usuario_id
     ORDER BY COALESCE(d.despachado_en, d.creado_en) DESC
     LIMIT ?`,
    [limit]
  );

  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePost(req, res) {
  const user = await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const body = req.body || {};
  const lpn = String(body.lot_id || body.lpn || body.lote || '').trim();
  const qty = Number(body.qty || body.cantidad);
  const customer = String(body.customer || body.cliente || '').trim();

  if (!lpn) throw httpError(400, 'El lote es requerido');
  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, 'La cantidad debe ser positiva');
  if (!customer) throw httpError(400, 'El cliente es requerido');

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const lot = await getProductByLot(conn, lpn);
    const bodegaId = lot.bodega_id || await getDefaultBodega(conn);

    const [stockUpdate] = await conn.execute(
      `UPDATE stock
       SET cantidad = cantidad - ?, actualizado_en = NOW()
       WHERE producto_id = ? AND bodega_id = ? AND lote = ? AND cantidad >= ? LIMIT 1`,
      [qty, lot.product_id, bodegaId, lpn, qty]
    );
    if (stockUpdate.affectedRows !== 1) {
      throw httpError(409, `Stock insuficiente para lote ${lpn}`);
    }

    const [lotUpdate] = await conn.execute(
      `UPDATE lots SET qty_current = qty_current - ? WHERE lpn = ? AND qty_current >= ?`,
      [qty, lpn, qty]
    );
    if (lotUpdate.affectedRows !== 1) {
      throw httpError(409, `Saldo insuficiente en lote ${lpn}`);
    }
    await conn.execute(`UPDATE lots SET status = IF(qty_current <= 0, 'DESPACHADO', 'DISPONIBLE') WHERE lpn = ?`, [lpn]);

    const numero = `DSP-${Date.now()}`;
    const dispatchId = await insertDispatch(conn, {
      numero,
      customer,
      bodegaId,
      productId: lot.product_id,
      lpn,
      qty,
      userId: user.id,
      notes: body.notes || body.observaciones || 'Despacho registrado desde dashboard',
    });

    await conn.execute(
      `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
       VALUES ('salida', ?, ?, ?, ?, ?, 'despacho_dashboard', ?)`,
      [lot.product_id, bodegaId, lpn, qty, dispatchId, user.id]
    );

    const [lotRows] = await conn.execute(`SELECT id, qty_current FROM lots WHERE lpn = ? LIMIT 1`, [lpn]);
    const balance = Number(lotRows[0]?.qty_current || 0);
    await logKardex(conn, {
      productId: lot.product_id,
      userId: user.id,
      qty: -qty,
      lotId: lotRows[0]?.id || null,
      balanceAfter: balance,
      reference: `despacho:${numero}`,
      notes: `Cliente: ${customer}`,
    });

    await conn.commit();

    return res.status(200).json({
      ok: true,
      data: {
        numero,
        cliente: customer,
        sku: lot.siigo_code,
        producto: lot.nombre,
        lote: lpn,
        cantidad: qty,
        saldo_lote: balance,
        mensaje: `Despacho ${numero} registrado. Lote ${lpn}: ${fmtNumber(qty)} und.`,
      },
    });
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
    console.error('[dispatch]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
