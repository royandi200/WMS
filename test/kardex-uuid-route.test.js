const test = require('node:test');
const assert = require('node:assert/strict');

test('kardex reconstructs historical lot balances without coercing UUID identifiers', async () => {
  const dbPath = require.resolve('../api/_lib/db');
  const authPath = require.resolve('../api/_lib/auth');
  const routePath = require.resolve('../api/v1/inventory/kardex');
  const previous = [dbPath, authPath, routePath].map(path => require.cache[path]);
  const lotId = '9a40956a-df79-4cfb-8ea4-5685fc5e023e';
  const otherId = '8a40956a-df79-4cfb-8ea4-5685fc5e023e';
  const calls = [];
  require.cache[dbPath] = { exports: { query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes('COUNT(*)')) return [{ total: 2 }];
    if (sql.includes('WHERE k.lot_id IN')) return [
      { id: 'receipt', lot_id: lotId, qty: 2000, qty_current: 1995 },
      { id: 'waste', lot_id: lotId, qty: -5, qty_current: 1995 },
      { id: 'other', lot_id: otherId, qty: 7, qty_current: 7 },
    ];
    if (sql.includes('LIMIT ? OFFSET ?')) return [
      { id: 'waste', lot_id: lotId, product_id: 51, qty: -5, balance_after: 8540.1 },
      { id: 'other', lot_id: otherId, product_id: 51, qty: 7, balance_after: 9000 },
    ];
    throw new Error('Unexpected query: ' + sql);
  } } };
  require.cache[authPath] = { exports: { cors() {}, requireAuth: async () => ({ id: 1 }) } };
  delete require.cache[routePath];
  try {
    let status;
    let body;
    await require(routePath)({ method: 'GET', query: { sku: '00051-MPASH' } }, {
      status(value) { status = value; return this; },
      json(value) { body = value; return this; },
    });
    assert.equal(status, 200);
    assert.deepEqual(calls.find(call => call.sql.includes('WHERE k.lot_id IN')).args, [lotId, otherId]);
    assert.equal(body.data.rows[0].balance_after, 1995);
    assert.equal(body.data.rows[1].balance_after, 7);
    assert.ok(body.data.rows.every(row => row.balance_scope === 'LOTE'));
    assert.equal(calls.length, 3);
  } finally {
    [dbPath, authPath, routePath].forEach((path, index) => {
      if (previous[index]) require.cache[path] = previous[index];
      else delete require.cache[path];
    });
  }
});
