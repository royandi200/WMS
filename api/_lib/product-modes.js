const PRODUCT_MODES = Object.freeze({
  INTERNAL: 'PR',
  OUTSOURCED: 'PT',
  IN_OUT: 'IO',
});

function assertInternalProductionProduct(product) {
  if (product?.modalidad_operativa === PRODUCT_MODES.INTERNAL) return product;
  const code = product?.siigo_code || 'Producto';
  const mode = product?.modalidad_operativa || 'SIN_MODALIDAD';
  const error = new Error(
    `${code} tiene modalidad ${mode} y no puede procesarse como produccion interna`
  );
  error.status = 409;
  error.code = 'INVALID_INTERNAL_PRODUCTION_MODE';
  throw error;
}

module.exports = { PRODUCT_MODES, assertInternalProductionProduct };
