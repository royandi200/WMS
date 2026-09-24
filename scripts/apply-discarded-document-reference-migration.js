const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const migrationPath = path.join(__dirname, '..', 'database', '39_discarded_document_reference_reuse.sql');
const applyFlag = '--apply';
const confirmFlag = '--yes-i-understand-this-changes-the-qa-schema';

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '..', '..', '.env'),
  ];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    if (!(match[1] in process.env)) process.env[match[1]] = value;
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
  const [columns] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos_bodega_borrador'
        AND COLUMN_NAME = 'referencia_documento_activa'`
  );
  const [indexes] = await conn.execute(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos_bodega_borrador'
        AND INDEX_NAME IN ('uk_documento_tipo_origen_referencia',
                           'uk_documento_tipo_origen_referencia_activa')`
  );
  return {
    activeReferenceColumn: columns.length === 1,
    legacyIndex: indexes.some(row => row.INDEX_NAME === 'uk_documento_tipo_origen_referencia'),
    activeReferenceIndex: indexes.some(row => row.INDEX_NAME === 'uk_documento_tipo_origen_referencia_activa'),
  };
}

async function main() {
  const apply = process.argv.includes(applyFlag);
  if (apply && !process.argv.includes(confirmFlag)) {
    throw new Error(`Para aplicar usa ${applyFlag} ${confirmFlag}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn);
    if (before.activeReferenceColumn && before.activeReferenceIndex && !before.legacyIndex) {
      console.log(JSON.stringify({ ok: true, mode: 'already-applied', before }));
      return;
    }
    if (before.activeReferenceColumn || before.activeReferenceIndex || !before.legacyIndex) {
      throw new Error('Esquema documental parcial o inesperado; no se aplicó la migración');
    }
    const [duplicates] = await conn.execute(
      `SELECT tipo_documento, origen, referencia_documento, COUNT(*) AS copies
         FROM documentos_bodega_borrador
        WHERE estado <> 'DESCARTADO'
        GROUP BY tipo_documento, origen, referencia_documento
       HAVING COUNT(*) > 1 LIMIT 1`
    );
    if (duplicates.length) throw new Error('Hay referencias activas duplicadas; no se aplicó la migración');
    if (apply) await conn.query(fs.readFileSync(migrationPath, 'utf8'));
    const after = await inspect(conn);
    if (apply && (!after.activeReferenceColumn || !after.activeReferenceIndex || after.legacyIndex)) {
      throw new Error('La migración de referencias descartadas no quedó completa');
    }
    console.log(JSON.stringify({ ok: true, mode: apply ? 'applied' : 'dry-run', before, after }));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
