const LEGACY_MUTATING_APPROVAL_ACTIONS = new Set([
  'SOLICITAR_INICIO_PRODUCCION',
  'SOLICITAR_CIERRE_PRODUCCION',
  'SOLICITAR_DESPACHO',
]);

function isLegacyMutatingApprovalAction(action) {
  return LEGACY_MUTATING_APPROVAL_ACTIONS.has(String(action || '').trim().toUpperCase());
}

function assertApprovalActionSupported(action) {
  const normalized = String(action || '').trim().toUpperCase();
  if (isLegacyMutatingApprovalAction(normalized)) {
    const error = new Error(
      'Esta solicitud pertenece al flujo anterior y no puede modificar inventario. '
      + 'Usa el flujo operativo actual de produccion o el despacho importado desde Siigo.'
    );
    error.status = 409;
    error.code = 'LEGACY_APPROVAL_DISABLED';
    throw error;
  }
  return normalized;
}

module.exports = {
  LEGACY_MUTATING_APPROVAL_ACTIONS,
  assertApprovalActionSupported,
  isLegacyMutatingApprovalAction,
};
