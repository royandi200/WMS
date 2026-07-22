// GET/POST /api/v1/reception
const crypto = require('crypto');
const { createConnection, query } = require('../_lib/db');
const { cors, requireRole } = require('../_lib/auth');
const { pushCompraToSiigo } = require('../_lib/siigo.purchases');

const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';

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
    `SELECT id, siigo_id, siigo_code, nombre
     FROM productos
     WHERE id = ? OR siigo_code = ?
     LIMIT 1`,
    [Number.isFinite(Number(term)) ? Number(term) : 0, term]
  );
  if (!rows.length) throw httpError(404, 'Producto no encontrado');
  return rows[0];
}

function canSyncSiigo(user) {
  return ['admin', 'supervisor'].includes(String(user.rol || '').toLowerCase());
}

async function validateSiigoReception(conn, { terceroId, product, price, invoiceNumber }) {
  if (!terceroId) throw httpError(400, 'tercero_id es obligatorio para sincronizar con SIIGO');
  if (!product.siigo_id) throw httpError(400, 'El producto no esta sincronizado con SIIGO');
  if (!Number.isFinite(price) || price <= 0) {
    throw httpError(400, 'precio_unitario debe ser positivo para sincronizar con SIIGO');
  }
  if (!invoiceNumber) throw httpError(400, 'proveedor_invoice_number es obligatorio');

  const [rows] = await conn.execute(
    `SELECT id, siigo_id, identification, nombre, nombre_comercial
     FROM terceros WHERE id = ? LIMIT 1`,
    [terceroId]
  );
  if (!rows.length || !rows[0].siigo_id) {
    throw httpError(400, 'El proveedor no esta sincronizado con SIIGO');
  }

  if (String(process.env.SIIGO_USERNAME || '').toLowerCase() === SHARED_SANDBOX_USERNAME) {
    const prefix = String(process.env.SIIGO_TEST_PREFIX || DEFAULT_TEST_PREFIX).toUpperCase();
    const terceroName = `${rows[0].nombre || ''} ${rows[0].nombre_comercial || ''}`.toUpperCase();
    if (!String(product.siigo_code || '').toUpperCase().startsWith(prefix) || !terceroName.includes(prefix)) {
      throw httpError(400, `En sandbox solo se permiten registros ${prefix}`);
    }
  }

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
       r.siigo_purchase_id,
       r.siigo_purchase_name,
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

function receivedItemInput(body, item, totalItems) {
  const inputs = Array.isArray(body.items) ? body.items : [];
  const match = inputs.find(input => Number(input.item_id) === Number(item.id))
    || inputs.find(input => Number(input.product_id) === Number(item.producto_id));
  if (match) return match;
  return totalItems === 1 ? body : null;
}

async function handlePut(req, res) {
  const user = await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const body = req.body || {};
  const receptionId = Number(body.reception_id || body.recepcion_id || 0);
  if (!Number.isInteger(receptionId) || receptionId <= 0) {
    throw httpError(400, 'recepcion_id es obligatorio');
  }

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const [receptions] = await conn.execute(
      `SELECT * FROM recepciones WHERE id = ? LIMIT 1 FOR UPDATE`,
      [receptionId]
    );
    if (!receptions.length) throw httpError(404, 'Recepcion no encontrada');
    const reception = receptions[0];
    if (reception.estado === 'completada') {
      await conn.commit();
      return res.status(200).json({
        ok: true,
        data: {
          recepcion_id: receptionId,
          numero: reception.numero,
          estado: reception.estado,
          already_completed: true,
        },
      });
    }
    if (!['borrador', 'en_proceso'].includes(reception.estado)) {
      throw httpError(409, `La recepcion esta ${reception.estado} y no puede completarse`);
    }

    const [items] = await conn.execute(
      `SELECT ri.*, p.siigo_code
       FROM recepcion_items ri
       JOIN productos p ON p.id = ri.producto_id
       WHERE ri.recepcion_id = ?
       ORDER BY ri.id ASC
       FOR UPDATE`,
      [receptionId]
    );
    if (!items.length) throw httpError(409, 'La recepcion no tiene items importados');

    const results = [];
    let hasDifference = false;
    for (const item of items) {
      const input = receivedItemInput(body, item, items.length);
      if (!input) throw httpError(400, `Falta confirmar el item ${item.siigo_code}`);

      const received = Number(input.qty_received ?? input.cantidad_recibida ?? input.qty_total);
      const damaged = Number(input.qty_damaged ?? input.cantidad_danada ?? 0);
      const lot = String(input.lot_id || input.lpn || input.lote || '').trim();
      const expiryDate = input.expiry_date || input.fecha_vencimiento || null;
      if (!Number.isFinite(received) || received < 0) {
        throw httpError(400, `Cantidad recibida invalida para ${item.siigo_code}`);
      }
      if (!Number.isFinite(damaged) || damaged < 0 || damaged > received) {
        throw httpError(400, `Cantidad danada invalida para ${item.siigo_code}`);
      }

      const accepted = received - damaged;
      if (accepted > 0 && !lot) throw httpError(400, `Lote requerido para ${item.siigo_code}`);
      hasDifference = hasDifference
        || received !== Number(item.cantidad_esp)
        || damaged > 0;

      await conn.execute(
        `UPDATE recepcion_items
         SET lote = ?, fecha_venc = ?, cantidad_rec = ?
         WHERE id = ?`,
        [lot || null, expiryDate, received, item.id]
      );

      if (accepted > 0) {
        const [existingLots] = await conn.execute(
          `SELECT id FROM lots WHERE lpn = ? LIMIT 1`,
          [lot]
        );
        if (existingLots.length) throw httpError(409, `El lote ${lot} ya existe`);

        const lotId = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO lots
             (id, lpn, product_id, bodega_id, qty_initial, qty_current,
              supplier, origin, status, received_by, notes, expiry_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEPCION', 'DISPONIBLE', ?, ?, ?, NOW())`,
          [lotId, lot, item.producto_id, reception.bodega_id, accepted, accepted,
           reception.proveedor_nombre || null, user.id,
           body.notes || `Recepcion desde SIIGO ${reception.siigo_purchase_name || ''}`,
           expiryDate]
        );

        await conn.execute(
          `INSERT INTO stock
             (producto_id, bodega_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
           VALUES (?, ?, ?, ?, ?, 0, NOW())`,
          [item.producto_id, reception.bodega_id, lot, expiryDate, accepted]
        );

        await conn.execute(
          `INSERT INTO movimientos
             (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id,
              referencia_tipo, usuario_id, siigo_sync)
           VALUES ('entrada', ?, ?, ?, ?, ?, 'recepcion_siigo_import', ?, 1)`,
          [item.producto_id, reception.bodega_id, lot, accepted, receptionId, user.id]
        );
      }

      results.push({
        item_id: item.id,
        sku: item.siigo_code,
        esperado: Number(item.cantidad_esp),
        recibido: received,
        danado: damaged,
        aceptado: accepted,
        lote: lot || null,
      });
    }

    const discrepancy = hasDifference
      ? `Diferencia fisica confirmada ${new Date().toISOString()}`
      : null;
    await conn.execute(
      `UPDATE recepciones
       SET estado = 'completada', completado_en = NOW(), usuario_id = ?,
           observaciones = CASE
             WHEN ? IS NULL THEN observaciones
             WHEN observaciones IS NULL OR observaciones = '' THEN ?
             ELSE CONCAT(observaciones, '\n', ?)
           END
       WHERE id = ?`,
      [user.id, discrepancy, discrepancy, discrepancy, receptionId]
    );

    await conn.commit();
    return res.status(200).json({
      ok: true,
      data: {
        recepcion_id: receptionId,
        numero: reception.numero,
        estado: 'completada',
        siigo_purchase_id: reception.siigo_purchase_id,
        diferencia: hasDifference,
        items: results,
      },
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    throw err;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function handlePost(req, res) {
  const user = await requireRole(req, ['Admin', 'Supervisor', 'Validador', 'Operario']);
  const body = req.body || {};
  const qtyTotal = Number(body.qty_total || body.cantidad || body.qty);
  const qtyDamaged = Number(body.qty_damaged || 0);
  const syncSiigo = body.sync_siigo === true;
  const price = Number(body.precio_unitario || body.unit_price || 0);
  const discount = Number(body.descuento || 0);
  const terceroId = Number(body.tercero_id || 0) || null;
  const invoiceNumber = String(body.proveedor_invoice_number || '').trim();
  if (!Number.isFinite(qtyTotal) || qtyTotal <= 0) throw httpError(400, 'Cantidad total invalida');
  if (!Number.isFinite(qtyDamaged) || qtyDamaged < 0 || qtyDamaged > qtyTotal) throw httpError(400, 'Cantidad danada invalida');
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw httpError(400, 'Descuento invalido');
  if (syncSiigo && discount !== 0) throw httpError(400, 'Las pruebas SIIGO requieren descuento 0');
  if (syncSiigo && !canSyncSiigo(user)) throw httpError(403, 'Solo Admin o Supervisor puede sincronizar con SIIGO');

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const product = await findProduct(conn, body.product_id || body.sku);
    const tercero = syncSiigo
      ? await validateSiigoReception(conn, { terceroId, product, price, invoiceNumber })
      : null;
    const bodegaId = await getDefaultBodega(conn);
    const qtyReceived = qtyTotal - qtyDamaged;
    const numero = await nextReceptionNumber(conn);
    const lpn = body.lot_id || body.lpn || `L-REC-${product.siigo_code}-${Date.now()}`;

    const [rec] = await conn.execute(
      `INSERT INTO recepciones
         (numero, tercero_id, bodega_id, proveedor_nombre, proveedor_invoice_prefix,
          proveedor_invoice_number, proveedor_invoice_date, estado, usuario_id,
          observaciones, completado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completada', ?, ?, NOW())`,
      [numero, terceroId, bodegaId,
       tercero?.nombre || body.supplier || body.proveedor || null,
       body.proveedor_invoice_prefix || null,
       invoiceNumber || null,
       body.proveedor_invoice_date || null,
       user.id, body.notes || null]
    );

    await conn.execute(
      `INSERT INTO recepcion_items
         (recepcion_id, producto_id, lote, fecha_venc, cantidad_esp, cantidad_rec,
          precio_unitario, descuento, bodega_siigo_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rec.insertId, product.id, lpn, body.expiry_date || null, qtyTotal, qtyReceived,
       price || null, discount, body.bodega_siigo_id || null]
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
      `INSERT INTO movimientos
         (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id,
          referencia_tipo, usuario_id, siigo_sync)
       VALUES ('entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [product.id, bodegaId, lpn, qtyReceived, rec.insertId,
       syncSiigo ? 'recepcion_siigo' : 'recepcion_dashboard', user.id, syncSiigo ? 0 : 1]
    );

    await conn.commit();
    await conn.end();
    conn = null;

    let siigo = null;
    let siigoError = null;
    if (syncSiigo) {
      try {
        siigo = await pushCompraToSiigo(rec.insertId);
      } catch (err) {
        siigoError = err.response?.data || err.message;
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        numero,
        recepcion_id: rec.insertId,
        sku: product.siigo_code,
        lote: lpn,
        cantidad_recibida: qtyReceived,
        siigo,
        siigo_pendiente: syncSiigo && !siigo,
        siigo_error: siigoError,
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
  cors(res, 'GET,POST,PUT');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'PUT') return await handlePut(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[reception]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
