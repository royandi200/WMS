const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const {
  relationshipKey,
  prepareOperationalSettings,
} = require('../api/_lib/product-operational-settings');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-product-catalog';
const ROOT = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'data', 'product-operational-settings-20260921.json');
const MIGRATION_PATH = path.join(ROOT, 'database', '35_product_commercial_relationships.sql');
const SOURCE_REFERENCE = 'Google Sheets 1RdYUh0B2TCVbxfvf8Y9LaneaOuypbpZborefrSJ-w_0 / Inventario';

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  const candidates = [
    path.join(ROOT, '.env'),
    path.join(ROOT, '..', '.env'),
    path.join(ROOT, '..', '..', '.env'),
    path.join(ROOT, '..', '..', '..', '.env'),
  ];
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

function loadSource() {
  const raw = fs.readFileSync(SOURCE_PATH, 'utf8');
  const document = JSON.parse(raw);
  return {
    document,
    rows: prepareOperationalSettings(document),
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  };
}

function terceroCandidates(terceros, label, relationType) {
  const expected = relationshipKey(label);
  const acceptedTypes = relationType === 'PROVEEDOR'
    ? new Set(['Supplier', 'Other'])
    : new Set(['Customer', 'Other']);
  const matches = terceros.filter((tercero) => acceptedTypes.has(tercero.tipo)
    && [tercero.nombre, tercero.nombre_comercial].some(name => relationshipKey(name) === expected));
  return [...new Map(matches.map(item => [Number(item.id), item])).values()];
}

function buildPlan(sourceRows, products, terceros) {
  const bySku = new Map(products.map(product => [String(product.siigo_code).toUpperCase(), product]));
  const matched = [];
  const missing = [];
  const inactive = [];
  const aliases = [];
  const relationships = [];
  const unmatchedThirdParties = new Set();
  const ambiguousThirdParties = new Set();
  for (const row of sourceRows) {
    const product = bySku.get(row.sku);
    if (!product) {
      missing.push({ sku: row.sku, source_row: row.source_row, item: row.item });
      continue;
    }
    if (!Number(product.activo)) {
      inactive.push({ sku: row.sku, source_row: row.source_row, item: row.item, product_id: Number(product.id) });
      continue;
    }
    matched.push({ product, row });
    if (row.alias) aliases.push({ product_id: Number(product.id), alias: row.alias, normalized: row.alias_key });
    const sourceRelations = [
      ...(row.provider ? [{ type: 'PROVEEDOR', label: row.provider, key: row.provider_key }] : []),
      ...row.clients.map(client => ({ type: 'CLIENTE', label: client.label, key: client.key })),
    ];
    for (const relation of sourceRelations) {
      const candidates = terceroCandidates(terceros, relation.label, relation.type);
      if (!candidates.length) unmatchedThirdParties.add(`${relation.type}:${relation.label}`);
      if (candidates.length > 1) ambiguousThirdParties.add(`${relation.type}:${relation.label}`);
      relationships.push({
        product_id: Number(product.id),
        ...relation,
        tercero_id: candidates.length === 1 ? Number(candidates[0].id) : null,
      });
    }
  }
  return {
    matched,
    missing,
    inactive,
    aliases,
    relationships,
    unmatchedThirdParties: [...unmatchedThirdParties].sort(),
    ambiguousThirdParties: [...ambiguousThirdParties].sort(),
  };
}

function reportPlan(source, plan, mode) {
  return {
    ok: true,
    mode,
    source: source.document.source,
    source_sha256: source.sha256,
    counts: {
      source_rows: source.rows.length,
      matched_products: plan.matched.length,
      missing_products: plan.missing.length,
      inactive_products: plan.inactive.length,
      stock_minimum_updates: plan.matched.filter(item => item.row.stock_minimo !== null).length,
      dwell_day_updates: plan.matched.filter(item => item.row.permanencia_max_dias !== null).length,
      valid_aliases: plan.aliases.length,
      commercial_relationships: plan.relationships.length,
      linked_legal_third_parties: plan.relationships.filter(item => item.tercero_id).length,
    },
    missing_products: plan.missing,
    inactive_products: plan.inactive,
    unmatched_third_party_labels: plan.unmatchedThirdParties,
    ambiguous_third_party_labels: plan.ambiguousThirdParties,
  };
}

async function tableExists(conn, tableName) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS amount FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row.amount) > 0;
}

