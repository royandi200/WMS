const fs = require('fs');
const path = require('path');
const { loadEnvironment } = require('./apply-additional-confirmations-migration');
const { createConnection } = require('../api/_lib/db');

async function inspect(conn) {
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recepcion_distribuciones'
        AND COLUMN_NAME = 'lote_proveedor'`
  );
  return rows.length > 0;
}

async function migrate(conn, apply = false) {
  const exists = await inspect(conn);
  if (!apply || exists) return { mode: apply ? 'already-applied' : 'dry-run', pending: !exists };
  await conn.query(fs.readFileSync(path.join(__dirname, '../database/31_reception_supplier_lots.sql'), 'utf8'));
  if (!await inspect(conn)) throw new Error('Migracion 31 incompleta');
  return { mode: 'applied', pending: false };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes-i-understand-this-changes-the-qa-schema')) {
    throw new Error('Confirma explicitamente el cambio de esquema QA');
  }
  loadEnvironment();
  const conn = await createConnection();
  try { console.log(JSON.stringify(await migrate(conn, apply))); }
  finally { await conn.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate };
