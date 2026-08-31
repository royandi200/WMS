const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '17_warehouse_document_intake.sql');
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';
const TABLES = ['documentos_bodega_borrador', 'documento_bodega_borrador_items'];

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
  const [required] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('maquila_envios','productos','usuarios')`
  );
  if (required.length !== 3) throw new Error('Faltan tablas base para la lectura documental 3Q');
  const [existing] = await conn.execute(
    `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
    TABLES
  );
  if (existing.length > 0 && existing.length < TABLES.length) throw new Error('La migracion documental esta incompleta');
  return { required_tables: required.length, existing_tables: existing.length };
}

async function verify(conn) {
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
    TABLES
  );
  if (tables.length !== TABLES.length || tables.some((table) => table.ENGINE !== 'InnoDB')) {
    throw new Error('No se crearon las tablas documentales como InnoDB');
  }
  return { tables: tables.length, engines: [...new Set(tables.map((table) => table.ENGINE))] };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn);
    if (before.existing_tables === TABLES.length) {
      console.log(JSON.stringify({ ok: true, mode: 'already-applied', before, after: await verify(conn) }, null, 2));
      return;
    }
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
