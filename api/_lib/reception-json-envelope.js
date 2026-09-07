const { currentText, legacyMessageText } = require('./additional-operation-input');

function recoverReceptionPreview(candidate, rawBody) {
  if (typeof candidate !== 'string' || candidate.length > 32000) return null;
  // Only the two observed closing-bracket errors. Never repair values, strings,
  // commas, truncated content or an arbitrary operational JSON payload.
  const suffix = candidate.match(/\}\]\}\}\}(?:\s*)$|\}\]\}\}\]\}\}(?:\s*)$/);
  if (!suffix) return null;
  let value;
  try { value = JSON.parse(candidate.slice(0, suffix.index) + '}]}]}}'); }
  catch { return null; }
  const p = value?.params;
  const text = currentText(rawBody, {});
  if (value?.['@ction'] !== 'CONFIRMAR_RECEPCION_OC' || p?.confirmacion_final !== false
      || !text || /\bconfirm\w*/i.test(text)
      || !/\brecepci[o\u00f3]n\b/i.test(text)
      || typeof value.body !== 'string' || legacyMessageText(value.body).trim() !== text.trim()
      || !Number.isSafeInteger(p.orden_compra_id) || p.orden_compra_id <= 0
      || !new RegExp(`\\bID\\s+${p.orden_compra_id}\\b`, 'i').test(text)
      || !Array.isArray(p.items) || p.items.length !== 1) return null;
  const item = p.items[0];
  const dist = item?.distribuciones;
  if (!item?.sku || !Array.isArray(dist) || dist.length < 2 || dist.length > 4
      || typeof item.cantidad_recibida !== 'number' || !Number.isFinite(item.cantidad_recibida)
      || dist.some(d => !d || typeof d.cantidad !== 'number' || !Number.isFinite(d.cantidad) || d.cantidad <= 0
        || !['DISPONIBLE', 'CUARENTENA', 'RECHAZADO', 'PENDIENTE_DISPOSICION'].includes(d.condicion)
        || !d.lote || !d.ubicacion || !d.fecha_vencimiento
        || (d.condicion !== 'DISPONIBLE' && !d.motivo))
      || Math.abs(dist.reduce((sum, d) => sum + d.cantidad, 0) - item.cantidad_recibida) > 0.000001) return null;
  return value;
}

module.exports = { recoverReceptionPreview };
