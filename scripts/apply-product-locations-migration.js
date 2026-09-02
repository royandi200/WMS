const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';
const MIGRATION_PATH = path.join(__dirname, '..', 'database', '25_product_location_assignments.sql');
const MANIFEST_PATH = path.join(__dirname, '..', 'database', 'warehouse_positions_master.json');

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
  };
}

function allLocationCodes(manifest) {
  const codes = [];
  for (const [aisle, definition] of Object.entries(manifest.position_sets)) {
    const values = definition.values || Array.from(
      { length: definition.to - definition.from + 1 },
      (_, index) => definition.from + index
    );
    for (const value of values) codes.push(`${aisle}${value}`);
  }
  return codes;
}

function assignmentRows(manifest) {
  const positionsBySku = new Map();
  for (const [location, skus] of Object.entries(manifest.assignments)) {
    for (const documentedSku of skus) {
      const sku = manifest.canonical_sku_overrides?.[documentedSku] || documentedSku;
      if (!positionsBySku.has(sku)) positionsBySku.set(sku, []);
      if (!positionsBySku.get(sku).includes(location)) positionsBySku.get(sku).push(location);
    }
  }
  return [...positionsBySku.entries()].flatMap(([sku, locations]) => locations.map((location, index) => ({
    sku,
    location,
    priority: index + 1,
    type: index === 0 ? 'PRIMARIA' : 'SECUNDARIA',
  })));
}

async function inspect(conn, manifest) {
  const [[warehouse]] = await conn.execute(
    'SELECT id, codigo, nombre FROM bodegas WHERE codigo = ? AND activa = 1 LIMIT 1',
    [manifest.warehouse_code]
  );
  if (!warehouse) throw new Error(`No existe la bodega activa ${manifest.warehouse_code}`);
  const rows = assignmentRows(manifest);
  const skus = [...new Set(rows.map(row => row.sku))];
  const placeholders = skus.map(() => '?').join(',');
  const [products] = await conn.execute(
    `SELECT id, siigo_code, nombre, activo FROM productos WHERE siigo_code IN (${placeholders})`,
    skus
  );
  const productsBySku = new Map(products.map(product => [product.siigo_code, product]));
  const unknown = skus.filter(sku => !productsBySku.has(sku));
  const inactive = products.filter(product => !Number(product.activo)).map(product => product.siigo_code).sort();
  const applicable = rows.filter(row => Number(productsBySku.get(row.sku)?.activo));
  const locations = allLocationCodes(manifest);
  const [existingLocations] = await conn.execute(
    `SELECT codigo FROM ubicaciones WHERE bodega_id = ? AND codigo IN (${locations.map(() => '?').join(',')})`,
    [warehouse.id, ...locations]
  );
  const [[table]] = await conn.execute(
    `SELECT COUNT(*) AS count FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producto_ubicaciones'`
  );
  return {
    warehouse,
    productsBySku,
    locations,
    applicable,
    summary: {
      table_exists: Boolean(Number(table.count)),
      positions_documented: locations.length,
      positions_existing: existingLocations.length,
      assignments_documented: rows.length,
      assignments_applicable: applicable.length,
      unknown_skus: unknown.sort(),
      inactive_skus: inactive,
      known_issues: manifest.known_issues,
    },
  };
}

async function applyManifest(conn, manifest, inspection) {
  await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  await conn.beginTransaction();
  try {
    for (const code of inspection.locations) {
      const aisle = code.charAt(0);
      const position = code.slice(1);
      await conn.execute(
        `INSERT IGNORE INTO ubicaciones
           (bodega_id, codigo, zona, pasillo, nivel, posicion, activa, canvas_x, canvas_y)
         VALUES (?, ?, ?, ?, '1', ?, 1, 0, 0)`,
        [inspection.warehouse.id, code, aisle, aisle, position]
      );
    }
    const [locations] = await conn.execute(
      `SELECT id, codigo FROM ubicaciones WHERE bodega_id = ? AND codigo IN (${inspection.locations.map(() => '?').join(',')})`,
      [inspection.warehouse.id, ...inspection.locations]
    );
    const locationsByCode = new Map(locations.map(location => [location.codigo, location]));
    for (const row of inspection.applicable) {
      const product = inspection.productsBySku.get(row.sku);
      const location = locationsByCode.get(row.location);
      if (!product || !location) throw new Error(`No se pudo resolver ${row.sku} en ${row.location}`);
      await conn.execute(
        `INSERT INTO producto_ubicaciones
           (producto_id, ubicacion_id, prioridad, tipo_asignacion, activa, fuente)
         VALUES (?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE prioridad = VALUES(prioridad),
           tipo_asignacion = VALUES(tipo_asignacion), activa = 1,
           fuente = VALUES(fuente), actualizado_en = NOW()`,
        [product.id, location.id, row.priority, row.type, manifest.source]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn, manifest);
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', ...before.summary }, null, 2));
      return;
    }
    await applyManifest(conn, manifest, before);
    const after = await inspect(conn, manifest);
    const [[counts]] = await conn.execute(
      `SELECT COUNT(*) AS assignments,
              COUNT(DISTINCT producto_id) AS products,
              COUNT(DISTINCT ubicacion_id) AS positions
         FROM producto_ubicaciones WHERE activa = 1 AND fuente = ?`,
      [manifest.source]
    );
    console.log(JSON.stringify({ ok: true, mode: 'applied', before: before.summary, after: after.summary, seeded: counts }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
