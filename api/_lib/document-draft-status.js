const REVIEW_ONLY_WARNINGS = [
  /^Proveedor no encontrado de forma inequivoca en el catalogo sincronizado$/iu,
];

function warningRequiresCorrection(value) {
  const warning = String(value || '').trim();
  if (!warning) return false;
  return !REVIEW_ONLY_WARNINGS.some((pattern) => pattern.test(warning));
}

function documentDraftStatus(warnings = []) {
  return warnings.some(warningRequiresCorrection)
    ? 'REQUIERE_CORRECCION'
    : 'PENDIENTE_REVISION';
}

module.exports = {
  documentDraftStatus,
  warningRequiresCorrection,
};
