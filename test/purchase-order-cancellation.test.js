const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  cancelPurchaseOrder,
  normalizePurchaseOrderCancellation,
} = require('../api/_lib/purchase-order-cancellation');
const { CAPABILITIES, hasCapability } = require('../api/_lib/capabilities');

function connectionWith(responses) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (!responses.length) throw new Error('Consulta inesperada');
      return responses.shift();
    },
  };
}

function loadedOrder(overrides = {}) {
  return {
    id: 21,
    numero: 'OC-QA-21',
    estado: 'CARGADA',
    motivo_cancelacion: null,
    cancelada_en: null,
    cancelada_por: null,
    cancelada_por_nombre: null,
    ...overrides,
  };
}

test('purchase order cancellation input is normalized and bounded', () => {
  assert.deepEqual(
    normalizePurchaseOrderCancellation({ orden_compra_id: '21', motivo: '  Orden   duplicada  ' }),
    { id: 21, reason: 'Orden duplicada' }
  );
  assert.throws(() => normalizePurchaseOrderCancellation({ id: 0, motivo: 'Duplicada' }), /invalida/u);
  assert.throws(() => normalizePurchaseOrderCancellation({ id: 21, motivo: 'no' }), /obligatorio/u);
  assert.throws(() => normalizePurchaseOrderCancellation({ id: 21, motivo: 'x'.repeat(501) }), /500/u);
});

test('purchase order cancellation is restricted to privileged roles', () => {
  assert.equal(hasCapability('admin', CAPABILITIES.PURCHASE_ORDER_CANCEL), true);
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.PURCHASE_ORDER_CANCEL), false);
  assert.equal(hasCapability('alistador', CAPABILITIES.PURCHASE_ORDER_CANCEL), false);
  assert.equal(hasCapability('despacho', CAPABILITIES.PURCHASE_ORDER_CANCEL), false);
});

test('loaded purchase order is cancelled once and audited', async () => {
  const conn = connectionWith([
    [[loadedOrder()], []],
    [[], []],
    [[], []],
    [{ affectedRows: 1 }, []],
    [{ insertId: 99 }, []],
  ]);
  const result = await cancelPurchaseOrder(conn, { id: 21, reason: 'Orden duplicada', userId: 7 });
  assert.equal(result.estado, 'CANCELADA');
  assert.equal(result.duplicate, false);
  assert.match(conn.calls[3].sql, /WHERE id = \? AND estado = 'CARGADA'/u);
  assert.deepEqual(conn.calls[3].params, ['Orden duplicada', 7, 21]);
  assert.match(conn.calls[4].sql, /INSERT INTO system_logs/u);
  assert.doesNotMatch(conn.calls[4].params[2], /documento_pdf|contenido/u);
});

test('repeated cancellation is idempotent and preserves the first audit record', async () => {
  const order = loadedOrder({
    estado: 'CANCELADA',
    motivo_cancelacion: 'Orden duplicada',
    cancelada_por: 7,
    cancelada_por_nombre: 'Sofi',
  });
  const conn = connectionWith([[[order], []]]);
  const result = await cancelPurchaseOrder(conn, { id: 21, reason: 'Otro motivo', userId: 8 });
  assert.equal(result.duplicate, true);
  assert.equal(result.motivo_cancelacion, 'Orden duplicada');
  assert.equal(conn.calls.length, 1);
});

test('purchase order with any reception cannot be cancelled', async () => {
  const conn = connectionWith([
    [[loadedOrder()], []],
    [[{ id: 3, numero: 'REC-3', estado: 'borrador' }], []],
  ]);
  await assert.rejects(
    cancelPurchaseOrder(conn, { id: 21, reason: 'Orden anulada', userId: 7 }),
    /vinculada a la recepcion REC-3/u
  );
  assert.equal(conn.calls.length, 2);
});

test('purchase order linked to 3Q cannot be cancelled', async () => {
  const conn = connectionWith([
    [[loadedOrder()], []],
    [[], []],
    [[{ id: 5, codigo: 'MQ-5', estado: 'BORRADOR' }], []],
  ]);
  await assert.rejects(
    cancelPurchaseOrder(conn, { id: 21, reason: 'Orden anulada', userId: 7 }),
    /proceso 3Q MQ-5/u
  );
});

test('purchase order cannot be cancelled after its state advances', async () => {
  const conn = connectionWith([[[loadedOrder({ estado: 'FACTURA_VINCULADA' })], []]]);
  await assert.rejects(
    cancelPurchaseOrder(conn, { id: 21, reason: 'Orden anulada', userId: 7 }),
    /estado FACTURA_VINCULADA/u
  );
});

test('purchase order route exposes PATCH with server-side authorization', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'purchase-orders.js'), 'utf8');
  assert.match(source, /requireCapability\(req, CAPABILITIES\.PURCHASE_ORDER_CANCEL\)/u);
  assert.match(source, /req\.method === 'PATCH'/u);
  assert.match(source, /GET,POST,PATCH/u);
});

test('cancellation migration keeps audit actor, time and reason', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'database', '18_purchase_order_cancellation.sql'), 'utf8');
  assert.match(migration, /motivo_cancelacion VARCHAR\(500\)/u);
  assert.match(migration, /cancelada_por INT UNSIGNED/u);
  assert.match(migration, /cancelada_en DATETIME/u);
  assert.match(migration, /FOREIGN KEY \(cancelada_por\) REFERENCES usuarios\(id\)/u);
  assert.doesNotMatch(migration, /DELETE\s+FROM/u);
});
