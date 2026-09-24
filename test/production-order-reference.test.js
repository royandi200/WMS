const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileProductionOrderId } = require('../api/_lib/production-order-reference');

test('accepts common spoken and transcribed forms of a short OP ID', () => {
  for (const text of [
    'Se perdió una unidad de OP ID 97.',
    'Reponer el BOM de OPID97.',
    'Ya alisté la reposición de O P I D 97.',
    'La orden de producción ID 97.',
    'La orden 97.',
  ]) {
    assert.equal(reconcileProductionOrderId({}, text), 97, text);
  }
  assert.equal(reconcileProductionOrderId({ id_orden: 'OP ID 97' }), 97);
  assert.equal(reconcileProductionOrderId({ id_orden: 'OP-20260924-000097' }), 'OP-20260924-000097');
});

test('does not mistake replenishment quantities for an OP ID', () => {
  assert.equal(reconcileProductionOrderId({}, 'Reponer 1 unidad completa por contaminación'), null);
  assert.equal(reconcileProductionOrderId({ id_orden: 97 }, 'Reponer 1 unidad completa'), 97);
});

test('uses the explicit user OP ID when the structured one agrees', () => {
  assert.equal(reconcileProductionOrderId({ id_orden: 'OP ID 97' }, 'OP-20260924-000097'),
    'OP-20260924-000097');
});

test('rejects conflicting or ambiguous OP references before any inventory operation', () => {
  assert.throws(
    () => reconcileProductionOrderId({ id_orden: 98 }, 'Reponer OP ID 97'),
    error => error.status === 409 && /no coincide/u.test(error.message)
  );
  assert.throws(
    () => reconcileProductionOrderId({}, 'OP ID 97 y OP ID 98'),
    error => error.status === 409 && /más de una OP/u.test(error.message)
  );
  assert.throws(
    () => reconcileProductionOrderId({ id_orden: 'ID 97' }),
    error => error.status === 409 && /No pude identificar/u.test(error.message)
  );
});
