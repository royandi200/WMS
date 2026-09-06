const crypto = require('crypto');
const { createConnection } = require('./db');
const { resolveProductReference } = require('./product-references');
const { beginAdditionalConfirmation, completeAdditionalConfirmation } = require('./additional-confirmation');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function materialAdjustmentLockName({ userId, orderId, productId, lot, locationId, type, quantity }) {
  const canonical = JSON.stringify({
    userId: Number(userId),
    orderId: Number(orderId),
    productId: Number(productId),
    lot: String(lot || '').trim().toUpperCase(),
    locationId: Number(locationId),
    type: String(type || '').trim().toUpperCase(),
    quantity: Number(Number(quantity).toFixed(4)),
  });
  return `wms_mat_${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 50)}`;
}

async function adjustProductionMaterials({
  orderId, productTerm, lot, locationId, locationCode, type, quantity, reason, userId, confirmNew = false, existingAdjustmentId,
}) {
  const adjustmentType = String(type || '').trim().toUpperCase();
  const qty = Number(quantity);
  const locationReference = locationId || locationCode || null;
  const productValue = String(productTerm || '').trim();
  const lpn = String(lot || '').trim();
  if (!orderId || !productValue || !lpn || !locationReference) throw httpError(400, 'Orden, producto, lote y ubicacion son obligatorios');
  if (!['ENTREGA_ADICIONAL', 'DEVOLUCION'].includes(adjustmentType)) throw httpError(400, 'tipo debe ser ENTREGA_ADICIONAL o DEVOLUCION');
  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, 'La cantidad debe ser positiva');

  const conn = await createConnection();
  let dedupeLock = null;
  try {
    await conn.beginTransaction();
    const confirmation = confirmNew ? await beginAdditionalConfirmation(conn, {
      kind: 'MATERIAL', userId, base: existingAdjustmentId,
      payload: { orderId: String(orderId), product: productValue, lot: lpn,
        location: String(locationReference), type: adjustmentType, quantity: qty, reason: reason || null },
    }) : null;
    if (confirmation?.result) {
      await conn.commit();
      return { ...confirmation.result, already_recorded: true, requires_confirmation: false };
    }
    const [orders] = await conn.execute(
      `SELECT * FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1 FOR UPDATE`,
      [orderId, orderId]
    );
    if (!orders.length) throw httpError(404, 'Orden no encontrada');
    const order = orders[0];
    if (order.estado !== 'EN_PROCESO') throw httpError(409, 'La orden debe estar EN_PROCESO');
    const [materials] = await conn.execute(
      `SELECT pm.*, p.siigo_code, p.nombre
         FROM produccion_materiales pm
         JOIN productos p ON p.id = pm.producto_id
        WHERE pm.orden_produccion_id = ? FOR UPDATE`,
      [order.id]
    );
    if (!materials.length) throw httpError(409, 'La orden no tiene materiales entregados');
    const product = await resolveProductReference(conn, productValue, {
      productIds: materials.map(material => material.producto_id),
    });
    const material = materials.find(item => Number(item.producto_id) === Number(product.id));
    if (!material) throw httpError(409, 'El producto no pertenece al BOM de la orden');
    const [stocks] = await conn.execute(
      `SELECT s.id, s.bodega_id, s.cantidad, s.reservada, s.ubicacion_id, u.codigo AS ubicacion_codigo
       FROM stock s
       JOIN ubicaciones u ON u.id = s.ubicacion_id
       WHERE s.producto_id = ? AND s.lote = ?
         AND (u.id = ? OR UPPER(u.codigo) = UPPER(?)) AND u.activa = 1
       LIMIT 1 FOR UPDATE`,
      [product.id, lpn, Number(locationReference) || 0, String(locationReference).trim()]
    );
    if (!stocks.length) throw httpError(404, 'No existe stock para ese lote y ubicacion');
    const stock = stocks[0];
    const location = stock.ubicacion_id;
    dedupeLock = materialAdjustmentLockName({
      userId,
      orderId: order.id,
      productId: product.id,
      lot: lpn,
      locationId: location,
      type: adjustmentType,
      quantity: qty,
    });
    const [locks] = await conn.execute('SELECT GET_LOCK(?, 5) AS acquired', [dedupeLock]);
    if (Number(locks[0]?.acquired) !== 1) {
      throw httpError(409, 'No fue posible registrar el movimiento; intenta nuevamente');
    }
    const movementType = adjustmentType === 'ENTREGA_ADICIONAL' ? 'salida' : 'entrada';
    const referenceType = adjustmentType === 'ENTREGA_ADICIONAL' ? 'consumo_produccion' : 'retorno_produccion';
    const locationColumn = adjustmentType === 'ENTREGA_ADICIONAL' ? 'ubicacion_orig' : 'ubicacion_dest';
    const [recent] = await conn.execute(
      `SELECT id FROM movimientos
        WHERE referencia_id = ? AND referencia_tipo = ? AND producto_id = ?
          AND lote = ? AND ${locationColumn} = ? AND usuario_id = ?
          AND tipo = ? AND ABS(cantidad - ?) < 0.000001
          AND creado_en >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY creado_en DESC, id DESC LIMIT 1 FOR UPDATE`,
      [order.id, referenceType, product.id, lpn, location, userId, movementType, qty]
    );
    if (recent.length && !confirmNew) {
      await conn.commit();
      return {
        movement_id: recent[0].id,
        order_code: order.codigo_orden,
        tipo: adjustmentType,
        sku: product.siigo_code,
        producto: product.nombre,
        unidad: material.unidad,
        lote: lpn,
        ubicacion_id: location,
        ubicacion: stock.ubicacion_codigo,
        cantidad: qty,
        already_recorded: true,
        requires_confirmation: true,
      };
    }

    if (adjustmentType === 'ENTREGA_ADICIONAL') {
      const [updated] = await conn.execute(
        `UPDATE stock SET cantidad = cantidad - ?, actualizado_en = NOW()
         WHERE id = ? AND (cantidad - reservada) >= ?`,
        [qty, stock.id, qty]
      );
      if (updated.affectedRows !== 1) throw httpError(409, 'Stock disponible insuficiente');
      const [lotUpdated] = await conn.execute(
        `UPDATE lots SET qty_current = qty_current - ?, updated_at = NOW()
         WHERE lpn = ? AND qty_current >= ?`,
        [qty, lpn, qty]
      );
      if (lotUpdated.affectedRows !== 1) throw httpError(409, 'Saldo de lote insuficiente');
      await conn.execute(`UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', 'DISPONIBLE') WHERE lpn = ?`, [lpn]);
      await conn.execute(
        `INSERT INTO produccion_material_lotes
           (produccion_material_id, stock_id, lote, ubicacion_id, cantidad_reservada,
            cantidad_alistada, cantidad_consumida, es_adicional, confirmado_por,
            confirmado_en, creado_en)
         VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, NOW(), NOW())`,
        [material.id, stock.id, lpn, location, qty, qty, userId]
      );
      await conn.execute(
        `UPDATE produccion_materiales
         SET cantidad_alistada = cantidad_alistada + ?, cantidad_consumida = cantidad_consumida + ?,
             cantidad_adicional = cantidad_adicional + ?, actualizado_en = NOW() WHERE id = ?`,
        [qty, qty, qty, material.id]
      );
    } else {
      const [used] = await conn.execute(
        `SELECT id FROM produccion_material_lotes
         WHERE produccion_material_id = ? AND lote = ? AND ubicacion_id = ?
           AND (cantidad_consumida - cantidad_devuelta) >= ?
         ORDER BY es_adicional DESC, id DESC LIMIT 1 FOR UPDATE`,
        [material.id, lpn, location, qty]
      );
      if (!used.length) throw httpError(409, 'La devolucion supera lo consumido desde ese lote y ubicacion');
      await conn.execute(`UPDATE stock SET cantidad = cantidad + ?, actualizado_en = NOW() WHERE id = ?`, [qty, stock.id]);
      await conn.execute(`UPDATE lots SET qty_current = qty_current + ?, status = 'DISPONIBLE', updated_at = NOW() WHERE lpn = ?`, [qty, lpn]);
      await conn.execute(`UPDATE produccion_material_lotes SET cantidad_devuelta = cantidad_devuelta + ? WHERE id = ?`, [qty, used[0].id]);
      await conn.execute(`UPDATE produccion_materiales SET cantidad_devuelta = cantidad_devuelta + ?, actualizado_en = NOW() WHERE id = ?`, [qty, material.id]);
    }

    const [movement] = await conn.execute(
      `INSERT INTO movimientos
         (tipo, producto_id, bodega_orig, bodega_dest, ubicacion_orig, ubicacion_dest,
          lote, cantidad, referencia_id, referencia_tipo, usuario_id, siigo_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [movementType, product.id,
       adjustmentType === 'ENTREGA_ADICIONAL' ? stock.bodega_id : null,
       adjustmentType === 'DEVOLUCION' ? stock.bodega_id : null,
       adjustmentType === 'ENTREGA_ADICIONAL' ? location : null,
       adjustmentType === 'DEVOLUCION' ? location : null,
       lpn, qty, order.id, referenceType, userId]
    );
    const [lots] = await conn.execute(`SELECT id, qty_current FROM lots WHERE lpn = ? LIMIT 1`, [lpn]);
    await conn.execute(
      `INSERT INTO kardex
         (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
          reference, notes, approved_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), crypto.randomUUID(), lots[0]?.id || null, product.id,
       userId, adjustmentType === 'ENTREGA_ADICIONAL' ? 'CONSUMO_MATERIAL' : 'AJUSTE_RETORNO',
       adjustmentType === 'ENTREGA_ADICIONAL' ? -qty : qty,
       Number(lots[0]?.qty_current || 0), `produccion:${order.codigo_orden}`,
       reason || adjustmentType, userId]
    );
    const result = {
      movement_id: movement.insertId,
      order_code: order.codigo_orden,
      tipo: adjustmentType,
      sku: product.siigo_code,
      producto: product.nombre,
      unidad: material.unidad,
      lote: lpn,
      ubicacion_id: location,
      ubicacion: stock.ubicacion_codigo,
      cantidad: qty,
      already_recorded: false,
    };
    await completeAdditionalConfirmation(conn, confirmation, result);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (dedupeLock) {
      await conn.execute('SELECT RELEASE_LOCK(?) AS released', [dedupeLock]).catch(() => {});
    }
    await conn.end().catch(() => {});
  }
}

module.exports = { adjustProductionMaterials, materialAdjustmentLockName };
