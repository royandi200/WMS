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

test('SIIGO purchase order rows are read without AI and matched only when clear', () => {
  const { siigoPurchaseOrderItems } = require('../api/_lib/document-pdf-headers');
  const tokens = ['Ítem', 'Descripción', 'Vr. Total',
    '1', 'ETIQUETA ASHWAGANDHA LB X80', '3,000.00', '458.00', '0.00', '19 %', '2,5 %', '1,600,710.00',
    '2', 'FUNDA NAPS', 'VINAGRE', '1,000.00', '990.00', '0.00', '19 %', '2,5 %', '1,153,350.00',
    'Observaciones:', 'Total Bruto'];
  const items = siigoPurchaseOrderItems(tokens, [
    { siigo_code: '00031-ETLBASH', nombre: 'ETIQUETA AZUL ASHWAGANDHA LINEA BLANCA x 60' },
    { siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA x 60' },
    { siigo_code: '00009-ETVM60', nombre: 'ETIQUETA VINAGRE DE MANZANA x 60' },
    { siigo_code: '000-34FLB', nombre: 'FUNDAS LINEA BLANCA' },
  ]);
  assert.deepEqual(items.map((item) => [item.cantidad, item.sku, item.descripcion]), [
    [3000, '00031-ETLBASH', 'ETIQUETA ASHWAGANDHA LB X80'],
    [1000, undefined, 'FUNDA NAPS VINAGRE'],
  ]);
});

test('SIIGO OC row picks the catalog product with the same printed name', () => {
  const { siigoPurchaseOrderItems } = require('../api/_lib/document-pdf-headers');
  const tokens = ['Vr. Total', '1', 'GOMA DE GELATINA - CREATINA, FOS Y', 'PROBIOTICOS', '90,000.00', '193.00', 'Observaciones:'];
  const items = siigoPurchaseOrderItems(tokens, [
    { siigo_code: '00052-MPCG', nombre: 'GOMAS CREAGUMS - CREATINA CREAPURE' },
    { siigo_code: '00050-MPRO', nombre: 'GOMAS PROBIOTICOS' },
    { siigo_code: '58398789001', nombre: 'GOMA DE GELATINA - CREATINA, FOS Y PROBIOTICOS' },
    { siigo_code: '5839878900', nombre: 'GOMA DE GELATINA - CREATINA' },
  ]);
  assert.equal(items[0].sku, '58398789001');
});

test('purchase order rows without an equivalent product are kept as por asignar', () => {
  const { normalizePurchaseOrderDocumentInput } = require('../api/_lib/purchase-order-document-intake');
  const evidence = 'ORDEN DE COMPRA\nNo. OC-1-353\nFecha\t2026-10-14\nTAMPOGRAFIA SEGUN DISEÑO\t10,000.00\n';
  const result = normalizePurchaseOrderDocumentInput({
    tipo_documento: 'ORDEN_COMPRA', referencia_documento: 'OC-1-353', fecha_documento: '2026-10-14',
    proveedor_nombre: 'Proveedor', items: [{ sku: '', por_asignar: true, descripcion: 'TAMPOGRAFIA SEGUN DISEÑO', cantidad: 10000 }],
  }, { evidenceText: evidence });
  assert.equal(result.items[0].sku, '');
  assert.equal(result.items[0].pending, true);
  assert.throws(() => normalizePurchaseOrderDocumentInput({
    tipo_documento: 'ORDEN_COMPRA', referencia_documento: 'OC-1-353', fecha_documento: '2026-10-14',
    proveedor_nombre: 'Proveedor', items: [{ sku: '', descripcion: 'X', cantidad: 1 }],
  }), /requiere SKU/);
});
