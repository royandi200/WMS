// POST /api/v1/webhook/siigo-credit-notes — desactivado (ver _lib/siigo-webhook-disabled.js).
const { disabledSiigoWebhook } = require('../../_lib/siigo-webhook-disabled');

module.exports = disabledSiigoWebhook('siigo-credit-notes');
