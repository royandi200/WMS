const { Kardex } = require('../models');
const { generateTxId } = require('./generateCodes');

/**
 * Registra un movimiento en el Kardex dentro de una transacción.
 */
async function logKardex({ lotId, productId, userId, action, qty, balanceAfter, reference, notes, approvedBy }, t) {
  return Kardex.create({
    tx_id:        generateTxId(),
    lot_id:       lotId || null,
    product_id:   productId || null,
    user_id:      userId || null,
    action,
    qty,
    balance_after: balanceAfter || null,
    reference:    reference || null,
    notes:        notes || null,
    approved_by:  approvedBy || null
  }, t ? { transaction: t } : {});
}

module.exports = { logKardex };
