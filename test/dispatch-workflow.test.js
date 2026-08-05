const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDispatchLookup } = require('../api/_lib/dispatch-workflow');

test('resolves a visible Siigo invoice name as either invoice identifier', () => {
  assert.deepEqual(
    buildDispatchLookup({ invoiceId: 'FV-1-10000004804' }),
    {
      clause: '(siigo_invoice_id = ? OR siigo_invoice_name = ?)',
      params: ['FV-1-10000004804', 'FV-1-10000004804'],
    }
  );
});

test('resolves a dispatch number without coercing it to an internal id', () => {
  assert.deepEqual(
    buildDispatchLookup({ dispatchId: 'DSP-SIIGO-FV-1-10000004804' }),
    {
      clause: 'numero = ?',
      params: ['DSP-SIIGO-FV-1-10000004804'],
    }
  );
});

test('resolves a numeric dispatch reference by id or exact dispatch number', () => {
  assert.deepEqual(
    buildDispatchLookup({ dispatchId: '45' }),
    { clause: '(id = ? OR numero = ?)', params: [45, '45'] }
  );
});

test('rejects an empty dispatch lookup', () => {
  assert.throws(
    () => buildDispatchLookup({}),
    error => error.status === 400 && error.message === 'despacho_id o id_factura es obligatorio'
  );
});
