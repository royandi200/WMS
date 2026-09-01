const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '20_direct_purchase_order_receptions.sql');
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')];
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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

async function inspect(conn) {
  const [columns] = await conn.execute(
    `SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recepciones'
        AND COLUMN_NAME = 'preparacion_clave'`
  );
  const [indexes] = await conn.execute(
    `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recepciones'
        AND INDEX_NAME = 'uk_recepcion_preparacion_clave'`
  );
  const [states] = await conn.execute(
    `SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_compra_proveedor'
        AND COLUMN_NAME = 'estado'`
  );
  return {
    preparationColumn: columns.length === 1,
    preparationIndex: indexes.length === 1,
    partialState: String(states[0]?.COLUMN_TYPE || '').includes('RECIBIDA_PARCIAL'),
  };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn);
    if (before.preparationColumn && before.preparationIndex && before.partialState) {
      console.log(JSON.stringify({ ok: true, mode: 'already-applied', before }, null, 2));
      return;
    }
    if (before.preparationColumn || before.preparationIndex || before.partialState) {
      throw new Error('La migracion 20 esta aplicada parcialmente');
    }
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before }, null, 2));
      return;
    }
    await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    const after = await inspect(conn);
    if (!after.preparationColumn || !after.preparationIndex || !after.partialState) {
      throw new Error('La migracion 20 no quedo completa');
    }
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, after }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
