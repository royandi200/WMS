const mysql = require('mysql2/promise');
const {
  connectionConfig,
  loadSource,
  buildPlan,
} = require('../sync-product-operational-settings');
const { resolveProductReference } = require('../../api/_lib/product-references');

function numberEquals(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.00001;
}

async function main() {
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
    const thresholdErrors = [];
    for (const { product, row } of plan.matched) {
      if (row.stock_minimo !== null && !numberEquals(product.stock_minimo, row.stock_minimo)) {
        thresholdErrors.push(`${row.sku}: stock_minimo`);
      }
      if (row.permanencia_max_dias !== null && Number(product.permanencia_max_dias) !== row.permanencia_max_dias) {
        thresholdErrors.push(`${row.sku}: permanencia_max_dias`);
      }
    }
    const ids = plan.matched.map(item => Number(item.product.id));
    const placeholders = ids.map(() => '?').join(',');
    const [aliases] = await conn.execute(
      `SELECT producto_id, alias_normalizado FROM producto_aliases
        WHERE activo = 1 AND producto_id IN (${placeholders})`,
      ids
    );
    const aliasKeys = new Set(aliases.map(alias => `${Number(alias.producto_id)}:${alias.alias_normalizado}`));
    const missingAliases = plan.aliases
      .filter(alias => !aliasKeys.has(`${alias.product_id}:${alias.normalized}`))
      .map(alias => `${alias.product_id}:${alias.alias}`);
    const [relations] = await conn.execute(
      `SELECT producto_id, tipo, etiqueta_normalizada, tercero_id
         FROM producto_relaciones_comerciales
        WHERE activo = 1 AND origen = 'GOOGLE_SHEETS'
          AND producto_id IN (${placeholders})`,
      ids
    );
    const relationKeys = new Set(relations.map(relation => `${Number(relation.producto_id)}:${relation.tipo}:${relation.etiqueta_normalizada}`));
    const expectedRelationKeys = new Set(plan.relationships.map(relation => `${relation.product_id}:${relation.type}:${relation.key}`));
    const missingRelations = [...expectedRelationKeys].filter(key => !relationKeys.has(key));
    const unexpectedRelations = [...relationKeys].filter(key => !expectedRelationKeys.has(key));
    const [[audit]] = await conn.execute(
      `SELECT id, created_at, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.source_sha256')) AS source_sha256
         FROM system_logs
        WHERE modulo = 'catalogo' AND mensaje = 'Sincronizacion de configuracion operativa de productos'
        ORDER BY id DESC LIMIT 1`
    );
    const [dashboardRows] = await conn.execute(
      `SELECT p.siigo_code,
              (SELECT GROUP_CONCAT(DISTINCT pa.alias ORDER BY pa.alias SEPARATOR '||')
                 FROM producto_aliases pa
                WHERE pa.producto_id = p.id AND pa.activo = 1 AND pa.origen = 'CLIENTE') AS aliases,
              (SELECT GROUP_CONCAT(DISTINCT prc.etiqueta_fuente ORDER BY prc.etiqueta_fuente SEPARATOR '||')
                 FROM producto_relaciones_comerciales prc
                WHERE prc.producto_id = p.id AND prc.activo = 1 AND prc.tipo = 'PROVEEDOR') AS proveedores
         FROM productos p
        WHERE p.activo = 1 AND p.siigo_code IN ('00001-TPBI', '00006-TRP')
        ORDER BY p.siigo_code`
    );
    const spokenStockProduct = await resolveProductReference(conn, 'tarros cuadrados x60', {
      allowContextualPartial: true,
      allowCatalogContextual: true,
    });
    const spotSku = new Set(['00001-TPBI', '00006-TRP']);
    const spotIds = plan.matched.filter(item => spotSku.has(item.row.sku)).map(item => Number(item.product.id));
    const spotChecks = plan.matched
      .filter(item => spotSku.has(item.row.sku))
      .map(({ product, row }) => ({
        sku: row.sku,
        stock_minimo: Number(product.stock_minimo),
        permanencia_max_dias: Number(product.permanencia_max_dias),
        alias: row.alias,
        relaciones: relations
          .filter(relation => spotIds.includes(Number(relation.producto_id)) && Number(relation.producto_id) === Number(product.id))
          .map(relation => relation.tipo),
      }));
    const ok = thresholdErrors.length === 0
      && missingAliases.length === 0
      && missingRelations.length === 0
      && unexpectedRelations.length === 0
      && audit?.source_sha256 === source.sha256
      && dashboardRows.length === 2
      && dashboardRows.every(row => row.aliases && row.proveedores)
      && spokenStockProduct.siigo_code === '00006-TRP';
    const result = {
      ok,
      matched_products: plan.matched.length,
      verified_aliases: plan.aliases.length,
      verified_relationships: plan.relationships.length,
      threshold_errors: thresholdErrors,
      missing_aliases: missingAliases,
      missing_relationships: missingRelations,
      unexpected_relationships: unexpectedRelations,
      audit: audit || null,
      dashboard_rows: dashboardRows,
      spoken_stock_reference: spokenStockProduct.siigo_code,
      spot_checks: spotChecks,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
