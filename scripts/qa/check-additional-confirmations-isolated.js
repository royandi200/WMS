const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEnvironment } = require('../apply-additional-confirmations-migration');
const { createConnection } = require('../../api/_lib/db');
const { beginAdditionalConfirmation, completeAdditionalConfirmation } = require('../../api/_lib/additional-confirmation');

async function main() {
  loadEnvironment();
  const conn = await createConnection();
  try {
    // Session-local tables shadow the real names. No operational table is written.
    await conn.query(fs.readFileSync(path.resolve(__dirname, '../../database/30_additional_operation_confirmations.sql'), 'utf8')
      .replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'));
    await conn.query('CREATE TEMPORARY TABLE mermas (id BIGINT PRIMARY KEY, numero VARCHAR(80)) ENGINE=InnoDB');
    await conn.execute('INSERT INTO mermas VALUES (1, ?)', ['MER-ISOLATED']);
    const input = { kind: 'MERMA', userId: 5, base: 'MER-ISOLATED', payload: { quantity: 1 } };
    await conn.beginTransaction();
    const pending = await beginAdditionalConfirmation(conn, input);
    await completeAdditionalConfirmation(conn, pending, { numero: 'MER-RESULT', cantidad: 1 });
    await conn.rollback();
    const [[rolledBack]] = await conn.execute('SELECT COUNT(*) AS n FROM confirmaciones_adicionales');
    assert.equal(Number(rolledBack.n), 0);
    await conn.beginTransaction();
    const fresh = await beginAdditionalConfirmation(conn, input);
    assert.equal(fresh.result, null);
    await completeAdditionalConfirmation(conn, fresh, { numero: 'MER-RESULT', cantidad: 1 });
    await conn.commit();
    await conn.beginTransaction();
    const replay = await beginAdditionalConfirmation(conn, { ...input, base: 1 });
    assert.equal(replay.result.numero, 'MER-RESULT');
    await conn.commit();
    await conn.beginTransaction();
    await assert.rejects(beginAdditionalConfirmation(conn, { ...input, payload: { quantity: 2 } }), /datos diferentes/);
    await conn.rollback();
    console.log(JSON.stringify({ ok: true, checks: ['rollback', 'commit', 'replay-by-id-or-code', 'payload-conflict'], operational_writes: 0 }));
  } finally { await conn.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
