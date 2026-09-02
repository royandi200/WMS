const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '26_production_replenishments.sql');
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

async function exists(conn, kind, name) {
  const source = kind === 'table' ? 'TABLES' : kind === 'column' ? 'COLUMNS' : 'STATISTICS';
  const field = kind === 'table' ? 'TABLE_NAME' : kind === 'column' ? 'COLUMN_NAME' : 'INDEX_NAME';
  const tableClause = kind === 'table' ? '' : ' AND TABLE_NAME = ?';
  const params = kind === 'table' ? [name] : ['produccion_material_lotes', name];
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.${source} WHERE TABLE_SCHEMA = DATABASE()${tableClause} AND ${field} = ? LIMIT 1`,
    kind === 'table' ? params : [params[0], params[1]]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function foreignKeyExists(conn) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'produccion_material_lotes'
       AND CONSTRAINT_NAME = 'fk_prod_mat_lote_reposicion' LIMIT 1`
  );
  return rows.length > 0;
}

async function inspect(conn) {
  const [engines] = await conn.execute(
    `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('produccion_materiales','produccion_material_lotes')`
  );
  return {
    table: await exists(conn, 'table', 'produccion_reposiciones'),
    items: await exists(conn, 'table', 'produccion_reposicion_items'),
    column: await exists(conn, 'column', 'reposicion_id'),
    index: await exists(conn, 'index', 'idx_prod_mat_lote_reposicion'),
    foreign_key: await foreignKeyExists(conn),
    engines: Object.fromEntries(engines.map(row => [row.TABLE_NAME, row.ENGINE])),
  };
}

async function assertNoOrphans(conn) {
  const checks = [
    ['material sin OP', `SELECT COUNT(*) AS total FROM produccion_materiales pm LEFT JOIN ordenes_produccion op ON op.id=pm.orden_produccion_id WHERE op.id IS NULL`],
    ['material sin producto', `SELECT COUNT(*) AS total FROM produccion_materiales pm LEFT JOIN productos p ON p.id=pm.producto_id WHERE p.id IS NULL`],
    ['lote sin material', `SELECT COUNT(*) AS total FROM produccion_material_lotes x LEFT JOIN produccion_materiales pm ON pm.id=x.produccion_material_id WHERE pm.id IS NULL`],
    ['lote sin stock', `SELECT COUNT(*) AS total FROM produccion_material_lotes x LEFT JOIN stock s ON s.id=x.stock_id WHERE x.stock_id IS NOT NULL AND s.id IS NULL`],
    ['lote sin ubicacion', `SELECT COUNT(*) AS total FROM produccion_material_lotes x LEFT JOIN ubicaciones u ON u.id=x.ubicacion_id WHERE x.ubicacion_id IS NOT NULL AND u.id IS NULL`],
    ['lote sin usuario', `SELECT COUNT(*) AS total FROM produccion_material_lotes x LEFT JOIN usuarios u ON u.id=x.confirmado_por WHERE x.confirmado_por IS NOT NULL AND u.id IS NULL`],
  ];
  const failures = [];
  for (const [label, sql] of checks) {
    const [rows] = await conn.execute(sql);
    if (Number(rows[0]?.total || 0) > 0) failures.push(`${label}: ${rows[0].total}`);
  }
  if (failures.length) throw new Error(`No se puede convertir a InnoDB; filas huerfanas: ${failures.join('; ')}`);
  return checks.length;
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const orphanChecks = await assertNoOrphans(conn);
    const before = await inspect(conn);
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', orphan_checks: orphanChecks, before }, null, 2));
      return;
    }
    await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    if (!(await columnExists(conn, 'produccion_material_lotes', 'reposicion_id'))) {
      await conn.query('ALTER TABLE produccion_material_lotes ADD COLUMN reposicion_id INT UNSIGNED NULL AFTER produccion_material_id');
    }
    if (!(await columnExists(conn, 'produccion_reposiciones', 'cancelada_por'))) {
      await conn.query('ALTER TABLE produccion_reposiciones ADD COLUMN cancelada_por INT UNSIGNED NULL AFTER confirmada_por');
    }
    if (!(await columnExists(conn, 'produccion_reposiciones', 'cancelada_en'))) {
      await conn.query('ALTER TABLE produccion_reposiciones ADD COLUMN cancelada_en DATETIME NULL AFTER confirmada_en');
    }
    if (!(await exists(conn, 'index', 'idx_prod_mat_lote_reposicion'))) {
      await conn.query('ALTER TABLE produccion_material_lotes ADD INDEX idx_prod_mat_lote_reposicion (reposicion_id)');
    }
    if (!(await foreignKeyExists(conn))) {
      await conn.query(`ALTER TABLE produccion_material_lotes
        ADD CONSTRAINT fk_prod_mat_lote_reposicion FOREIGN KEY (reposicion_id)
        REFERENCES produccion_reposiciones(id) ON DELETE RESTRICT`);
    }
    const after = await inspect(conn);
    const structuralChecks = [after.table, after.items, after.column, after.index, after.foreign_key];
    if (structuralChecks.some(value => !value)
        || Object.values(after.engines).some(engine => engine !== 'InnoDB')) {
      throw new Error('La migracion de reposiciones quedo incompleta');
    }
    console.log(JSON.stringify({ ok: true, mode: 'applied', orphan_checks: orphanChecks, before, after }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
