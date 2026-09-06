const assert = require('node:assert/strict');
const { loadEnvironment } = require('../apply-additional-confirmations-migration');
const { createConnection } = require('../../api/_lib/db');
const { dashboardMetrics } = require('../../api/_lib/dashboard-metrics');
const { draftQuantitySummary } = require('../../api/_lib/quantity-totals');

async function main() {
  loadEnvironment();
  const db = await createConnection();
  try {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('SET TRANSACTION READ ONLY');
    await db.beginTransaction();
    const query = async (sql, args = []) => (await db.execute(sql, args))[0];
    const report = await dashboardMetrics(query, { period: 'week', approvalsAllowed: true });
    const [direct] = await query(`SELECT COUNT(*) AS n FROM recepciones WHERE completado_en >= ? AND completado_en < ?`, [report.range.from, report.range.to]);
    assert.equal(report.reception.count, Number(direct.n));
    const [date] = await query(`SELECT created_at, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS wall_time FROM kardex ORDER BY created_at DESC LIMIT 1`);
    if (date) {
      const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date.created_at);
      assert.equal(local, date.wall_time);
    }
    const [draft] = await query(`SELECT id FROM documentos_bodega_borrador WHERE referencia_documento = ?`, ['QA-DOC-20260906-R09-OC-001']);
    const documentSummary = draft ? await draftQuantitySummary(db, draft.id) : null;
    await db.commit();
    console.log(JSON.stringify({ ok: true, operational_writes: 0, documentSummary, report }, null, 2));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
