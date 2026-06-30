const { query } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (process.env.ENABLE_HTTP_MIGRATIONS !== 'true') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  try {
    await requireRole(req, ['Admin']);
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }

  const log = [];
  try {
    for (const col of ['canvas_x', 'canvas_y']) {
      try {
        await query(`ALTER TABLE ubicaciones ADD COLUMN ${col} INT NOT NULL DEFAULT 0`);
        log.push(`${col}: created`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          log.push(`${col}: already exists`);
          continue;
        }
        throw err;
      }
    }
    return res.json({ ok: true, log });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Migration failed', log });
  }
};
