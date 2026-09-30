const MAX_ROWS = 10;
const MAX_MESSAGE_CHARS = 1400;

function compact(value, maxLength) {
  const text = String(value || 'N/A').replace(/\s+/gu, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function buildPendingReceptionsMessage({ available = [], outsourcing = [], formatDateOnly }) {
  const reservedOutsourcing = outsourcing.length ? Math.min(2, outsourcing.length) : 0;
  const directCandidates = available.slice(0, MAX_ROWS - reservedOutsourcing);
  const outsourcingCandidates = outsourcing.slice(0, MAX_ROWS - directCandidates.length);
  const directRows = directCandidates.map(order => ({
      kind: 'direct',
      order,
      line: `${order.tipo_recepcion === 'IN_OUT' ? 'IO' : 'OC'} ID ${Number(order.id)} | `
        + `${compact(order.numero, 60)} | ${compact(order.proveedor_nombre, 34)} | `
        + `${order.items.length} SKU | ${compact(formatDateOnly(order.fecha_orden), 12)}`
        + `${order.estado === 'RECIBIDA_PARCIAL' ? ' | parcial' : ''}`,
    }));
  const outsourcingRows = outsourcingCandidates.map(order => ({
      kind: 'outsourcing',
      order,
      line: `MQ ID ${Number(order.id)} | ${compact(order.codigo, 48)} | `
        + `${compact(order.proveedor_nombre || '3Q', 30)} | `
        + `${compact(order.sku, 30)} | ${Number(order.cantidad_pendiente)} ${compact(order.unidad, 8)} pend.`,
    }));
  const candidates = [
    ...directRows.slice(0, 3),
    ...outsourcingRows,
    ...directRows.slice(3),
  ];
  function render(items) {
    const first = items[0];
    const example = first?.kind === 'outsourcing'
      ? `Prepara la recepción MQ ID ${first.order.id} por ${first.order.cantidad_pendiente} ${first.order.unidad}`
      : first ? `Prepara ${first.order.tipo_recepcion === 'IN_OUT' ? 'IO' : 'OC'} ID ${first.order.id}` : null;
    return [
      `*Recepciones pendientes (${items.length} mostradas)*`,
      ...items.map(item => item.line),
      ...(items.length < available.length + outsourcing.length
        ? ['Hay más órdenes pendientes; si conoces su ID, puedes prepararla directamente.'] : []),
      ...(example ? [`Para ver los productos de una orden, escribe por ejemplo: ${example}. Prepararla no modifica inventario.`] : []),
    ].join('\n');
  }
  const shown = [];
  for (const candidate of candidates) {
    if (render(shown.concat(candidate)).length > MAX_MESSAGE_CHARS) break;
    shown.push(candidate);
  }
  const shownAvailable = shown.filter(item => item.kind === 'direct').map(item => item.order);
  const shownOutsourcing = shown.filter(item => item.kind === 'outsourcing').map(item => item.order);
  const message = render(shown);
  if (message.length > MAX_MESSAGE_CHARS) throw new Error('El resumen de recepciones supera el límite interno');
  return { message, shownAvailable, shownOutsourcing };
}

module.exports = { buildPendingReceptionsMessage, MAX_MESSAGE_CHARS };
