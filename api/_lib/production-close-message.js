function closedProductionMessage(closure, suggestedLocation) {
  const registered = closure.ubicacion || closure.ubicacion_id || 'No aplica';
  const suggestion = closure.qty_real > 0 && suggestedLocation
    ? [`Ubicación sugerida para este SKU: *${suggestedLocation}*${
      String(registered).toUpperCase() === String(suggestedLocation).toUpperCase()
        ? ' (coincide con la registrada)'
        : ' (solo referencia; no se movió inventario)'}`]
    : [];
  return [
    '🏭 ✅ *Producción cerrada*',
    '',
    `Orden: *OP ID ${closure.order_id}* | ${closure.order_code}`,
    `Unidades conformes: ${closure.qty_real}`,
    `No conformes: ${closure.qty_waste}`,
    '',
    '*Materiales repuestos*',
    ...(closure.materiales_repuestos.length
      ? closure.materiales_repuestos.flatMap(item => [
        `• *${item.sku}*: ${item.cantidad} ${item.unidad} · lote de reposición ${item.lote}`,
        `  Causa: ${item.motivo} · ubicación ${item.ubicacion}`,
      ]) : ['• Ninguno']),
    '',
    `Lote PT: ${closure.lpn_terminado || 'Sin lote conforme'}`,
    `Vencimiento: ${closure.fecha_venc || 'No aplica'}`,
    `Ubicación registrada: *${registered}*`,
    ...suggestion,
  ].join('\n');
}

module.exports = { closedProductionMessage };
