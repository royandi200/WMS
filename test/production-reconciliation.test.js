const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMaterialReconciliation } = require('../api/_lib/production-close');

test('separates issued material, process waste and estimated productive use', () => {
  const [result] = buildMaterialReconciliation([{
    producto_id: 51,
    sku: '00051-MPASH',
    nombre: 'Materia prima',
    cantidad_teorica: 3,
    cantidad_consumida: 3,
    cantidad_devuelta: 0,
    cantidad_adicional: 0,
  }], [{ producto_id: 51, merma_proceso: 0.25 }]);
  assert.equal(result.consumo_neto, 3);
  assert.equal(result.merma_proceso, 0.25);
  assert.equal(result.uso_productivo_estimado, 2.75);
  assert.equal(result.variacion, 0);
});

test('keeps reconciliation stable when no process waste was reported', () => {
  const [result] = buildMaterialReconciliation([{
    producto_id: 7,
    sku: '00007-TRG',
    cantidad_teorica: 3,
    cantidad_consumida: 3.25,
    cantidad_devuelta: 0.25,
    cantidad_adicional: 0.25,
  }]);
  assert.equal(result.consumo_neto, 3);
  assert.equal(result.merma_proceso, 0);
  assert.equal(result.uso_productivo_estimado, 3);
  assert.equal(result.variacion, 0);
});
