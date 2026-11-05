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

test('a quantity equal to a numeric catalog code does not drop its row', async () => {
  const pdf = buildPurchaseOrderPdf({
    number: 'OC-NUMERIC-CODE-001',
    supplier: 'Proveedor QA',
    date: '2026-10-07',
    title: 'ORDEN DE COMPRA',
    purpose: 'Codigos numericos SIIGO',
    items: [
      { sku: '00001-TPBI', description: 'Tapa blanca 60', quantity: 3, unit: 'und' },
      { sku: '00006-TRP', description: 'Tarro cuadrado 60', quantity: 2, unit: 'und' },
      { sku: '12', description: 'Muebles de carton', quantity: 12, unit: 'und' },
    ],
  });
  const extracted = await extractPdfTextLayer(pdf);
  const catalog = [...PRODUCTS, { siigo_code: '2', nombre: 'Servicios' }, { siigo_code: '12', nombre: 'Muebles' }];
  const items = deriveCatalogItemsFromPdfTokens(extracted.tokens, catalog);
  assert.deepEqual(items.map(item => [item.sku, item.cantidad]), [['00001-TPBI', 3], ['00006-TRP', 2], ['12', 12]]);
});

test('table rows with SKUs outside the catalog are reported, not silently dropped', async () => {
  const { unmatchedTableRowCodes } = require('../api/_lib/pdf-text-layer');
  const pdf = buildPurchaseOrderPdf({
    number: 'OC-UNKNOWN-SKU-001',
    supplier: 'Proveedor QA',
    date: '2026-10-07',
    title: 'ORDEN DE COMPRA',
    purpose: 'SKU inexistente',
    items: [
      { sku: '00001-TPBI', description: 'Tapa blanca 60', quantity: 5, unit: 'und' },
      { sku: '99999-NOEXISTE', description: 'Insumo que no existe', quantity: 7, unit: 'und' },
    ],
  });
  const extracted = await extractPdfTextLayer(pdf);
  assert.deepEqual(unmatchedTableRowCodes(extracted.text, PRODUCTS), ['99999-NOEXISTE']);
});

test('SIIGO purchase order headers are recovered from the printed layout', () => {
  const { recoverSiigoPurchaseOrderHeaders } = require('../api/_lib/document-pdf-headers');
  const text = 'Orden de compra\nNo. OC-1-354\nALNATURE NUTRITION LAB\nPara\nINFINITY BRANDS SAS\tSAS\nNit 901.189.721-2\nNit\t901.600.946-5\nFecha\t2026-10-16\n';
  const result = recoverSiigoPurchaseOrderHeaders({ tipo_documento: 'ORDEN_COMPRA' }, text);
  assert.equal(result.referencia_documento, 'OC-1-354');
  assert.equal(result.fecha_documento, '2026-10-16');
  assert.equal(result.proveedor_nit, '901.600.946-5');
});

test('SIIGO purchase order rows are read without AI and matched by name', () => {
  const { siigoPurchaseOrderItems } = require('../api/_lib/document-pdf-headers');
  const text = 'Ítem\tDescripción\tCantidad\tVr. Total\nUnitario\tdesc.\tCargo\tRete.\nGOMA DE GELATINA - CREATINA, FOS Y\t90,000.00\t19 %\t2,5 %\n193.00\t0.00\t20,236,050.00\n1\nPROBIOTICOS\nTotal Bruto\t17,370,000.00\n';
  const items = siigoPurchaseOrderItems(text, [
    { siigo_code: '00052-MPCG', nombre: 'GOMAS CREAGUMS - CREATINA CREAPURE' },
    { siigo_code: '00050-MPRO', nombre: 'GOMAS PROBIOTICOS' },
    { siigo_code: '00001-TPBI', nombre: 'TAPA BLANCA' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].descripcion, 'GOMA DE GELATINA - CREATINA, FOS Y PROBIOTICOS');
  assert.equal(items[0].cantidad, 90000);
  assert.ok(['00052-MPCG', '00050-MPRO'].includes(items[0].sku));
  assert.equal(items[0].alternativas.length, 1);
});
