const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizePurchaseOrderDocumentInput,
  registerPurchaseOrderDocumentDraft,
  validateBuilderBotDocumentUrl,
  downloadBuilderBotPdf,
} = require('../api/_lib/purchase-order-document-intake');
const { CAPABILITIES, capabilityForAction } = require('../api/_lib/capabilities');

function validInput(overrides = {}) {
  return {
    tipo_documento: 'ORDEN_COMPRA',
    referencia_documento: 'OC-DEMO-20260902-001',
    fecha_documento: '2026-09-02',
    proveedor_nombre: 'Proveedor Demo',
    proveedor_nit: '900123456-7',
    total_unidades: 1500,
    items: [
      { sku: '00051-MPASH', descripcion: 'Gomas Ashwagandha', cantidad: 1500, unidad: 'gr' },
    ],
    ...overrides,
  };
}

test('purchase order PDF extraction is deterministic and grounded in literal evidence', () => {
  const evidence = 'ORDEN DE COMPRA OC-DEMO-20260902-001 00051-MPASH Gomas Ashwagandha 1,500 gr';
  const first = normalizePurchaseOrderDocumentInput(validInput(), { evidenceText: evidence });
  const second = normalizePurchaseOrderDocumentInput({ params: validInput() }, { evidenceText: evidence });
  assert.equal(first.hash, second.hash);
  assert.equal(first.operationalHash, second.operationalHash);
  assert.equal(first.totalUnits, 1500);
  assert.deepEqual(first.warnings, []);
});

test('purchase order extraction fails closed for invented SKU, quantity or ambiguous header', () => {
  const evidence = 'ORDEN DE COMPRA OC-DEMO-20260902-001 00051-MPASH 1500 gr';
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput({
      items: [{ sku: 'SKU-INVENTADO', descripcion: 'Inventado', cantidad: 1500, unidad: 'gr' }],
    }), { evidenceText: evidence }),
    /no aparece literalmente/u
  );
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput({
      items: [{ sku: '00051-MPASH', descripcion: 'Gomas', cantidad: 1501, unidad: 'gr' }],
    }), { evidenceText: evidence }),
    /cantidad 1501/u
  );
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput({ fecha_documento: null })),
    /fecha visible/u
  );
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput({
      items: [{ sku: '00051-MPASH', descripcion: 'Gomas', cantidad: 150, unidad: 'gr' }],
      total_unidades: 150,
    }), { evidenceText: 'OC-DEMO-20260902-001 00051-MPASH 1500 gr' }),
    /cantidad 150/u
  );
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput({
      items: [{ sku: '00051-MPAS', descripcion: 'Gomas', cantidad: 1500, unidad: 'gr' }],
    }), { evidenceText: 'OC-DEMO-20260902-001 00051-MPASH 1500 gr' }),
    /no aparece literalmente/u
  );
});

test('BuilderBot PDF download rejects SSRF targets and accepts only expected storage hosts', () => {
  assert.equal(
    validateBuilderBotDocumentUrl('https://runtime-sessions.s3.us-east-1.amazonaws.com/path/oc.pdf').protocol,
    'https:'
  );
  assert.equal(
    validateBuilderBotDocumentUrl('https://files.builderbot.cloud/path/oc.pdf').hostname,
    'files.builderbot.cloud'
  );
  assert.throws(() => validateBuilderBotDocumentUrl('http://runtime-sessions.s3.amazonaws.com/oc.pdf'), /no esta permitida/u);
  assert.throws(() => validateBuilderBotDocumentUrl('https://127.0.0.1/oc.pdf'), /dominio/u);
  assert.throws(() => validateBuilderBotDocumentUrl('https://example.com/oc.pdf'), /dominio/u);
});

test('BuilderBot PDF download verifies content and produces a stable evidence hash', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('%PDF-1.7\nDEMO\n%%EOF'), {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
  });
  try {
    const document = await downloadBuilderBotPdf(
      'https://runtime-sessions.s3.us-east-1.amazonaws.com/demo/oc.pdf',
      'OC-DEMO.pdf'
    );
    assert.equal(document.name, 'OC-DEMO.pdf');
    assert.equal(document.mimeType, 'application/pdf');
    assert.match(document.hash, /^[a-f0-9]{64}$/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test('document retry is idempotent and performs no writes', async () => {
  const normalized = normalizePurchaseOrderDocumentInput(validInput());
  const calls = [];
  const db = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    execute: async (sql) => {
      calls.push(sql);
      if (/FROM documentos_bodega_borrador/u.test(sql)) {
        return [[{
          id: 91,
          tipo_documento: 'ORDEN_COMPRA',
          referencia_documento: normalized.reference,
          fecha_documento: normalized.documentDate,
          destinatario_nombre: normalized.supplierName,
          proveedor_nit: normalized.supplierTaxId,
          total_unidades: normalized.totalUnits,
          sha256: normalized.hash,
          estado: 'PENDIENTE_REVISION',
          advertencias: null,
          orden_compra_id: null,
          file_count: 1,
        }]];
      }
      throw new Error('An identical retry must not write');
    },
  };
  const result = await registerPurchaseOrderDocumentDraft({ db, body: validInput(), userId: 1 });
  assert.equal(result.duplicate, true);
  assert.equal(result.id, 91);
  assert.equal(result.pdfStored, true);
  assert.ok(calls.includes('commit'));
  assert.ok(!calls.includes('rollback'));
});

test('purchase order document action is reception-scoped and cannot mutate inventory', () => {
  assert.equal(
    capabilityForAction('REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO'),
    CAPABILITIES.RECEPTION_CREATE
  );
  const domain = fs.readFileSync(path.join(__dirname, '../api/_lib/purchase-order-document-intake.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../database/19_purchase_order_document_intake.sql'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/purchase-orders.js'), 'utf8');
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS Documentos BBC.txt'), 'utf8');
  const warehouseDomain = fs.readFileSync(path.join(__dirname, '../api/_lib/warehouse-document-intake.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.doesNotMatch(`${domain}\n${migration}`, /INSERT INTO (stock|movimientos|kardex)/u);
  assert.doesNotMatch(`${domain}\n${migration}`, /UPDATE (stock|lots)/u);
  assert.match(route, /El numero revisado no coincide con la referencia del PDF/u);
  assert.match(route, /estado = 'VINCULADO'/u);
  assert.match(prompt, /REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO/u);
  assert.match(prompt, /REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO/u);
  assert.match(warehouseDomain, /WHERE tipo_documento = \? AND origen = \? AND referencia_documento = \?/u);
  assert.match(webhook, /delete sanitized\.document_text/u);
  assert.match(webhook, /delete sanitized\.document_url/u);
  assert.match(webhook, /builderBotDocumentValue\(rawBody\.document_url\)/u);
});
