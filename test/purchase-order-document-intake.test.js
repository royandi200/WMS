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

test('purchase order evidence requires an explicit document marker', () => {
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput(), {
      evidenceText: 'OC-DEMO-20260902-001 00051-MPASH 1500 gr',
    }),
    /encabezado visible ORDEN DE COMPRA/u
  );
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput(), {
      evidenceText: 'ORDEN DE COMPRA Y SALIDA DE BODEGA HACIA 3Q OC-DEMO-20260902-001 00051-MPASH 1500 gr',
    }),
    /marcadores contradictorios/u
  );
});

test('purchase order totals never add incompatible units', () => {
  const input = validInput({
    total_unidades: 80,
    items: [
      { sku: '00001-TPBI', descripcion: 'Tapas', cantidad: 80, unidad: 'unidades' },
      { sku: '00051-MPASH', descripcion: 'Gomas', cantidad: 8750, unidad: 'gr' },
    ],
  });
  const normalized = normalizePurchaseOrderDocumentInput(input);
  assert.equal(normalized.totalUnits, 80);
  assert.equal(normalized.calculatedTotal, 80);
  assert.doesNotMatch(normalized.warnings.join(' | '), /9126|suma de items/u);
});

test('purchase order mixed-unit total compares against the units subtotal', () => {
  const input = validInput({
    total_unidades: 79,
    items: [
      { sku: '00001-TPBI', descripcion: 'Tapas', cantidad: 80, unidad: 'und' },
      { sku: '00051-MPASH', descripcion: 'Gomas', cantidad: 8750, unidad: 'g' },
    ],
  });
  const normalized = normalizePurchaseOrderDocumentInput(input);
  assert.equal(normalized.calculatedTotal, 80);
  assert.match(normalized.warnings.join(' | '), /79.*80/u);
});

test('purchase order rejects a weight subtotal presented as total units', () => {
  const normalized = normalizePurchaseOrderDocumentInput(validInput({
    total_unidades: 8750,
    items: [
      { sku: '00001-TPBI', descripcion: 'Tapas', cantidad: 80, unidad: 'und' },
      { sku: '00051-MPASH', descripcion: 'Gomas', cantidad: 8750, unidad: 'g' },
    ],
  }));
  assert.equal(normalized.calculatedTotal, 80);
  assert.match(normalized.warnings.join(' | '), /8750.*80/u);
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
    }), { evidenceText: 'ORDEN DE COMPRA OC-DEMO-20260902-001 00051-MPASH 1500 gr' }),
    /cantidad 150/u
  );
  assert.throws(
    () => normalizePurchaseOrderDocumentInput(validInput({
      items: [{ sku: '00051-MPAS', descripcion: 'Gomas', cantidad: 1500, unidad: 'gr' }],
    }), { evidenceText: 'ORDEN DE COMPRA OC-DEMO-20260902-001 00051-MPASH 1500 gr' }),
    /no aparece literalmente/u
  );
});

test('purchase order extraction preserves supplier lot and expiry only when grounded', () => {
  const body = validInput({
    items: [{
      sku: '00051-MPASH',
      descripcion: 'Gomas Ashwagandha',
      cantidad: 1500,
      unidad: 'gr',
      lote: 'PROV-LOT-77',
      fecha_vencimiento: '2027-11-30',
    }],
  });
  const grounded = normalizePurchaseOrderDocumentInput(body, {
    evidenceText: 'ORDEN DE COMPRA OC-DEMO-20260902-001 00051-MPASH 1,500 gr PROV-LOT-77 30/11/2027',
  });
  assert.equal(grounded.items[0].lot, 'PROV-LOT-77');
  assert.equal(grounded.items[0].expiryDate, '2027-11-30');
  assert.deepEqual(grounded.warnings, []);

  const unsupported = normalizePurchaseOrderDocumentInput(body, {
    evidenceText: 'ORDEN DE COMPRA OC-DEMO-20260902-001 00051-MPASH 1,500 gr',
  });
  assert.equal(unsupported.items[0].lot, null);
  assert.equal(unsupported.items[0].expiryDate, null);
  assert.match(unsupported.warnings.join(' | '), /lote propuesto/u);
  assert.match(unsupported.warnings.join(' | '), /vencimiento propuesto/u);
});

test('purchase order recovers omitted row fields only from an exact line-delimited SKU block', () => {
  const body = validInput({
    total_unidades: 37,
    items: [{
      sku: '00001-TPBI',
      descripcion: 'Tapa tarro cuadrado blanco',
      cantidad: 37,
      unidad: 'und',
    }],
  });
  const evidence = [
    'ORDEN DE COMPRA',
    'OC-DEMO-20260902-001',
    '2026-09-02',
    '00001-TPBI',
    'TAPA TARRO CUADRADO BLANCO',
    '37',
    'und',
    'QA-TPBI-260905',
    '2028-01-31',
  ].join('\n');
  const normalized = normalizePurchaseOrderDocumentInput(body, { evidenceText: evidence });
  assert.equal(normalized.items[0].lot, 'QA-TPBI-260905');
  assert.equal(normalized.items[0].expiryDate, '2028-01-31');
});

