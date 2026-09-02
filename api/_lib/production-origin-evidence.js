function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function productionOriginEvidence(userText) {
  const text = normalizeText(userText);
  if (!text) return null;

  const stockPatterns = [
    /\bstock(?: de seguridad)?\b/u,
    /\binventario de seguridad\b/u,
    /\bexistencias de seguridad\b/u,
    /\bpara (?:tener |mantener |reponer )?(?:inventario|existencias)\b/u,
  ];
  const customerPatterns = [
    /\bpedido(?: de| del)? (?:un )?cliente\b/u,
    /\bpedido (?:normal|especifico)\b/u,
    /\borden de compra (?:de |del )?cliente\b/u,
    /\boc (?:de |del )?cliente\b/u,
    /\bpara (?:el )?cliente\b/u,
    /\bpara cumplir (?:una |un )?(?:oc|orden de compra|pedido)\b/u,
  ];

  const mentionsStock = stockPatterns.some(pattern => pattern.test(text));
  const mentionsCustomerOrder = customerPatterns.some(pattern => pattern.test(text));

  if (mentionsStock && mentionsCustomerOrder) return 'AMBIGUOUS';
  if (mentionsStock) return 'STOCK_SEGURIDAD';
  if (mentionsCustomerOrder) return 'OC_CLIENTE';
  return null;
}

function resolveProductionOrigin(userText, claimedOrigin) {
  const evidence = productionOriginEvidence(userText);
  const claimed = String(claimedOrigin || '').trim().toUpperCase();

  if (!evidence || evidence === 'AMBIGUOUS') {
    throw httpError(
      400,
      'Indica si la orden es para stock de seguridad o para un pedido de cliente. No se creo la orden ni se reservo inventario.'
    );
  }
  if (claimed && claimed !== evidence) {
    throw httpError(
      400,
      'El destino interpretado no coincide con tu mensaje. Aclara si es stock de seguridad o pedido de cliente. No se creo la orden.'
    );
  }
  return evidence;
}

module.exports = {
  normalizeText,
  productionOriginEvidence,
  resolveProductionOrigin,
};
