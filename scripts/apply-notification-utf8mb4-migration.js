const fs = require('fs');
const path = require('path');
const { loadEnvironment } = require('./apply-additional-confirmations-migration');
const { createConnection } = require('../api/_lib/db');

const TEXT_TYPES = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set']);

async function inspect(conn) {
  const [tables] = await conn.execute(
    `SELECT TABLE_COLLATION
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notificaciones_salida'`
  );
  if (!tables.length) return { exists: false, valid: false, table_collation: null, incompatible_columns: [] };

  const [columns] = await conn.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notificaciones_salida'
      ORDER BY ORDINAL_POSITION`
  );
  const incompatibleColumns = columns
    .filter(column => TEXT_TYPES.has(String(column.DATA_TYPE).toLowerCase()))
    .filter(column => !String(column.COLLATION_NAME || '').toLowerCase().startsWith('utf8mb4_'))
    .map(column => ({ name: column.COLUMN_NAME, collation: column.COLLATION_NAME }));
  const tableCollation = tables[0].TABLE_COLLATION || null;
  return {
    exists: true,
    valid: String(tableCollation || '').toLowerCase().startsWith('utf8mb4_') && incompatibleColumns.length === 0,
    table_collation: tableCollation,
    incompatible_columns: incompatibleColumns,
  };
}

async function migrate(conn, apply = false) {
  const before = await inspect(conn);
  if (!before.exists) throw new Error('La tabla notificaciones_salida no existe');
  if (!apply || before.valid) {
    return { mode: apply ? 'already-applied' : 'dry-run', pending: !before.valid, before, after: before };
  }

  await conn.query(fs.readFileSync(path.resolve(__dirname, '../database/32_notification_utf8mb4.sql'), 'utf8'));
  const after = await inspect(conn);
  if (!after.valid) throw new Error('La migracion utf8mb4 de notificaciones_salida quedo incompleta');
  return { mode: 'applied', pending: false, before, after };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes-i-understand-this-changes-the-qa-schema')) {
    throw new Error('Confirma explicitamente el cambio de esquema QA');
  }
  loadEnvironment();
  const conn = await createConnection();
  try {
    console.log(JSON.stringify(await migrate(conn, apply)));
  } finally {
    await conn.end();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspect, migrate };