async function writeBackup(conn, plan, source) {
  const ids = [...new Set(plan.matched.map(item => Number(item.product.id)))];
  const placeholders = ids.map(() => '?').join(',');
  const [products] = await conn.execute(
    `SELECT id, siigo_code, stock_minimo, permanencia_max_dias
       FROM productos WHERE id IN (${placeholders}) ORDER BY id`,
    ids
  );
  const [aliases] = await conn.execute(
    `SELECT id, producto_id, alias, alias_normalizado, origen, activo
       FROM producto_aliases WHERE producto_id IN (${placeholders}) ORDER BY id`,
    ids
  );
  const hasRelationships = await tableExists(conn, 'producto_relaciones_comerciales');
  const relationships = hasRelationships
    ? (await conn.execute(
      `SELECT id, producto_id, tipo, etiqueta_fuente, etiqueta_normalizada,
              tercero_id, origen, fuente_referencia, activo
         FROM producto_relaciones_comerciales
        WHERE producto_id IN (${placeholders}) ORDER BY id`,
      ids
    ))[0]
    : [];
  const backup = {
    created_at: new Date().toISOString(),
    database: connectionConfig().database,
    source_sha256: source.sha256,
    products,
    aliases,
    relationships,
  };
  const stamp = backup.created_at.replace(/[:.]/g, '-');
  const outputDir = path.join(ROOT, 'output', 'backups');
  fs.mkdirSync(outputDir, { recursive: true });
  const backupPath = path.join(outputDir, `product-operational-settings-${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  return backupPath;
}

async function applyPlan(conn, plan, source) {
  const productIds = [...new Set(plan.matched.map(item => Number(item.product.id)))];
  await conn.beginTransaction();
  try {
    for (const { product, row } of plan.matched) {
      const fields = [];
      const values = [];
      if (row.stock_minimo !== null) {
        fields.push('stock_minimo = ?');
        values.push(row.stock_minimo);
      }
      if (row.permanencia_max_dias !== null) {
        fields.push('permanencia_max_dias = ?');
        values.push(row.permanencia_max_dias);
      }
      if (fields.length) {
        values.push(product.id);
        await conn.execute(`UPDATE productos SET ${fields.join(', ')}, actualizado_en = NOW() WHERE id = ?`, values);
      }
    }
    for (const alias of plan.aliases) {
      await conn.execute(
        `INSERT INTO producto_aliases
           (producto_id, alias, alias_normalizado, origen, activo, creado_en, actualizado_en)
         VALUES (?, ?, ?, 'CLIENTE', 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           alias = VALUES(alias), origen = 'CLIENTE', activo = 1, actualizado_en = NOW()`,
        [alias.product_id, alias.alias, alias.normalized]
      );
    }
    if (productIds.length) {
      await conn.execute(
        `UPDATE producto_relaciones_comerciales
            SET activo = 0, actualizado_en = NOW()
          WHERE origen = 'GOOGLE_SHEETS' AND producto_id IN (${productIds.map(() => '?').join(',')})`,
        productIds
      );
    }
    for (const relation of plan.relationships) {
      await conn.execute(
        `INSERT INTO producto_relaciones_comerciales
           (producto_id, tipo, etiqueta_fuente, etiqueta_normalizada, tercero_id,
            origen, fuente_referencia, activo, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, 'GOOGLE_SHEETS', ?, 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           etiqueta_fuente = VALUES(etiqueta_fuente),
           tercero_id = VALUES(tercero_id),
           origen = 'GOOGLE_SHEETS', fuente_referencia = VALUES(fuente_referencia),
           activo = 1, actualizado_en = NOW()`,
        [relation.product_id, relation.type, relation.label, relation.key, relation.tercero_id, SOURCE_REFERENCE]
      );
    }
    const summary = reportPlan(source, plan, 'applied');
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('catalogo', 'INFO', 'Sincronizacion de configuracion operativa de productos', NULL, ?, NOW())`,
      [JSON.stringify({ ...summary.counts, source_sha256: source.sha256, canal: 'google_sheets_sync' })]
    );
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
  const source = loadSource();
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const [products] = await conn.execute(
      `SELECT id, siigo_code, nombre, stock_minimo, permanencia_max_dias, activo
         FROM productos ORDER BY id`
    );
    const [terceros] = await conn.execute(
      `SELECT id, tipo, nombre, nombre_comercial FROM terceros WHERE activo = 1 ORDER BY id`
    );
    const plan = buildPlan(source.rows, products, terceros);
    if (!apply) {
      console.log(JSON.stringify(reportPlan(source, plan, 'dry-run'), null, 2));
      return;
    }
    const backupPath = await writeBackup(conn, plan, source);
    await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    await applyPlan(conn, plan, source);
    console.log(JSON.stringify({
      ...reportPlan(source, plan, 'applied'),
      backup: backupPath,
    }, null, 2));
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  connectionConfig,
  loadSource,
  terceroCandidates,
  buildPlan,
  reportPlan,
};
