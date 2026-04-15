/**
 * api/v1/health.js  — Vercel Serverless Function
 * GET /api/v1/health
 * Público (sin auth). Valida conexión DB y existencia de tablas críticas.
 */
const { db } = require('../_lib/db');

const TABLAS_CRITICAS = [
  'lots', 'kardex', 'stock', 'productos',
  'recepciones', 'despachos', 'waste_records',
  'approval_queue', 'ordenes_produccion', 'bom'
];

module.exports = async (req, res) => {
  const start = Date.now();

  const resultado = {
    ok:          true,
    status:      'ok',
    timestamp:   new Date().toISOString(),
    db:          'connected',
    latency_ms:  0,
    tablas:      {},
    ultima_lot:   null,
    ultimo_kardex: null,
    errores:     []
  };

  // 1. Ping
  try {
    await db.query('SELECT 1');
    resultado.latency_ms = Date.now() - start;
  } catch (e) {
    return res.status(503).json({
      ok: false, status: 'error',
      db: 'FALLO: ' + e.message,
      timestamp: new Date().toISOString()
    });
  }

  // 2. Verificar tablas
  for (const tabla of TABLAS_CRITICAS) {
    try {
      const [rows] = await db.query(
        `SELECT COUNT(*) as total FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tabla]
      );
      const cols = rows[0]?.total ?? 0;
      resultado.tablas[tabla] = cols > 0 ? `✅ ${cols} columnas` : '❌ NO EXISTE';
      if (cols === 0) {
        resultado.ok     = false;
        resultado.status = 'degraded';
        resultado.errores.push('TABLA_FALTANTE: ' + tabla);
      }
    } catch (e) {
      resultado.tablas[tabla] = '❌ ERROR: ' + e.message;
      resultado.ok     = false;
      resultado.status = 'degraded';
      resultado.errores.push('TABLA_ERROR: ' + tabla);
    }
  }

  // 3. Smoke test últimos registros
  try {
    const [lots]   = await db.query('SELECT id FROM lots   ORDER BY created_at DESC LIMIT 1');
    const [kardex] = await db.query('SELECT id FROM kardex ORDER BY created_at DESC LIMIT 1');
    resultado.ultima_lot    = lots[0]?.id    || 'vacía';
    resultado.ultimo_kardex = kardex[0]?.id  || 'vacío';
  } catch (e) {
    resultado.errores.push('SMOKE_TEST: ' + e.message);
  }

  const code = resultado.status === 'ok' ? 200 : resultado.status === 'degraded' ? 207 : 503;
  return res.status(code).json(resultado);
};
