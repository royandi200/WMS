const crypto = require('crypto');
const { createConnection } = require('./db');
const { notifyRoles } = require('./builderbot-notifications');
const { roundQty } = require('./production-workflow');
const { resolvePrimaryWarehouse } = require('./warehouses');

function httpError(status, message, data) {
  const error = new Error(message);
  error.status = status;
  error.data = data;
  return error;
}

function normalizeReplenishmentInput({ quantity, reason, fullBomConfirmed }) {
  const units = Number(quantity);
  const normalizedReason = String(reason || '').trim();
  const confirmed = fullBomConfirmed === true
    || ['true', '1', 'si', 'sí'].includes(String(fullBomConfirmed || '').trim().toLowerCase());
  if (!Number.isInteger(units) || units <= 0) {
    throw httpError(400, 'La cantidad de unidades a reponer debe ser un entero positivo');
  }
  if (!normalizedReason) throw httpError(400, 'El motivo de la reposicion es obligatorio');
  if (!confirmed) {
    throw httpError(400, 'Confirma expresamente que se repondra el BOM completo de las unidades faltantes');
  }
  return { units, reason: normalizedReason };
}

function replenishmentCodeForId(orderId, id) {
  return `REP-OP-${String(orderId).padStart(6, '0')}-${String(id).padStart(4, '0')}`;
}

function buildReplenishmentRequirements(materials, plannedQuantity, targetUnits) {
  const planned = Number(plannedQuantity);
  if (!Array.isArray(materials) || !materials.length || !Number.isFinite(planned) || planned <= 0) {
    throw httpError(409, 'La orden no tiene un BOM de produccion valido');
  }
  return materials.map((material) => {
    const perUnit = Number(material.cantidad_teorica) / planned;
    const required = roundQty(perUnit * targetUnits);
    if (!Number.isFinite(required) || required <= 0) {
      throw httpError(409, `El BOM registrado para ${material.sku} no permite calcular la reposicion`);
    }
    return { material, required };
  });
}

async function loadReplenishmentPicking(conn, replenishmentId) {
  const [rows] = await conn.execute(
    `SELECT p.siigo_code AS sku, p.nombre AS producto, pml.cantidad_reservada,
            pri.unidad, pml.lote, pml.ubicacion_id, u.codigo AS ubicacion,
            DATE_FORMAT(COALESCE(l.expiry_date, s.fecha_venc), '%Y-%m-%d') AS vence
     FROM produccion_reposicion_items pri
     JOIN produccion_materiales pm ON pm.id = pri.produccion_material_id
     JOIN productos p ON p.id = pm.producto_id
     JOIN produccion_material_lotes pml ON pml.reposicion_id = pri.reposicion_id
       AND pml.produccion_material_id = pri.produccion_material_id
     JOIN stock s ON s.id = pml.stock_id
     LEFT JOIN lots l ON l.lpn = pml.lote AND l.product_id = pm.producto_id
     LEFT JOIN ubicaciones u ON u.id = pml.ubicacion_id
     WHERE pri.reposicion_id = ? ORDER BY pri.id, pml.id`,
    [replenishmentId]
  );
  return rows.map(row => ({
    sku: row.sku,
    producto: row.producto,
    cantidad: Number(row.cantidad_reservada),
    unidad: row.unidad,
    lote: row.lote,
    ubicacion_id: row.ubicacion_id,
    ubicacion: row.ubicacion,
    vence: row.vence,
  }));
}

