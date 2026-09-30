const fs = require('node:fs');
const path = require('node:path');
const { createConnection } = require('../api/_lib/db');

function loadEnvFile() {
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) return;
  const candidates = [path.join(__dirname, '../.env'), path.join(__dirname, '../../.env'),
    path.join(__dirname, '../../../.env')];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
  for (const [dbKey, mysqlKey] of [
    ['DB_HOST', 'MYSQL_HOST'], ['DB_PORT', 'MYSQL_PORT'], ['DB_USER', 'MYSQL_USER'],
    ['DB_PASSWORD', 'MYSQL_PASSWORD'], ['DB_NAME', 'MYSQL_DATABASE'],
  ]) process.env[dbKey] ||= process.env[mysqlKey];
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes-i-understand-this-changes-the-qa-schema')) {
    throw new Error('Explicit schema-change confirmation flag is required');
  }
  loadEnvFile();
  const source = fs.readFileSync(path.join(__dirname,
    '../database/40_production_pick_reviews.sql'), 'utf8');
  const conn = await createConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) AS present FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produccion_alistamiento_revisiones'`
    );
    const present = Number(rows[0]?.present) === 1;
    if (apply && !present) await conn.query(source);
    const [columns] = await conn.execute(
      `SELECT COUNT(*) AS present FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produccion_alistamiento_revisiones'
          AND COLUMN_NAME = 'seleccion_pendiente'`
    );
    const choiceColumnPresent = Number(columns[0]?.present) === 1;
    if (apply && present && !choiceColumnPresent) await conn.execute(
      `ALTER TABLE produccion_alistamiento_revisiones
         ADD COLUMN seleccion_pendiente JSON NULL AFTER huella`
    );
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run',
      table: 'produccion_alistamiento_revisiones', presentBefore: present,
      created: apply && !present, choiceColumnPresentBefore: choiceColumnPresent,
      choiceColumnAdded: apply && present && !choiceColumnPresent })}\n`);
  } finally { await conn.end(); }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
