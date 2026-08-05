function normalizeApprovalPayload(payload = {}, product = null) {
  const productId = payload.product_id ?? null;
  return {
    quantity: payload.cantidad ?? payload.qty ?? payload.cantidad_real
      ?? payload.cantidad_planificada ?? payload.cantidad_deseada ?? null,
    lot: payload.id_lote ?? payload.lote ?? payload.lot ?? payload.lpn
      ?? payload.lote_usado ?? payload.lote_sugerido ?? null,
    productName: payload.producto_nombre ?? payload.producto
      ?? payload.id_producto_final ?? payload.id_item ?? payload.sku
      ?? product?.nombre ?? (productId ? `Producto #${productId}` : null),
    sku: payload.siigo_code ?? payload.sku ?? product?.siigo_code ?? null,
    itemId: payload.id_item ?? payload.id_producto_final ?? productId,
    orderId: payload.id_orden ?? null,
    customer: payload.cliente ?? payload.customer ?? payload.cliente_final ?? null,
  };
}

module.exports = { normalizeApprovalPayload };
