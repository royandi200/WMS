const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeProductReference,
  resolveProductReference,
  contextualProductMatches,
  scopedApproximateMatches,
} = require('../api/_lib/product-references');

test('product references normalize speech, accents and punctuation deterministically', () => {
  assert.equal(normalizeProductReference('  Etiqueta ÁSHWA x Sesenta  '), 'etiqueta ashwa x 60');
  assert.equal(normalizeProductReference('Creagums ciento veinte'), 'creagums 120');
  assert.equal(normalizeProductReference('Creagums ciento cuarenta'), 'creagums 140');
  assert.equal(normalizeProductReference('tarro cuadrado x60'), 'tarro cuadrado x 60');
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

test('contextual aliases tolerate singular speech only inside an active operation', async () => {
  const rows = [
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', alias: 'tapa blanca' },
    { id: 60, siigo_code: '00051-MPASH', nombre: 'GOMAS ASHWAGANDHA', alias: 'gomas ashwa' },
  ];
  assert.deepEqual(
    contextualProductMatches('goma', rows).map(product => product.siigo_code),
    ['00051-MPASH']
  );
});

test('contextual alias resolution fails closed when several operation materials match', async () => {
  const matches = contextualProductMatches('etiqueta', [
    { id: 27, siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA', alias: null },
    { id: 28, siigo_code: '00018-ETBOS60', nombre: 'ETIQUETA BOOSTER', alias: null },
  ]);
  assert.equal(matches.length, 2);
});

test('resolver uses partial aliases only when explicitly scoped', async () => {
  let calls = 0;
  const db = {
    async execute(sql) {
      calls += 1;
      assert.match(sql, /p\.id IN \(\?,\?\)/u);
      if (calls <= 2) return [[]];
      return [[
        { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', alias: 'tapa blanca' },
        { id: 60, siigo_code: '00051-MPASH', nombre: 'GOMAS ASHWAGANDHA', alias: 'gomas ashwa' },
      ]];
    },
  };
  const product = await resolveProductReference(db, 'goma', {
    productIds: [19, 60],
    allowContextualPartial: true,
  });
  assert.equal(product.siigo_code, '00051-MPASH');
  assert.equal(product.matched_by, 'contextual_alias');
  assert.equal(calls, 3);
});

test('scoped reception references tolerate one transcription error only when unique', () => {
  const rows = [
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', alias: 'tapa pequeña' },
    { id: 60, siigo_code: '00051-MPASH', nombre: 'GOMAS ASHWAGANDHA', alias: 'gomas ashwa' },
  ];
  assert.deepEqual(scopedApproximateMatches('etapa', rows).map(row => row.siigo_code), ['00001-TPBI']);
  assert.deepEqual(scopedApproximateMatches('etapa', [
    ...rows,
    { id: 20, siigo_code: '00004-TPALB', nombre: 'TAPA ALTA BLANCA', alias: 'tapa alta' },
  ]).map(row => row.siigo_code), ['00001-TPBI', '00004-TPALB']);
  assert.deepEqual(scopedApproximateMatches('00001-TPB1', rows), []);
});

test('approximate product matching needs an active product scope', async () => {
  let calls = 0;
  const rows = [
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', alias: 'tapa pequeña' },
    { id: 60, siigo_code: '00051-MPASH', nombre: 'GOMAS ASHWAGANDHA', alias: 'gomas ashwa' },
  ];
  const db = { async execute() { calls += 1; return calls < 3 ? [[]] : [rows]; } };
  const product = await resolveProductReference(db, 'etapa', {
    productIds: [19, 60],
    allowContextualPartial: true,
    allowScopedApproximate: true,
  });
  assert.equal(product.siigo_code, '00001-TPBI');
  assert.equal(product.matched_by, 'scoped_approximate');
  assert.equal(calls, 3);
  const unscopedDb = { async execute() { return [[]]; } };
  await assert.rejects(
    resolveProductReference(unscopedDb, 'etapa', { allowContextualPartial: true, allowScopedApproximate: true }),
    error => error.code === 'PRODUCT_REFERENCE_NOT_FOUND'
  );
});

test('ambiguous approximate reception reference refuses to select a SKU', async () => {
  let calls = 0;
  const rows = [
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO' },
    { id: 20, siigo_code: '00004-TPALB', nombre: 'TAPA ALTA BLANCA' },
  ];
  const db = { async execute() { calls += 1; return calls < 3 ? [[]] : [rows]; } };
  await assert.rejects(
    resolveProductReference(db, 'etapa', {
      productIds: [19, 20],
      allowContextualPartial: true,
      allowScopedApproximate: true,
    }),
    error => error.code === 'PRODUCT_REFERENCE_AMBIGUOUS'
  );
});

test('stock queries can explicitly resolve a unique contextual alias across the catalog', async () => {
  let calls = 0;
  const db = {
    async execute(sql) {
      calls += 1;
      if (calls <= 2) return [[]];
      assert.match(sql, /LIMIT 500/u);
      return [[
        { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO (60 UNID)', alias: 'tapa pequeña' },
        { id: 20, siigo_code: '00006-TRP', nombre: 'TARRO CUADRADO x 60', alias: 'tarro pequeño' },
      ]];
    },
  };
  const product = await resolveProductReference(db, 'tarros cuadrados x60', {
    allowContextualPartial: true,
    allowCatalogContextual: true,
  });
  assert.equal(product.siigo_code, '00006-TRP');
  assert.equal(product.matched_by, 'contextual_alias');
});

test('stock webhook enables catalog contextual matching only for the read-only stock query', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(source, /allowCatalogContextual: true/u);
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
