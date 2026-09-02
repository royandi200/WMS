function normalizeOutsourcingOrderInput(body = {}) {
  const purchaseOrderId = Number(body.orden_compra_id || body.purchase_order_id || 0);
  const supplierId = Number(body.tercero_id || body.supplier_id || 0);
  const product = String(body.producto_id || body.product_id || body.sku || '').trim();
  const quantity = Number(body.cantidad_objetivo ?? body.quantity ?? body.cantidad);
  const idempotencyKey = String(body.clave_idempotencia || body.idempotency_key || '').trim();
  const hasPurchaseOrder = Number.isInteger(purchaseOrderId) && purchaseOrderId > 0;
  if (!hasPurchaseOrder && (!Number.isInteger(supplierId) || supplierId <= 0)) {
    throw inputError('Debes indicar el maquilador cuando la OC esta pendiente');
  }
  if (!hasPurchaseOrder && (!idempotencyKey || idempotencyKey.length > 100)) {
    throw inputError('clave_idempotencia es obligatoria cuando la OC esta pendiente');
  }
  if (!product) throw inputError('Debes indicar el producto terminado tercerizado');
  if (!Number.isFinite(quantity) || quantity <= 0) throw inputError('La cantidad objetivo debe ser positiva');
  return {
    purchaseOrderId: hasPurchaseOrder ? purchaseOrderId : null,
    supplierId: Number.isInteger(supplierId) && supplierId > 0 ? supplierId : null,
    product,
    quantity: roundQty(quantity),
    idempotencyKey: idempotencyKey || null,
    notes: String(body.notas || body.notes || '').trim() || null,
  };
}

function normalizePurchaseOrderLinkInput(body = {}) {
  const orderId = String(body.orden_maquila_id || body.order_id || '').trim();
  const purchaseOrderId = Number(body.orden_compra_id || body.purchase_order_id || 0);
  if (!orderId) throw inputError('orden_maquila_id es obligatorio');
  if (!Number.isInteger(purchaseOrderId) || purchaseOrderId <= 0) {
    throw inputError('orden_compra_id es obligatorio');
  }
  return { orderId, purchaseOrderId };
}

function normalizeAdditionalShipmentInput(body = {}) {
  const orderId = String(body.orden_maquila_id || body.order_id || '').trim();
  const product = String(body.producto_id || body.product_id || body.sku || '').trim();
  const quantity = Number(body.cantidad ?? body.quantity);
  const reason = String(body.motivo || body.reason || '').trim();
  const idempotencyKey = String(body.clave_idempotencia || body.idempotency_key || '').trim();
  if (!orderId) throw inputError('orden_maquila_id es obligatorio');
  if (!product) throw inputError('Debes indicar el material adicional');
  if (!Number.isFinite(quantity) || quantity <= 0) throw inputError('La cantidad debe ser positiva');
  if (!reason) throw inputError('El motivo del material adicional es obligatorio');
  if (!idempotencyKey || idempotencyKey.length > 100) throw inputError('clave_idempotencia es obligatoria');
  return { orderId, product, quantity: roundQty(quantity), reason, idempotencyKey };
}

function outsourcingStateForReceipt(accepted, target) {
  const received = roundQty(accepted);
  const expected = roundQty(target);
  if (received <= 0) return 'EN_3Q';
  if (received + 0.0001 < expected) return 'RECIBIDA_PARCIAL';
  return 'COMPLETADA';
}

function roundQty(value) {
  return Number(Number(value).toFixed(4));
}

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

module.exports = {
  normalizeOutsourcingOrderInput,
  normalizePurchaseOrderLinkInput,
  normalizeAdditionalShipmentInput,
  outsourcingStateForReceipt,
  roundQty,
};
