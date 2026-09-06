const crypto = require('crypto');
const { createConnection } = require('./db');
const { resolveProductReference } = require('./product-references');
const { beginAdditionalConfirmation, completeAdditionalConfirmation } = require('./additional-confirmation');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeWasteInput(input = {}, { allowGeneratedReference = false } = {}) {
  const quantity = Number(input.cantidad ?? input.qty);
  const order = String(input.id_orden ?? input.production_order_id ?? '').trim();
  const lot = String(input.id_lote ?? input.lot_id ?? input.lote ?? '').trim();
  const data = {
    externalReference: String(
      input.external_reference ?? input.referencia_merma ?? input.referencia_externa
        ?? input.reference ?? input.referencia ?? ''
    ).trim(),
    sku: String(input.id_item ?? input.sku ?? input.product_id ?? '').trim(),
    quantity,
    reason: String(input.motivo ?? input.reason ?? '').trim(),
    order,
    lot,
    location: String(input.ubicacion ?? input.location ?? input.location_code ?? '').trim(),
    requestedType: String(input.tipo ?? input.type ?? '').trim().toUpperCase(),
    confirmNew: input.confirmar_nueva_merma === true || input.confirm_new_waste === true,
  };

  if (!data.externalReference && !allowGeneratedReference) {
    throw httpError(400, 'Referencia de merma es obligatoria');
  }
  if (!data.sku) throw httpError(400, 'Producto de la merma es obligatorio');
  if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, 'Cantidad de merma invalida');
  if (quantity > 999999999) throw httpError(400, 'Cantidad de merma fuera de rango');
  if (!data.reason) throw httpError(400, 'Motivo de la merma es obligatorio');
  if (Boolean(order) === Boolean(lot)) {
    throw httpError(400, 'Debes indicar exactamente uno: orden de produccion o lote');
  }
  if (lot && !data.location) throw httpError(400, 'Ubicacion del lote es obligatoria');

  for (const [label, value, max] of [
    ['Referencia de merma', data.externalReference, 80],
    ['Producto', data.sku, 80],
    ['Orden', data.order, 80],
    ['Lote', data.lot, 80],
    ['Ubicacion', data.location, 30],
    ['Motivo', data.reason, 255],
  ]) {
    if (value.length > max) throw httpError(400, `${label} supera ${max} caracteres`);
  }
  return data;
}

function bogotaDateStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

