const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '16_purchase_order_documents_and_outsourcing.sql');
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';
const NEW_TABLES = [
  'orden_compra_documentos',
  'ordenes_maquila',
  'maquila_materiales',
  'maquila_material_lotes',
  'maquila_envios',
  'maquila_envio_items',
  'maquila_recepciones',
];

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

async function scalar(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return Number(rows[0]?.value || 0);
}

async function preflight(conn) {
  const required = [
    'ordenes_compra_proveedor', 'orden_compra_proveedor_items',
    'recepcion_conciliacion_items', 'recepciones', 'productos', 'usuarios',
    'terceros', 'stock', 'lots', 'movimientos', 'kardex', 'bom',
  ];
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${required.map(() => '?').join(',')})`,
    required
  );
  if (tables.length !== required.length) {
    const found = new Set(tables.map(row => row.TABLE_NAME));
    throw new Error(`Faltan tablas requeridas: ${required.filter(name => !found.has(name)).join(', ')}`);
  }
  const [existingNewTables] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${NEW_TABLES.map(() => '?').join(',')})`,
    NEW_TABLES
  );
  if (existingNewTables.length > 0 && existingNewTables.length < NEW_TABLES.length) {
    throw new Error(`La migracion esta incompleta: ${existingNewTables.map(row => row.TABLE_NAME).join(', ')}`);
  }
  const checks = [
    ['items sin OC', `SELECT COUNT(*) AS value FROM orden_compra_proveedor_items i LEFT JOIN ordenes_compra_proveedor o ON o.id=i.orden_compra_id WHERE o.id IS NULL`],
    ['items sin producto', `SELECT COUNT(*) AS value FROM orden_compra_proveedor_items i LEFT JOIN productos p ON p.id=i.producto_id WHERE p.id IS NULL`],
    ['OC sin usuario', `SELECT COUNT(*) AS value FROM ordenes_compra_proveedor o LEFT JOIN usuarios u ON u.id=o.creado_por WHERE u.id IS NULL`],
    ['OC con proveedor inexistente', `SELECT COUNT(*) AS value FROM ordenes_compra_proveedor o LEFT JOIN terceros t ON t.id=o.tercero_id WHERE o.tercero_id IS NOT NULL AND t.id IS NULL`],
    ['conciliacion sin recepcion', `SELECT COUNT(*) AS value FROM recepcion_conciliacion_items x LEFT JOIN recepciones r ON r.id=x.recepcion_id WHERE r.id IS NULL`],
    ['conciliacion sin OC', `SELECT COUNT(*) AS value FROM recepcion_conciliacion_items x LEFT JOIN ordenes_compra_proveedor o ON o.id=x.orden_compra_id WHERE o.id IS NULL`],
    ['conciliacion sin producto', `SELECT COUNT(*) AS value FROM recepcion_conciliacion_items x LEFT JOIN productos p ON p.id=x.producto_id WHERE p.id IS NULL`],
  ];
  const failures = [];
  for (const [name, sql] of checks) {
    const count = await scalar(conn, sql);
    if (count) failures.push(`${name}: ${count}`);
  }
  if (failures.length) throw new Error(`Preflight con filas huerfanas: ${failures.join('; ')}`);
  return {
    required_tables: required.length,
    orphan_checks: checks.length,
    already_applied: existingNewTables.length === NEW_TABLES.length,
    engines: Object.fromEntries(tables.map(row => [row.TABLE_NAME, row.ENGINE])),
  };
}

async function verify(conn) {
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${NEW_TABLES.map(() => '?').join(',')})`,
    NEW_TABLES
  );
  if (tables.length !== NEW_TABLES.length || tables.some(row => row.ENGINE !== 'InnoDB')) {
    throw new Error('No se crearon todas las tablas 3Q como InnoDB');
  }
  const [columns] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recepcion_conciliacion_items'
        AND COLUMN_NAME IN ('cantidad_factura_acumulada','cantidad_fisica_acumulada','cantidad_aceptada_acumulada','saldo_oc')`
  );
  if (columns.length !== 4) throw new Error('Faltan columnas de conciliacion acumulada');
  const [engines] = await conn.execute(
    `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('ordenes_compra_proveedor','orden_compra_proveedor_items','recepcion_conciliacion_items')`
  );
  if (engines.some(row => row.ENGINE !== 'InnoDB')) throw new Error('Las tablas de OC no quedaron transaccionales');
  return { new_tables: tables.length, reconciliation_columns: columns.length, converted_tables: engines.length };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await preflight(conn);
    if (before.already_applied) {
      const after = await verify(conn);
      console.log(JSON.stringify({ ok: true, mode: 'already-applied', before, after }, null, 2));
      return;
    }
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before }, null, 2));
      return;
    }
    await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    const after = await verify(conn);
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, after }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
