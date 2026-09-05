function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/gu, '""')}"`;
}

function dispatchItems(dispatch) {
  return Array.isArray(dispatch.items) && dispatch.items.length ? dispatch.items : [dispatch];
}

function safeFilePart(value) {
  return String(value || 'despacho').replace(/[^A-Za-z0-9_-]+/gu, '-').slice(0, 80);
}

export function buildDispatchSheetHtml(dispatch) {
  const items = dispatchItems(dispatch);
  const total = items.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.sku || '-')}</td>
      <td>${escapeHtml(item.producto_nombre || '-')}</td>
      <td>${escapeHtml(item.lote || '-')}</td>
      <td>${escapeHtml(item.ubicacion || 'Sin ubicacion')}</td>
      <td class="number">${escapeHtml(Number(item.cantidad || 0).toLocaleString('es-CO', { maximumFractionDigits: 4 }))}</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hoja de despacho ${escapeHtml(dispatch.numero || '')}</title>
<style>
  *{box-sizing:border-box}body{margin:0;color:#17202a;font:13px Arial,sans-serif;background:#eef1f4}.sheet{width:210mm;min-height:270mm;margin:12px auto;padding:14mm;background:#fff}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #f0883e;padding-bottom:12px}.head h1{font-size:24px;margin:0}.muted{color:#65717e}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 28px;margin:22px 0}.label{display:block;color:#65717e;font-size:10px;text-transform:uppercase;margin-bottom:3px}table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #dfe4e8;text-align:left;vertical-align:top}th{font-size:10px;text-transform:uppercase;background:#f5f6f7}.number{text-align:right}.total{margin-top:12px;text-align:right;font-size:16px;font-weight:700}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:75px}.signature{border-top:1px solid #17202a;padding-top:6px}.actions{width:210mm;margin:16px auto;text-align:right}.actions button{border:0;background:#f0883e;color:#fff;padding:10px 16px;font-weight:700;cursor:pointer}@media print{body{background:#fff}.sheet{margin:0;width:auto;min-height:auto;padding:8mm}.actions{display:none}}@page{size:A4 portrait;margin:8mm}
</style></head><body><div class="actions"><button onclick="window.print()">Imprimir o guardar PDF</button></div><main class="sheet">
<div class="head"><div><h1>Hoja de despacho</h1><div class="muted">Documento operativo de alistamiento y entrega</div></div><div><strong>${escapeHtml(dispatch.numero || '-')}</strong><div class="muted">Estado: ${escapeHtml(dispatch.estado || '-')}</div></div></div>
<section class="meta"><div><span class="label">Factura</span>${escapeHtml(dispatch.siigo_invoice_name || '-')}</div><div><span class="label">Cliente</span>${escapeHtml(dispatch.cliente_nombre || '-')}</div><div><span class="label">Fecha</span>${escapeHtml(String(dispatch.despachado_en || dispatch.creado_en || '-').replace('T', ' ').slice(0, 16))}</div><div><span class="label">Referencia WMS</span>${escapeHtml(dispatch.numero || '-')}</div></section>
<table><thead><tr><th>SKU</th><th>Producto</th><th>Lote</th><th>Ubicacion</th><th class="number">Cantidad</th></tr></thead><tbody>${rows}</tbody></table>
<div class="total">Total: ${escapeHtml(total.toLocaleString('es-CO', { maximumFractionDigits: 4 }))}</div>
<section class="signatures"><div class="signature">Preparado por</div><div class="signature">Recibido por</div></section>
</main></body></html>`;
}

export function buildDispatchCsv(dispatch) {
  const header = ['Despacho', 'Factura', 'Cliente', 'SKU', 'Producto', 'Lote', 'Ubicacion', 'Cantidad'];
  const rows = dispatchItems(dispatch).map((item) => [
    dispatch.numero, dispatch.siigo_invoice_name, dispatch.cliente_nombre, item.sku,
    item.producto_nombre, item.lote, item.ubicacion, Number(item.cantidad || 0),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function openBlob(content, type, filename, shouldOpen) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  if (shouldOpen) window.open(url, '_blank', 'noopener,noreferrer');
  else {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function openDispatchSheet(dispatch) {
  openBlob(buildDispatchSheetHtml(dispatch), 'text/html;charset=utf-8', '', true);
}

export function downloadDispatchCsv(dispatch) {
  openBlob(`\ufeff${buildDispatchCsv(dispatch)}`, 'text/csv;charset=utf-8', `despacho-${safeFilePart(dispatch.numero)}.csv`, false);
}

export { escapeHtml };
