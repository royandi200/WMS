function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePurchaseOrderCancellation(body = {}) {
  const id = Number(body.id || body.orden_compra_id || body.purchase_order_id || 0);
  const reason = String(body.motivo || body.reason || '').trim().replace(/\s+/g, ' ');
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Orden de compra invalida');
  if (reason.length < 5) throw httpError(400, 'El motivo de cancelacion es obligatorio');
  if (reason.length > 500) throw httpError(400, 'El motivo de cancelacion supera 500 caracteres');
  return { id, reason };
}

async function cancelPurchaseOrder(conn, { id, reason, userId }) {
  const [orders] = await conn.execute(
    `SELECT oc.id, oc.numero, oc.estado, oc.motivo_cancelacion, oc.cancelada_en,
            oc.cancelada_por, u.nombre AS cancelada_por_nombre
       FROM ordenes_compra_proveedor oc
       LEFT JOIN usuarios u ON u.id = oc.cancelada_por
      WHERE oc.id = ? LIMIT 1 FOR UPDATE`,
    [id]
  );
  if (!orders.length) throw httpError(404, 'Orden de compra no encontrada');
  const order = orders[0];

  if (order.estado === 'CANCELADA') {
    return { ...order, duplicate: true };
  }
  if (order.estado !== 'CARGADA') {
    throw httpError(409, `La orden ${order.numero} no se puede cancelar en estado ${order.estado}`);
  }

  const [receptions] = await conn.execute(
    `SELECT id, numero, estado FROM recepciones
      WHERE orden_compra_id = ? LIMIT 1 FOR UPDATE`,
    [id]
  );
  if (receptions.length) {
    throw httpError(409, `La orden ${order.numero} ya esta vinculada a la recepcion ${receptions[0].numero}`);
  }

  const [outsourcingOrders] = await conn.execute(
    `SELECT id, codigo, estado FROM ordenes_maquila
      WHERE orden_compra_id = ? LIMIT 1 FOR UPDATE`,
    [id]
  );
  if (outsourcingOrders.length) {
    throw httpError(409, `La orden ${order.numero} ya esta vinculada al proceso 3Q ${outsourcingOrders[0].codigo}`);
  }

  const [updated] = await conn.execute(
    `UPDATE ordenes_compra_proveedor
        SET estado = 'CANCELADA', motivo_cancelacion = ?, cancelada_por = ?,
            cancelada_en = NOW(), actualizado_en = NOW()
      WHERE id = ? AND estado = 'CARGADA'`,
    [reason, userId, id]
  );
  if (updated.affectedRows !== 1) {
    throw httpError(409, 'La orden cambio de estado mientras se intentaba cancelar');
  }

  await conn.execute(
    `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
     VALUES ('purchase_orders', 'INFO', ?, ?, ?, NOW())`,
    [
      `Orden de compra ${order.numero} cancelada`,
      userId,
      JSON.stringify({ orden_compra_id: id, numero: order.numero, estado_anterior: order.estado, motivo: reason }),
    ]
  );

  return {
    id,
    numero: order.numero,
    estado: 'CANCELADA',
    motivo_cancelacion: reason,
    cancelada_por: userId,
    duplicate: false,
  };
}

module.exports = {
  cancelPurchaseOrder,
  normalizePurchaseOrderCancellation,
};
