const { v4: uuidv4 } = require('uuid');

/**
 * Genera un LPN único para lotes de recepción.
 * Formato: L-YYYYMMDD-XXXX  (ej: L-20260413-A3F2)
 */
function generateLPN(prefix = 'L') {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${date}-${rand}`;
}

/**
 * Genera código para órdenes de producción.
 * Formato: P-YYYYMMDD-XXXX
 */
function generateOrderCode() {
  return generateLPN('P');
}

/**
 * Genera código para solicitudes de aprobación.
 * Formato: REQ-XXXXXXXXXX
 */
function generateRequestCode() {
  return 'REQ-' + uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase();
}

/**
 * Genera código para registros de merma.
 * Formato: MER-XXXXXXXXXX
 */
function generateWasteCode() {
  return 'MER-' + uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase();
}

/**
 * Genera TX-ID para el kardex.
 * Formato: TX-XXXXXXXXXXXXXXXXXX
 */
function generateTxId() {
  return 'TX-' + uuidv4().replace(/-/g, '').toUpperCase();
}

module.exports = { generateLPN, generateOrderCode, generateRequestCode, generateWasteCode, generateTxId };
