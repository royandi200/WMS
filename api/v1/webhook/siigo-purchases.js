// POST /api/v1/webhook/siigo-purchases — desactivado (ver _lib/siigo-webhook-disabled.js).
// El ingreso nace de la OC del WMS y su recepción física.
const { disabledSiigoWebhook } = require('../../_lib/siigo-webhook-disabled');

module.exports = disabledSiigoWebhook('siigo-purchases');
