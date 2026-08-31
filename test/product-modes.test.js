const test = require('node:test');
const assert = require('node:assert/strict');
const { assertInternalProductionProduct } = require('../api/_lib/product-modes');

test('internal production accepts only PR products', () => {
  const product = { siigo_code: 'PR-OK', modalidad_operativa: 'PR' };
  assert.equal(assertInternalProductionProduct(product), product);
});

for (const mode of ['PT', 'IO', null]) {
  test(`internal production rejects ${mode || 'missing'} mode`, () => {
    assert.throws(
      () => assertInternalProductionProduct({ siigo_code: 'NOT-PR', modalidad_operativa: mode }),
      error => error.status === 409 && error.code === 'INVALID_INTERNAL_PRODUCTION_MODE'
    );
  });
}