async function prepareProductionReplenishment({ orderId, quantity, reason, fullBomConfirmed, userId }) {
  if (!orderId) throw httpError(400, 'La orden es obligatoria');
  const input = normalizeReplenishmentInput({ quantity, reason, fullBomConfirmed });
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
    if (order.estado !== 'EN_PROCESO') throw httpError(409, 'La orden debe estar EN_PROCESO');
    const warehouseId = await resolvePrimaryWarehouse(conn);

    const [pending] = await conn.execute(
      `SELECT * FROM produccion_reposiciones
       WHERE orden_produccion_id = ? AND estado = 'PENDIENTE_ALISTAMIENTO'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [order.id]
    );
    if (pending.length) {
      const existing = pending[0];
      if (Number(existing.cantidad_objetivo) !== input.units
          || String(existing.motivo).trim().toLowerCase() !== input.reason.toLowerCase()) {
        throw httpError(409, `La orden ya tiene la reposicion pendiente ${existing.codigo}`);
      }
      const picking = await loadReplenishmentPicking(conn, existing.id);
      await conn.commit();
      return {
        already_prepared: true,
        replenishment_id: existing.id,
        replenishment_code: existing.codigo,
        order_code: order.codigo_orden,
        target_quantity: input.units,
        reason: input.reason,
        picking,
      };
    }

    const [recentRetry] = await conn.execute(
      `SELECT * FROM produccion_reposiciones
       WHERE orden_produccion_id = ? AND estado = 'CONFIRMADA'
         AND cantidad_objetivo = ? AND LOWER(TRIM(motivo)) = LOWER(?)
         AND creada_en >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
       ORDER BY id DESC LIMIT 1`,
      [order.id, input.units, input.reason]
    );
    if (recentRetry.length) {
      const existing = recentRetry[0];
      const picking = await loadReplenishmentPicking(conn, existing.id);
      await conn.commit();
      return {
        already_prepared: true,
        already_confirmed: true,
        replenishment_id: existing.id,
        replenishment_code: existing.codigo,
        order_code: order.codigo_orden,
        target_quantity: input.units,
        reason: input.reason,
        picking,
      };
    }

    const [materials] = await conn.execute(
      `SELECT pm.id, pm.producto_id, pm.cantidad_teorica, pm.unidad,
              p.siigo_code AS sku, p.nombre
       FROM produccion_materiales pm JOIN productos p ON p.id = pm.producto_id
       WHERE pm.orden_produccion_id = ? ORDER BY pm.id FOR UPDATE`,
      [order.id]
    );
    const requirements = buildReplenishmentRequirements(
      materials,
      order.cantidad_planeada,
      input.units
    );

    const plan = [];
    const shortages = [];
    for (const requirement of requirements) {
      const { material, required } = requirement;
      let remaining = required;
      const [stockRows] = await conn.execute(
        `SELECT s.id, s.bodega_id, s.lote, s.ubicacion_id,
                (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
                u.codigo AS ubicacion,
                DATE_FORMAT(COALESCE(l.expiry_date, s.fecha_venc), '%Y-%m-%d') AS vence
         FROM stock s
         JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
         JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
         WHERE s.producto_id = ? AND s.bodega_id = ? AND l.status = 'DISPONIBLE'
           AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
           AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
                OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
         ORDER BY CASE WHEN COALESCE(l.expiry_date, s.fecha_venc) IS NULL THEN 1 ELSE 0 END,
                  COALESCE(l.expiry_date, s.fecha_venc), l.created_at, s.id
         FOR UPDATE`,
        [material.producto_id, warehouseId]
      );
      const allocations = [];
      for (const stock of stockRows) {
        if (remaining <= 0.0001) break;
        const take = roundQty(Math.min(Number(stock.disponible), remaining));
        allocations.push({ ...stock, quantity: take });
        remaining = roundQty(remaining - take);
      }
      if (remaining > 0.0001) shortages.push({ sku: material.sku, requerido: required, faltante: remaining });
      plan.push({ material, required, allocations });
    }
    if (shortages.length) throw httpError(409, 'Stock insuficiente para preparar la reposicion', { shortages });

    const [created] = await conn.execute(
      `INSERT INTO produccion_reposiciones
         (codigo, orden_produccion_id, cantidad_objetivo, motivo, estado, solicitada_por, creada_en)
       VALUES (?, ?, ?, ?, 'PENDIENTE_ALISTAMIENTO', ?, NOW())`,
      [`TMP-${crypto.randomUUID()}`, order.id, input.units, input.reason, userId]
    );
    const code = replenishmentCodeForId(order.id, created.insertId);
    await conn.execute(`UPDATE produccion_reposiciones SET codigo = ? WHERE id = ?`, [code, created.insertId]);

    for (const item of plan) {
      await conn.execute(
        `INSERT INTO produccion_reposicion_items
           (reposicion_id, produccion_material_id, cantidad_requerida, unidad, creado_en)
         VALUES (?, ?, ?, ?, NOW())`,
        [created.insertId, item.material.id, item.required, item.material.unidad]
      );
      for (const allocation of item.allocations) {
        const [reserved] = await conn.execute(
          `UPDATE stock SET reservada = reservada + ?, actualizado_en = NOW()
           WHERE id = ? AND (cantidad - reservada) >= ?`,
          [allocation.quantity, allocation.id, allocation.quantity]
        );
        if (reserved.affectedRows !== 1) throw httpError(409, 'El inventario cambio durante la reserva');
        await conn.execute(
          `INSERT INTO produccion_material_lotes
             (produccion_material_id, reposicion_id, stock_id, lote, ubicacion_id,
              cantidad_reservada, es_adicional, creado_en)
           VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
          [item.material.id, created.insertId, allocation.id, allocation.lote,
           allocation.ubicacion_id, allocation.quantity]
        );
      }
      await conn.execute(
        `UPDATE produccion_materiales
         SET cantidad_reservada = cantidad_reservada + ?, actualizado_en = NOW() WHERE id = ?`,
        [item.required, item.material.id]
      );
    }

    const picking = await loadReplenishmentPicking(conn, created.insertId);
    await conn.commit();
    const result = {
      already_prepared: false,
      replenishment_id: created.insertId,
      replenishment_code: code,
      order_code: order.codigo_orden,
      product_sku: order.producto_sku,
      product_name: order.producto_nombre,
      target_quantity: input.units,
      reason: input.reason,
      picking,
    };
    result.notification = await notifyRoles({
      event: `production_replenishment_prepared:${created.insertId}`,
      roles: ['alistador'],
      text: [
        `Reposicion ${code} autorizada para ${order.codigo_orden}.`,
        `${input.units} unidad(es) conformes faltantes de ${order.producto_sku} - ${order.producto_nombre}.`,
        `Motivo: ${input.reason}`,
        'Alistamiento adicional FEFO:',
        ...picking.map(item => `- ${item.sku}: ${item.cantidad} ${item.unidad || ''} | lote ${item.lote} | ubicacion ${item.ubicacion || item.ubicacion_id}`),
        `Cuando esten listos, confirma la reposicion ${code}.`,
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

async function confirmProductionReplenishment({ replenishmentId, orderId, userId }) {
  if (!replenishmentId && !orderId) throw httpError(400, 'La reposicion o la orden son obligatorias');
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const numericReplenishment = Number(replenishmentId) || 0;
    const numericOrder = Number(orderId) || 0;
    const [rows] = await conn.execute(
      `SELECT r.*, op.codigo_orden, op.estado AS orden_estado,
              p.siigo_code AS producto_sku, p.nombre AS producto_nombre
       FROM produccion_reposiciones r
       JOIN ordenes_produccion op ON op.id = r.orden_produccion_id
       JOIN productos p ON p.id = op.producto_id
       WHERE r.id = ? OR r.codigo = ? OR op.id = ? OR op.codigo_orden = ?
       ORDER BY (r.estado = 'PENDIENTE_ALISTAMIENTO') DESC, r.id DESC LIMIT 1 FOR UPDATE`,
      [numericReplenishment, String(replenishmentId || ''), numericOrder, String(orderId || '')]
    );
    if (!rows.length) throw httpError(404, 'Reposicion pendiente no encontrada');
    const replenishment = rows[0];
    if (replenishment.estado === 'CONFIRMADA') {
      await conn.commit();
      return {
        already_confirmed: true,
        replenishment_code: replenishment.codigo,
        order_code: replenishment.codigo_orden,
        consumed: [],
      };
    }
    if (replenishment.estado !== 'PENDIENTE_ALISTAMIENTO') {
      throw httpError(409, `La reposicion esta ${replenishment.estado}`);
    }
    if (replenishment.orden_estado !== 'EN_PROCESO') throw httpError(409, 'La orden debe estar EN_PROCESO');

    const [allocations] = await conn.execute(
      `SELECT pml.id, pml.stock_id, pml.lote, pml.ubicacion_id, pml.cantidad_reservada,
              pm.id AS material_id, pm.producto_id, s.bodega_id,
              p.siigo_code AS sku, p.nombre AS producto_nombre, u.codigo AS ubicacion
       FROM produccion_material_lotes pml
       JOIN produccion_materiales pm ON pm.id = pml.produccion_material_id
       JOIN stock s ON s.id = pml.stock_id
       JOIN productos p ON p.id = pm.producto_id
       LEFT JOIN ubicaciones u ON u.id = pml.ubicacion_id
       WHERE pml.reposicion_id = ? ORDER BY pml.id FOR UPDATE`,
      [replenishment.id]
    );
    if (!allocations.length) throw httpError(409, 'La reposicion no tiene materiales reservados');

    const consumed = [];
    for (const allocation of allocations) {
      const qty = Number(allocation.cantidad_reservada);
      const [stockUpdate] = await conn.execute(
        `UPDATE stock SET cantidad = cantidad - ?, reservada = reservada - ?, actualizado_en = NOW()
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
      await conn.execute(`UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', 'DISPONIBLE') WHERE lpn = ?`, [allocation.lote]);
      await conn.execute(
        `UPDATE produccion_material_lotes
         SET cantidad_alistada = ?, cantidad_consumida = ?, confirmado_por = ?, confirmado_en = NOW()
         WHERE id = ? AND confirmado_en IS NULL`,
        [qty, qty, userId, allocation.id]
      );
      await conn.execute(
        `UPDATE produccion_materiales
         SET cantidad_alistada = cantidad_alistada + ?, cantidad_consumida = cantidad_consumida + ?,
             cantidad_adicional = cantidad_adicional + ?, actualizado_en = NOW() WHERE id = ?`,
        [qty, qty, qty, allocation.material_id]
      );
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_orig, ubicacion_orig, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id, siigo_sync)
         VALUES ('salida', ?, ?, ?, ?, ?, ?, 'reposicion_produccion', ?, 0)`,
        [allocation.producto_id, allocation.bodega_id, allocation.ubicacion_id,
         allocation.lote, qty, replenishment.id, userId]
      );
      const [lotRows] = await conn.execute(`SELECT id, qty_current FROM lots WHERE lpn = ? LIMIT 1`, [allocation.lote]);
      await conn.execute(
        `INSERT INTO kardex
           (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
            reference, notes, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'CONSUMO_MATERIAL', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), crypto.randomUUID(), lotRows[0]?.id || null,
         allocation.producto_id, userId, -qty, Number(lotRows[0]?.qty_current || 0),
         `reposicion:${replenishment.codigo}`, `Orden ${replenishment.codigo_orden} | ${replenishment.motivo}`, userId]
      );
      consumed.push({
        sku: allocation.sku,
        producto: allocation.producto_nombre,
        cantidad: qty,
        lote: allocation.lote,
        ubicacion: allocation.ubicacion,
      });
    }
    await conn.execute(
      `UPDATE produccion_reposiciones
       SET estado = 'CONFIRMADA', confirmada_por = ?, confirmada_en = NOW()
       WHERE id = ? AND estado = 'PENDIENTE_ALISTAMIENTO'`,
      [userId, replenishment.id]
    );
    const [actors] = await conn.execute(`SELECT nombre FROM usuarios WHERE id = ? LIMIT 1`, [userId]);
    await conn.commit();
    const result = {
      already_confirmed: false,
      replenishment_id: replenishment.id,
      replenishment_code: replenishment.codigo,
      order_code: replenishment.codigo_orden,
      target_quantity: Number(replenishment.cantidad_objetivo),
      consumed,
    };
    result.notification = await notifyRoles({
      event: `production_replenishment_confirmed:${replenishment.id}`,
      roles: ['admin', 'recepcion_cierre'],
      fallbackRoles: ['admin'],
      excludeUserIds: [userId],
      text: [
        `Reposicion confirmada: ${replenishment.codigo}`,
        `Orden: ${replenishment.codigo_orden}`,
        `Objetivo adicional: ${Number(replenishment.cantidad_objetivo)} unidad(es) conformes.`,
        `Confirmo: ${actors[0]?.nombre || 'Usuario WMS'}.`,
        'Material adicional entregado a produccion:',
        ...consumed.map(item => `- ${item.sku}: ${item.cantidad} | lote ${item.lote} | ubicacion ${item.ubicacion || 'N/A'}`),
        'La orden permanece EN_PROCESO.',
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

async function cancelProductionReplenishment({ replenishmentId, orderId, userId }) {
  if (!replenishmentId && !orderId) throw httpError(400, 'La reposicion o la orden son obligatorias');
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT r.*, op.codigo_orden
       FROM produccion_reposiciones r
       JOIN ordenes_produccion op ON op.id = r.orden_produccion_id
       WHERE r.id = ? OR r.codigo = ? OR op.id = ? OR op.codigo_orden = ?
       ORDER BY (r.estado = 'PENDIENTE_ALISTAMIENTO') DESC, r.id DESC LIMIT 1 FOR UPDATE`,
      [Number(replenishmentId) || 0, String(replenishmentId || ''),
       Number(orderId) || 0, String(orderId || '')]
    );
    if (!rows.length) throw httpError(404, 'Reposicion no encontrada');
    const replenishment = rows[0];
    if (replenishment.estado === 'CANCELADA') {
      await conn.commit();
      return { already_cancelled: true, replenishment_code: replenishment.codigo, order_code: replenishment.codigo_orden };
    }
    if (replenishment.estado === 'CONFIRMADA') throw httpError(409, 'Una reposicion confirmada no se puede cancelar');

    const [allocations] = await conn.execute(
      `SELECT pml.stock_id, pml.produccion_material_id, pml.cantidad_reservada
       FROM produccion_material_lotes pml
       WHERE pml.reposicion_id = ? ORDER BY pml.id FOR UPDATE`,
      [replenishment.id]
    );
    for (const allocation of allocations) {
      const qty = Number(allocation.cantidad_reservada);
      const [released] = await conn.execute(
        `UPDATE stock SET reservada = reservada - ?, actualizado_en = NOW()
         WHERE id = ? AND reservada >= ?`,
        [qty, allocation.stock_id, qty]
      );
      if (released.affectedRows !== 1) throw httpError(409, 'No se pudo liberar una reserva de la reposicion');
      await conn.execute(
        `UPDATE produccion_materiales
         SET cantidad_reservada = cantidad_reservada - ?, actualizado_en = NOW()
         WHERE id = ? AND cantidad_reservada >= ?`,
        [qty, allocation.produccion_material_id, qty]
      );
    }
    await conn.execute(
      `UPDATE produccion_reposiciones SET estado = 'CANCELADA', cancelada_por = ?, cancelada_en = NOW()
       WHERE id = ? AND estado = 'PENDIENTE_ALISTAMIENTO'`,
      [userId, replenishment.id]
    );
    await conn.commit();
    return {
      already_cancelled: false,
      replenishment_code: replenishment.codigo,
      order_code: replenishment.codigo_orden,
      released_allocations: allocations.length,
    };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = {
  buildReplenishmentRequirements,
  cancelProductionReplenishment,
  confirmProductionReplenishment,
  normalizeReplenishmentInput,
  prepareProductionReplenishment,
  replenishmentCodeForId,
};
