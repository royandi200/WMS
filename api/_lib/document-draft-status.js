const NON_WARNINGS = [
  /^Leyenda de prueba o sin validez comercial no observada\.?$/iu,
];

const REVIEW_ONLY_WARNINGS = [
  /^Proveedor no encontrado de forma inequivoca en el catalogo sincronizado$/iu,
  /^Documento de (?:demostracion|prueba)\s*(?:-|\/)\s*sin validez comercial\.?$/iu,
  /^No se pudo verificar la tabla completa con el texto nativo del PDF;/iu,
  /^No fue posible cotejar automaticamente todas las filas del PDF\./iu,
];

function documentWarningsForReview(warnings = []) {
  return warnings.filter((value) => {
    const warning = String(value || '').trim();
    return warning && !NON_WARNINGS.some((pattern) => pattern.test(warning));
  });
}

function warningRequiresCorrection(value) {
  const warning = String(value || '').trim();
  if (!warning) return false;
  if (NON_WARNINGS.some((pattern) => pattern.test(warning))) return false;
  return !REVIEW_ONLY_WARNINGS.some((pattern) => pattern.test(warning));
}

function documentDraftStatus(warnings = []) {
  return warnings.some(warningRequiresCorrection)
    ? 'REQUIERE_CORRECCION'
    : 'PENDIENTE_REVISION';
}

module.exports = {
  documentWarningsForReview,
  documentDraftStatus,
  warningRequiresCorrection,
};
