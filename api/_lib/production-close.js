const crypto = require('crypto');
const { createConnection } = require('./db');
const { normalizeExpiryDate } = require('./production-close-input');
const { notifyRoles } = require('./builderbot-notifications');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function buildMaterialReconciliation(materials, processWasteRows = []) {
  const processWasteByProduct = new Map(
    processWasteRows.map((row) => [Number(row.producto_id), Number(row.merma_proceso || 0)])
  );
  return materials.map((material) => {
    const theoretical = Number(material.cantidad_teorica || 0);
    const consumed = Number(material.cantidad_consumida || 0);
    const returned = Number(material.cantidad_devuelta || 0);
    const net = consumed - returned;
    const processWaste = processWasteByProduct.get(Number(material.producto_id)) || 0;
    return {
      product_id: material.producto_id,
      sku: material.sku,
      producto: material.nombre,
      teorico: theoretical,
      consumido: consumed,
      devuelto: returned,
      adicional: Number(material.cantidad_adicional || 0),
      consumo_neto: net,
      merma_proceso: processWaste,
      uso_productivo_estimado: Number((net - processWaste).toFixed(4)),
      variacion: Number((net - theoretical).toFixed(4)),
    };
  });
}

async function closeProductionOrder({ orderId, qtyReal, qtyWaste, wasteReason, locationId, locationCode, expiryDate, userId }) {
  const conforming = Number(qtyReal);
  const waste = Number(qtyWaste);
  const normalizedExpiry = expiryDate ? normalizeExpiryDate(expiryDate) : null;
  const locationReference = locationId || locationCode || null;
  if (!orderId) throw httpError(400, 'La orden es obligatoria');
  if (expiryDate && !normalizedExpiry) throw httpError(400, 'La fecha de vencimiento no es valida');

  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.execute(
      `SELECT op.*, u.nombre AS cerrado_por_nombre,
              p.siigo_code AS producto_sku, p.nombre AS producto_nombre
       FROM ordenes_produccion op
       LEFT JOIN usuarios u ON u.id = op.aprobado_por
       JOIN productos p ON p.id = op.producto_id
       WHERE op.id = ? OR op.codigo_orden = ? LIMIT 1 FOR UPDATE`,
      [orderId, orderId]
    );
    if (!orders.length) throw httpError(404, 'Orden no encontrada');
    const order = orders[0];
    const lpn = `LPN-${order.codigo_orden}`;
    if (order.estado === 'CERRADA') {
      const [existingLots] = await conn.execute(
        `SELECT l.lpn, u.codigo AS ubicacion FROM lots l
         LEFT JOIN stock s ON s.lote = l.lpn
         LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
         WHERE l.production_order_id = ? AND l.product_id = ? ORDER BY l.created_at LIMIT 1`,
        [order.id, order.producto_id]
      );
      await conn.commit();
      return {
        already_closed: true,
        order_code: order.codigo_orden,
        qty_real: Number(order.cantidad_real),
        lpn_terminado: existingLots[0]?.lpn || null,
        ubicacion: existingLots[0]?.ubicacion || null,
        closed_by: order.cerrado_por_nombre || null,
        closed_at: order.cerrado_en || null,
      };
    }
    if (order.estado !== 'EN_PROCESO') throw httpError(409, `La orden esta ${order.estado} y debe estar EN_PROCESO`);
    if (!Number.isFinite(conforming) || conforming < 0 || !Number.isFinite(waste) || waste < 0) {
      throw httpError(400, 'Cantidad conforme y merma son obligatorias');
    }
    if (conforming === 0 && waste === 0) throw httpError(400, 'Debes confirmar unidades conformes o merma');
    if (waste > 0 && !String(wasteReason || '').trim()) throw httpError(400, 'El motivo de merma es obligatorio');
    if (conforming > 0 && !locationReference) throw httpError(400, 'La ubicacion del producto terminado es obligatoria');
    const [materials] = await conn.execute(
      `SELECT pm.producto_id, p.siigo_code AS sku, p.nombre,
              pm.cantidad_teorica, pm.cantidad_consumida,
              pm.cantidad_devuelta, pm.cantidad_adicional
       FROM produccion_materiales pm JOIN productos p ON p.id = pm.producto_id
       WHERE pm.orden_produccion_id = ? ORDER BY pm.id`,
      [order.id]
    );
    if (!materials.length) throw httpError(409, 'La orden no tiene conciliacion de materiales');
    const [processWasteRows] = await conn.execute(
      `SELECT producto_id, COALESCE(SUM(cantidad), 0) AS merma_proceso
       FROM mermas
       WHERE orden_produccion_id = ? AND tipo = 'PROCESO'
       GROUP BY producto_id`,
      [order.id]
    );
    let warehouseId = null;
    let location = null;
    let resolvedLocationCode = null;
    if (locationReference) {
      const [locations] = await conn.execute(
        `SELECT u.id, u.codigo, u.bodega_id
         FROM ubicaciones u JOIN bodegas b ON b.id = u.bodega_id
         WHERE (u.id = ? OR UPPER(u.codigo) = UPPER(?)) AND u.activa = 1 AND b.activa = 1
         LIMIT 1`,
        [Number(locationReference) || 0, String(locationReference).trim()]
      );
      if (!locations.length) throw httpError(400, 'La ubicacion no existe o no esta activa');
      location = locations[0].id;
      resolvedLocationCode = locations[0].codigo;
      warehouseId = locations[0].bodega_id;
    }

    let lotId = null;
    if (conforming > 0) {
      lotId = crypto.randomUUID();
      await conn.execute(
        `INSERT INTO lots
           (id, lpn, product_id, bodega_id, qty_initial, qty_current, origin, status,
            production_order_id, received_by, notes, expiry_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PRODUCCION', 'DISPONIBLE', ?, ?, ?, ?, NOW())`,
        [lotId, lpn, order.producto_id, warehouseId, conforming, conforming,
         order.id, userId,
         `Orden ${order.codigo_orden} | Merma cierre: ${waste} | ${wasteReason || 'Sin merma'}`,
         normalizedExpiry]
      );
      await conn.execute(
        `INSERT INTO stock
           (producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
        [order.producto_id, warehouseId, location, lpn, normalizedExpiry, conforming]
      );
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_dest, ubicacion_dest, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id, siigo_sync)
         VALUES ('entrada', ?, ?, ?, ?, ?, ?, 'orden_produccion', ?, 0)`,
        [order.producto_id, warehouseId, location, lpn, conforming, order.id, userId]
      );
      await conn.execute(
        `INSERT INTO kardex
           (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
            reference, notes, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'CIERRE_PRODUCCION', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), crypto.randomUUID(), lotId, order.producto_id, userId,
         conforming, conforming, `produccion:${order.codigo_orden}`,
         `Ubicacion ${location}`, userId]
      );
    }
    await conn.execute(
      `UPDATE ordenes_produccion
       SET cantidad_real = ?, fase = 'F5', estado = 'CERRADA', cerrado_en = NOW(), aprobado_por = ?
       WHERE id = ? AND estado = 'EN_PROCESO'`,
      [conforming, userId, order.id]
    );
    let wasteNumber = null;
    if (waste > 0) {
      wasteNumber = `MER-${Date.now()}`;
      await conn.execute(
        `INSERT INTO mermas
           (numero, tipo, producto_id, lote, orden_produccion_id, cantidad, motivo,
            usuario_id, aprobado_por, estado, creado_en)
         VALUES (?, 'PROCESO', ?, NULL, ?, ?, ?, ?, ?, 'APROBADO', NOW())`,
        [wasteNumber, order.producto_id, order.id, waste, wasteReason, userId, userId]
      );
    }
    const reconciliation = buildMaterialReconciliation(materials, processWasteRows);
    const [actors] = await conn.execute(`SELECT nombre FROM usuarios WHERE id = ? LIMIT 1`, [userId]);
    await conn.commit();
    const result = {
      already_closed: false,
      order_code: order.codigo_orden,
      qty_planned: Number(order.cantidad_planeada),
      qty_real: conforming,
      qty_waste: waste,
      waste_number: wasteNumber,
      lpn_terminado: conforming > 0 ? lpn : null,
      ubicacion_id: location,
      ubicacion: resolvedLocationCode,
      material_reconciliation: reconciliation,
    };
    const closedAt = new Date().toLocaleString('es-CO', {
      timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
    });
    const wastePercent = Number(order.cantidad_planeada) > 0
      ? Number(((waste / Number(order.cantidad_planeada)) * 100).toFixed(2))
      : 0;
    result.notification = await notifyRoles({
      event: `production_closed:${order.id}`,
      roles: ['admin'],
      fallbackRoles: [],
      excludeUserIds: [userId],
      text: [
        `Produccion cerrada: ${order.codigo_orden}`,
        `${order.producto_sku} - ${order.producto_nombre}`,
        `Plan: ${Number(order.cantidad_planeada)} | Conformes: ${conforming} | Merma: ${waste} (${wastePercent}%)`,
        `Motivo de merma: ${waste > 0 ? wasteReason : 'Sin merma'}`,
        `Lote PT: ${conforming > 0 ? lpn : 'Sin lote conforme'} | ubicacion ${resolvedLocationCode || 'N/A'} | vence ${normalizedExpiry || 'N/A'}`,
        `Cerro: ${actors[0]?.nombre || 'Usuario WMS'} | ${closedAt}`,
        'Conciliacion de materiales:',
        ...reconciliation.map(item => [
          `- ${item.sku}: teorico ${item.teorico}, neto entregado ${item.consumo_neto}`,
          `merma proceso ${item.merma_proceso}, uso productivo estimado ${item.uso_productivo_estimado}`,
          `variacion de entrega ${item.variacion}`,
        ].join(' | ')),
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

module.exports = { buildMaterialReconciliation, closeProductionOrder };
