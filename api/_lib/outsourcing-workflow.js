const crypto = require('crypto');
const { createConnection } = require('./db');
const { resolvePrimaryWarehouse } = require('./warehouses');
const { PRODUCT_MODES } = require('./product-modes');
const { resolveProductReference } = require('./product-references');
const { addPreferredLocations } = require('./product-locations');
const {
  normalizeOutsourcingOrderInput,
  normalizeAdditionalShipmentInput,
  outsourcingStateForReceipt,
  roundQty,
} = require('./outsourcing-domain');

function httpError(status, message, data) {
  const error = new Error(message);
  error.status = status;
  error.data = data;
  return error;
}

function codeForId(prefix, id) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${String(id).padStart(6, '0')}`;
}

async function allocateFefo(conn, { productId, warehouseId, quantity }) {
  let remaining = roundQty(quantity);
  const [rows] = await conn.execute(
    `SELECT s.id, s.producto_id, s.bodega_id, s.ubicacion_id, s.lote,
            COALESCE(l.expiry_date, s.fecha_venc) AS fecha_venc,
            (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
            u.codigo AS ubicacion
       FROM stock s
       JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
       JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
      WHERE s.producto_id = ? AND s.bodega_id = ?
        AND l.status = 'DISPONIBLE'
        AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
        AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
             OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
      ORDER BY CASE WHEN COALESCE(l.expiry_date, s.fecha_venc) IS NULL THEN 1 ELSE 0 END,
               COALESCE(l.expiry_date, s.fecha_venc), l.created_at, s.id
      FOR UPDATE`,
    [productId, warehouseId]
  );
  const allocations = [];
  for (const stock of rows) {
    if (remaining <= 0.0001) break;
    const quantityTaken = roundQty(Math.min(Number(stock.disponible), remaining));
    allocations.push({ ...stock, quantity: quantityTaken });
    remaining = roundQty(remaining - quantityTaken);
  }
  if (remaining > 0.0001) throw httpError(409, 'Stock insuficiente para preparar el envio a 3Q', { faltante: remaining });
  return allocations;
}

async function insertShipment(conn, { orderId, type, reason, userId, idempotencyKey = crypto.randomUUID() }) {
  const temporary = `TMP-3Q-${crypto.randomBytes(8).toString('hex')}`;
  const [created] = await conn.execute(
    `INSERT INTO maquila_envios
       (numero, orden_maquila_id, tipo, estado, motivo, clave_idempotencia,
        creado_por, creado_en)
     VALUES (?, ?, ?, 'BORRADOR', ?, ?, ?, NOW())`,
    [temporary, orderId, type, reason || null, idempotencyKey, userId]
  );
  const number = codeForId('REM-3Q', created.insertId);
  await conn.execute(`UPDATE maquila_envios SET numero = ? WHERE id = ?`, [number, created.insertId]);
  return { id: created.insertId, number };
}

async function createOutsourcingOrder({ body, userId }) {
  const input = normalizeOutsourcingOrderInput(body);
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.execute(
      `SELECT oc.*,
              EXISTS(SELECT 1 FROM orden_compra_documentos d
                      WHERE d.orden_compra_id = oc.id AND d.activo = 1) AS tiene_pdf
         FROM ordenes_compra_proveedor oc
        WHERE oc.id = ? LIMIT 1 FOR UPDATE`,
      [input.purchaseOrderId]
    );
    if (!orders.length) throw httpError(404, 'Orden de compra no encontrada');
    const purchaseOrder = orders[0];
    if (['CANCELADA', 'CERRADA'].includes(purchaseOrder.estado)) {
      throw httpError(409, `La orden de compra esta ${purchaseOrder.estado}`);
    }
    if (!purchaseOrder.tiene_pdf) throw httpError(409, 'La orden de compra no tiene PDF de soporte');
    if (!purchaseOrder.tercero_id) {
      throw httpError(409, 'La orden de compra no tiene un proveedor sincronizado');
    }

    const finalProduct = await resolveProductReference(conn, input.product, { modes: [PRODUCT_MODES.OUTSOURCED] });
    if (finalProduct.modalidad_operativa !== PRODUCT_MODES.OUTSOURCED) {
      throw httpError(409, `${finalProduct.siigo_code} no es un producto de maquila tercerizada`);
    }
    const [orderedItems] = await conn.execute(
      `SELECT COALESCE(SUM(cantidad_ordenada), 0) AS cantidad
         FROM orden_compra_proveedor_items
        WHERE orden_compra_id = ? AND producto_id = ?`,
      [purchaseOrder.id, finalProduct.id]
    );
    const orderedQuantity = Number(orderedItems[0]?.cantidad || 0);
    if (orderedQuantity <= 0) throw httpError(409, 'El producto no esta incluido en la orden de compra');
    const [alreadyPlannedRows] = await conn.execute(
      `SELECT COALESCE(SUM(cantidad_objetivo), 0) AS cantidad
         FROM ordenes_maquila
        WHERE orden_compra_id = ? AND producto_id = ? AND estado <> 'CANCELADA'
        FOR UPDATE`,
      [purchaseOrder.id, finalProduct.id]
    );
    const alreadyPlanned = Number(alreadyPlannedRows[0]?.cantidad || 0);
    const [existingOutsourcing] = await conn.execute(
      `SELECT id, codigo, cantidad_objetivo, estado
         FROM ordenes_maquila
        WHERE orden_compra_id = ? AND producto_id = ? AND estado <> 'CANCELADA'
        LIMIT 1`,
      [purchaseOrder.id, finalProduct.id]
    );
    if (existingOutsourcing.length) {
      throw httpError(409, `Ya existe la orden ${existingOutsourcing[0].codigo} para este producto y OC`);
    }
    if (alreadyPlanned + input.quantity > orderedQuantity + 0.0001) {
      throw httpError(409, 'La cantidad de maquila supera lo ordenado en la OC', {
        cantidad_oc: orderedQuantity,
        ya_programada: alreadyPlanned,
        solicitada: input.quantity,
      });
    }

    const [bom] = await conn.execute(
      `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
              p.siigo_code AS sku, p.nombre
         FROM bom b
         JOIN productos p ON p.id = b.insumo_id
        WHERE b.producto_final_id = ? AND b.etapa = 'ENVIO'
        ORDER BY b.id`,
      [finalProduct.id]
    );
    if (!bom.length) throw httpError(422, `No existe BOM de envio para ${finalProduct.siigo_code}`);

    const warehouseId = await resolvePrimaryWarehouse(conn);
    const plan = [];
    for (const component of bom) {
      const required = roundQty(Number(component.cantidad_por_unidad) * input.quantity);
      const allocations = await allocateFefo(conn, { productId: component.insumo_id, warehouseId, quantity: required });
      plan.push({ component, required, allocations });
    }

    const temporary = `TMP-MQ-${crypto.randomBytes(8).toString('hex')}`;
    const [created] = await conn.execute(
      `INSERT INTO ordenes_maquila
         (codigo, orden_compra_id, tercero_id, proveedor_nombre, producto_id,
          cantidad_objetivo, estado, notas, creado_por, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'MATERIALES_RESERVADOS', ?, ?, NOW(), NOW())`,
      [temporary, purchaseOrder.id, purchaseOrder.tercero_id,
       purchaseOrder.proveedor_nombre || '3Q', finalProduct.id, input.quantity,
       input.notes, userId]
    );
    const orderCode = codeForId('MQ-3Q', created.insertId);
    await conn.execute(`UPDATE ordenes_maquila SET codigo = ? WHERE id = ?`, [orderCode, created.insertId]);
    const shipment = await insertShipment(conn, { orderId: created.insertId, type: 'INICIAL', userId });

    const picking = [];
    for (const item of plan) {
      const [material] = await conn.execute(
        `INSERT INTO maquila_materiales
           (orden_maquila_id, producto_id, cantidad_teorica, cantidad_reservada,
            unidad, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [created.insertId, item.component.insumo_id, item.required, item.required, item.component.unidad]
      );
      for (const allocation of item.allocations) {
        const [reserved] = await conn.execute(
          `UPDATE stock SET reservada = reservada + ?, actualizado_en = NOW()
            WHERE id = ? AND (cantidad - reservada) >= ?`,
          [allocation.quantity, allocation.id, allocation.quantity]
        );
        if (reserved.affectedRows !== 1) throw httpError(409, 'El inventario cambio durante la reserva');
        const [lot] = await conn.execute(
          `INSERT INTO maquila_material_lotes
             (maquila_material_id, stock_id, bodega_origen_id, ubicacion_origen_id,
              lote, cantidad_reservada, es_adicional, estado, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'RESERVADO', NOW(), NOW())`,
          [material.insertId, allocation.id, allocation.bodega_id,
           allocation.ubicacion_id, allocation.lote, allocation.quantity]
        );
        await conn.execute(
          `INSERT INTO maquila_envio_items
             (maquila_envio_id, maquila_material_lote_id, cantidad, creado_en)
           VALUES (?, ?, ?, NOW())`,
          [shipment.id, lot.insertId, allocation.quantity]
        );
        picking.push({
          sku: item.component.sku,
          producto: item.component.nombre,
          cantidad: allocation.quantity,
          unidad: item.component.unidad,
          lote: allocation.lote,
          ubicacion: allocation.ubicacion,
          vence: allocation.fecha_venc,
        });
      }
    }
    await conn.commit();
    return {
      order_id: created.insertId,
      order_code: orderCode,
      shipment_id: shipment.id,
      shipment_number: shipment.number,
      status: 'MATERIALES_RESERVADOS',
      product: finalProduct,
      quantity: input.quantity,
      picking,
    };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function prepareAdditionalShipment({ body, userId }) {
  const input = normalizeAdditionalShipmentInput(body);
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.execute(
      `SELECT * FROM ordenes_maquila WHERE id = ? OR codigo = ? LIMIT 1 FOR UPDATE`,
      [Number(input.orderId) || 0, input.orderId]
    );
    if (!orders.length) throw httpError(404, 'Orden de maquila no encontrada');
    const order = orders[0];
    if (!['EN_3Q', 'RECIBIDA_PARCIAL'].includes(order.estado)) {
      throw httpError(409, `La orden esta ${order.estado} y no admite material adicional`);
    }
    const product = await resolveProductReference(conn, input.product);
    const [replays] = await conn.execute(
      `SELECT id, numero, estado, orden_maquila_id
         FROM maquila_envios WHERE clave_idempotencia = ? LIMIT 1`,
      [input.idempotencyKey]
    );
    if (replays.length) {
      if (Number(replays[0].orden_maquila_id) !== Number(order.id)) {
        throw httpError(409, 'La clave de idempotencia ya fue utilizada');
      }
      await conn.commit();
      return {
        order_code: order.codigo,
        shipment_id: replays[0].id,
        shipment_number: replays[0].numero,
        state: replays[0].estado,
        already_prepared: true,
      };
    }
    const [materials] = await conn.execute(
      `SELECT * FROM maquila_materiales
        WHERE orden_maquila_id = ? AND producto_id = ? LIMIT 1 FOR UPDATE`,
      [order.id, product.id]
    );
    if (!materials.length) throw httpError(409, 'El material no pertenece al BOM de envio de la orden');
    const warehouseId = await resolvePrimaryWarehouse(conn);
    const allocations = await allocateFefo(conn, { productId: product.id, warehouseId, quantity: input.quantity });
    const shipment = await insertShipment(conn, {
      orderId: order.id,
      type: 'ADICIONAL',
      reason: input.reason,
      userId,
      idempotencyKey: input.idempotencyKey,
    });
    for (const allocation of allocations) {
      const [reserved] = await conn.execute(
        `UPDATE stock SET reservada = reservada + ?, actualizado_en = NOW()
          WHERE id = ? AND (cantidad - reservada) >= ?`,
        [allocation.quantity, allocation.id, allocation.quantity]
      );
      if (reserved.affectedRows !== 1) throw httpError(409, 'El inventario cambio durante la reserva');
      const [lot] = await conn.execute(
        `INSERT INTO maquila_material_lotes
           (maquila_material_id, stock_id, bodega_origen_id, ubicacion_origen_id,
            lote, cantidad_reservada, es_adicional, estado, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'RESERVADO', NOW(), NOW())`,
        [materials[0].id, allocation.id, allocation.bodega_id,
         allocation.ubicacion_id, allocation.lote, allocation.quantity]
      );
      await conn.execute(
        `INSERT INTO maquila_envio_items
           (maquila_envio_id, maquila_material_lote_id, cantidad, creado_en)
         VALUES (?, ?, ?, NOW())`,
        [shipment.id, lot.insertId, allocation.quantity]
      );
    }
    await conn.execute(
      `UPDATE maquila_materiales
          SET cantidad_reservada = cantidad_reservada + ?, actualizado_en = NOW()
        WHERE id = ?`,
      [input.quantity, materials[0].id]
    );
    await conn.commit();
    return {
      order_code: order.codigo,
      shipment_id: shipment.id,
      shipment_number: shipment.number,
      sku: product.siigo_code,
      quantity: input.quantity,
      reason: input.reason,
      picking: allocations.map(item => ({
        sku: product.siigo_code,
        cantidad: item.quantity,
        lote: item.lote,
        ubicacion: item.ubicacion,
      })),
    };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function cancelOutsourcingShipment({ shipmentId, userId }) {
  const shipmentReference = String(shipmentId || '').trim();
  if (!shipmentReference) throw httpError(400, 'envio_id es obligatorio');
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [shipments] = await conn.execute(
      `SELECT me.*, om.codigo AS orden_codigo
         FROM maquila_envios me
         JOIN ordenes_maquila om ON om.id = me.orden_maquila_id
        WHERE me.id = ? OR me.numero = ? LIMIT 1 FOR UPDATE`,
      [Number(shipmentReference) || 0, shipmentReference]
    );
    if (!shipments.length) throw httpError(404, 'Remision 3Q no encontrada');
    const shipment = shipments[0];
    if (shipment.estado === 'CANCELADO') {
      await conn.commit();
      return { shipment_number: shipment.numero, already_cancelled: true };
    }
    if (shipment.estado !== 'BORRADOR') throw httpError(409, 'Una remision confirmada no se puede cancelar');
    const [items] = await conn.execute(
      `SELECT mei.cantidad, mml.id AS material_lote_id, mml.stock_id,
              mml.maquila_material_id
         FROM maquila_envio_items mei
         JOIN maquila_material_lotes mml ON mml.id = mei.maquila_material_lote_id
        WHERE mei.maquila_envio_id = ? FOR UPDATE`,
      [shipment.id]
    );
    for (const item of items) {
      const quantity = Number(item.cantidad);
      const [released] = await conn.execute(
        `UPDATE stock SET reservada = reservada - ?, actualizado_en = NOW()
          WHERE id = ? AND reservada >= ?`,
        [quantity, item.stock_id, quantity]
      );
      if (released.affectedRows !== 1) throw httpError(409, 'No fue posible liberar una reserva de la remision');
      await conn.execute(
        `UPDATE maquila_material_lotes SET estado = 'CANCELADO', actualizado_en = NOW() WHERE id = ?`,
        [item.material_lote_id]
      );
      const [materialReleased] = await conn.execute(
        `UPDATE maquila_materiales
            SET cantidad_reservada = cantidad_reservada - ?, actualizado_en = NOW()
          WHERE id = ? AND cantidad_reservada >= ?`,
        [quantity, item.maquila_material_id, quantity]
      );
      if (materialReleased.affectedRows !== 1) throw httpError(409, 'La reserva agregada de material es inconsistente');
    }
    await conn.execute(
      `UPDATE maquila_envios SET estado = 'CANCELADO', cancelado_por = ?, cancelado_en = NOW() WHERE id = ?`,
      [userId, shipment.id]
    );
    if (shipment.tipo === 'INICIAL') {
      await conn.execute(
        `UPDATE ordenes_maquila SET estado = 'CANCELADA', actualizado_en = NOW() WHERE id = ?`,
        [shipment.orden_maquila_id]
      );
    }
    await conn.commit();
    return { shipment_number: shipment.numero, order_code: shipment.orden_codigo, state: 'CANCELADO' };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function confirmOutsourcingShipment({ shipmentId, userId }) {
  const shipmentReference = String(shipmentId || '').trim();
  if (!shipmentReference) throw httpError(400, 'envio_id es obligatorio');
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [shipments] = await conn.execute(
      `SELECT me.*, om.codigo AS orden_codigo, om.estado AS orden_estado
         FROM maquila_envios me
         JOIN ordenes_maquila om ON om.id = me.orden_maquila_id
        WHERE me.id = ? OR me.numero = ? LIMIT 1 FOR UPDATE`,
      [Number(shipmentReference) || 0, shipmentReference]
    );
    if (!shipments.length) throw httpError(404, 'Remision 3Q no encontrada');
    const shipment = shipments[0];
    if (shipment.estado === 'CONFIRMADO') {
      await conn.commit();
      return { shipment_number: shipment.numero, order_code: shipment.orden_codigo, already_confirmed: true };
    }
    if (shipment.estado !== 'BORRADOR') throw httpError(409, `La remision esta ${shipment.estado}`);
    if (['COMPLETADA', 'CANCELADA'].includes(shipment.orden_estado)) {
      throw httpError(409, `La orden esta ${shipment.orden_estado}`);
    }
    const [items] = await conn.execute(
      `SELECT mei.cantidad, mml.id AS material_lote_id, mml.stock_id,
              mml.bodega_origen_id, mml.ubicacion_origen_id, mml.lote,
              mml.maquila_material_id, mml.es_adicional,
              mm.producto_id, p.siigo_code AS sku, p.nombre,
              u.codigo AS ubicacion
         FROM maquila_envio_items mei
         JOIN maquila_material_lotes mml ON mml.id = mei.maquila_material_lote_id
         JOIN maquila_materiales mm ON mm.id = mml.maquila_material_id
         JOIN productos p ON p.id = mm.producto_id
         JOIN ubicaciones u ON u.id = mml.ubicacion_origen_id
        WHERE mei.maquila_envio_id = ?
        ORDER BY mei.id FOR UPDATE`,
      [shipment.id]
    );
    if (!items.length) throw httpError(409, 'La remision no tiene materiales');
    const txId = crypto.randomUUID();
    const dispatched = [];
    for (const item of items) {
      const quantity = Number(item.cantidad);
      const [stockUpdate] = await conn.execute(
        `UPDATE stock
            SET cantidad = cantidad - ?, reservada = reservada - ?, actualizado_en = NOW()
          WHERE id = ? AND cantidad >= ? AND reservada >= ?`,
        [quantity, quantity, item.stock_id, quantity, quantity]
      );
      if (stockUpdate.affectedRows !== 1) throw httpError(409, `La reserva del lote ${item.lote} ya no esta disponible`);
      const [lotUpdate] = await conn.execute(
        `UPDATE lots SET qty_current = qty_current - ?, updated_at = NOW()
          WHERE lpn = ? AND product_id = ? AND qty_current >= ?`,
        [quantity, item.lote, item.producto_id, quantity]
      );
      if (lotUpdate.affectedRows !== 1) throw httpError(409, `Saldo insuficiente en lote ${item.lote}`);
      await conn.execute(
        `UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', 'DISPONIBLE')
          WHERE lpn = ? AND product_id = ?`,
        [item.lote, item.producto_id]
      );
      await conn.execute(
        `UPDATE maquila_material_lotes
            SET cantidad_enviada = cantidad_enviada + ?, estado = 'ENVIADO', actualizado_en = NOW()
          WHERE id = ?`,
        [quantity, item.material_lote_id]
      );
      await conn.execute(
        `UPDATE maquila_materiales
            SET cantidad_reservada = cantidad_reservada - ?,
                cantidad_enviada = cantidad_enviada + ?, actualizado_en = NOW()
          WHERE id = ?`,
        [quantity, quantity, item.maquila_material_id]
      );
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_orig, ubicacion_orig, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id, siigo_sync)
         VALUES ('salida', ?, ?, ?, ?, ?, ?, 'maquila_envio_3q', ?, 0)`,
        [item.producto_id, item.bodega_origen_id, item.ubicacion_origen_id,
         item.lote, quantity, shipment.id, userId]
      );
      const [lotRows] = await conn.execute(
        `SELECT id, qty_current FROM lots WHERE lpn = ? AND product_id = ? LIMIT 1`,
        [item.lote, item.producto_id]
      );
      await conn.execute(
        `INSERT INTO kardex
           (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
            reference, notes, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'ENVIO_MAQUILA_3Q', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), txId, lotRows[0]?.id || null, item.producto_id,
         userId, -quantity, Number(lotRows[0]?.qty_current || 0),
         `maquila:${shipment.orden_codigo}`,
         `Remision ${shipment.numero}; custodia externa 3Q; origen ${item.ubicacion}`,
         userId]
      );
      dispatched.push({ sku: item.sku, cantidad: quantity, lote: item.lote, ubicacion_origen: item.ubicacion, adicional: Boolean(item.es_adicional) });
    }
    await conn.execute(
      `UPDATE maquila_envios
          SET estado = 'CONFIRMADO', confirmado_por = ?, confirmado_en = NOW()
        WHERE id = ?`,
      [userId, shipment.id]
    );
    await conn.execute(
      `UPDATE ordenes_maquila
          SET estado = IF(estado = 'MATERIALES_RESERVADOS', 'EN_3Q', estado),
              enviado_por = COALESCE(enviado_por, ?), enviado_en = COALESCE(enviado_en, NOW()),
              actualizado_en = NOW()
        WHERE id = ?`,
      [userId, shipment.orden_maquila_id]
    );
    await conn.commit();
    return {
      shipment_number: shipment.numero,
      order_code: shipment.orden_codigo,
      state: 'CONFIRMADO',
      external_custody: '3Q',
      dispatched,
    };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function reconcileOutsourcingReception(conn, { outsourcingOrderId, userId }) {
  if (!outsourcingOrderId) return null;
  const [orders] = await conn.execute(
    `SELECT * FROM ordenes_maquila WHERE id = ? LIMIT 1 FOR UPDATE`,
    [outsourcingOrderId]
  );
  if (!orders.length) throw httpError(404, 'Orden de maquila no encontrada');
  const order = orders[0];
  if (!['EN_3Q', 'RECIBIDA_PARCIAL', 'COMPLETADA'].includes(order.estado)) {
    throw httpError(409, `La orden de maquila esta ${order.estado} y no puede recibir producto`);
  }
  const [totals] = await conn.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN rd.condicion = 'DISPONIBLE' THEN rd.cantidad ELSE 0 END), 0) AS disponible,
       COALESCE(SUM(CASE WHEN rd.condicion = 'CUARENTENA' THEN rd.cantidad ELSE 0 END), 0) AS cuarentena,
       COALESCE(SUM(CASE WHEN rd.condicion IN ('RECHAZADO','PENDIENTE_DISPOSICION') THEN rd.cantidad ELSE 0 END), 0) AS rechazado
       FROM maquila_recepciones mr
       JOIN recepciones r ON r.id = mr.recepcion_id
       JOIN recepcion_items ri ON ri.recepcion_id = r.id AND ri.producto_id = ?
       JOIN recepcion_distribuciones rd ON rd.recepcion_id = r.id AND rd.recepcion_item_id = ri.id
      WHERE mr.orden_maquila_id = ? AND r.estado <> 'anulada'`,
    [order.producto_id, order.id]
  );
  const available = roundQty(totals[0]?.disponible || 0);
  const state = outsourcingStateForReceipt(available, order.cantidad_objetivo);
  if (state === 'COMPLETADA') {
    const [pendingShipments] = await conn.execute(
      `SELECT COUNT(*) AS cantidad FROM maquila_envios
        WHERE orden_maquila_id = ? AND estado = 'BORRADOR'`,
      [order.id]
    );
    if (Number(pendingShipments[0]?.cantidad || 0) > 0) {
      throw httpError(409, `La orden ${order.codigo} tiene remisiones pendientes de confirmar o cancelar`);
    }
  }
  await conn.execute(
    `UPDATE ordenes_maquila
        SET cantidad_recibida = ?, estado = ?,
            completado_por = IF(? = 'COMPLETADA', COALESCE(completado_por, ?), completado_por),
            completado_en = IF(? = 'COMPLETADA', COALESCE(completado_en, NOW()), completado_en),
            actualizado_en = NOW()
      WHERE id = ?`,
    [available, state, state, userId, state, order.id]
  );
  if (state === 'COMPLETADA' && order.estado !== 'COMPLETADA') {
    await conn.execute(
      `UPDATE maquila_materiales mm
       JOIN (
         SELECT maquila_material_id,
                SUM(CASE WHEN es_adicional = 0 THEN cantidad_enviada ELSE 0 END) AS inicial,
                SUM(CASE WHEN es_adicional = 1 THEN cantidad_enviada ELSE 0 END) AS adicional
           FROM maquila_material_lotes
          GROUP BY maquila_material_id
       ) sent ON sent.maquila_material_id = mm.id
          SET mm.cantidad_conciliada = sent.inicial,
              mm.cantidad_merma = sent.adicional,
              mm.actualizado_en = NOW()
        WHERE mm.orden_maquila_id = ?`,
      [order.id]
    );
  }
  return {
    order_id: order.id,
    order_code: order.codigo,
    state,
    target: Number(order.cantidad_objetivo),
    available,
    quarantine: roundQty(totals[0]?.cuarentena || 0),
    rejected: roundQty(totals[0]?.rechazado || 0),
  };
}

async function prepareOutsourcingReception(conn, { orderId, quantity, userId }) {
  const reference = String(orderId || '').trim();
  if (!reference) throw httpError(400, 'orden_maquila_id es obligatorio');
  const [orders] = await conn.execute(
    `SELECT om.id, om.codigo, om.orden_compra_id, om.tercero_id,
            om.proveedor_nombre, om.producto_id, om.cantidad_objetivo,
            om.cantidad_recibida, om.estado, oc.numero AS orden_compra_numero,
            p.siigo_code AS sku, p.nombre AS producto, p.requiere_lote,
            p.unit_label AS unidad
       FROM ordenes_maquila om
       JOIN ordenes_compra_proveedor oc ON oc.id = om.orden_compra_id
       JOIN productos p ON p.id = om.producto_id
      WHERE om.id = ? OR om.codigo = ? LIMIT 1 FOR UPDATE`,
    [Number(reference) || 0, reference]
  );
  if (!orders.length) throw httpError(404, 'Orden de maquila no encontrada');
  const order = orders[0];
  if (!['EN_3Q', 'RECIBIDA_PARCIAL'].includes(order.estado)) {
    throw httpError(409, `La orden ${order.codigo} esta ${order.estado} y no puede recibir producto`);
  }

  const preparationKey = `MAQUILA_3Q:${order.id}`;
  const [preparedRows] = await conn.execute(
    `SELECT r.id, r.numero, r.estado, ri.id AS item_id, ri.cantidad_esp
       FROM recepciones r
       JOIN recepcion_items ri ON ri.recepcion_id = r.id AND ri.producto_id = ?
      WHERE r.preparacion_clave = ? AND r.estado IN ('borrador','en_proceso')
      LIMIT 1`,
    [order.producto_id, preparationKey]
  );
  if (preparedRows.length) {
    const existingItems = await addPreferredLocations(conn, [{
      item_id: preparedRows[0].item_id,
      producto_id: order.producto_id,
      sku: order.sku,
      producto: order.producto,
      modalidad_operativa: PRODUCT_MODES.OUTSOURCED,
      requiere_lote: Boolean(order.requiere_lote),
      cantidad_pendiente: Number(preparedRows[0].cantidad_esp),
      unidad: order.unidad || 'und',
      orden_maquila_id: order.id,
      orden_maquila_codigo: order.codigo,
    }]);
    return {
      id: preparedRows[0].id,
      numero: preparedRows[0].numero,
      orden_compra_id: order.orden_compra_id,
      orden_compra_numero: order.orden_compra_numero,
      orden_maquila_id: order.id,
      orden_maquila_codigo: order.codigo,
      proveedor_nombre: order.proveedor_nombre,
      estado: preparedRows[0].estado,
      items: existingItems,
      duplicate: true,
    };
  }

  const remaining = roundQty(Number(order.cantidad_objetivo) - Number(order.cantidad_recibida));
  if (remaining <= 0) throw httpError(409, `La orden ${order.codigo} no tiene cantidades pendientes`);
  const deliveryQuantity = quantity == null || quantity === '' ? remaining : roundQty(Number(quantity));
  if (!Number.isFinite(deliveryQuantity) || deliveryQuantity <= 0) {
    throw httpError(400, 'La cantidad de esta entrega debe ser positiva');
  }
  if (deliveryQuantity > remaining + 0.0001) {
    throw httpError(409, 'La cantidad de esta entrega supera el saldo pendiente de la orden 3Q', {
      saldo_pendiente: remaining,
      cantidad_entrega: deliveryQuantity,
    });
  }

  const warehouseId = await resolvePrimaryWarehouse(conn);
  const [sequenceRows] = await conn.execute(
    `SELECT COUNT(*) AS cantidad FROM recepciones
      WHERE orden_compra_id = ? AND numero LIKE ?`,
    [order.orden_compra_id, `REC-3Q-${order.id}-%`]
  );
  const sequence = Number(sequenceRows[0]?.cantidad || 0) + 1;
  const number = `REC-3Q-${order.id}-${String(sequence).padStart(3, '0')}`;
  const [created] = await conn.execute(
    `INSERT INTO recepciones
       (numero, orden_compra_id, tercero_id, proveedor_nombre, bodega_id, estado,
        usuario_id, observaciones, preparacion_clave, creado_en)
     VALUES (?, ?, ?, ?, ?, 'borrador', ?, ?, ?, NOW())`,
    [number, order.orden_compra_id, order.tercero_id, order.proveedor_nombre,
     warehouseId, userId,
     `Recepcion fisica preparada desde orden 3Q ${order.codigo}`,
     preparationKey]
  );
  const [createdItem] = await conn.execute(
    `INSERT INTO recepcion_items
       (recepcion_id, producto_id, cantidad_esp, cantidad_rec)
     VALUES (?, ?, ?, 0)`,
    [created.insertId, order.producto_id, deliveryQuantity]
  );
  const items = await addPreferredLocations(conn, [{
    item_id: createdItem.insertId,
    producto_id: order.producto_id,
    sku: order.sku,
    producto: order.producto,
    modalidad_operativa: PRODUCT_MODES.OUTSOURCED,
    requiere_lote: Boolean(order.requiere_lote),
    cantidad_ordenada: Number(order.cantidad_objetivo),
    cantidad_aceptada: Number(order.cantidad_recibida),
    cantidad_pendiente: deliveryQuantity,
    saldo_orden_maquila: remaining,
    unidad: order.unidad || 'und',
    orden_maquila_id: order.id,
    orden_maquila_codigo: order.codigo,
  }]);
  return {
    id: created.insertId,
    numero: number,
    orden_compra_id: order.orden_compra_id,
    orden_compra_numero: order.orden_compra_numero,
    orden_maquila_id: order.id,
    orden_maquila_codigo: order.codigo,
    proveedor_nombre: order.proveedor_nombre,
    estado: 'borrador',
    cantidad_entrega: deliveryQuantity,
    saldo_orden_maquila: remaining,
    items,
    duplicate: false,
  };
}

module.exports = {
  createOutsourcingOrder,
  prepareAdditionalShipment,
  confirmOutsourcingShipment,
  cancelOutsourcingShipment,
  prepareOutsourcingReception,
  reconcileOutsourcingReception,
};
