const fs = require('fs');
const path = require('path');
const { parseEnv } = require('node:util');
const { createConnection } = require('../api/_lib/db');

function loadEnvironment() {
  for (const candidate of [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../.env')]) {
    if (!fs.existsSync(candidate)) continue;
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(candidate, 'utf8')))) {
      process.env[key] ??= value;
    }
    break;
  }
  for (const [key, alias] of Object.entries({ DB_HOST: 'MYSQL_HOST', DB_PORT: 'MYSQL_PORT',
    DB_USER: 'MYSQL_USER', DB_PASSWORD: 'MYSQL_PASSWORD', DB_NAME: 'MYSQL_DATABASE' })) {
    process.env[key] ||= process.env[alias];
  }
}

async function inspect(conn) {
  const [columns] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'confirmaciones_adicionales'`
  );
  const [indexes] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'confirmaciones_adicionales'
       AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX`
  );
  const [tables] = await conn.execute(
    `SELECT ENGINE FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'confirmaciones_adicionales'`
  );
  const expected = ['tipo', 'usuario_id', 'registro_base_id', 'payload_hash', 'resultado', 'creado_en', 'completado_en'];
  const valid = columns.length === expected.length && expected.every(name => columns.some(row => row.COLUMN_NAME === name))
    && indexes.map(row => row.COLUMN_NAME).join(',') === 'tipo,usuario_id,registro_base_id'
    && tables[0]?.ENGINE === 'InnoDB';
  return { exists: columns.length > 0, valid };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes-i-understand-this-changes-the-qa-schema')) {
    throw new Error('Aplicar requiere confirmacion explicita de cambio de esquema QA');
  }
  loadEnvironment();
  const conn = await createConnection();
  try {
    const before = await inspect(conn);
    if (before.exists && !before.valid) throw new Error('Esquema de confirmaciones incompatible; no se modifica');
    if (apply && !before.exists) {
      await conn.query(fs.readFileSync(path.resolve(__dirname, '../database/30_additional_operation_confirmations.sql'), 'utf8'));
    }
    const after = await inspect(conn);
    if (apply && !after.valid) throw new Error('No se completo la migracion');
    console.log(JSON.stringify({ ok: true, mode: apply ? 'applied' : 'dry-run', before, after }));
  } finally { await conn.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { loadEnvironment, inspect };
