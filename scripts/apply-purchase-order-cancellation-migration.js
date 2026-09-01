const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '18_purchase_order_cancellation.sql');
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';
const COLUMNS = ['motivo_cancelacion', 'cancelada_por', 'cancelada_en'];

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST)
      && (process.env.DB_USER || process.env.MYSQL_USER)
      && (process.env.DB_NAME || process.env.MYSQL_DATABASE)) return;
  const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function connectionConfig() {
  loadEnvFile();
  return {
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
  };
}

async function schemaState(conn) {
  const [table] = await conn.execute(
    `SELECT ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_compra_proveedor' LIMIT 1`
  );
  if (!table.length) throw new Error('No existe la tabla ordenes_compra_proveedor');
  if (table[0].ENGINE !== 'InnoDB') throw new Error('ordenes_compra_proveedor debe usar InnoDB');
  const [columns] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_compra_proveedor'
        AND COLUMN_NAME IN (${COLUMNS.map(() => '?').join(',')})`,
    COLUMNS
  );
  return { engine: table[0].ENGINE, columns: columns.map(row => row.COLUMN_NAME).sort() };
}

async function verify(conn) {
  const state = await schemaState(conn);
  if (state.columns.length !== COLUMNS.length) throw new Error('Faltan columnas de auditoria de cancelacion');
  const [indexes] = await conn.execute(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_compra_proveedor'
        AND INDEX_NAME = 'idx_oc_cancelada_por'`
  );
  const [constraints] = await conn.execute(
    `SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_compra_proveedor'
        AND CONSTRAINT_NAME = 'fk_oc_cancelada_usuario'`
  );
  if (!indexes.length || !constraints.length) throw new Error('Faltan indice o clave foranea de cancelacion');
  return { ...state, index: indexes[0].INDEX_NAME, foreign_key: constraints[0].CONSTRAINT_NAME };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await schemaState(conn);
    if (before.columns.length === COLUMNS.length) {
      const after = await verify(conn);
      console.log(JSON.stringify({ ok: true, mode: 'already-applied', before, after }, null, 2));
      return;
    }
    if (before.columns.length > 0) {
      throw new Error(`Migracion parcial detectada: ${before.columns.join(', ')}`);
    }
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before }, null, 2));
      return;
    }
    await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    const after = await verify(conn);
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, after }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
