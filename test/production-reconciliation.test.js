const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMaterialReconciliation,
  deriveProductionExpiry,
  validateProductionCloseQuantities,
} = require('../api/_lib/production-close');

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

test('derives finished-product expiry from the earliest consumed gram lot', () => {
  const result = deriveProductionExpiry([
    { sku: '00051-MPASH', unit_label: 'g', lote: 'GOMA-2', cantidad_neta: 255.75, fecha_venc: '2027-12-31' },
    { sku: '00051-MPASH', unit_label: 'gr', lote: 'GOMA-1', cantidad_neta: 284.25, fecha_venc: '2026-09-30' },
    { sku: '00017-ETASH60', unit_label: 'und', lote: 'ETIQUETA-1', cantidad_neta: 3, fecha_venc: '2026-01-01' },
  ]);
  assert.equal(result.expiryDate, '2026-09-30');
  assert.deepEqual(result.sourceLots.map((row) => row.lote), ['GOMA-2', 'GOMA-1']);
});

test('fails closed when a consumed gram lot has no expiry', () => {
  assert.throws(
    () => deriveProductionExpiry([
      { sku: '00051-MPASH', unit_label: 'g', lote: 'GOMA-SIN-FECHA', cantidad_neta: 10, fecha_venc: null },
    ]),
    /falta el vencimiento del material 00051-MPASH \/ GOMA-SIN-FECHA/u
  );
});

test('finished output cannot exceed the production plan without an exception flow', () => {
  assert.deepEqual(
    validateProductionCloseQuantities({ conforming: 3, waste: 1, planned: 3 }),
    { conforming: 3, waste: 1, planned: 3 }
  );
  assert.throws(
    () => validateProductionCloseQuantities({ conforming: 4, waste: 0, planned: 3 }),
    error => error.status === 409 && /supera el plan/u.test(error.message)
  );
});
