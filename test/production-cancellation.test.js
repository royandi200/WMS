const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  cancelProductionOrder,
  normalizeProductionCancellation,
} = require('../api/_lib/production-cancellation');
const { CAPABILITIES, hasCapability } = require('../api/_lib/capabilities');

function connectionWith(responses) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql: sql.replace(/\s+/gu, ' ').trim(), params });
      if (!responses.length) throw new Error('Consulta inesperada');
      return responses.shift();
    },
  };
}

function approvedOrder(overrides = {}) {
  return {
    id: 91,
    codigo_orden: 'OP-20260921-000091',
    estado: 'APROBADA',
    fase: 'F0',
    materiales_conf_en: null,
    producto_id: 7,
    cantidad_planeada: '3.0000',
    sku: '00102-PTASH60',
    producto: 'PRODUCTO TERMINADO ASHWAGANDHA X 60',
    ...overrides,
  };
}

test('production cancellation input requires an order and bounded reason', () => {
  assert.deepEqual(
    normalizeProductionCancellation({ order_id: 91, motivo: '  Orden   duplicada  ' }),
    { orderId: '91', reason: 'Orden duplicada' }
  );
  assert.throws(() => normalizeProductionCancellation({ motivo: 'Duplicada' }), /invalida/u);
  assert.throws(() => normalizeProductionCancellation({ order_id: 91, motivo: 'no' }), /obligatorio/u);
  assert.throws(() => normalizeProductionCancellation({ order_id: 91, motivo: 'x'.repeat(501) }), /500/u);
});

test('only roles that release production can cancel an approved order', () => {
  assert.equal(hasCapability('admin', CAPABILITIES.PRODUCTION_RELEASE), true);
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.PRODUCTION_RELEASE), false);
  assert.equal(hasCapability('alistador', CAPABILITIES.PRODUCTION_RELEASE), false);
  assert.equal(hasCapability('despacho', CAPABILITIES.PRODUCTION_RELEASE), false);
});

test('approved order cancellation releases reservations atomically and is audited', async () => {
  const allocations = [
    { id: 1, stock_id: 11, lote: 'LOT-A', cantidad_reservada: '3.0000', unidad: 'und', cantidad_alistada: 0, cantidad_consumida: 0, confirmado_en: null },
    { id: 2, stock_id: 12, lote: 'LOT-B', cantidad_reservada: '540.0000', unidad: 'g', cantidad_alistada: 0, cantidad_consumida: 0, confirmado_en: null },
  ];
  const conn = connectionWith([
    [[approvedOrder()], []],
    [allocations, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []],
    [{ insertId: 77 }, []],
  ]);
  const result = await cancelProductionOrder(conn, { orderId: '91', reason: 'Orden duplicada', userId: 5 });
  assert.equal(result.status, 'CANCELADA');
  assert.equal(result.released_reservations, 2);
  assert.deepEqual(result.released_by_unit, [
    { unit: 'und', quantity: 3 },
    { unit: 'g', quantity: 540 },
  ]);
  assert.match(conn.calls[2].sql, /UPDATE stock SET reservada = reservada - \?/u);
  assert.match(conn.calls[4].sql, /WHERE id = \? AND estado = 'APROBADA' AND fase = 'F0'/u);
  assert.match(conn.calls[5].sql, /INSERT INTO system_logs/u);
  assert.match(conn.calls[5].params[2], /Orden duplicada/u);
});

test('repeated cancellation is idempotent and does not release reservations twice', async () => {
  const conn = connectionWith([[[approvedOrder({ estado: 'CANCELADA' })], []]]);
  const result = await cancelProductionOrder(conn, { orderId: '91', reason: 'Repetida', userId: 5 });
  assert.equal(result.duplicate, true);
  assert.equal(result.released_reservations, 0);
  assert.equal(conn.calls.length, 1);
});

test('order cannot be cancelled after materials are confirmed or production starts', async () => {
  for (const state of [
    { estado: 'EN_PROCESO', fase: 'F1', materiales_conf_en: new Date() },
    { estado: 'CERRADA', fase: 'F5', materiales_conf_en: new Date() },
  ]) {
    const conn = connectionWith([[[approvedOrder(state)], []]]);
    await assert.rejects(
      cancelProductionOrder(conn, { orderId: '91', reason: 'Solicitud anulada', userId: 5 }),
      /no se puede cancelar/u
    );
    assert.equal(conn.calls.length, 1);
  }
});

test('inconsistent reservation prevents partial cancellation', async () => {
  const conn = connectionWith([
    [[approvedOrder()], []],
    [[{ id: 1, stock_id: 11, lote: 'LOT-A', cantidad_reservada: 3, cantidad_alistada: 0, cantidad_consumida: 0, confirmado_en: null }], []],
    [{ affectedRows: 0 }, []],
  ]);
  await assert.rejects(
    cancelProductionOrder(conn, { orderId: '91', reason: 'Solicitud anulada', userId: 5 }),
    /No se pudo liberar/u
  );
  assert.equal(conn.calls.some((call) => /UPDATE ordenes_produccion/u.test(call.sql)), false);
});

test('route and dashboard enforce the cancellation boundary', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'production', 'cancel.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'pages', 'ProduccionPage.jsx'), 'utf8');
  assert.match(route, /requireCapability\(req, CAPABILITIES\.PRODUCTION_RELEASE\)/u);
  assert.match(route, /beginTransaction\(\)/u);
  assert.match(route, /rollback\(\)/u);
  assert.match(page, /canCancelOrder && r\.status === 'APROBADA'/u);
  assert.match(page, /liberar todas sus reservas de materiales/u);
});
