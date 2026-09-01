const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '19_purchase_order_document_intake.sql');
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
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'documentos_bodega_borrador'
              AND COLUMN_NAME IN ('proveedor_nit','tercero_id','moneda','orden_compra_id'))
          OR (TABLE_NAME = 'documento_bodega_borrador_items'
              AND COLUMN_NAME IN ('unidad','precio_unitario')))`
  );
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'documento_bodega_borrador_archivos'`
  );
  return { columns: columns.length, fileTable: tables.length === 1 };
}

async function verify(conn) {
  const state = await inspect(conn);
  if (state.columns !== 6 || !state.fileTable) throw new Error('La migracion de OC documental no quedo completa');
  const [indexes] = await conn.execute(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos_bodega_borrador'
        AND INDEX_NAME = 'uk_documento_tipo_origen_referencia'`
  );
  if (!indexes.length) throw new Error('Falta el indice idempotente por tipo documental');
  return { ...state, idempotencyIndex: true };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn);
    if (before.columns === 6 && before.fileTable) {
      console.log(JSON.stringify({ ok: true, mode: 'already-applied', before, after: await verify(conn) }, null, 2));
      return;
    }
    if (before.columns || before.fileTable) throw new Error('La migracion 19 esta aplicada parcialmente');
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before }, null, 2));
      return;
    }
    await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, after: await verify(conn) }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
