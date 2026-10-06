// POST /api/v1/webhook/siigo-invoices — desactivado (ver _lib/siigo-webhook-disabled.js).
// Las facturas de venta se importan con api/v1/siigo/import-invoices.
const { disabledSiigoWebhook } = require('../../_lib/siigo-webhook-disabled');

module.exports = disabledSiigoWebhook('siigo-invoices');
