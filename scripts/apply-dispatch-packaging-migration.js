const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { parseEnv } = require('node:util');

const migrationPath = path.join(__dirname, '..', 'database', '42_dispatch_packaging.sql');

async function inspect(conn) {
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('despacho_embalaje_catalogo',
           'despacho_embalaje_borradores', 'despacho_embalaje_consumos')`
  );
  const [products] = await conn.execute(
    `SELECT siigo_code, activo FROM productos
      WHERE siigo_code IN ('00283-TPDCJM', '00038-CJ12IN')`
  );
  return { tables: tables.map(row => row.TABLE_NAME).sort(),
    lidSkuExists: products.some(row => row.siigo_code === '00283-TPDCJM'),
    infinityBoxSkuExists: products.some(row => row.siigo_code === '00038-CJ12IN') };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes-i-understand-this-changes-the-qa-schema')) {
    throw new Error('Para aplicar, añade --yes-i-understand-this-changes-the-qa-schema');
  }
  const envPath = [path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../../../.env')]
    .find(candidate => fs.existsSync(candidate));
  if (envPath) {
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(envPath, 'utf8')))) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
  for (const [key, alias] of Object.entries({ DB_HOST: 'MYSQL_HOST', DB_PORT: 'MYSQL_PORT',
    DB_USER: 'MYSQL_USER', DB_PASSWORD: 'MYSQL_PASSWORD', DB_NAME: 'MYSQL_DATABASE' })) {
    process.env[key] ||= process.env[alias];
  }
  const config = {
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
  };
  const conn = await mysql.createConnection(config);
  try {
    const before = await inspect(conn);
    if (apply) await conn.query(fs.readFileSync(migrationPath, 'utf8'));
    const after = apply ? await inspect(conn) : undefined;
    if (apply && (after.tables.length !== 3 || !after.lidSkuExists || !after.infinityBoxSkuExists)) {
      throw new Error('La migración de embalaje no quedó completa');
    }
    console.log(JSON.stringify({ ok: true, mode: apply ? 'applied' : 'dry-run',
      schema: config.database, before, ...(after ? { after } : {}) }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
