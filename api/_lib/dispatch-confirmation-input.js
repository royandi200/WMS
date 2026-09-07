const reject = () => Object.assign(new Error(
  'No se confirmo el despacho. Solo se permite confirmar el despacho completo; revisa cantidades y confirma sin restricciones parciales. No se modifico inventario.'
), { status: 409 });

function dispatchConfirmationInput(rawText, params = {}) {
  const text = String(rawText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (!text || /[?\u00bf]/.test(text)
      || !/^(?:por favor[, ]+)?(?:confirm(?:o|a|ar)|despach(?:a|ar)|envi(?:a|ar))\b/i.test(text)
      || /\b(?:no|nunca|cancel\w*|parcial\w*|solo|solamente|unicamente|excepto|menos|resto|pendiente|exclu\w*)\b/i.test(text)
      || ['parcial', 'partial', 'allow_partial', 'partial_dispatch'].some(k => params[k] === true || params[k] === 'true')) throw reject();
  const quantities = [...text.matchAll(/\b(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:unidades?|und|uds|tarros?|cajas?|paquetes?)\b/gi)];
  const words = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  if (quantities.length > 1) throw reject();
  const withoutReferences = text.replace(/\b(?:ID\s*\d+|(?:DSP|FV)-[A-Z0-9-]+)\b/gi, '');
  const remainder = quantities.reduce((s, match) => s.replace(match[0], ''), withoutReferences);
  if (/\d|\b(?:uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|mitad)\b/i.test(remainder)) throw reject();
  // Units without an unambiguous quantity cannot be treated as consent to all.
  if (!quantities.length && /\b(?:unidades?|und|uds|tarros?|cajas?|paquetes?)\b/i.test(text)) throw reject();
  if (!quantities.length) {
    if (params.cantidad != null || params.quantity != null || params.items != null) throw reject();
    return {};
  }
  // Packing units are not equivalent to stock units without a conversion.
  if (/\b(?:cajas?|paquetes?)\b/i.test(quantities[0][0])) throw reject();
  const value = quantities[0][1].toLowerCase();
  const quantity = words[value] || Number(value.replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) throw reject();
  return { expectedQuantity: quantity };
}

function assertDispatchQuantity(items, expectedQuantity) {
  if (expectedQuantity == null) return;
  const total = items.reduce((sum, item) => sum + Number(item.cantidad_sol), 0);
  if (!Number.isFinite(expectedQuantity) || expectedQuantity <= 0
      || new Set(items.map(item => item.producto_id)).size !== 1
      || Math.abs(total - expectedQuantity) > 0.000001) throw reject();
}

module.exports = { dispatchConfirmationInput, assertDispatchQuantity };
