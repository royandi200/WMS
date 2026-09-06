const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPurchaseOrderPdf, buildWarehouseExitPdf } = require('../scripts/qa/demo-pdf');
const {
  deriveCatalogItemsFromPdfTokens,
  extractPdfTextLayer,
  parseNumberToken,
  preferNativeItems,
} = require('../api/_lib/pdf-text-layer');

const PRODUCTS = [
  { siigo_code: '00001-TPBI', nombre: 'Tapa blanca 60' },
  { siigo_code: '00006-TRP', nombre: 'Tarro cuadrado 60' },
];

test('native PDF text extraction recovers every catalog row omitted by the model', async () => {
  const pdf = buildPurchaseOrderPdf({
    number: 'OC-NATIVE-001',
    supplier: 'Proveedor QA',
    date: '2026-09-06',
    title: 'ORDEN DE COMPRA',
    purpose: 'Recepcion de prueba',
    items: [
      { sku: '00001-TPBI', description: 'Tapa blanca 60', quantity: 37, unit: 'und', documentLot: 'LOT-TPBI-01', documentExpiry: '2028-01-31' },
      { sku: '00006-TRP', description: 'Tarro cuadrado 60', quantity: 43, unit: 'und', documentLot: 'LOT-TRP-01', documentExpiry: '2028-02-29' },
    ],
  });
  const extracted = await extractPdfTextLayer(pdf);
  const nativeItems = deriveCatalogItemsFromPdfTokens(extracted.tokens, PRODUCTS);
  assert.equal(extracted.pages, 1);
  assert.match(extracted.text, /ORDEN DE COMPRA/u);
  assert.deepEqual(nativeItems.map((item) => ({
    sku: item.sku, cantidad: item.cantidad, unidad: item.unidad,
    lote: item.lote, fecha_vencimiento: item.fecha_vencimiento,
  })), [
    { sku: '00001-TPBI', cantidad: 37, unidad: 'und', lote: 'LOT-TPBI-01', fecha_vencimiento: '2028-01-31' },
    { sku: '00006-TRP', cantidad: 43, unidad: 'und', lote: 'LOT-TRP-01', fecha_vencimiento: '2028-02-29' },
  ]);

  const modelBody = { params: { items: [{ ...nativeItems[0], precio_unitario: 1250 }] } };
  const recovered = preferNativeItems(modelBody, nativeItems).params.items;
  assert.equal(recovered.length, 2);
  assert.equal(recovered[0].precio_unitario, 1250);
});

test('native extraction also understands a 3Q warehouse exit without lot data', async () => {
  const pdf = buildWarehouseExitPdf({
    number: 'REM-NATIVE-001', recipient: '3Q', date: '2026-09-06', sender: 'Sofi', totalPackages: 2,
    items: [
      { sku: '00001-TPBI', description: 'Tapa blanca 60', quantity: 12, unit: 'und' },
      { sku: '00006-TRP', description: 'Tarro cuadrado 60', quantity: 14, unit: 'und' },
    ],
  });
  const extracted = await extractPdfTextLayer(pdf);
  const items = deriveCatalogItemsFromPdfTokens(extracted.tokens, PRODUCTS);
  assert.deepEqual(items.map((item) => [item.sku, item.cantidad, item.unidad]), [
    ['00001-TPBI', 12, 'und'],
    ['00006-TRP', 14, 'und'],
  ]);
});

test('ambiguous formatted quantities are not guessed', () => {
  assert.equal(parseNumberToken('1200'), 1200);
  assert.equal(parseNumberToken('0,25'), 0.25);
  assert.equal(parseNumberToken('1.200'), null);
});
