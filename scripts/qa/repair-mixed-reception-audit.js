const assert = require('node:assert/strict');
const { loadEnvironment } = require('../apply-additional-confirmations-migration');
const { createConnection } = require('../../api/_lib/db');

const targets = [
  { id: 'cb511164-71eb-4e5d-8337-b972cbcf71b0', lpn: 'RECBLK-3422e007c109a87963b8ffc42f983dc3', status: 'CUARENTENA' },
  { id: '94015922-3711-4483-a66a-bf054de551f7', lpn: 'RECBLK-acc1ed044af584c638f2d457382b8a64', status: 'RECHAZADO' },
];
const marker = '[RM-01: tipo de ingreso corregido; cantidades sin cambios]';

async function repair(conn, apply = false) {
  if (apply) await conn.beginTransaction();
  try {
    const report = [];
    for (const target of targets) {
      const [rows] = await conn.execute(
        `SELECT k.*, l.lpn, l.status AS lot_status FROM kardex k JOIN lots l ON l.id = k.lot_id
          WHERE k.id = ? ${apply ? 'FOR UPDATE' : ''}`, [target.id]);
      assert.equal(rows.length, 1, 'Fila QA no encontrada');
      const row = rows[0];
      assert.equal(row.reference, 'recepcion:REC-OC-6-001');
      assert.equal(row.lpn, target.lpn);
      assert.equal(row.lot_status, target.status);
      assert.equal(Number(row.product_id), 104);
      assert.equal(Number(row.qty), 1);
      assert.equal(Number(row.balance_after), 1);
      assert.ok(row.notes.includes('Lote proveedor QA-PREVIEW-20260906-IO'));
      assert.ok(row.notes.includes(target.status));
      const already = row.action === 'INGRESO_RECEPCION' && row.notes.includes(marker);
      assert.ok(row.action === '' || already, 'Evento inesperado; no se modifica');
      if (apply && !already) {
        const notes = `${row.notes} | ${marker}`;
        const [result] = await conn.execute(
          `UPDATE kardex SET action = 'INGRESO_RECEPCION', notes = ? WHERE id = ? AND action = ''`,
          [notes, target.id]);
        assert.equal(result.affectedRows, 1);
        const [after] = await conn.execute('SELECT * FROM kardex WHERE id = ?', [target.id]);
        const { lpn, lot_status, ...before } = row;
        assert.deepEqual(after[0], { ...before, action: 'INGRESO_RECEPCION', notes });
      }
      report.push({ id: target.id, status: already ? 'already-repaired' : apply ? 'repaired' : 'pending' });
    }
    if (apply) await conn.commit();
    return { mode: apply ? 'apply' : 'dry-run', report };
  } catch (error) {
    if (apply) await conn.rollback();
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--confirm-qa-reception-61')) throw new Error('Falta confirmacion explicita QA61');
  loadEnvironment();
  const conn = await createConnection();
  try { console.log(JSON.stringify(await repair(conn, apply))); }
  finally { await conn.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { repair, targets, marker };
