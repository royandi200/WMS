const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyInventoryRow } = require('../api/_lib/inventory-availability');

const base = {
  cantidad: '10',
  reservada: '2',
  disponible: '8',
  lot_id: 'lot-1',
  lot_status: 'DISPONIBLE',
  ubicacion_id: 1,
  ubicacion_codigo: 'PPAL-A-1-01',
  ubicacion_activa: 1,
  bodega_activa: 1,
};

test('available inventory keeps its operational balance', () => {
  const row = classifyInventoryRow(base, new Date('2026-08-05'));
  assert.equal(row.estado_calculado, 'DISPONIBLE');
  assert.equal(row.disponible, 8);
  assert.equal(row.bloqueada, 0);
});

test('inventory without a physical location is blocked, not available', () => {
  const row = classifyInventoryRow({ ...base, ubicacion_id: null, ubicacion_codigo: null }, new Date('2026-08-05'));
  assert.equal(row.estado_calculado, 'SIN_UBICACION');
  assert.equal(row.saldo_fisico, 10);
  assert.equal(row.disponible, 0);
  assert.equal(row.bloqueada, 10);
});

test('expired inventory is blocked', () => {
  const row = classifyInventoryRow({ ...base, expiry_date: '2026-08-04' }, new Date('2026-08-05'));
  assert.equal(row.estado_calculado, 'VENCIDO');
  assert.equal(row.disponible, 0);
});
