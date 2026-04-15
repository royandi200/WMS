// api/v1/health.js — verifica conexión a la base de datos
const { query } = require('../_lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const start = Date.now();
    await query('SELECT 1');
    const ms = Date.now() - start;
    return res.status(200).json({
      ok: true,
      db: 'connected',
      latency_ms: ms,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      db: 'error',
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  }
};
