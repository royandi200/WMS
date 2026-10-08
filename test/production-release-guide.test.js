const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceProductionReleaseGuide, correctionFields,
  productionReleaseCancellation, productionReleaseConfirmation, productionReleaseFollowup } =
  require('../api/_lib/production-release-guide');

const products = [
  { id: 60, siigo_code: '00102-PTASH60', nombre: 'ASHWAGANDHA X 60', modalidad_operativa: 'PR' },
  { id: 201, siigo_code: '00201-PTPBS120', nombre: 'PROBIOTICOS X 120', modalidad_operativa: 'PR' },
];
const db = { async execute(sql, params) {
  const term = String(params[1] || params[0] || '').toLowerCase();
  if (sql.includes('LEFT JOIN skus')) return [products.filter(row => row.siigo_code.toLowerCase() === term)];
  if (sql.includes('FROM producto_aliases pa')) return [products.filter(row =>
    term.includes(row.nombre.toLowerCase().split(' ')[0]) || term.includes(row.siigo_code.toLowerCase()))];
  if (sql.includes('LEFT JOIN producto_aliases pa')) return [products];
  throw new Error(`Unexpected SQL: ${sql}`);
} };

test('stock production preview retains corrections and only explicit confirmation returns release data', async () => {
  const first = await advanceProductionReleaseGuide({ db, rawText: 'producir 5 para stock',
    request: { product: '00102-PTASH60', quantity: 5 } });
  assert.equal(first.status, 'PENDING');
  assert.match(first.message, /no se reservaron materiales/u);
  const quantity = await advanceProductionReleaseGuide({ db, draft: first.draft,
    rawText: 'serán 12 unidades' });
  assert.equal(quantity.draft.quantity, 12);
  assert.equal(quantity.draft.sku, first.draft.sku);
  const product = await advanceProductionReleaseGuide({ db, draft: quantity.draft,
    rawText: 'cambia el SKU a 00201-PTPBS120' });
  assert.equal(product.draft.sku, '00201-PTPBS120');
  assert.equal(product.draft.quantity, 12);
  const confirmed = await advanceProductionReleaseGuide({ db, draft: product.draft,
    rawText: 'confirmo crear OP para stock de seguridad' });
  assert.deepEqual(confirmed.release,
    { product: '00201-PTPBS120', quantity: 12, originType: 'STOCK_SEGURIDAD' });
});

test('numeric SKU is not misread as a new quantity', () => {
  assert.deepEqual(correctionFields('cambia a 00201-PTPBS120'),
    { product: '00201-ptpbs120', quantity: null });
  assert.deepEqual(correctionFields('cambia a 12 unidades'),
    { product: null, quantity: 12 });
  assert.deepEqual(correctionFields('corrige cantidad a 100'),
    { product: null, quantity: 100 });
  assert.deepEqual(correctionFields('cambia el producto a probióticos 120 y serán 12 unidades'),
    { product: 'probioticos 120', quantity: 12 });
  assert.deepEqual(correctionFields('corrección: 12 unidades'),
    { product: null, quantity: 12 });
  assert.deepEqual(correctionFields('el SKU 00201-PTPBS120'),
    { product: '00201-ptpbs120', quantity: null });
  assert.deepEqual(correctionFields('The quantity will be 8 units'),
    { product: null, quantity: 8 });
  assert.deepEqual(correctionFields('las unidades eran 7'),
    { product: null, quantity: 7 });
  assert.deepEqual(correctionFields('la cantidad era 7'),
    { product: null, quantity: 7 });
});

test('a negated or quoted confirmation cannot authorize release', () => {
  for (const text of ['no confirmo crear OP', 'ayer dije: confirmo crear OP',
    '¿confirmo crear OP?', 'confirmo crear OP pero cambia a 10 unidades']) {
    assert.equal(productionReleaseConfirmation(text), false, text);
  }
  assert.equal(productionReleaseFollowup('son 20 unidades'), true);
  assert.equal(productionReleaseFollowup('serán doce'), true);
  assert.equal(productionReleaseFollowup('corrección: cantidad a 12'), true);
  assert.equal(productionReleaseFollowup('corrección: 12 unidades'), true);
  assert.equal(productionReleaseFollowup('The quantity will be 8 units'), true);
  assert.equal(productionReleaseFollowup('las unidades eran 7'), true);
  assert.equal(productionReleaseFollowup('cambia el producto a probióticos'), true);
  assert.equal(productionReleaseConfirmation(
    '[Sunday, September 6, 2026 23:34:14]: Confirmo crear OP para stock de seguridad.'), true);
});

test('an unresolved product correction leaves the reviewed OP unchanged', async () => {
  const draft = { status: 'PENDING', sku: '00102-PTASH60',
    name: 'ASHWAGANDHA X 60', quantity: 5 };
  const failingDb = { async execute() {
    const error = new Error('Hay varios productos posibles; indica presentación o SKU.');
    error.status = 409;
    throw error;
  } };
  await assert.rejects(advanceProductionReleaseGuide({ db: failingDb, draft,
    rawText: 'cambia el producto a probióticos' }), /varios productos/u);
  assert.deepEqual(draft, { status: 'PENDING', sku: '00102-PTASH60',
    name: 'ASHWAGANDHA X 60', quantity: 5 });
  const notConfirmed = await advanceProductionReleaseGuide({ db, draft, rawText: 'no confirmo' });
  assert.equal(notConfirmed.status, 'PENDING');
  assert.match(notConfirmed.message, /No liberé la OP/u);
});

test('a spoken OP variant cancels only the pending stock draft, never an OC or a numbered order', async () => {
  const draft = { status: 'PENDING', sku: '00102-PTASH60',
    name: 'ASHWAGANDHA X 60', quantity: 5 };
  for (const phrase of ['cancela esta orden', 'Cancele esta orden',
    'Cancele esta OPF', 'Cancele esta OPE',
    'Cancela esta OB', 'Descarta esta OOB', 'Anule esta OPIB', 'Cancele esta O. P.']) {
    assert.equal(productionReleaseCancellation(phrase), true, phrase);
    assert.equal(productionReleaseFollowup(phrase), true, phrase);
    const result = await advanceProductionReleaseGuide({ db, draft, rawText: phrase });
    assert.equal(result.status, 'CANCELLED', phrase);
    assert.match(result.message, /No se creó la orden/u);
  }
  assert.equal(await advanceProductionReleaseGuide({ db, rawText: 'cancela esta orden' }), null);
  for (const phrase of ['Cancela esta OC', 'Cancela OP ID 115',
    'Cancela el despacho', 'No canceles esta OP']) {
    assert.equal(productionReleaseCancellation(phrase), false, phrase);
  }
});
