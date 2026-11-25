const test = require('node:test');
const assert = require('node:assert/strict');
const { inventoryLines } = require('../api/_lib/siigo.invoice-lines');

test('ignora solo los códigos de envío exactos', () => {
  assert.deepEqual(inventoryLines([{ code: 'ENV-1 ' }, { code: 'env-10' }, { code: '127' }]).map(i => i.code), ['env-10', '127']);
  assert.deepEqual(inventoryLines(undefined), []);
});
