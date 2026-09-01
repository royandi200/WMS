const crypto = require('crypto');
const { createConnection } = require('./db');
const { resolvePrimaryWarehouse } = require('./warehouses');
const { notifyRoles } = require('./builderbot-notifications');
const { assertInternalProductionProduct } = require('./product-modes');
const { resolveProductReference } = require('./product-references');

function httpError(status, message, data) {
  const error = new Error(message);
  error.status = status;
  error.data = data;
  return error;
}

function roundQty(value) {
  return Number(Number(value).toFixed(4));
}

function orderCodeForId(id) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = String(id).padStart(6, '0');
  return `OP-${date}-${suffix}`;
}

async function defaultWarehouse(conn) {
  return resolvePrimaryWarehouse(conn);
}

async function releaseProductionOrder({ product, quantity, originType, customerReference, finalCustomer, notes, userId }) {
  const qty = Number(quantity);
  const origin = String(originType || '').trim().toUpperCase();
  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, 'La cantidad planeada debe ser positiva');
  if (!['OC_CLIENTE', 'STOCK_SEGURIDAD'].includes(origin)) {
    throw httpError(400, 'origen_tipo debe ser OC_CLIENTE o STOCK_SEGURIDAD');
  }
  if (origin === 'OC_CLIENTE' && !String(customerReference || '').trim()) {
    throw httpError(400, 'La referencia de la OC del cliente es obligatoria');
  }
  if (origin === 'OC_CLIENTE' && !String(finalCustomer || '').trim()) {
    throw httpError(400, 'El cliente final es obligatorio');
  }

  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const finalProduct = await resolveProductReference(conn, product, { modes: ['PR'] });
    assertInternalProductionProduct(finalProduct);
    const warehouseId = await defaultWarehouse(conn);
    const [bom] = await conn.execute(
      `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
              p.siigo_code AS sku, p.nombre
       FROM bom b JOIN productos p ON p.id = b.insumo_id
       WHERE b.producto_final_id = ? AND b.etapa = 'PRODUCCION' ORDER BY b.id`,
      [finalProduct.id]
    );
    if (!bom.length) throw httpError(422, `No existe BOM para ${finalProduct.siigo_code}`);

    const plan = [];
    const shortages = [];
    for (const component of bom) {
      const required = roundQty(Number(component.cantidad_por_unidad) * qty);
      let remaining = required;
      const [stockRows] = await conn.execute(
        `SELECT s.id, s.lote, s.ubicacion_id, COALESCE(l.expiry_date, s.fecha_venc) AS fecha_venc,
                (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
                u.codigo AS ubicacion_codigo
         FROM stock s
         JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
         JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
         WHERE s.producto_id = ? AND s.bodega_id = ?
           AND l.status = 'DISPONIBLE'
           AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
           AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
                OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
         ORDER BY CASE WHEN COALESCE(l.expiry_date, s.fecha_venc) IS NULL THEN 1 ELSE 0 END,
                  COALESCE(l.expiry_date, s.fecha_venc) ASC, l.created_at ASC, s.id ASC
         FOR UPDATE`,
        [component.insumo_id, warehouseId]
      );
      const allocations = [];
      for (const stock of stockRows) {
        if (remaining <= 0.0001) break;
        const take = roundQty(Math.min(Number(stock.disponible), remaining));
        allocations.push({
          stockId: stock.id,
          lot: stock.lote,
          locationId: stock.ubicacion_id,
          locationCode: stock.ubicacion_codigo,
          expiryDate: stock.fecha_venc,
          quantity: take,
        });
        remaining = roundQty(remaining - take);
      }
      if (remaining > 0.0001) {
        shortages.push({ sku: component.sku, requerido: required, faltante: remaining });
      }
      plan.push({ component, required, allocations });
    }
    if (shortages.length) throw httpError(409, 'Stock insuficiente para liberar la orden', { shortages });

    const temporaryCode = `TMP-${crypto.randomBytes(8).toString('hex')}`;
    const [created] = await conn.execute(
      `INSERT INTO ordenes_produccion
         (codigo_orden, producto_id, origen_tipo, referencia_cliente, cliente_final,
          cantidad_planeada, fase, estado, creado_por, aprobado_por, liberado_por,
          materiales_conf_en, liberado_en, notas, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'F0', 'APROBADA', ?, ?, ?, NULL, NOW(), ?, NOW())`,
      [temporaryCode, finalProduct.id, origin, customerReference || null, finalCustomer || null,
       qty, userId, userId, userId, notes || null]
    );
    const code = orderCodeForId(created.insertId);
    await conn.execute(`UPDATE ordenes_produccion SET codigo_orden = ? WHERE id = ?`, [code, created.insertId]);

    const picking = [];
    for (const item of plan) {
      const [material] = await conn.execute(
        `INSERT INTO produccion_materiales
           (orden_produccion_id, producto_id, cantidad_teorica, cantidad_reservada,
            unidad, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [created.insertId, item.component.insumo_id, item.required, item.required, item.component.unidad]
      );
      for (const allocation of item.allocations) {
        const [reserved] = await conn.execute(
          `UPDATE stock SET reservada = reservada + ?, actualizado_en = NOW()
           WHERE id = ? AND (cantidad - reservada) >= ?`,
          [allocation.quantity, allocation.stockId, allocation.quantity]
        );
        if (reserved.affectedRows !== 1) throw httpError(409, 'El inventario cambio durante la reserva');
        await conn.execute(
          `INSERT INTO produccion_material_lotes
             (produccion_material_id, stock_id, lote, ubicacion_id, cantidad_reservada, creado_en)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [material.insertId, allocation.stockId, allocation.lot, allocation.locationId, allocation.quantity]
        );
        picking.push({
          sku: item.component.sku,
          producto: item.component.nombre,
          cantidad: allocation.quantity,
          unidad: item.component.unidad,
          lote: allocation.lot,
          ubicacion_id: allocation.locationId,
          ubicacion: allocation.locationCode,
          vence: allocation.expiryDate,
        });
      }
    }
    await conn.commit();
    const result = {
      order_id: created.insertId,
      order_code: code,
      status: 'APROBADA',
      product: finalProduct,
      origin_type: origin,
      customer_reference: customerReference || null,
      final_customer: finalCustomer || null,
      picking,
    };
    result.notification = await notifyRoles({
      event: `production_released:${created.insertId}`,
      roles: ['alistador'],
      text: [
        `Orden ${code} liberada`,
        `${finalProduct.siigo_code} - ${finalProduct.nombre}: ${qty} und`,
        ...picking.map(item => `${item.sku}: ${item.cantidad} ${item.unidad || ''} | lote ${item.lote} | ubicacion ${item.ubicacion || item.ubicacion_id}`),
        `Confirma materiales e inicio de produccion para ${code}.`,
      ].join('\n'),
    }).catch(error => [{ status: 'error', error: error.message }]);
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function confirmProductionMaterials({ orderId, userId }) {
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.execute(
      `SELECT op.*, p.siigo_code AS producto_sku, p.nombre AS producto_nombre
       FROM ordenes_produccion op JOIN productos p ON p.id = op.producto_id
       WHERE op.id = ? OR op.codigo_orden = ? LIMIT 1 FOR UPDATE`,
      [orderId, orderId]
    );
    if (!orders.length) throw httpError(404, 'Orden no encontrada');
    const order = orders[0];
    if (order.estado === 'EN_PROCESO' && order.materiales_conf_en) {
      await conn.commit();
      return { order_code: order.codigo_orden, phase: order.fase, already_confirmed: true, consumed: [] };
    }
    if (order.estado !== 'APROBADA' || order.fase !== 'F0') {
      throw httpError(409, `La orden esta ${order.estado} en fase ${order.fase} y no puede iniciar`);
    }
    const [allocations] = await conn.execute(
      `SELECT pml.id, pml.stock_id, pml.lote, pml.ubicacion_id, pml.cantidad_reservada,
              pm.id AS material_id, pm.producto_id, s.bodega_id,
              p.siigo_code AS sku, p.nombre AS producto_nombre, u.codigo AS ubicacion
       FROM produccion_material_lotes pml
       JOIN produccion_materiales pm ON pm.id = pml.produccion_material_id
       JOIN stock s ON s.id = pml.stock_id
       JOIN productos p ON p.id = pm.producto_id
       LEFT JOIN ubicaciones u ON u.id = pml.ubicacion_id
       WHERE pm.orden_produccion_id = ?
       ORDER BY pm.id, pml.id FOR UPDATE`,
      [order.id]
    );
    if (!allocations.length) throw httpError(409, 'La orden no tiene materiales reservados');

    const consumed = [];
    for (const allocation of allocations) {
      const qty = Number(allocation.cantidad_reservada);
      const [stockUpdate] = await conn.execute(
        `UPDATE stock
         SET cantidad = cantidad - ?, reservada = reservada - ?, actualizado_en = NOW()
         WHERE id = ? AND cantidad >= ? AND reservada >= ?`,
        [qty, qty, allocation.stock_id, qty, qty]
      );
      if (stockUpdate.affectedRows !== 1) throw httpError(409, `La reserva del lote ${allocation.lote} ya no esta disponible`);
      const [lotUpdate] = await conn.execute(
        `UPDATE lots SET qty_current = qty_current - ?, updated_at = NOW()
         WHERE lpn = ? AND qty_current >= ?`,
        [qty, allocation.lote, qty]
      );
      if (lotUpdate.affectedRows !== 1) throw httpError(409, `Saldo insuficiente en lote ${allocation.lote}`);
      await conn.execute(
        `UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', 'DISPONIBLE') WHERE lpn = ?`,
        [allocation.lote]
      );
      await conn.execute(
        `UPDATE produccion_material_lotes
         SET cantidad_alistada = ?, cantidad_consumida = ?, confirmado_por = ?, confirmado_en = NOW()
         WHERE id = ?`,
        [qty, qty, userId, allocation.id]
      );
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_orig, ubicacion_orig, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id, siigo_sync)
         VALUES ('salida', ?, ?, ?, ?, ?, ?, 'consumo_produccion', ?, 0)`,
        [allocation.producto_id, allocation.bodega_id, allocation.ubicacion_id,
         allocation.lote, qty, order.id, userId]
      );
      const [lotRows] = await conn.execute(
        `SELECT id, qty_current FROM lots WHERE lpn = ? LIMIT 1`,
        [allocation.lote]
      );
      await conn.execute(
        `INSERT INTO kardex
           (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
            reference, notes, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'CONSUMO_MATERIAL', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), crypto.randomUUID(), lotRows[0]?.id || null,
         allocation.producto_id, userId, -qty, Number(lotRows[0]?.qty_current || 0),
         `produccion:${order.codigo_orden}`, `Lote ${allocation.lote}`, userId]
      );
      consumed.push({
        product_id: allocation.producto_id,
        sku: allocation.sku,
        product: allocation.producto_nombre,
        lpn: allocation.lote,
        location: allocation.ubicacion,
        qty_taken: qty,
      });
    }
    await conn.execute(
      `UPDATE produccion_materiales pm
       SET cantidad_alistada = (
             SELECT COALESCE(SUM(pml.cantidad_alistada), 0) FROM produccion_material_lotes pml
             WHERE pml.produccion_material_id = pm.id
           ),
           cantidad_consumida = (
             SELECT COALESCE(SUM(pml.cantidad_consumida), 0) FROM produccion_material_lotes pml
             WHERE pml.produccion_material_id = pm.id
           ),
           actualizado_en = NOW()
       WHERE pm.orden_produccion_id = ?`,
      [order.id]
    );
    await conn.execute(
      `UPDATE ordenes_produccion
       SET fase = 'F1', estado = 'EN_PROCESO', materiales_conf_en = NOW()
       WHERE id = ? AND estado = 'APROBADA' AND fase = 'F0'`,
      [order.id]
    );
    const [actors] = await conn.execute(`SELECT nombre FROM usuarios WHERE id = ? LIMIT 1`, [userId]);
    await conn.commit();
    const result = { order_code: order.codigo_orden, phase: 'F1', already_confirmed: false, consumed };
    const startedAt = new Date().toLocaleString('es-CO', {
      timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
    });
    result.notification = await notifyRoles({
      event: `production_started:${order.id}`,
      roles: ['admin', 'recepcion_cierre'],
      fallbackRoles: ['admin'],
      excludeUserIds: [userId],
      text: [
        `Produccion iniciada: ${order.codigo_orden}`,
        `${order.producto_sku} - ${order.producto_nombre}: ${Number(order.cantidad_planeada)} und planeadas`,
        `Origen: ${order.origen_tipo === 'OC_CLIENTE' ? `OC ${order.referencia_cliente} - ${order.cliente_final}` : 'stock de seguridad'}`,
        `Confirmo: ${actors[0]?.nombre || 'Usuario WMS'} | ${startedAt}`,
        'Materiales consumidos:',
        ...consumed.map(item => `- ${item.sku}: ${item.qty_taken} | lote ${item.lpn} | ubicacion ${item.location || 'N/A'}`),
        'Estado: EN_PROCESO',
      ].join('\n'),
    }).catch(error => [{ status: 'error', error: error.message }]);
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = { releaseProductionOrder, confirmProductionMaterials, roundQty };
