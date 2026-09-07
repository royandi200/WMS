// Execute local GET handlers against one read-only transaction. No HTTP or notifications.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { loadEnvironment } = require('../apply-additional-confirmations-migration');
const { createConnection } = require('../../api/_lib/db');

function localHandler(relative, query, extra = '') {
  const filename = path.resolve(__dirname, '../..', relative);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + extra, {
    module, exports: module.exports, Buffer, process: { env: {} }, console,
    require: name => name.endsWith('/db') ? { query }
      : name.endsWith('/auth') ? { cors() {}, requireAuth: async () => ({ rol: 'admin' }),
        requireCapability: async () => ({ rol: 'admin' }) } : nativeRequire(name),
  }, { filename });
  return module.exports;
}

async function main() {
  loadEnvironment();
  const db = await createConnection();
  let reads = 0;
  try {
    await db.query('SET TRANSACTION READ ONLY');
    await db.beginTransaction();
    const query = async (sql, args = []) => {
      assert.match(sql.trim(), /^SELECT\b/i);
      reads++;
      return (await db.execute(sql, args))[0];
    };
    const results = [];
    for (const relative of ['api/v1/inventory/summary.js', 'api/v1/inventory/aging.js',
      'api/v1/products/index.js', 'api/v1/reception.js']) {
      let body, status;
      const res = { setHeader() {}, status(code) { status = code; return this; },
        json(value) { body = value; return this; } };
      await localHandler(relative, query)({ method: 'GET', query: { limit: '10' } }, res);
      assert.equal(status, 200, `${relative}: ${body?.error}`);
      assert.equal(body.ok, true);
      results.push({ route: relative, ok: true, rows: body.data?.rows?.length ?? null });
    }
    const handler = localHandler('api/v1/webhook/builderbot.js', query,
      '\nmodule.exports.stockRead = queryStockDisponible;');
    const connection = { execute: async (sql, args) => [await query(sql, args)] };
    for (const sku of ['00102-PTASH60', null]) {
      const result = await handler.stockRead(connection, { sku, bodega: 'BG-PPAL', tipoFiltro: 'MP' });
      assert.ok(Array.isArray(result.rows));
      results.push({ stockQuery: sku ? 'product' : 'summary', ok: true, rows: result.rows.length });
    }
    await db.rollback();
    console.log(JSON.stringify({ ok: true, reads, operational_writes: 0,
      scope: 'Local read handlers; authentication not exercised; no HTTP, BBC or SIIGO', results }, null, 2));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
