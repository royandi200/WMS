const { query } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    await requireRole(req, ['Admin', 'Supervisor']);
  } catch (error) {
    return res.status(error.status || 401).json({ ok: false, error: error.message });
  }

  const hours = boundedNumber(req.query?.hours, 24, 1, 168);
  const staleSeconds = boundedNumber(process.env.BUILDERBOT_INBOX_STALE_SECONDS, 120, 30, 3600);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const staleBefore = new Date(Date.now() - staleSeconds * 1000);

  try {
    const [summary] = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(status = 'RECEIVED') AS received,
         SUM(status = 'PROCESSING') AS processing,
         SUM(status = 'PROCESSED') AS processed,
         SUM(status = 'DUPLICATE') AS duplicates,
         SUM(status = 'FAILED') AS failed,
         ROUND(AVG(CASE WHEN status = 'PROCESSED' THEN duration_ms END), 1) AS avg_duration_ms,
         ROUND(MAX(CASE WHEN status = 'PROCESSED' THEN duration_ms END), 1) AS max_duration_ms
       FROM webhook_ingress_inbox
       WHERE received_at >= ?`,
      [since]
    );
    const [stale] = await query(
      `SELECT COUNT(*) AS total
         FROM webhook_ingress_inbox
        WHERE status IN ('RECEIVED', 'PROCESSING')
          AND received_at < ?`,
      [staleBefore]
    );
    const failures = await query(
      `SELECT event_uuid, action, status, attempt_count, last_error,
              received_at, completed_at
         FROM webhook_ingress_inbox
        WHERE status = 'FAILED' AND received_at >= ?
        ORDER BY received_at DESC
        LIMIT 10`,
      [since]
    );

    const totals = summary || {};
    const staleTotal = Number(stale?.total || 0);
    const failedTotal = Number(totals.failed || 0);
    const status = staleTotal || failedTotal ? 'DEGRADED' : 'HEALTHY';

    return res.status(200).json({
      ok: true,
      status,
      window_hours: hours,
      stale_after_seconds: staleSeconds,
      totals: {
        total: Number(totals.total || 0),
        received: Number(totals.received || 0),
        processing: Number(totals.processing || 0),
        processed: Number(totals.processed || 0),
        duplicates: Number(totals.duplicates || 0),
        failed: failedTotal,
        stale: staleTotal,
      },
      latency_ms: {
        average: totals.avg_duration_ms === null ? null : Number(totals.avg_duration_ms),
        maximum: totals.max_duration_ms === null ? null : Number(totals.max_duration_ms),
      },
      recent_failures: failures,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[webhook/monitor]', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible consultar la bandeja durable' });
  }
};

module.exports.boundedNumber = boundedNumber;
