const DOCUMENT_TYPES = Object.freeze({
  PURCHASE_ORDER: 'ORDEN_COMPRA',
  OUTSOURCING_EXIT: 'SALIDA_BODEGA_3Q',
});

function normalizeMarkerText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectDocumentTypeMarkers(evidenceText) {
  const text = normalizeMarkerText(evidenceText);
  const purchaseOrder = /(?:^| )ORDEN DE COMPRA(?: |$)/u.test(text)
    || /(?:^| )TIPO DOCUMENTO WMS ORDEN COMPRA(?: |$)/u.test(text);
  const outsourcingExit = /(?:^| )REMISION(?: DE INVENTARIO)? (?:A|HACIA) 3 ?Q(?: |$)/u.test(text)
    || /(?:^| )SALIDA DE BODEGA (?:A|HACIA) 3 ?Q(?: |$)/u.test(text)
    || /(?:^| )TIPO DOCUMENTO WMS REMISION 3 ?Q(?: |$)/u.test(text);
  return { purchaseOrder, outsourcingExit };
}

function assertDocumentTypeMarker(expectedType, evidenceText) {
  if (!String(evidenceText || '').trim()) return;
  const markers = detectDocumentTypeMarkers(evidenceText);
  if (markers.purchaseOrder && markers.outsourcingExit) {
    throw inputError('El PDF contiene marcadores contradictorios de orden de compra y remision a 3Q');
  }
  if (expectedType === DOCUMENT_TYPES.PURCHASE_ORDER && !markers.purchaseOrder) {
    throw inputError('El PDF debe incluir el encabezado visible ORDEN DE COMPRA');
  }
  if (expectedType === DOCUMENT_TYPES.OUTSOURCING_EXIT && !markers.outsourcingExit) {
    throw inputError('El PDF debe incluir el encabezado visible SALIDA DE BODEGA HACIA 3Q o REMISION A 3Q');
  }
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

module.exports = {
  DOCUMENT_TYPES,
  assertDocumentTypeMarker,
  detectDocumentTypeMarkers,
  normalizeMarkerText,
};
