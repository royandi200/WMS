const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';
const MIGRATION_PATH = path.join(__dirname, '..', 'database', '29_product_alert_thresholds.sql');

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')];
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
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
  };
}

async function inspect(conn) {
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'productos'
        AND COLUMN_NAME = 'permanencia_max_dias'`
  );
  return rows[0] || null;
}

async function inspectValues(conn) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS productos,
            MIN(permanencia_max_dias) AS minimo_dias,
            MAX(permanencia_max_dias) AS maximo_dias,
            SUM(permanencia_max_dias = 90) AS configurados_en_90
       FROM productos`
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn);
    if (!apply) {
      const values = before ? await inspectValues(conn) : null;
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        action: before ? 'normalize-default' : 'add-column',
        before,
        values,
      }, null, 2));
      return;
    }
    if (!before) await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    await conn.query(
      `ALTER TABLE productos
         MODIFY COLUMN permanencia_max_dias SMALLINT UNSIGNED NOT NULL DEFAULT 90
           COMMENT 'Dias maximos de permanencia antes de generar alerta'`
    );
    const after = await inspect(conn);
    if (!after || Number(after.COLUMN_DEFAULT) !== 90 || after.IS_NULLABLE !== 'NO') {
      throw new Error('La migracion 29 no quedo completa');
    }
    const values = await inspectValues(conn);
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, after, values }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
