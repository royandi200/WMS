const assert = require('node:assert/strict');
const test = require('node:test');
const { enrichItemsFromLineEvidence } = require('../api/_lib/document-evidence-items');

for (const separator of ['\n', ' ']) {
  test(`evidence enrichment never borrows next page header fields (${JSON.stringify(separator)})`, () => {
    const items = [
      { sku: 'SKU-1', quantity: 23, unit: 'und', lot: null, expiryDate: null },
      { sku: 'SKU-2', quantity: 31, unit: 'und', lot: null, expiryDate: null },
    ];
    const pageOne = ['SKU-1', 'Tapas', '23', 'und'].join(separator);
    const pageTwo = ['REMISION A 3Q', 'REF-QA-001', '2026-09-06', 'SKU-2', 'Tarros', '31', 'und', 'LOTE-2', '2028-12-31'].join(separator);
    const result = enrichItemsFromLineEvidence(items, `${pageOne}\n\f\n${pageTwo}`);
    assert.deepEqual(result[0], items[0]);
    assert.equal(result[1].lot, 'LOTE-2');
    assert.equal(result[1].expiryDate, '2028-12-31');
  });
}
