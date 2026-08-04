function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function workflowFlags() {
  return Object.freeze({
    allowPartialDispatch: envFlag('ALLOW_PARTIAL_DISPATCH', false),
    enableBackorderAlerts: envFlag('ENABLE_BACKORDER_ALERTS', false),
    autoReleaseStaleReservations: envFlag('AUTO_RELEASE_STALE_RESERVATIONS', false),
    reserveAvailableOnShortage: envFlag('RESERVE_AVAILABLE_ON_SHORTAGE', true),
    requirePurchaseOrderForSiigoReceipt: envFlag('REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT', true),
    allowSplitProductionLine: envFlag('ALLOW_SPLIT_PRODUCTION_LINE', false),
    allowDirectDispatchRequest: envFlag('ALLOW_DIRECT_DISPATCH_REQUEST', false),
    allowManualReception: envFlag('ALLOW_MANUAL_RECEPTION', false),
  });
}

module.exports = { envFlag, workflowFlags };
