const test = require('node:test');
const assert = require('node:assert/strict');
const { repair, targets, marker } = require('../scripts/qa/repair-mixed-reception-audit');

function database({ corrupt = false, failSecond = false } = {}) {
  let rows = targets.map(t => ({ id: t.id, lpn: t.lpn, lot_status: t.status,
    reference: 'recepcion:REC-OC-6-001', product_id: 104, qty: '1.000', balance_after: '1.000',
    action: '', notes: `Lote proveedor QA-PREVIEW-20260906-IO | ${t.status}`, tx_id: `tx-${t.id}` }));
  if (corrupt) rows[1].qty = '2.000';
  let backup; const writes = [];
  return { get rows() { return rows; }, writes,
    async beginTransaction() { backup = structuredClone(rows); },
    async commit() {}, async rollback() { rows = backup; },
    async execute(sql, values) {
      if (sql.startsWith('SELECT k.*')) return [rows.filter(r => r.id === values[0]).map(r => ({ ...r }))];
      if (sql.startsWith('UPDATE')) {
        if (failSecond && values[1] === targets[1].id) throw new Error('second write failed');
        const row = rows.find(r => r.id === values[1]);
        row.action = 'INGRESO_RECEPCION'; row.notes = values[0]; writes.push(values[1]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT *')) {
        return [rows.filter(r => r.id === values[0]).map(({ lpn, lot_status, ...r }) => r)];
      }
      throw new Error('Unexpected SQL');
    },
  };
}

test('audit repair defaults to dry-run with zero writes', async () => {
  const conn = database();
  assert.equal((await repair(conn)).mode, 'dry-run');
  assert.equal(conn.writes.length, 0);
});
test('audit repair changes only event and annotated notes, and is idempotent', async () => {
  const conn = database(); const before = structuredClone(conn.rows);
  await repair(conn, true);
  assert.equal(conn.writes.length, 2);
  assert.deepEqual(conn.rows, before.map(r => ({ ...r, action: 'INGRESO_RECEPCION', notes: `${r.notes} | ${marker}` })));
  assert.ok((await repair(conn, true)).report.every(r => r.status === 'already-repaired'));
  assert.equal(conn.writes.length, 2);
});
test('audit repair rolls back both entries if any fingerprint or write differs', async () => {
  for (const options of [{ corrupt: true }, { failSecond: true }]) {
    const conn = database(options); const before = structuredClone(conn.rows);
    await assert.rejects(repair(conn, true));
    assert.deepEqual(conn.rows, before);
  }
});
