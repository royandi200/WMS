const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWasteInput,
  parseWasteReferences,
  buildWasteDedupeKey,
  generateWasteReference,
} = require('../api/_lib/waste-workflow');

test('normalizes a location-specific warehouse waste report', () => {
  const result = normalizeWasteInput({
    referencia_merma: 'MER-QA-001',
    id_item: 'SKU-1',
    id_lote: 'LOT-1',
    ubicacion: 'PPAL-A-1-01',
    cantidad: '0.25',
    motivo: 'Daño de empaque',
  });
  assert.equal(result.externalReference, 'MER-QA-001');
  assert.equal(result.quantity, 0.25);
  assert.equal(result.lot, 'LOT-1');
  assert.equal(result.location, 'PPAL-A-1-01');
});

test('accepts the exact dashboard waste payload contract', () => {
  const result = normalizeWasteInput({
    type: 'BODEGA',
    external_reference: 'E2E-DASH-MER-20260805-001',
    product_id: '00102-PTASH60',
    qty: 0.25,
    lot_id: 'TEST_AGENT-PTASH-DISP',
    location: 'PPAL-A-1-01',
    reason: 'prueba controlada desde dashboard',
  });
  assert.equal(result.externalReference, 'E2E-DASH-MER-20260805-001');
  assert.equal(result.sku, '00102-PTASH60');
  assert.equal(result.quantity, 0.25);
});

test('requires exactly one inventory context', () => {
  const base = {
    referencia_merma: 'MER-QA-002', id_item: 'SKU-1', cantidad: 1, motivo: 'QA',
  };
  assert.throws(() => normalizeWasteInput(base), /exactamente uno/);
  assert.throws(() => normalizeWasteInput({ ...base, id_lote: 'LOT-1', id_orden: 'OP-1' }), /exactamente uno/);
});

test('requires reason, reference and location for warehouse waste', () => {
  const base = { id_item: 'SKU-1', cantidad: 1, id_lote: 'LOT-1' };
  assert.throws(() => normalizeWasteInput(base), /Referencia/);
  assert.throws(() => normalizeWasteInput({ ...base, referencia_merma: 'MER-QA-003' }), /Motivo/);
  assert.throws(() => normalizeWasteInput({ ...base, referencia_merma: 'MER-QA-003', motivo: 'QA' }), /Ubicacion/);
});

test('allows BuilderBot to omit a field-generated waste reference', () => {
  const result = normalizeWasteInput({
    id_item: '00051-MPASH',
    cantidad: 10,
    motivo: 'derrame',
    id_orden: 67,
  }, { allowGeneratedReference: true });
  assert.equal(result.externalReference, '');
  assert.equal(result.order, '67');
});

test('generated waste references use the Bogota business date', () => {
  const reference = generateWasteReference(new Date('2026-09-02T03:30:00.000Z'));
  assert.match(reference, /^AUTO-MER-20260901-[A-F0-9]{8}$/u);
});

test('waste retry lock is deterministic for the same operational event', () => {
  const event = {
    userId: 18,
    productId: 51,
    orderId: 67,
    lot: null,
    locationId: null,
    quantity: 10,
    reason: 'Derrame',
  };
  const first = buildWasteDedupeKey(event);
  const retry = buildWasteDedupeKey({ ...event, reason: ' derrame ' });
  assert.equal(first, retry);
  assert.notEqual(first, buildWasteDedupeKey({ ...event, quantity: 11 }));
  assert.match(first, /^wms_waste_[a-f0-9]{48}$/u);
});

test('extracts immutable references from the original user message', () => {
  const parsed = parseWasteReferences(
    'reporta merma del lote LOT-QA-1 ubicacion PPAL-A-1-01 referencia MER-QA-004'
  );
  assert.deepEqual(parsed, {
    referencia_merma: 'MER-QA-004',
    id_lote: 'LOT-QA-1',
    ubicacion: 'PPAL-A-1-01',
  });
});

test('dashboard and BuilderBot use the shared transactional waste workflow', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dashboard = fs.readFileSync(path.join(__dirname, '../api/v1/waste.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(dashboard, /reportWaste\(req\.body \|\| \{\}, user\.id\)/u);
  assert.match(webhook, /parseWasteReferences\(rawText\)/u);
  assert.match(webhook, /allowGeneratedReference: true/u);
  assert.match(webhook, /Referencia generada por WMS/u);
});
