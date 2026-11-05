const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPurchaseOrderPdf } = require('../scripts/qa/demo-pdf');
const { aiDocumentBody } = require('../api/_lib/document-ai-extractor');

function pdfDocument() {
  return {
    content: buildPurchaseOrderPdf({
      number: 'OC-AI-001', supplier: 'Proveedor QA', date: '2026-10-07', title: 'ORDEN DE COMPRA', purpose: 'IA',
      items: [{ sku: '00001-TPBI', description: 'Tapa blanca 60', quantity: 3, unit: 'und' }],
    }),
  };
}

test('without GROQ_API_KEY the body is returned unchanged', async () => {
  delete process.env.GROQ_API_KEY;
  const body = { foo: 1 };
  assert.equal(await aiDocumentBody(pdfDocument(), 'ORDEN_COMPRA', body), body);
});

test('model output fills header and items and flags SKUs absent from the PDF', async (t) => {
  process.env.GROQ_API_KEY = 'test-key';
  t.after(() => { delete process.env.GROQ_API_KEY; });
  t.mock.method(global, 'fetch', async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      referencia_documento: 'OC-AI-001', fecha_documento: '2026-10-07', proveedor_nombre: 'Proveedor QA',
      items: [{ sku: '00001-TPBI', cantidad: 3, unidad: 'und' }, { sku: 'INVENTADO-1', cantidad: 5 }],
    }) } }] }),
  }));
  const result = await aiDocumentBody(pdfDocument(), 'ORDEN_COMPRA', {});
  assert.equal(result.referencia_documento, 'OC-AI-001');
  assert.equal(result.items.length, 2);
  assert.match(result.advertencias[0], /INVENTADO-1/);
});

test('a model failure falls back to the original body', async (t) => {
  process.env.GROQ_API_KEY = 'test-key';
  t.after(() => { delete process.env.GROQ_API_KEY; });
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 429 }));
  const body = { foo: 1 };
  assert.equal(await aiDocumentBody(pdfDocument(), 'ORDEN_COMPRA', body), body);
});

test('description-only rows (SIIGO OC) get a catalog SKU flagged for confirmation', async (t) => {
  process.env.GROQ_API_KEY = 'test-key';
  t.after(() => { delete process.env.GROQ_API_KEY; });
  let sentPrompt = '';
  t.mock.method(global, 'fetch', async (_url, init) => {
    sentPrompt = JSON.parse(init.body).messages[0].content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      items: [
        { sku: '00052-MPCG', sku_por_descripcion: true, descripcion: 'GOMA DE GELATINA - CREATINA', cantidad: 90000 },
        { descripcion: 'PRODUCTO RARO', cantidad: 4 },
      ],
    }) } }] }) };
  });
  const catalog = [{ siigo_code: '00052-MPCG', nombre: 'GOMAS CREAGUMS - CREATINA CREAPURE' }];
  const result = await aiDocumentBody(pdfDocument(), 'ORDEN_COMPRA', {}, catalog);
  assert.match(sentPrompt, /00052-MPCG \| GOMAS CREAGUMS/);
  assert.deepEqual(result.items, [{ sku: '00052-MPCG', descripcion: 'GOMA DE GELATINA - CREATINA', cantidad: 90000 }]);
  assert.match(result.advertencias.join(' '), /asignado por descripcion.*00052-MPCG/);
  assert.match(result.advertencias.join(' '), /PRODUCTO RARO/);
  assert.doesNotMatch(result.advertencias.join(' '), /no aparecen en el PDF/);
});
