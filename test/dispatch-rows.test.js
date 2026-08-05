const test = require('node:test');
const assert = require('node:assert/strict');

test('groups dispatch history by dispatch while preserving lot detail', async () => {
  const { groupDispatchRows } = await import('../frontend/src/utils/dispatchRows.js');
  const rows = groupDispatchRows([
    {
      id: 45,
      numero: 'DSP-SIIGO-FV-1-10000004804',
      sku: 'WMSQA260721P01',
      lote: 'WMSQA260721LOT01',
      ubicacion: 'PPAL-A-1-01',
      cantidad: 1,
      cantidad_facturada: 2,
    },
    {
      id: 45,
      numero: 'DSP-SIIGO-FV-1-10000004804',
      sku: 'WMSQA260721P01',
      lote: 'WMSQA260722LOT01',
      ubicacion: 'PPAL-A-1-01',
      cantidad: 1,
      cantidad_facturada: 2,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].cantidad, 2);
  assert.equal(rows[0].cantidad_facturada, 2);
  assert.equal(rows[0].lote, '2 lotes');
  assert.deepEqual(rows[0].items.map((item) => item.lote), [
    'WMSQA260721LOT01',
    'WMSQA260722LOT01',
  ]);
});
