const DOCUMENT_ACTIONS = new Set([
  'REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO',
  'REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO',
]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeSameMessageInstruction(value) {
  const instruction = typeof value === 'string' ? value.trim() : '';
  if (!instruction || /^\{[^{}]+\}$/u.test(instruction)) return '';
  return instruction;
}

function assertDocumentHasSameMessageInstruction(action, value) {
  if (!DOCUMENT_ACTIONS.has(String(action || '').toUpperCase())) return '';
  const instruction = normalizeSameMessageInstruction(value);
  if (!instruction) {
    throw httpError(
      400,
      'El documento no fue procesado porque llego sin texto adjunto. Reenvialo con una instruccion en el mismo mensaje, por ejemplo: Orden de compra o Remision de salida a 3Q'
    );
  }
  return instruction;
}

module.exports = {
  DOCUMENT_ACTIONS,
  assertDocumentHasSameMessageInstruction,
  normalizeSameMessageInstruction,
};
