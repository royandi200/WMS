const WORD_NUMBERS = Object.freeze({
  UNO: 1, UNA: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5,
  SEIS: 6, SIETE: 7, OCHO: 8, NUEVE: 9, DIEZ: 10,
});

function customerOrderIdFromText(value) {
  const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase().replace(/[^A-Z0-9_-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  const number = '(\\d+|UNO|UNA|DOS|TRES|CUATRO|CINCO|SEIS|SIETE|OCHO|NUEVE|DIEZ)';
  const patterns = [
    new RegExp(`(?:^|[^A-Z0-9_-])(?:PEDIDO|PED(?:\\s+DE\\s+CLIENTE)?|O\\s*C(?:\\s+DE)?\\s+CLIENTE)(?:[\\s-]+(?:ID|NUMERO|NRO))?[\\s-]+${number}(?![A-Z0-9_-])`, 'gu'),
    // Audio frecuente: PEDID1, PEDY1, P E D I D 1 o "pedido p e d y 1".
    // La letra Y puede representar la I; B/P pueden representar la D final.
    new RegExp(`(?:^|[^A-Z0-9_-])P\\s*E\\s*D[\\s-]*(?:[IY][\\s-]*[DBP]?)?[\\s-]*${number}(?![A-Z0-9_-])`, 'gu'),
  ];
  const matches = patterns.flatMap((pattern) => [...text.matchAll(pattern)]
    .map((match) => WORD_NUMBERS[match[1]] || Number(match[1])));
  const unique = [...new Set(matches)].filter((id) => Number.isSafeInteger(id) && id > 0);
  return unique.length === 1 ? unique[0] : null;
}

function reconcileCustomerOrderId(params, currentText) {
  const spoken = customerOrderIdFromText(currentText);
  const supplied = params.pedido_cliente_id ?? params.customer_order_id;
  if (supplied == null || supplied === '') return spoken;
  const selected = Number(supplied);
  if (!Number.isSafeInteger(selected) || selected <= 0 || spoken !== selected) {
    throw Object.assign(new Error('El PED ID interpretado no coincide con el pedido indicado. Repite el PED ID; no se liberó ninguna OP.'), { status: 409 });
  }
  return selected;
}

function reconcileCustomerOrderItemId(params, currentText) {
  const text = String(currentText || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]+/gu, ' ');
  const mentioned = [...text.matchAll(/\bITEM\s*(?:ID|NUMERO|NRO)?\s*(\d+)\b/gu)]
    .map((match) => Number(match[1]));
  const unique = [...new Set(mentioned)];
  if (unique.length > 1) {
    throw Object.assign(new Error('Mencionaste más de un Item ID. Aclara cuál producto deseas producir.'), { status: 409 });
  }
  const spoken = unique[0] || null;
  const supplied = params.pedido_cliente_item_id ?? params.customer_order_item_id;
  if (supplied == null || supplied === '') return spoken;
  if (!spoken || Number(supplied) !== spoken) {
    throw Object.assign(new Error('El Item ID interpretado no coincide con el que indicaste. No se liberó ninguna OP.'), { status: 409 });
  }
  return spoken;
}

module.exports = { customerOrderIdFromText, reconcileCustomerOrderId, reconcileCustomerOrderItemId };
