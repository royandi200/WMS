const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeProductReference,
  resolveProductReference,
} = require('../api/_lib/product-references');

test('product references normalize speech, accents and punctuation deterministically', () => {
  assert.equal(normalizeProductReference('  Etiqueta ÁSHWA x Sesenta  '), 'etiqueta ashwa x 60');
  assert.equal(normalizeProductReference('Creagums ciento veinte'), 'creagums 120');
  assert.equal(normalizeProductReference('Creagums ciento cuarenta'), 'creagums 140');
});

test('product reference prefers canonical SKU before human aliases', async () => {
  let calls = 0;
  const db = {
    async execute(sql) {
      calls += 1;
      assert.match(sql, /FROM productos p/u);
      return [[{ id: 10, siigo_code: '00102-PTASH60', nombre: 'ASHWAGANDHA 60', modalidad_operativa: 'PR', unit_label: 'und' }]];
    },
  };
  const product = await resolveProductReference(db, '00102-PTASH60');
  assert.equal(product.matched_by, 'sku');
  assert.equal(calls, 1);
});

test('product aliases fail closed when a spoken name is ambiguous', async () => {
  let calls = 0;
  const db = {
    async execute() {
      calls += 1;
      if (calls === 1) return [[]];
      return [[
        { id: 10, siigo_code: '00102-PTASH60', nombre: 'ASHWAGANDHA 60', alias: 'ashwagandha' },
        { id: 11, siigo_code: '00200-PTASH120', nombre: 'ASHWAGANDHA 120', alias: 'ashwagandha' },
      ]];
    },
  };
  await assert.rejects(
    resolveProductReference(db, 'ashwagandha'),
    error => error.status === 409
      && error.code === 'PRODUCT_REFERENCE_AMBIGUOUS'
      && /00102-PTASH60/u.test(error.message)
  );
});

test('product alias resolution can be scoped to products in the active operation', async () => {
  let calls = 0;
  const db = {
    async execute(sql, params) {
      calls += 1;
      assert.match(sql, /p\.id IN \(\?,\?\)/u);
      if (calls === 1) return [[]];
      assert.equal(params[0], 'tapa blanca 60');
      return [[{ id: 1, siigo_code: '00001-TPBI', nombre: 'TAPA BLANCA 60', alias: 'tapa blanca 60' }]];
    },
  };
  const product = await resolveProductReference(db, 'tapa blanca sesenta', { productIds: [1, 2] });
  assert.equal(product.id, 1);
  assert.equal(product.matched_by, 'alias');
});

test('human product references share one resolver across operational workflows', () => {
  const files = [
    '../api/_lib/builderbot-reception.js',
    '../api/_lib/outsourcing-workflow.js',
    '../api/_lib/production-materials.js',
    '../api/_lib/production-workflow.js',
    '../api/_lib/returns-workflow.js',
    '../api/_lib/waste-workflow.js',
    '../api/v1/webhook/builderbot.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source, /resolveProductReference/u, file);
  }
});
