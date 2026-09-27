const fs = require('fs');
const path = require('path');
const { parseEnv } = require('node:util');
const { loadEnvironment } = require('./apply-additional-confirmations-migration');
const { createConnection } = require('../api/_lib/db');

async function inspect(conn) {
  const [rows] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recepcion_lote_reglas'`
  );
  const [columns] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recepcion_distribuciones'
        AND COLUMN_NAME = 'lote_interno_origen'`
  );
  return { table: rows.length > 0, trace: columns.length > 0 };
}

async function migrate(conn, apply = false) {
  const exists = await inspect(conn);
  const pending = !exists.table || !exists.trace;
  if (!apply || !pending) return { mode: apply ? 'already-applied' : 'dry-run', pending };
  if (!exists.table) await conn.query(fs.readFileSync(path.join(__dirname, '../database/34_reception_auto_lot_rules.sql'), 'utf8'));
  if (!exists.trace) await conn.query(fs.readFileSync(path.join(__dirname, '../database/34_reception_auto_lot_trace.sql'), 'utf8'));
  const after = await inspect(conn);
  if (!after.table || !after.trace) throw new Error('Migración de reglas de lote incompleta');
  return { mode: 'applied', pending: false };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes-i-understand-this-changes-the-qa-schema')) {
    throw new Error('Confirma explícitamente el cambio de esquema QA');
  }
  loadEnvironment();
  if (!process.env.DB_HOST || process.env.DB_HOST === 'undefined') {
    const mainCheckoutEnv = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(mainCheckoutEnv)) {
      for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(mainCheckoutEnv, 'utf8')))) {
        process.env[key] ??= value;
      }
    }
  }
  for (const [key, alias] of Object.entries({ DB_HOST: 'MYSQL_HOST', DB_PORT: 'MYSQL_PORT',
    DB_USER: 'MYSQL_USER', DB_PASSWORD: 'MYSQL_PASSWORD', DB_NAME: 'MYSQL_DATABASE' })) {
    if (!process.env[key] || process.env[key] === 'undefined') process.env[key] = process.env[alias];
  }
  const conn = await createConnection();
  try { console.log(JSON.stringify(await migrate(conn, apply))); }
  finally { await conn.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspect, migrate };
