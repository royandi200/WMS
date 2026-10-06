// Sincronización de productos SIIGO → tabla `productos` (llave: siigo_code).
// La usan la sincronización manual (api/v1/siigo/sync-products) y la
// corrección de facturas con productos aún no sincronizados.
const { query } = require('./db');
const { siigoGet } = require('./siigo.service');

const PAGE_SIZE = 100;

async function fetchProductsByCode(codes) {
  const products = [];
  for (const code of codes) {
    const response = await siigoGet('/v1/products', {
      params: { code, page: 1, page_size: PAGE_SIZE },
      entidad: 'producto',
    });
    const results = response?.results ?? (Array.isArray(response) ? response : []);
    products.push(...results.filter(product => String(product.code || '') === code));
  }
  return products;
}

async function upsertProduct(p) {
  // Mapeo campos SIIGO → columnas tabla `productos`
  const siigoId      = String(p.id              || '');
  const siigoCode    = String(p.code            || '').trim();
  const nombre       = String(p.name            || '').trim();
  const tipo         = p.type || 'Product';
  const accountGroup = p.account_group?.id ?? null;
  const controlStock = p.stock_control ? 1 : 0;
  const precio       = p.prices?.[0]?.price_list?.[0]?.value ?? null;
  const unitCode     = String(p.unit?.code || p.unit?.id || '94');
  const unitLabel    = String(p.unit?.name   || '');
  const taxClass     = p.tax_classification  || 'Taxed';
  const taxIncluded  = p.tax_included ? 1 : 0;
  const activo       = p.active !== false ? 1 : 0;
  const barcode      = p.additional_fields?.barcode || p.barcode || null;

  if (!siigoCode) return 'skip';

  await query(
    `INSERT INTO productos
       (siigo_id, siigo_code, siigo_account_group, nombre, tipo_producto,
        control_stock, precio_venta, unit_code, unit_label,
        tax_classification, tax_included, barcode, activo, siigo_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       siigo_id            = VALUES(siigo_id),
       siigo_account_group = VALUES(siigo_account_group),
       nombre              = VALUES(nombre),
       tipo_producto       = VALUES(tipo_producto),
       control_stock       = VALUES(control_stock),
       precio_venta        = VALUES(precio_venta),
       unit_code           = VALUES(unit_code),
       unit_label          = VALUES(unit_label),
       tax_classification  = VALUES(tax_classification),
       tax_included        = VALUES(tax_included),
       barcode             = VALUES(barcode),
       activo              = VALUES(activo),
       siigo_synced_at     = NOW(),
       actualizado_en      = NOW()`,
    [siigoId, siigoCode, accountGroup, nombre, tipo,
     controlStock, precio, unitCode, unitLabel,
     taxClass, taxIncluded, barcode, activo]
  );
  return 'ok';
}

// Trae de SIIGO solo los códigos indicados y los guarda en el WMS.
async function syncProductCodes(codes) {
  const requested = [...new Set((codes || []).map(code => String(code || '').trim()).filter(Boolean))];
  const products = await fetchProductsByCode(requested);
  const synced = [];
  for (const product of products) {
    if (await upsertProduct(product) === 'ok') synced.push(String(product.code).trim());
  }
  return { synced, notFound: requested.filter(code => !synced.includes(code)) };
}

module.exports = { PAGE_SIZE, fetchProductsByCode, syncProductCodes, upsertProduct };
