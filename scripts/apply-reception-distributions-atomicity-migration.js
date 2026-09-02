const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
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
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

const FOREIGN_KEYS = Object.freeze([
  ['fk_recepcion_dist_recepcion', 'recepcion_id', 'recepciones', 'id'],
  ['fk_recepcion_dist_item', 'recepcion_item_id', 'recepcion_items', 'id'],
  ['fk_recepcion_dist_ubicacion', 'ubicacion_id', 'ubicaciones', 'id'],
  ['fk_recepcion_dist_usuario', 'usuario_id', 'usuarios', 'id'],
]);

async function inspect(conn) {
  const [[table]] = await conn.execute(
    `SELECT ENGINE AS engine
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recepcion_distribuciones'`
  );
  const [constraints] = await conn.execute(
    `SELECT CONSTRAINT_NAME AS name
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'recepcion_distribuciones'`
  );
  const [[orphans]] = await conn.execute(
    `SELECT
       (SELECT COUNT(*) FROM recepcion_distribuciones rd LEFT JOIN recepciones r ON r.id = rd.recepcion_id WHERE r.id IS NULL) AS receptions,
       (SELECT COUNT(*) FROM recepcion_distribuciones rd LEFT JOIN recepcion_items ri ON ri.id = rd.recepcion_item_id WHERE ri.id IS NULL) AS items,
       (SELECT COUNT(*) FROM recepcion_distribuciones rd LEFT JOIN ubicaciones u ON u.id = rd.ubicacion_id WHERE rd.ubicacion_id IS NOT NULL AND u.id IS NULL) AS locations,
       (SELECT COUNT(*) FROM recepcion_distribuciones rd LEFT JOIN usuarios u ON u.id = rd.usuario_id WHERE u.id IS NULL) AS users`
  );
  return {
    engine: table?.engine || null,
    foreignKeys: constraints.map(row => row.name).sort(),
    orphans: Object.fromEntries(Object.entries(orphans || {}).map(([key, value]) => [key, Number(value)])),
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
    if (Object.values(before.orphans).some(Boolean)) {
      throw new Error(`No se puede migrar con relaciones huerfanas: ${JSON.stringify(before.orphans)}`);
    }
    const expectedNames = FOREIGN_KEYS.map(([name]) => name).sort();
    const complete = before.engine === 'InnoDB'
      && expectedNames.every(name => before.foreignKeys.includes(name));
    if (complete) {
      console.log(JSON.stringify({ ok: true, mode: 'already-applied', before }, null, 2));
      return;
    }
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before }, null, 2));
      return;
    }
    if (before.engine !== 'InnoDB') {
      await conn.query('ALTER TABLE recepcion_distribuciones ENGINE=InnoDB');
    }
    for (const [name, column, parentTable, parentColumn] of FOREIGN_KEYS) {
      if (before.foreignKeys.includes(name)) continue;
      await conn.query(
        `ALTER TABLE recepcion_distribuciones ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${parentTable}(${parentColumn})`
      );
    }
    const after = await inspect(conn);
    if (after.engine !== 'InnoDB' || !expectedNames.every(name => after.foreignKeys.includes(name))) {
      throw new Error('La migracion de atomicidad de recepciones no quedo completa');
    }
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, after }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
