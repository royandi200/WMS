const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTA_CODES_OUTSIDE_5_2,
  canonicalize,
  readDataset,
  retainedActaCodes,
} = require('../scripts/import-acta-5-2');

test('acta 5.2 produces the expected canonical dataset', () => {
  const canonical = canonicalize(readDataset());
  assert.equal(canonical.rows.length, 122);
  assert.equal(canonical.modes.size, 30);
  assert.deepEqual(canonical.modeCounts, { PR: 21, PT: 3, IO: 6 });
  assert.equal(canonical.products.length, 75);
  assert.equal(canonical.bomRows.length, 113);
  assert.equal(canonical.duplicates.length, 3);
});

test('IO products classify supply mode without creating self BOM rows', () => {
  const canonical = canonicalize(readDataset());
  const ioProducts = [...canonical.modes]
    .filter(([, mode]) => mode === 'IO')
    .map(([code]) => code);
  assert.equal(ioProducts.length, 6);
  for (const code of ioProducts) {
    assert.equal(canonical.bomRows.some(row => row.producto === code), false);
  }
});

test('internal and outsourced BOM stages remain separated', () => {
  const canonical = canonicalize(readDataset());
  for (const row of canonical.bomRows) {
    const mode = canonical.modes.get(row.producto);
    assert.equal(row.etapa, mode === 'PR' ? 'PRODUCCION' : 'ENVIO');
  }
});

test('only current acta references are retained by the importer', () => {
  const canonical = canonicalize(readDataset());
  const retained = retainedActaCodes(canonical);
  assert.equal(retained.size, 84);
  assert.equal(ACTA_CODES_OUTSIDE_5_2.length, 9);
  assert.equal(retained.has('00102-PTASH60'), true);
  assert.equal(retained.has('00038-CJ12'), true);
  assert.equal(retained.has('00288-VINI'), true);
  assert.equal(retained.has('00053-MPCLP'), false);
  assert.equal(retained.has('00101-PTMCL60'), false);
});
