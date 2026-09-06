const { createConnection } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES, hasCapability } = require('../_lib/capabilities');
const { dashboardMetrics, reportingPeriod } = require('../_lib/dashboard-metrics');

module.exports = async (req, res) => {
  cors(res, 'GET');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  let conn;
  try {
    const user = await requireCapability(req, CAPABILITIES.DASHBOARD_VIEW);
    const period = req.query?.period || 'week';
    reportingPeriod(period);
    conn = await createConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('SET TRANSACTION READ ONLY');
    await conn.beginTransaction();
    const data = await dashboardMetrics(async (sql, args = []) => (await conn.execute(sql, args))[0], {
      period, approvalsAllowed: hasCapability(user.rol, CAPABILITIES.APPROVALS_READ),
    });
    await conn.commit();
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('[dashboard]', error.message);
    return res.status(error.status || 500).json({ ok: false,
      error: error.status ? error.message : 'No se pudieron actualizar los indicadores' });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
};
