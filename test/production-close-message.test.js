const test = require('node:test');
const assert = require('node:assert/strict');
const { closedProductionMessage } = require('../api/_lib/production-close-message');

const closure = {
  order_id: 102, order_code: 'OP-20260925-000102', qty_real: 3, qty_waste: 0,
  materiales_repuestos: [], lpn_terminado: 'LPN-OP-20260925-000102',
  fecha_venc: '2027-09-30', ubicacion: 'C2',
};

test('el cierre confirmado muestra la ubicación real y su sugerencia coincidente', () => {
  const message = closedProductionMessage(closure, 'C2');
  assert.match(message, /Ubicación registrada: \*C2\*/u);
  assert.match(message, /Ubicación sugerida para este SKU: \*C2\* \(coincide con la registrada\)/u);
});

test('una sugerencia distinta no da a entender que el inventario se movió', () => {
  const message = closedProductionMessage({ ...closure, ubicacion: 'B16' }, 'C2');
  assert.match(message, /Ubicación registrada: \*B16\*/u);
  assert.match(message, /Ubicación sugerida para este SKU: \*C2\* \(solo referencia; no se movió inventario\)/u);
});

test('sin producto conforme no sugiere una ubicación ni inventa un lote', () => {
  const message = closedProductionMessage({ ...closure, qty_real: 0, qty_waste: 3,
    ubicacion: null, lpn_terminado: null }, 'C2');
  assert.match(message, /Ubicación registrada: \*No aplica\*/u);
  assert.doesNotMatch(message, /Ubicación sugerida/u);
});
