// GET/POST /api/v1/returns
const crypto = require('crypto');
const { createConnection, query } = require('../_lib/db');
const { cors, requireRole } = require('../_lib/auth');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeReturnStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  const map = {
    recuperable: 'RECUPERABLE',
    cuarentena: 'CUARENTENA',
    destruccion: 'DESTRUCCION',
    destruccion_total: 'DESTRUCCION',
    destrucciontotal: 'DESTRUCCION',
    destrucción: 'DESTRUCCION',
  };
  return map[raw] || 'CUARENTENA';
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
  const [rows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM recepciones WHERE numero LIKE 'REC-DASH-DEV-%'`);
  return `REC-DASH-DEV-${String((rows[0]?.cnt || 0) + 1).padStart(6, '0')}`;
}

async function insertStock(conn, { productId, bodegaId, lpn, qty }) {
  await conn.execute(
    `INSERT INTO stock (producto_id, bodega_id, lote, cantidad, reservada, actualizado_en)
     VALUES (?, ?, ?, ?, 0, NOW())
     ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad), actualizado_en = NOW()`,
    [productId, bodegaId, lpn, qty]
  ).catch(async () => {
    await conn.execute(
      `INSERT INTO stock (producto_id, bodega_id, lote, cantidad, reservada, actualizado_en)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [productId, bodegaId, lpn, qty]
    );
  });
}

async function logKardex(conn, { productId, userId, lotId, qty, reference, notes }) {
  const [balanceRows] = await conn.execute(
    `SELECT COALESCE(SUM(cantidad - reservada), 0) AS balance
     FROM stock
     WHERE producto_id = ?`,
    [productId]
  ).catch(() => [[{ balance: null }]]);
  await conn.execute(
    `INSERT INTO kardex
       (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after, reference, notes, approved_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'DEVOLUCION', ?, ?, ?, ?, ?, NOW())`,
    [
      crypto.randomUUID(),
      crypto.randomUUID(),
      lotId || null,
      productId,
      userId,
      qty,
      balanceRows[0]?.balance ?? null,
      reference,
      notes || null,
      userId,
    ]
  ).catch(() => {});
}

async function handleGet(req, res) {
  await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const limit = Math.min(Number(req.query?.limit || 100), 200);
  const rows = await query(
    `SELECT
       d.id,
       d.numero,
       d.producto_id,
       p.siigo_code AS sku,
       p.nombre AS producto_nombre,
       d.lote,
       d.cliente_origen,
       d.cantidad,
       d.estado,
       d.observaciones,
       d.creado_en,
       u.nombre AS usuario_nombre
     FROM devoluciones d
     LEFT JOIN productos p ON p.id = d.producto_id
     LEFT JOIN usuarios u ON u.id = d.usuario_id
     ORDER BY d.creado_en DESC
     LIMIT ?`,
    [limit]
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePost(req, res) {
  const user = await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const body = req.body || {};
  const qty = Number(body.cantidad || body.qty);
  const estado = normalizeReturnStatus(body.estado || body.status);
  const cliente = String(body.cliente_origen || body.customer || body.cliente || '').trim();
  const observaciones = String(body.observaciones || body.notes || '').trim();
  const loteOrigen = String(body.lote_origen || body.lote_original || '').trim();

  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, 'Cantidad de devolucion invalida');
  if (!cliente) throw httpError(400, 'Cliente origen es obligatorio');

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const product = await findProduct(conn, body.product_id || body.sku || body.id_item);
    const bodegaId = await getDefaultBodega(conn);
    const numeroRec = await nextReceptionNumber(conn);
    const numeroDev = `DEV-${Date.now()}`;
    const lpn = body.lot_id || body.lpn || `L-DEV-${product.siigo_code}-${Date.now()}`;
    const lotId = crypto.randomUUID();
    const notes = [
      `Cliente: ${cliente}`,
      `Estado: ${estado}`,
      loteOrigen ? `Lote origen: ${loteOrigen}` : null,
      observaciones || null,
    ].filter(Boolean).join(' | ');

    const [rec] = await conn.execute(
      `INSERT INTO recepciones (numero, bodega_id, proveedor_nombre, estado, usuario_id, observaciones, completado_en)
       VALUES (?, ?, ?, 'completada', ?, ?, NOW())`,
      [numeroRec, bodegaId, cliente, user.id, `Devolucion - ${estado}${observaciones ? ` | ${observaciones}` : ''}`]
    );

    await conn.execute(
      `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
       VALUES (?, ?, ?, ?, ?)`,
      [rec.insertId, product.id, lpn, qty, qty]
    );

    await conn.execute(
      `INSERT INTO lots
         (id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier, origin, status, received_by, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DEVOLUCION', ?, ?, ?, NOW())`,
      [lotId, lpn, product.id, bodegaId, qty, qty, cliente, estado === 'RECUPERABLE' ? 'DISPONIBLE' : estado, user.id, notes]
    );

    if (estado === 'RECUPERABLE') {
      await insertStock(conn, { productId: product.id, bodegaId, lpn, qty });
    }

    await conn.execute(
      `INSERT INTO devoluciones
         (numero, producto_id, lote, cliente_origen, cantidad, estado, recepcion_id, usuario_id, observaciones, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [numeroDev, product.id, lpn, cliente, qty, estado, rec.insertId, user.id, observaciones || `Registrada desde dashboard`]
    );

    if (estado === 'RECUPERABLE') {
      await conn.execute(
        `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
         VALUES ('entrada', ?, ?, ?, ?, ?, 'devolucion_dashboard', ?)`,
        [product.id, bodegaId, lpn, qty, rec.insertId, user.id]
      ).catch(() => {});
    }

    await logKardex(conn, {
      productId: product.id,
      userId: user.id,
      lotId,
      qty,
      reference: `devolucion:${numeroDev}`,
      notes,
    });

    await conn.commit();
    return res.status(200).json({
      ok: true,
      data: {
        numero: numeroDev,
        recepcion: numeroRec,
        sku: product.siigo_code,
        producto: product.nombre,
        lote: lpn,
        cantidad: qty,
        estado,
        destino: estado === 'RECUPERABLE' ? 'Stock disponible' : `${estado} (no disponible)`,
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
    console.error('[returns]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al procesar devolucion' });
  }
};
