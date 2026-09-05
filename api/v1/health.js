/** Public liveness/readiness probe. Never expose schema or record identifiers. */
const { query } = require('../_lib/db');

module.exports = async (req, res) => {
  const timestamp = new Date().toISOString();
  try {
    await query('SELECT 1');
    return res.status(200).json({ ok: true, status: 'ok', timestamp });
  } catch (e) {
    console.error('[health] database unavailable');
    return res.status(503).json({ ok: false, status: 'unavailable', timestamp });
  }
};