test('purchase order recovers omitted fields from flattened multi-row PDF evidence', () => {
  const body = validInput({
    total_unidades: 97,
    advertencias: [
      'Faltan lote y vencimiento legibles para algunos items.',
      'La cantidad total de 97 und no coincide con la suma de items en unidades.',
    ],
    items: [
      { sku: '00001-TPBI', descripcion: 'Tapa', cantidad: 37, unidad: 'und' },
      { sku: '00018-ETBOS60', descripcion: 'Etiqueta', cantidad: 31, unidad: 'und', lote: 'QA-ETBOS60-260905' },
      { sku: '00042-CMCG', descripcion: 'Caja master', cantidad: 29, unidad: 'und' },
    ],
  });
  const evidence = [
    'ORDEN DE COMPRA OC-DEMO-20260902-001',
    '00001-TPBI TAPA TARRO CUADRADO BLANCO 37 und QA-TPBI-260905 2028-01-31',
    '00018-ETBOS60 ETIQUETA BOOSTER 31 und QA-ETBOS60-260905 2028-05-31',
    '00042-CMCG CAJA MASTER CREA GUMS 29 und QA-CMCG-260905 2028-09-30',
  ].join(' ');

  const normalized = normalizePurchaseOrderDocumentInput(body, { evidenceText: evidence });
  assert.deepEqual(normalized.items.map(({ lot, expiryDate }) => ({ lot, expiryDate })), [
    { lot: 'QA-TPBI-260905', expiryDate: '2028-01-31' },
    { lot: 'QA-ETBOS60-260905', expiryDate: '2028-05-31' },
    { lot: 'QA-CMCG-260905', expiryDate: '2028-09-30' },
  ]);
  assert.deepEqual(normalized.warnings, []);
});

test('purchase order reports exact SKU fields that remain missing after evidence recovery', () => {
  const body = validInput({
    total_unidades: 68,
    advertencias: ['Faltan lote y vencimiento legibles para algunos items.'],
    items: [
      { sku: '00001-TPBI', descripcion: 'Tapa', cantidad: 37, unidad: 'und' },
      { sku: '00018-ETBOS60', descripcion: 'Etiqueta', cantidad: 31, unidad: 'und' },
    ],
  });
  const evidence = [
    'ORDEN DE COMPRA OC-DEMO-20260902-001',
    '00001-TPBI TAPA 37 und QA-TPBI-260905 2028-01-31',
    '00018-ETBOS60 ETIQUETA 31 und QA-ETBOS60-260905',
  ].join(' ');

  const normalized = normalizePurchaseOrderDocumentInput(body, { evidenceText: evidence });
  assert.equal(normalized.items[1].lot, 'QA-ETBOS60-260905');
  assert.equal(normalized.items[1].expiryDate, null);
  assert.match(normalized.warnings.join(' | '), /Vencimiento.*00018-ETBOS60/u);
  assert.doesNotMatch(normalized.warnings.join(' | '), /00001-TPBI/u);
});

test('purchase order does not recover hints when a SKU block is ambiguous', () => {
  const body = validInput({
    total_unidades: 37,
    items: [{ sku: '00001-TPBI', descripcion: 'Tapa', cantidad: 37, unidad: 'und' }],
  });
  const evidence = [
    'ORDEN DE COMPRA OC-DEMO-20260902-001 2026-09-02',
    '00001-TPBI', 'TAPA', '37', 'und', 'QA-LOTE-UNO', '2028-01-31',
    '00001-TPBI', 'TAPA REPETIDA', '37', 'und', 'QA-LOTE-DOS', '2028-02-29',
  ].join('\n');
  const normalized = normalizePurchaseOrderDocumentInput(body, { evidenceText: evidence });
  assert.equal(normalized.items[0].lot, null);
  assert.equal(normalized.items[0].expiryDate, null);
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
  const hintsMigration = fs.readFileSync(path.join(__dirname, '../database/27_purchase_order_document_lot_hints.sql'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/purchase-orders.js'), 'utf8');
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS Documentos BBC.txt'), 'utf8');
  const warehouseDomain = fs.readFileSync(path.join(__dirname, '../api/_lib/warehouse-document-intake.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.doesNotMatch(`${domain}\n${migration}`, /INSERT INTO (stock|movimientos|kardex)/u);
  assert.doesNotMatch(hintsMigration, /INSERT INTO (stock|movimientos|kardex)/u);
  assert.match(hintsMigration, /lote_documento/u);
  assert.match(hintsMigration, /fecha_vencimiento_documento/u);
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
