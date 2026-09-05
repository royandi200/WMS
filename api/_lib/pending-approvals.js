const GROUP_LABELS = Object.freeze({
  SOLICITAR_INICIO_PRODUCCION: 'Inicio de produccion',
  SOLICITAR_CIERRE_PRODUCCION: 'Cierre de produccion',
  SOLICITAR_DESPACHO: 'Despachos',
  REPORTE_MERMA: 'Mermas',
});

function parsePayload(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try { return JSON.parse(value); } catch { return {}; }
}

function detailLine(row) {
  const payload = parsePayload(row.payload);
  return [
    `- ${row.codigo_solicitud}`,
    payload.id_item || payload.sku ? `Producto: ${payload.id_item || payload.sku}` : null,
    payload.qty || payload.cantidad || payload.cantidad_real
      ? `Cantidad: ${payload.qty || payload.cantidad || payload.cantidad_real}` : null,
    payload.lpn || payload.id_lote || payload.lote
      ? `Lote: ${payload.lpn || payload.id_lote || payload.lote}` : null,
    payload.customer || payload.cliente_destino
      ? `Cliente: ${payload.customer || payload.cliente_destino}` : null,
    payload.codigo_orden || payload.id_orden
      ? `Orden: ${payload.codigo_orden || payload.id_orden}` : null,
    row.operario ? `Solicita: ${row.operario}` : null,
  ].filter(Boolean).join(' | ');
}

function formatPendingApprovals(rows = []) {
  if (!rows.length) return 'Solicitudes pendientes:\n(No hay solicitudes pendientes)';
  const groups = new Map();
  for (const row of rows) {
    const action = String(row.accion || 'OTRA').toUpperCase();
    if (!groups.has(action)) groups.set(action, []);
    groups.get(action).push(row);
  }
  const sections = [...groups.entries()].map(([action, items]) => [
    `*${GROUP_LABELS[action] || action.replace(/_/g, ' ')} (${items.length})${isLegacyMutatingApprovalAction(action) ? ' - flujo anterior, no ejecutable' : ''}:*`,
    ...items.map(detailLine),
  ].join('\n'));
  return [`Solicitudes pendientes (${rows.length}):`, ...sections].join('\n\n');
}

module.exports = { formatPendingApprovals, parsePayload };
const { isLegacyMutatingApprovalAction } = require('./approval-policy');
