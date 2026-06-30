const { createConnection } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (process.env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  try {
    await requireRole(req, ['Admin']);
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }

  let conn;
  const report = {
    ok: true,
    timestamp: new Date().toISOString(),
    checks: {
      database: false,
    },
  };

  try {
    conn = await createConnection();
    await conn.ping();
    report.checks.database = true;
    return res.status(200).json(report);
  } catch (err) {
    return res.status(503).json({
      ok: false,
      timestamp: report.timestamp,
      checks: { database: false },
      error: 'Database check failed',
    });
  } finally {
    if (conn) await conn.end();
  }
};
