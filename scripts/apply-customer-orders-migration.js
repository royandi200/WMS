const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';
const MIGRATION_PATH = path.join(__dirname, '..', 'database', '33_customer_orders.sql');

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  for (const candidate of [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '..', '..', '.env'),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    for (const rawLine of fs.readFileSync(candidate, 'utf8').split(/\r?\n/u)) {
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
    break;
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
  };
}

async function inspect(conn) {
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('pedidos_cliente', 'pedido_cliente_items')`
  );
  const [columns] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_produccion'
        AND COLUMN_NAME = 'pedido_cliente_item_id'`
  );
  return {
    tables: tables.map((row) => row.TABLE_NAME).sort(),
    production_link: columns.length === 1,
  };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn);
    if (apply) {
      const statements = fs.readFileSync(MIGRATION_PATH, 'utf8')
        .split(';').map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) {
        if (statement.includes('ALTER TABLE ordenes_produccion') && before.production_link) continue;
        await conn.query(statement);
      }
    }
    const after = await inspect(conn);
    if (apply && (after.tables.length !== 2 || !after.production_link)) {
      throw new Error('La migración de pedidos de cliente no quedó completa');
    }
    console.log(JSON.stringify({ ok: true, mode: apply ? 'applied' : 'dry-run', before, after }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
