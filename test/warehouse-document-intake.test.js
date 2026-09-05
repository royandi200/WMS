const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeWarehouseDocumentInput,
  operationalDocumentIdentity,
  registerWarehouseDocumentDraft,
} = require('../api/_lib/warehouse-document-intake');
const { CAPABILITIES, capabilityForAction } = require('../api/_lib/capabilities');
const { buildWarehouseExitPdf } = require('../scripts/qa/demo-pdf');

function validInput(overrides = {}) {
  return {
    tipo_documento: 'SALIDA_BODEGA_3Q',
    referencia_documento: 'SB-TEST-20260831-001',
    fecha_documento: '2026-08-31',
    nombre_cliente: '3Q',
    total_bultos: 125,
    total_unidades: 8200,
    items: [
      { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7000, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
      { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
    ],
    ...overrides,
  };
}

test('demo 3Q warehouse exit PDF is stable and exposes the operational reference', () => {
  const input = {
    number: 'DEMO-PRESENTACION-SALIDA-3Q', recipient: '3Q', date: '2026-09-03',
    sender: 'SOFI', totalPackages: 1,
    items: [{ sku: '00006-TRP', description: 'TARRO CUADRADO x 60', quantity: 4, unit: 'und' }],
  };
  const first = buildWarehouseExitPdf(input);
  const retry = buildWarehouseExitPdf(input);
  assert.deepEqual(first, retry);
  assert.match(first.toString('ascii'), /^%PDF-1\.4/u);
  assert.match(first.toString('ascii'), /DEMO-PRESENTACION-SALIDA-3Q/u);
});

test('document intake normalizes an exact, complete 3Q warehouse exit', () => {
  const input = normalizeWarehouseDocumentInput(validInput());
  assert.equal(input.documentType, 'SALIDA_BODEGA_3Q');
  assert.equal(input.items[0].sku, '00007-TRG');
  assert.equal(input.items[0].unit, 'und');
  assert.equal(input.calculatedTotal, 8200);
  assert.deepEqual(input.warnings, []);
  assert.match(input.hash, /^[a-f0-9]{64}$/u);
});

test('3Q intake recovers an omitted unit from the exact SKU quantity block', () => {
  const input = normalizeWarehouseDocumentInput(validInput({
    total_unidades: 23,
    items: [{ sku: '00001-TPBI', descripcion: 'Tapa tarro cuadrado', cantidad: 23 }],
  }), {
    evidenceText: [
      'SALIDA DE BODEGA HACIA 3Q',
      'SB-TEST-20260831-001',
      '00001-TPBI',
      'TAPA TARRO CUADRADO',
      '23',
      'und',
    ].join('\n'),
  });
  assert.equal(input.items[0].unit, 'und');
});

test('3Q evidence requires an explicit outsourcing marker', () => {
  assert.throws(
    () => normalizeWarehouseDocumentInput(validInput(), {
      evidenceText: 'SALIDA DE BODEGA SB-TEST-20260831-001 3Q 00007-TRG 7000 00006-TRP 1200',
    }),
    /SALIDA DE BODEGA HACIA 3Q/u
  );
  const normalized = normalizeWarehouseDocumentInput(validInput(), {
    evidenceText: 'REMISION A 3Q SB-TEST-20260831-001 00007-TRG 7000 00006-TRP 1200',
  });
  assert.equal(normalized.documentType, 'SALIDA_BODEGA_3Q');
});

test('document intake is deterministic and accepts BuilderBot params envelope', () => {
  const direct = normalizeWarehouseDocumentInput(validInput());
  const enveloped = normalizeWarehouseDocumentInput({ params: validInput() });
  assert.equal(direct.hash, enveloped.hash);
});

test('document identity ignores model warnings and ephemeral message references', () => {
  const first = normalizeWarehouseDocumentInput(validInput({
    advertencias: ['Observacion redactada por el modelo'],
    referencia_origen: 'event-document-1',
  }));
  const retry = normalizeWarehouseDocumentInput(validInput({
    advertencias: [],
    referencia_origen: 'event-document-2',
  }));
  const changedQuantity = normalizeWarehouseDocumentInput(validInput({
    total_unidades: 8201,
    items: [
      { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7001, fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
      { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
    ],
  }));
  assert.equal(first.hash, retry.hash);
  assert.notEqual(first.hash, changedQuantity.hash);
});

test('operational document identity ignores OCR metadata but protects inventory fields', () => {
  const first = normalizeWarehouseDocumentInput(validInput({
    nombre_archivo: 'salida-original.pdf',
    nombre_cliente: '3Q - DATOS DE PRUEBA',
    entrega: 'SOFI - USUARIO DE PRUEBA',
  }));
  const retry = normalizeWarehouseDocumentInput(validInput({
    nombre_archivo: null,
    nombre_cliente: '3Q',
    entrega: null,
    items: [
      { sku: '00006-TRP', descripcion: 'Envase pequeño', cantidad: 1200, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
      { sku: '00007-TRG', descripcion: 'Envase grande', cantidad: 7000, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
    ],
  }));
  const changedLot = normalizeWarehouseDocumentInput(validInput({
    items: [
      { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7000, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'OTRO-LOTE' },
      { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
    ],
  }));
  const changedQuantity = normalizeWarehouseDocumentInput(validInput({
    total_unidades: 8201,
    items: [
      { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7001, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
      { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
    ],
  }));
  assert.notEqual(first.hash, retry.hash);
  assert.equal(first.operationalHash, retry.operationalHash);
  assert.equal(first.operationalHash, changedLot.operationalHash);
  assert.notEqual(first.operationalHash, changedQuantity.operationalHash);
  assert.deepEqual(operationalDocumentIdentity(first), operationalDocumentIdentity(retry));
  const changedUnit = normalizeWarehouseDocumentInput(validInput({
    items: [
      { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7000, unidad: 'kg', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
      { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
    ],
  }));
  assert.notEqual(first.operationalHash, changedUnit.operationalHash);
});

test('duplicate document returns persisted total and warnings without inserting', async () => {
  const normalized = normalizeWarehouseDocumentInput(validInput());
  const calls = [];
  const db = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    execute: async (sql) => {
      calls.push(sql);
      if (/SELECT id, tipo_documento/u.test(sql)) {
        return [[{
          id: 7,
          referencia_documento: normalized.reference,
          sha256: normalized.hash,
          estado: 'PENDIENTE_REVISION',
          total_unidades: '8200.0000',
          advertencias: JSON.stringify(['Revision persistida']),
        }]];
      }
      throw new Error('A duplicate must not execute writes');
    },
  };

  const result = await registerWarehouseDocumentDraft({
    db,
    body: validInput(),
    userId: 5,
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.totalUnits, 8200);
  assert.deepEqual(result.warnings, ['Revision persistida']);
  assert.ok(calls.includes('commit'));
  assert.ok(!calls.includes('rollback'));
});

test('duplicate accepts equivalent operational data when OCR metadata changes', async () => {
  const calls = [];
  const db = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    execute: async (sql) => {
      calls.push(sql);
      if (/SELECT id, tipo_documento/u.test(sql)) {
        return [[{
          id: 7,
          tipo_documento: 'SALIDA_BODEGA_3Q',
          referencia_documento: 'SB-TEST-20260831-001',
          fecha_documento: '2026-08-31',
          total_bultos: '125.0000',
          total_unidades: '8200.0000',
          sha256: 'hash-anterior-con-metadatos',
          estado: 'PENDIENTE_REVISION',
          advertencias: null,
        }]];
      }
      if (/FROM documento_bodega_borrador_items/u.test(sql)) {
        return [[
          { sku_extraido: '00007-TRG', cantidad: '7000.0000', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
          { sku_extraido: '00006-TRP', cantidad: '1200.0000', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
        ]];
      }
      throw new Error('An equivalent retry must not execute writes');
    },
  };
  const result = await registerWarehouseDocumentDraft({
    db,
    body: validInput({
      nombre_archivo: null,
      entrega: null,
      items: [
        { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7000, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
        { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, unidad: 'und', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-LNTP60' },
      ],
    }),
    userId: 5,
    evidenceText: [
      'SALIDA DE BODEGA HACIA 3Q SB-TEST-20260831-001',
      '00007-TRG 7000 2027-12-31 L-TEST-120',
      '00006-TRP 1200 2027-12-31 L-TEST-60',
    ].join('\n'),
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.totalUnits, 8200);
  assert.ok(calls.includes('commit'));
  assert.ok(!calls.includes('rollback'));
});

test('duplicate rejects changes to operational items with a specific conflict', async () => {
  const db = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    execute: async (sql) => {
      if (/SELECT id, tipo_documento/u.test(sql)) {
        return [[{
          id: 7,
          tipo_documento: 'SALIDA_BODEGA_3Q',
          referencia_documento: 'SB-TEST-20260831-001',
          fecha_documento: '2026-08-31',
          total_bultos: '125.0000',
          total_unidades: '8200.0000',
          sha256: 'hash-anterior',
          estado: 'PENDIENTE_REVISION',
          advertencias: null,
        }]];
      }
      return [[
        { sku_extraido: '00007-TRG', cantidad: '6999.0000', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
        { sku_extraido: '00006-TRP', cantidad: '1200.0000', fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
      ]];
    },
  };
  await assert.rejects(
    registerWarehouseDocumentDraft({ db, body: validInput(), userId: 5 }),
    /SKU o cantidades/u
  );
});

test('BuilderBot document evidence rejects invented SKU and clears invented optional data', () => {
  const evidence = [
    'SALIDA DE BODEGA HACIA 3Q SB-TEST-20260831-001',
    '00007-TRG 7000 2027-12-31 L-TEST-120',
    '00006-TRP 1200 2027-12-31 L-TEST-60',
  ].join('\n');
  const normalized = normalizeWarehouseDocumentInput(validInput({
    items: [
      { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7000, fecha_vencimiento: '2027-12-31', lote: 'L-TEST-INVENTADO' },
      { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
    ],
  }), { evidenceText: evidence });
  assert.equal(normalized.items[0].lot, null);
  assert.match(normalized.warnings.join(' | '), /no aparece literalmente/u);
  assert.throws(
    () => normalizeWarehouseDocumentInput(validInput({
      items: [{ sku: 'SKU-INVENTADO', descripcion: 'Inventado', cantidad: 8200 }],
    }), { evidenceText: evidence }),
    /no aparece literalmente/u
  );
});

test('document intake fails closed without exact SKU or with an invalid date', () => {
  const missingSku = validInput({
    items: [{ descripcion: 'Tapas x 120', cantidad: 7, fecha_vencimiento: '2027-12-31', lote: 'L-1' }],
    total_unidades: 7,
  });
  assert.throws(() => normalizeWarehouseDocumentInput(missingSku), /SKU exacto/u);
  assert.throws(() => normalizeWarehouseDocumentInput(validInput({ fecha_documento: '31\/08\/2026' })), /YYYY-MM-DD/u);
  assert.throws(() => normalizeWarehouseDocumentInput(validInput({ tipo_documento: 'ORDEN_COMPRA' })), /SALIDA_BODEGA_3Q/u);
});

test('3Q document intake flags total mismatch without requiring FEFO data in the source PDF', () => {
  const input = normalizeWarehouseDocumentInput(validInput({
    total_unidades: 1,
    items: [{ sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7 }],
  }));
  assert.equal(input.warnings.length, 1);
  assert.match(input.warnings.join(' | '), /no coincide/u);
  assert.equal(input.items[0].lot, null);
  assert.equal(input.items[0].expiryDate, null);
});

test('document action is restricted to outsourcing management', () => {
  assert.equal(
    capabilityForAction('REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO'),
    CAPABILITIES.OUTSOURCING_MANAGE
  );
});

test('document schema and handler do not mutate inventory', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../database/17_warehouse_document_intake.sql'), 'utf8');
  const domain = fs.readFileSync(path.join(__dirname, '../api/_lib/warehouse-document-intake.js'), 'utf8');
  const source = `${migration}\n${domain}`;
  assert.doesNotMatch(source, /INSERT INTO (stock|movimientos|kardex)/u);
  assert.doesNotMatch(source, /UPDATE (stock|lots)/u);
  assert.match(migration, /PENDIENTE_REVISION/u);
  assert.match(domain, /FOR UPDATE/u);
  assert.match(domain, /cantidad, unidad, fecha_vencimiento/u);
});
