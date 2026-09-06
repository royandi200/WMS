const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nativePdfEvidence } = require('../api/_lib/document-pdf-evidence');
const { quantityTotals } = require('../api/_lib/quantity-totals');

test('R11 native PDF recovers all eleven references without a declared row count or total', async () => {
  const directory = path.join(__dirname, '../output/pdf/regresion-documental/20260906-r11');
  const [expected] = JSON.parse(fs.readFileSync(path.join(directory, 'expected.json'), 'utf8'));
  const db = { execute: async sql => {
    assert.match(sql, /^SELECT siigo_code, nombre/);
    return [expected.items.map(item => ({ siigo_code: item.sku, nombre: item.descripcion }))];
  } };
  const result = await nativePdfEvidence(db, { content: fs.readFileSync(path.join(directory, expected.archivo)) }, { items: [] });
  assert.equal(result.pages, 2);
  assert.equal(result.diagnostics.status, 'NATIVE_APPLIED');
  assert.equal(result.body.items.length, 11);
  const pick = items => items.map(({sku, cantidad, unidad, lote, fecha_vencimiento}) => ({sku, cantidad, unidad, lote, fecha_vencimiento}));
  assert.deepEqual(pick(result.body.items), expected.items.map(({descripcion, vencimiento, ...item}) => ({...item, fecha_vencimiento: vencimiento})));
  assert.deepEqual(quantityTotals(result.body.items), [{ unit: 'g', quantity: 8753 }, { unit: 'und', quantity: 406 }]);
});