function generateWasteReference(date = new Date()) {
  return `AUTO-MER-${bogotaDateStamp(date)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function buildWasteDedupeKey({ userId, productId, orderId, lot, locationId, quantity, reason }) {
  const canonical = JSON.stringify({
    userId: Number(userId),
    productId: Number(productId),
    orderId: orderId == null ? null : Number(orderId),
    lot: lot || null,
    locationId: locationId == null ? null : Number(locationId),
    quantity: Number(quantity),
    reason: String(reason || '').trim().toLowerCase(),
  });
  return `wms_waste_${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 48)}`;
}

function parseWasteReferences(text) {
  const source = String(text || '');
  const reference = source.match(/\breferencia(?:\s+de\s+merma)?\s+([A-Z0-9._-]+)/i)?.[1];
  const order = source.match(/\b(OP-[A-Z0-9-]+)\b/i)?.[1];
  const lot = source.match(/\blote\s+([A-Z0-9._-]+)/i)?.[1];
  const location = source.match(/\b(?:ubicacion|ubicaci[oó]n)\s+([A-Z0-9._-]+)/i)?.[1];
  return {
    ...(reference ? { referencia_merma: reference } : {}),
    ...(order ? { id_orden: order } : {}),
    ...(lot ? { id_lote: lot } : {}),
    ...(location ? { ubicacion: location } : {}),
  };
}

async function findExisting(conn, externalReference) {
  const [rows] = await conn.execute(
    `SELECT m.id, m.numero, m.tipo, m.producto_id, m.orden_produccion_id,
            m.cantidad, m.motivo, m.lote,
            m.referencia_externa, p.siigo_code AS sku,
            op.codigo_orden, u.codigo AS ubicacion
     FROM mermas m
     JOIN productos p ON p.id = m.producto_id
     LEFT JOIN ordenes_produccion op ON op.id = m.orden_produccion_id
     LEFT JOIN ubicaciones u ON u.id = m.ubicacion_id
     WHERE m.referencia_externa = ? LIMIT 1 FOR UPDATE`,
    [externalReference]
  );
  return rows[0] || null;
}

async function findRecentGenerated(conn, data, userId, productId, orderId, locationId) {
  const [rows] = await conn.execute(
    `SELECT m.id, m.numero, m.tipo, m.producto_id, m.orden_produccion_id,
            m.cantidad, m.motivo, m.lote,
            m.referencia_externa, p.siigo_code AS sku,
            op.codigo_orden, u.codigo AS ubicacion
     FROM mermas m
     JOIN productos p ON p.id = m.producto_id
     LEFT JOIN ordenes_produccion op ON op.id = m.orden_produccion_id
     LEFT JOIN ubicaciones u ON u.id = m.ubicacion_id
     WHERE m.referencia_externa LIKE 'AUTO-MER-%'
       AND m.usuario_id = ?
       AND m.producto_id = ?
       AND m.orden_produccion_id <=> ?
       AND m.lote <=> ?
       AND m.ubicacion_id <=> ?
       AND ABS(m.cantidad - ?) < 0.000001
       AND m.motivo = ?
       AND m.creado_en >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY m.creado_en DESC, m.id DESC
     LIMIT 1 FOR UPDATE`,
    [userId, productId, orderId, data.lot || null, locationId,
     data.quantity, data.reason]
  );
  return rows[0] || null;
}

async function reportWaste(input, userId, { allowGeneratedReference = false } = {}) {
  const data = normalizeWasteInput(input, { allowGeneratedReference });
  const conn = await createConnection();
  let dedupeLock = null;
  try {
    await conn.beginTransaction();
    const confirmation = data.confirmNew ? await beginAdditionalConfirmation(conn, {
      kind: 'MERMA', userId, base: input.id_merma_existente,
      payload: data,
    }) : null;
    if (confirmation?.result) {
      await conn.commit();
      return { ...confirmation.result, already_completed: true, requires_confirmation: false };
    }
    let order = null;
    let lotRow = null;
    let stockRow = null;
    let productIds = [];

    if (data.order) {
      const numericOrderId = /^\d+$/.test(data.order) ? Number(data.order) : 0;
      const [rows] = await conn.execute(
        `SELECT id, codigo_orden, estado, producto_id
         FROM ordenes_produccion
         WHERE id = ? OR codigo_orden = ? LIMIT 2 FOR UPDATE`,
        [numericOrderId, data.order]
      );
      if (!rows.length) throw httpError(404, `Orden ${data.order} no encontrada`);
      if (rows.length > 1) throw httpError(409, 'La referencia identifica mas de una orden');
      order = rows[0];
      const [materials] = await conn.execute(
        `SELECT producto_id FROM produccion_materiales
         WHERE orden_produccion_id = ?`,
        [order.id]
      );
      productIds = [order.producto_id, ...materials.map(material => material.producto_id)];
    }

    const product = await resolveProductReference(conn, data.sku, data.order ? {
      productIds,
      allowContextualPartial: true,
    } : {});
    const existing = data.externalReference
      ? await findExisting(conn, data.externalReference)
      : null;
    if (existing) {
      const sameProduct = Number(existing.producto_id) === Number(product.id);
      const sameContext = data.order
        ? (String(existing.codigo_orden || '') === data.order
          || String(existing.orden_produccion_id || '') === data.order) && !existing.lote
        : String(existing.lote || '') === data.lot
          && String(existing.ubicacion || '') === data.location
          && !existing.codigo_orden;
      const samePayload = sameProduct
        && sameContext
        && Math.abs(Number(existing.cantidad) - data.quantity) < 0.000001
        && String(existing.motivo || '') === data.reason;
      if (!samePayload) {
        throw httpError(409, 'La referencia de merma ya fue utilizada con datos diferentes');
      }
      const result = { ...existing, already_completed: true };
      await completeAdditionalConfirmation(conn, confirmation, result);
      await conn.commit();
      return result;
    }

    if (data.order) {
      if (order.estado !== 'EN_PROCESO') {
        throw httpError(409, `La orden ${order.codigo_orden} esta en estado ${order.estado}; debe estar EN_PROCESO`);
      }
    } else {
      const [lots] = await conn.execute(
        `SELECT id, lpn, product_id, bodega_id, qty_current, status
         FROM lots WHERE lpn = ? LIMIT 2 FOR UPDATE`,
        [data.lot]
      );
      if (!lots.length) throw httpError(404, `Lote ${data.lot} no encontrado`);
      if (lots.length > 1) throw httpError(409, 'El codigo identifica mas de un lote');
      lotRow = lots[0];
      if (Number(lotRow.product_id) !== Number(product.id)) {
        throw httpError(409, 'El lote no pertenece al producto indicado');
      }
      if (lotRow.status !== 'DISPONIBLE') {
        throw httpError(409, `El lote esta en estado ${lotRow.status} y no admite merma de stock disponible`);
      }

      const [stocks] = await conn.execute(
        `SELECT s.id, s.bodega_id, s.ubicacion_id, s.cantidad, s.reservada, u.codigo
         FROM stock s
         JOIN ubicaciones u ON u.id = s.ubicacion_id
         WHERE s.producto_id = ? AND s.lote = ? AND s.bodega_id = ?
           AND u.codigo = ? AND u.activa = 1
         LIMIT 2 FOR UPDATE`,
        [product.id, data.lot, lotRow.bodega_id, data.location]
      );
      if (!stocks.length) throw httpError(409, 'Lote y ubicacion no coinciden en el inventario disponible');
      if (stocks.length > 1) throw httpError(409, 'Hay mas de un saldo para el lote y ubicacion; requiere conciliacion');
      stockRow = stocks[0];
    }

    if (!data.externalReference) {
      dedupeLock = buildWasteDedupeKey({
        userId,
        productId: product.id,
        orderId: order?.id,
        lot: data.lot,
        locationId: stockRow?.ubicacion_id,
        quantity: data.quantity,
        reason: data.reason,
      });
      const [lockRows] = await conn.execute('SELECT GET_LOCK(?, 5) AS acquired', [dedupeLock]);
      if (Number(lockRows[0]?.acquired) !== 1) {
        throw httpError(409, 'No fue posible confirmar la merma; intenta nuevamente');
      }

      const recent = await findRecentGenerated(
        conn,
        data,
        userId,
        product.id,
        order?.id || null,
        stockRow?.ubicacion_id || null
      );
      if (recent && !data.confirmNew) {
        await conn.commit();
        return {
          ...recent,
          already_completed: true,
          requires_confirmation: true,
          generated_reference: true,
        };
      }
      data.externalReference = generateWasteReference();
    }

    if (stockRow) {
      const available = Number(stockRow.cantidad) - Number(stockRow.reservada);
      if (data.quantity > available + 0.000001) {
        throw httpError(409, `Stock disponible insuficiente: ${available}`);
      }
      if (data.quantity > Number(lotRow.qty_current) + 0.000001) {
        throw httpError(409, `Saldo de lote insuficiente: ${lotRow.qty_current}`);
      }
    }

    const number = `MER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const type = order ? 'PROCESO' : 'BODEGA';
    const [inserted] = await conn.execute(
      `INSERT INTO mermas
         (numero, tipo, producto_id, lote, orden_produccion_id, ubicacion_id,
          referencia_externa, cantidad, motivo, usuario_id, aprobado_por, estado, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APROBADO', NOW())`,
      [number, type, product.id, data.lot || null, order?.id || null,
       stockRow?.ubicacion_id || null, data.externalReference, data.quantity,
       data.reason, userId, userId]
    );

    let balance = null;
    let lotBalance = null;
    if (stockRow) {
      const [stockUpdate] = await conn.execute(
        `UPDATE stock SET cantidad = cantidad - ?, actualizado_en = NOW()
         WHERE id = ? AND cantidad - reservada >= ?`,
        [data.quantity, stockRow.id, data.quantity]
      );
      if (stockUpdate.affectedRows !== 1) throw httpError(409, 'El saldo disponible cambio; vuelve a consultar');

      const [lotUpdate] = await conn.execute(
        `UPDATE lots
         SET qty_current = qty_current - ?,
             status = IF(qty_current - ? <= 0, 'AGOTADO', 'DISPONIBLE')
         WHERE id = ? AND qty_current >= ?`,
        [data.quantity, data.quantity, lotRow.id, data.quantity]
      );
      if (lotUpdate.affectedRows !== 1) throw httpError(409, 'El saldo del lote cambio; vuelve a consultar');
      lotBalance = Number((Number(lotRow.qty_current) - data.quantity).toFixed(4));

      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_orig, ubicacion_orig, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id, creado_en)
         VALUES ('ajuste', ?, ?, ?, ?, ?, ?, 'merma_bodega', ?, NOW())`,
        [product.id, stockRow.bodega_id, stockRow.ubicacion_id, data.lot,
         -data.quantity, inserted.insertId, userId]
      );
      const [balances] = await conn.execute(
        `SELECT COALESCE(SUM(cantidad - reservada), 0) AS balance
         FROM stock WHERE producto_id = ? AND bodega_id = ?`,
        [product.id, stockRow.bodega_id]
      );
      balance = Number(balances[0]?.balance || 0);
    }

    await conn.execute(
      `INSERT INTO kardex
         (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
          reference, notes, approved_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), crypto.randomUUID(), lotRow?.id || null, product.id,
       userId, order ? 'MERMA_PROCESO' : 'MERMA_BODEGA',
       -data.quantity, lotBalance,
       `merma:${number}`,
       `${data.reason}${order ? ` | Orden: ${order.codigo_orden}` : ` | Lote: ${data.lot} | Ubicacion: ${data.location}`}`,
       userId]
    );

    const result = {
      id: inserted.insertId,
      numero: number,
      referencia_externa: data.externalReference,
      tipo: type,
      sku: product.siigo_code,
      producto: product.nombre,
      cantidad: data.quantity,
      motivo: data.reason,
      lote: data.lot || null,
      codigo_orden: order?.codigo_orden || null,
      ubicacion: stockRow?.codigo || null,
      balance_disponible: balance,
      saldo_lote: lotBalance,
      already_completed: false,
      generated_reference: allowGeneratedReference && !String(
        input.external_reference ?? input.referencia_merma ?? input.referencia_externa
          ?? input.reference ?? input.referencia ?? ''
      ).trim(),
    };
    await completeAdditionalConfirmation(conn, confirmation, result);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      throw httpError(409, 'La referencia de merma ya fue utilizada');
    }
    throw error;
  } finally {
    if (dedupeLock) {
      await conn.execute('SELECT RELEASE_LOCK(?) AS released', [dedupeLock]).catch(() => {});
    }
    await conn.end().catch(() => {});
  }
}

module.exports = {
  normalizeWasteInput,
  parseWasteReferences,
  reportWaste,
  buildWasteDedupeKey,
  generateWasteReference,
};
