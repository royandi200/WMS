const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { reportingPeriod, dashboardMetrics } = require('../api/_lib/dashboard-metrics');
const { quantityTotals, draftQuantitySummary } = require('../api/_lib/quantity-totals');
const { productionUseSummaries, productionReservationSummaries, paginateMessage } = require('../api/_lib/traceability-presentation');

test('reporting periods use Bogota midnight and include exactly 1, 7 or 30 calendar days', () => {
  const now = new Date('2026-09-07T02:00:00Z');
  for (const [period, from] of [['today', '2026-09-06'], ['week', '2026-08-31'], ['month', '2026-08-08']]) {
    const range = reportingPeriod(period, now);
    assert.equal(range.today, '2026-09-06');
    assert.equal(range.from, `${from} 00:00:00`);
    assert.equal(range.to, '2026-09-07 00:00:00');
  }
  assert.throws(() => reportingPeriod('invalid'), /Periodo invalido/);
});

test('quantities normalize gram aliases without adding mass to pieces or guessing missing units', () => {
  assert.deepEqual(quantityTotals([
    { cantidad: 376, unidad: 'und' }, { cantidad: 8000, unidad: 'gr' },
    { cantidad: 750, unidad: 'g' }, { cantidad: 1, unidad: 'kg' }, { cantidad: 2 },
  ]), [{ unit: 'g', quantity: 8750 }, { unit: 'kg', quantity: 1 },
    { unit: 'sin unidad', quantity: 2 }, { unit: 'und', quantity: 376 }]);
  assert.throws(() => quantityTotals([{ cantidad: 'oops' }]), /Cantidad invalida/);
});

test('document summary comes from stored lines on both first response and retry', async () => {
  const db = { execute: async (sql, args) => {
    assert.match(sql, /FROM documento_bodega_borrador_items WHERE documento_id = \?/);
    assert.deepEqual(args, [17]);
    return [[{ cantidad: 376, unidad: 'und' }, { cantidad: 8750, unidad: 'gr' }]];
  } };
  const first = await draftQuantitySummary(db, 17);
  assert.match(first, /8[.,]750 g/);
  assert.match(first, /376 und/);
  assert.equal(await draftQuantitySummary(db, 17), first);
});

const fixtures = {
  reception: [{ count: 205 }], received: [{ unidad: 'und', cantidad: 500 }, { unidad: 'gr', cantidad: 8750 }],
  rejected: [{ unidad: 'und', cantidad: 2 }],
  production: [{ estado: 'APROBADA', count: 125, closed: 0 }, { estado: 'CERRADA', count: 200, closed: 11 }],
  waste: [{ count: 201, orders: 12 }], 'waste-quantities': [{ unidad: 'g', cantidad: 45 }],
  stock: [{ unidad: 'und', products: 2, cantidad: 40, reserved: 3 }],
  flows: [{ direction: 'entry', unidad: 'und', cantidad: 500, count: 205 },
    { direction: 'exit', unidad: 'gr', cantidad: 180, count: 1 }], recent: [],
  approvals: [{ accion: 'SOLICITAR_INICIO_PRODUCCION', count: 140, oldest: '2026-09-06T15:00:00Z' }],
};
function fixtureQuery(calls) {
  return async (sql, args) => {
    const label = sql.match(/dashboard:([\w-]+)/)[1];
    calls.push(label);
    if (label !== 'recent') assert.doesNotMatch(sql, /\bLIMIT\b/i);
    if (label === 'received') assert.match(sql, /SUM\(ri.cantidad_rec\)/);
    if (label === 'rejected') assert.match(sql, /rd.condicion = 'RECHAZADO'/);
    if (label === 'flows') assert.match(sql, /k.qty <> 0/);
    if (label === 'stock') {
      assert.match(sql, /l.status = 'DISPONIBLE'/);
      assert.match(sql, /u.activa = 1/);
      assert.deepEqual(args, ['2026-09-06']);
    }
    return fixtures[label];
  };
}

test('dashboard uses complete SQL aggregates exceeding old row limits, not truncated lists', async () => {
  const data = await dashboardMetrics(fixtureQuery([]), { now: new Date('2026-09-06T20:00:00Z'), approvalsAllowed: true });
  assert.equal(data.reception.count, 205);
  assert.equal(data.production.byStatus.APROBADA, 125);
  assert.equal(data.production.closed, 11);
  assert.equal(data.waste.count, 201);
  assert.equal(data.approvals.count, 140);
  assert.deepEqual(data.reception.quantities, [{ unit: 'g', quantity: 8750 }, { unit: 'und', quantity: 500 }]);
  assert.equal(data.flows.entry.count, 205);
});

test('dashboard does not query approvals without the capability and fails closed on SQL errors', async () => {
  const calls = [];
  const data = await dashboardMetrics(fixtureQuery(calls), { now: new Date('2026-09-06T20:00:00Z') });
  assert.equal(data.approvals, null);
  assert.ok(!calls.includes('approvals'));
  await assert.rejects(dashboardMetrics(async () => { throw new Error('database unavailable'); }), /database unavailable/);
});

test('traceability separates reservations from actual delivery, including cancelled replenishment', () => {
  const base = { producto_final: 'PT1', unidad: 'g', estado: 'APROBADA', cantidad_reservada: 180, cantidad_consumida: 0 };
  const rows = [
    { ...base, codigo_orden: 'OP-PLANNED' },
    { ...base, codigo_orden: 'OP-USED', estado: 'EN_PROCESO', cantidad_consumida: 180, cantidad_devuelta: 180 },
    { ...base, codigo_orden: 'OP-CANCELLED', estado: 'CANCELADA' },
    { ...base, codigo_orden: 'OP-CANCELLED-REPLENISHMENT', reposicion_id: 1, reposicion_estado: 'CANCELADA' },
    { ...base, codigo_orden: 'OP-REPLENISHMENT', estado: 'EN_PROCESO', reposicion_id: 2, reposicion_estado: 'PENDIENTE_ALISTAMIENTO' },
  ];
  const consumed = productionUseSummaries(rows);
  assert.deepEqual(consumed.map(row => row.order), ['OP-USED']);
  assert.equal(consumed[0].netDelivered, 0);
  assert.deepEqual(productionReservationSummaries(rows).map(row => row.order), ['OP-PLANNED', 'OP-REPLENISHMENT']);
});

test('long multi-page trace retains every event exactly once', () => {
  const lines = Array.from({ length: 160 }, (_, i) => `MOV-${String(i).padStart(4, '0')} | SKU-TEST | lote TEST | 10 und | cliente de prueba | recepcion y despacho`);
  const text = lines.join('\n');
  const pages = paginateMessage(text);
  assert.ok(pages.length >= 4);
  assert.ok(pages.every(page => page.length <= 3400));
  assert.equal(pages.join('\n'), text);
});

test('WhatsApp shares the dashboard DATETIME parser rather than assuming Vercel UTC', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(source, /createConnection: DB.*require\('\.\.\/\.\.\/_lib\/db'\)/);
  assert.doesNotMatch(source, /mysql\.createConnection/);
  const { connectionConfig } = require('../api/_lib/db');
  assert.equal(connectionConfig().timezone, process.env.DB_TIMEZONE || '-05:00');
});
