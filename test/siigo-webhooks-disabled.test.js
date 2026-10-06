const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Si un webhook desactivado intentara usar la base de datos, la prueba falla.
const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async () => { throw new Error('no debe consultar la base de datos'); },
  createConnection: async () => { throw new Error('no debe abrir conexión'); },
} };

function response() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

for (const name of ['siigo-credit-notes', 'siigo-invoices', 'siigo-purchases']) {
  test(`${name}: un POST con Partner-Id ya no modifica inventario`, async () => {
    const handler = require(`../api/v1/webhook/${name}`);
    const res = response();
    await handler({
      method: 'POST',
      headers: { 'partner-id': 'WMSKainotomia' },
      body: { id: 'NC-1', items: [{ code: '00006-TRP', quantity: 999 }] },
    }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /desactivado/u);
  });
}

test('el webhook de productos sigue exigiendo su secreto', () => {
  const source = require('node:fs').readFileSync(
    path.join(__dirname, '../api/v1/webhook/siigo-products.js'), 'utf8');
  assert.match(source, /SIIGO_WEBHOOK_SECRET/u);
});
