const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDispatchLookup } = require('../api/_lib/dispatch-workflow');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function workflowHarness({ quantity = 2, completed = false, failWrite = false } = {}) {
  const calls = [];
  const filename = path.resolve(__dirname, '../api/_lib/dispatch-workflow.js');
  const nativeRequire = createRequire(filename);
  const conn = {
    async beginTransaction() { calls.push('begin'); }, async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); }, async end() {},
    async execute(sql) {
      if (sql.includes('FROM despachos')) return [[{ id: 60, numero: 'DSP-QA', bodega_id: 1,
        estado: completed ? 'despachado' : 'picking', siigo_invoice_id: 'FV-QA' }]];
      if (sql.includes('FROM despacho_demanda_items')) return [[{ cantidad_facturada: quantity, cantidad_reservada: quantity }]];
      if (sql.includes('FROM despacho_items')) return [[{ id: 1, producto_id: 1, lote: 'LOT-QA', ubicacion_id: 1, cantidad_sol: quantity }]];
      if (sql.includes('SELECT id, qty_current FROM lots')) return [[{ id: 'LOT-ID', qty_current: 0 }]];
      calls.push(sql);
      if (failWrite) throw new Error('injected failure');
      return [{ affectedRows: 1 }];
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
    require: name => name === './db' ? { createConnection: async () => conn } : nativeRequire(name),
  }, { filename });
  return { calls, run: expectedQuantity => module.exports.confirmImportedDispatch({ dispatchId: 60, userId: 1, expectedQuantity }) };
}

test('N1-05 transactional guard rejects a mismatched quantity before writes', async () => {
  const h = workflowHarness();
  await assert.rejects(h.run(1), error => error.status === 409);
  assert.deepEqual(h.calls, ['begin', 'rollback']);
});

test('complete quantity confirmation, replay and rollback remain supported', async () => {
  const h = workflowHarness();
  assert.equal((await h.run(2)).lotes[0].cantidad, 2);
  assert.equal(h.calls.at(-1), 'commit');
  const replay = workflowHarness({ completed: true });
  assert.equal((await replay.run(2)).already_completed, true);
  assert.deepEqual(replay.calls, ['begin', 'commit']);
  const failure = workflowHarness({ failWrite: true });
  await assert.rejects(failure.run(2));
  assert.equal(failure.calls.at(-1), 'rollback');
  assert.equal(failure.calls.includes('commit'), false);
});

test('resolves a visible Siigo invoice name as either invoice identifier', () => {
  assert.deepEqual(
    buildDispatchLookup({ invoiceId: 'FV-1-10000004804' }),
    {
      clause: '(siigo_invoice_id = ? OR siigo_invoice_name = ?)',
      params: ['FV-1-10000004804', 'FV-1-10000004804'],
    }
  );
});

test('resolves a dispatch number without coercing it to an internal id', () => {
  assert.deepEqual(
    buildDispatchLookup({ dispatchId: 'DSP-SIIGO-FV-1-10000004804' }),
    {
      clause: 'numero = ?',
      params: ['DSP-SIIGO-FV-1-10000004804'],
    }
  );
});

test('resolves a numeric dispatch reference by id or exact dispatch number', () => {
  assert.deepEqual(
    buildDispatchLookup({ dispatchId: '45' }),
    { clause: '(id = ? OR numero = ?)', params: [45, '45'] }
  );
});

test('rejects an empty dispatch lookup', () => {
  assert.throws(
    () => buildDispatchLookup({}),
    error => error.status === 400 && error.message === 'despacho_id o id_factura es obligatorio'
  );
});
