const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '28_outsourcing_before_purchase_order.sql');
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function config() {
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
    `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'ordenes_maquila' AND COLUMN_NAME IN ('orden_compra_id','estado','oc_vinculada_por','oc_vinculada_en'))
          OR (TABLE_NAME = 'kardex' AND COLUMN_NAME = 'action'))`
  );
  const byKey = Object.fromEntries(columns.map(row => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
  return {
    purchase_order_nullable: byKey['ordenes_maquila.orden_compra_id']?.IS_NULLABLE === 'YES',
    pending_state: String(byKey['ordenes_maquila.estado']?.COLUMN_TYPE || '').includes('EN_3Q_PENDIENTE_OC'),
    link_audit: Boolean(byKey['ordenes_maquila.oc_vinculada_por'] && byKey['ordenes_maquila.oc_vinculada_en']),
    kardex_action: String(byKey['kardex.action']?.COLUMN_TYPE || '').includes('ENVIO_MAQUILA_3Q'),
  };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  const conn = await mysql.createConnection(config());
  try {
    const before = await inspect(conn);
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before }, null, 2));
      return;
    }
    if (!Object.values(before).every(Boolean)) await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    const after = await inspect(conn);
    if (!Object.values(after).every(Boolean)) throw new Error('La migracion de salida 3Q previa a OC quedo incompleta');
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, after }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
