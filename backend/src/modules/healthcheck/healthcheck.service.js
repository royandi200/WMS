/**
 * healthcheck.service.js
 * GET /api/v1/health  →  valida conexión DB + existencia de tablas críticas
 * 
 * Uso: llama este endpoint después de cada deploy para confirmar
 * que el servidor nuevo está corriendo y la BD es accesible.
 */
const { sequelize } = require('../../models');

const TABLAS_CRITICAS = [
  'lots', 'kardex', 'stock', 'productos',
  'recepciones', 'despachos', 'waste_records',
  'approval_queue', 'ordenes_produccion', 'bom'
];

exports.check = async () => {
  const resultado = {
    status:    'ok',
    timestamp: new Date().toISOString(),
    db:        'ok',
    tablas:    {},
    errores:   []
  };

  // 1. Ping a la BD
  try {
    await sequelize.authenticate();
  } catch (e) {
    resultado.status = 'error';
    resultado.db     = 'FALLO: ' + e.message;
    resultado.errores.push('DB_CONNECTION: ' + e.message);
    return resultado;
  }

  // 2. Verificar que cada tabla crítica existe y tiene estructura
  for (const tabla of TABLAS_CRITICAS) {
    try {
      const [rows] = await sequelize.query(
        `SELECT COUNT(*) as total FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        { replacements: [tabla] }
      );
      const cols = rows[0]?.total ?? 0;
      resultado.tablas[tabla] = cols > 0
        ? `✅ ${cols} columnas`
        : `❌ NO EXISTE`;
      if (cols === 0) {
        resultado.status = 'degraded';
        resultado.errores.push(`TABLA_FALTANTE: ${tabla}`);
      }
    } catch (e) {
      resultado.tablas[tabla] = `❌ ERROR: ${e.message}`;
      resultado.status = 'degraded';
      resultado.errores.push(`TABLA_ERROR: ${tabla} — ${e.message}`);
    }
  }

  // 3. Smoke test: última fila de lots y kardex
  try {
    const [lots]   = await sequelize.query('SELECT id FROM lots   ORDER BY created_at DESC LIMIT 1');
    const [kardex] = await sequelize.query('SELECT id FROM kardex ORDER BY created_at DESC LIMIT 1');
    resultado.ultima_lot    = lots[0]?.id   || 'vacía';
    resultado.ultimo_kardex = kardex[0]?.id || 'vacío';
  } catch (e) {
    resultado.errores.push('SMOKE_TEST: ' + e.message);
  }

  return resultado;
};
