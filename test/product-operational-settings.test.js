const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isUsableAlias,
  splitClientLabels,
  parseOptionalNonNegativeNumber,
  parseOptionalDwellDays,
  prepareOperationalSettings,
} = require('../api/_lib/product-operational-settings');

const ROOT = path.join(__dirname, '..');

test('operational settings normalize current spreadsheet conventions', () => {
  assert.equal(isUsableAlias('Descontinuado'), false);
  assert.equal(isUsableAlias('Tapa pequeña'), true);
  assert.deepEqual(
    splitClientLabels('FULFILMENT- MKP- FAMARMATODO-JR-GARNICA-PASTEUR'),
    ['FULFILMENT', 'MKP', 'FARMATODO', 'JR', 'GARNICA', 'PASTEUR']
  );
  assert.equal(parseOptionalNonNegativeNumber('6000'), 6000);
  assert.equal(parseOptionalNonNegativeNumber(''), null);
  assert.equal(parseOptionalDwellDays('15 DIAS'), 15);
  assert.equal(parseOptionalDwellDays('30 días'), 30);
  assert.throws(() => parseOptionalDwellDays('pronto'), /invalida/u);
});

test('the captured Google Sheet source is complete, unique and operationally valid', () => {
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/product-operational-settings-20260921.json'), 'utf8'));
  const rows = prepareOperationalSettings(document);
  assert.equal(rows.length, 119);
  assert.equal(new Set(rows.map(row => row.sku)).size, rows.length);
  assert.ok(rows.filter(row => row.stock_minimo !== null).length > 100);
  assert.ok(rows.filter(row => row.alias).length > 60);
  assert.ok(rows.some(row => row.permanencia_max_dias === 15));
  assert.ok(rows.some(row => row.permanencia_max_dias === 30));
  assert.ok(rows.every(row => row.alias?.toLowerCase() !== 'descontinuado'));
});

test('commercial relationships preserve labels without inventing legal third parties', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'database/35_product_commercial_relationships.sql'), 'utf8');
  assert.match(migration, /tercero_id INT UNSIGNED NULL/u);
  assert.match(migration, /FOREIGN KEY \(tercero_id\).*ON DELETE SET NULL/u);
  assert.match(migration, /UNIQUE KEY uk_producto_relacion/u);
});

test('catalog synchronization is dry-run by default, guarded and inventory-safe', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts/sync-product-operational-settings.js'), 'utf8');
  assert.match(script, /--yes-i-understand-this-changes-the-qa-product-catalog/u);
  assert.match(script, /reportPlan\(source, plan, 'dry-run'\)/u);
  assert.match(script, /writeBackup/u);
  assert.match(script, /UPDATE productos SET/u);
  assert.match(script, /producto_aliases/u);
  assert.match(script, /producto_relaciones_comerciales/u);
  assert.match(script, /google_sheets_sync/u);
  assert.doesNotMatch(script, /UPDATE stock|INSERT INTO kardex|INSERT INTO movimientos/u);
});
