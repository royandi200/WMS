const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeApprovalPayload } = require('../api/_lib/approval-view');

test('normalizes legacy dispatch approval details', () => {
  const result = normalizeApprovalPayload({
    lpn: 'TEST_AGENT-PTASH-DISP',
    qty: 10,
    customer: 'Cliente QA',
    product_id: 74,
  }, { id: 74, nombre: 'PRODUCTO TERMINADO ASHWAGANDHA X 60', siigo_code: '00102-PTASH60' });
  assert.deepEqual(result, {
    quantity: 10,
    lot: 'TEST_AGENT-PTASH-DISP',
    productName: 'PRODUCTO TERMINADO ASHWAGANDHA X 60',
    sku: '00102-PTASH60',
    itemId: 74,
    orderId: null,
    customer: 'Cliente QA',
  });
});
