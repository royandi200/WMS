function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeProductionCancellation(body = {}) {
  const rawOrder = body.order_id ?? body.id_orden ?? body.production_order_id ?? body.id;
  const orderId = String(rawOrder ?? '').trim();
  const reason = String(body.motivo || body.reason || '').trim().replace(/\s+/gu, ' ');
  if (!orderId || orderId.length > 80) throw httpError(400, 'Orden de produccion invalida');
  if (reason.length < 5) throw httpError(400, 'El motivo de cancelacion es obligatorio');
  if (reason.length > 500) throw httpError(400, 'El motivo de cancelacion supera 500 caracteres');
  return { orderId, reason };
}

async function cancelProductionOrder(conn, { orderId, reason, userId }) {
  const numericId = Number(orderId);
  const [orders] = await conn.execute(
    `SELECT op.id, op.codigo_orden, op.estado, op.fase, op.materiales_conf_en,
            op.producto_id, op.cantidad_planeada, p.siigo_code AS sku, p.nombre AS producto
       FROM ordenes_produccion op
       JOIN productos p ON p.id = op.producto_id
      WHERE op.id = ? OR op.codigo_orden = ?
      LIMIT 1 FOR UPDATE`,
    [Number.isInteger(numericId) && numericId > 0 ? numericId : 0, orderId]
  );
  if (!orders.length) throw httpError(404, 'Orden de produccion no encontrada');
  const order = orders[0];

  if (order.estado === 'CANCELADA') {
    return { ...order, duplicate: true, released_reservations: 0, released_by_unit: [] };
  }
  if (order.estado !== 'APROBADA' || order.fase !== 'F0' || order.materiales_conf_en) {
    throw httpError(
      409,
      `La orden ${order.codigo_orden} no se puede cancelar en estado ${order.estado} y fase ${order.fase}`
    );
  }

  const [allocations] = await conn.execute(
    `SELECT pml.id, pml.stock_id, pml.lote, pml.cantidad_reservada, pm.unidad,
            pml.cantidad_alistada, pml.cantidad_consumida, pml.confirmado_en
       FROM produccion_material_lotes pml
       JOIN produccion_materiales pm ON pm.id = pml.produccion_material_id
      WHERE pm.orden_produccion_id = ?
      ORDER BY pml.id FOR UPDATE`,
    [order.id]
  );
  if (!allocations.length) throw httpError(409, 'La orden no tiene reservas de materiales para liberar');
  if (allocations.some((row) => Number(row.cantidad_alistada || 0) > 0
    || Number(row.cantidad_consumida || 0) > 0 || row.confirmado_en)) {
    throw httpError(409, 'La orden ya tiene materiales confirmados y no puede cancelarse');
  }

  const releasedByUnit = new Map();
  for (const allocation of allocations) {
    const quantity = Number(allocation.cantidad_reservada || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || !allocation.stock_id) {
      throw httpError(409, `La reserva del lote ${allocation.lote} no es valida`);
    }
    const [released] = await conn.execute(
      `UPDATE stock
          SET reservada = reservada - ?, actualizado_en = NOW()
        WHERE id = ? AND reservada >= ?`,
      [quantity, allocation.stock_id, quantity]
    );
    if (released.affectedRows !== 1) {
      throw httpError(409, `No se pudo liberar la reserva del lote ${allocation.lote}`);
    }
    const unit = String(allocation.unidad || 'und').trim().toLowerCase();
    releasedByUnit.set(unit, Number(((releasedByUnit.get(unit) || 0) + quantity).toFixed(4)));
  }

  const auditNote = `Cancelada desde dashboard. Motivo: ${reason}`;
  const [updated] = await conn.execute(
    `UPDATE ordenes_produccion
        SET estado = 'CANCELADA',
            notas = CONCAT_WS('\n', NULLIF(TRIM(notas), ''), ?)
      WHERE id = ? AND estado = 'APROBADA' AND fase = 'F0' AND materiales_conf_en IS NULL`,
    [auditNote, order.id]
  );
  if (updated.affectedRows !== 1) {
    throw httpError(409, 'La orden cambio de estado mientras se intentaba cancelar');
  }

  await conn.execute(
    `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
     VALUES ('produccion', 'INFO', ?, ?, ?, NOW())`,
    [
      `Orden de produccion ${order.codigo_orden} cancelada`,
      userId,
      JSON.stringify({
        orden_produccion_id: order.id,
        codigo_orden: order.codigo_orden,
        estado_anterior: order.estado,
        motivo: reason,
        reservas_liberadas: allocations.length,
        cantidades_liberadas: [...releasedByUnit].map(([unit, quantity]) => ({ unit, quantity })),
      }),
    ]
  );

  return {
    order_id: order.id,
    order_code: order.codigo_orden,
    status: 'CANCELADA',
    sku: order.sku,
    product: order.producto,
    planned_quantity: Number(order.cantidad_planeada),
    reason,
    duplicate: false,
    released_reservations: allocations.length,
    released_by_unit: [...releasedByUnit].map(([unit, quantity]) => ({ unit, quantity })),
  };
}

module.exports = {
  cancelProductionOrder,
  normalizeProductionCancellation,
};
