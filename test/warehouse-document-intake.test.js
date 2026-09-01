const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeWarehouseDocumentInput,
  registerWarehouseDocumentDraft,
} = require('../api/_lib/warehouse-document-intake');
const { CAPABILITIES, capabilityForAction } = require('../api/_lib/capabilities');

function validInput(overrides = {}) {
  return {
    tipo_documento: 'SALIDA_BODEGA_3Q',
    referencia_documento: 'SB-TEST-20260831-001',
    fecha_documento: '2026-08-31',
    nombre_cliente: '3Q',
    total_bultos: 125,
    total_unidades: 8200,
    items: [
      { sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7000, fecha_vencimiento: '2027-12-31', lote: 'L-TEST-120' },
      { sku: '00006-TRP', descripcion: 'Envases x 60', cantidad: 1200, fecha_vencimiento: '2027-12-31', lote: 'L-TEST-60' },
    ],
    ...overrides,
  };
}

test('document intake normalizes an exact, complete 3Q warehouse exit', () => {
  const input = normalizeWarehouseDocumentInput(validInput());
  assert.equal(input.documentType, 'SALIDA_BODEGA_3Q');
  assert.equal(input.items[0].sku, '00007-TRG');
  assert.equal(input.calculatedTotal, 8200);
  assert.deepEqual(input.warnings, []);
  assert.match(input.hash, /^[a-f0-9]{64}$/u);
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

test('duplicate document returns persisted total and warnings without inserting', async () => {
  const normalized = normalizeWarehouseDocumentInput(validInput());
  const calls = [];
  const db = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    execute: async (sql) => {
      calls.push(sql);
      if (/SELECT id, referencia_documento/u.test(sql)) {
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

test('document intake fails closed without exact SKU or with an invalid date', () => {
  const missingSku = validInput({
    items: [{ descripcion: 'Tapas x 120', cantidad: 7, fecha_vencimiento: '2027-12-31', lote: 'L-1' }],
    total_unidades: 7,
  });
  assert.throws(() => normalizeWarehouseDocumentInput(missingSku), /SKU exacto/u);
  assert.throws(() => normalizeWarehouseDocumentInput(validInput({ fecha_documento: '31\/08\/2026' })), /YYYY-MM-DD/u);
  assert.throws(() => normalizeWarehouseDocumentInput(validInput({ tipo_documento: 'ORDEN_COMPRA' })), /SALIDA_BODEGA_3Q/u);
});

test('document intake flags total, lot and expiry mismatches for human review', () => {
  const input = normalizeWarehouseDocumentInput(validInput({
    total_unidades: 1,
    items: [{ sku: '00007-TRG', descripcion: 'Envases x 120', cantidad: 7 }],
  }));
  assert.equal(input.warnings.length, 3);
  assert.match(input.warnings.join(' | '), /no coincide/u);
  assert.match(input.warnings.join(' | '), /no tiene lote/u);
  assert.match(input.warnings.join(' | '), /no tiene fecha de vencimiento/u);
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
});
