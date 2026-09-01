function httpError(status, message, code, data) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.data = data;
  return error;
}

function normalizeProductReference(value) {
  let normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  normalized = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bciento\s+cuarenta\b/g, '140')
    .replace(/\bciento\s+veinte\b/g, '120')
    .replace(/\bsesenta\b/g, '60')
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

function filterClause(options = {}) {
  const clauses = [];
  const params = [];
  const productIds = [...new Set((options.productIds || [])
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  const modes = [...new Set((options.modes || [])
    .map(mode => String(mode || '').trim().toUpperCase())
    .filter(Boolean))];
  if (productIds.length) {
    clauses.push(`p.id IN (${productIds.map(() => '?').join(',')})`);
    params.push(...productIds);
  }
  if (modes.length) {
    clauses.push(`p.modalidad_operativa IN (${modes.map(() => '?').join(',')})`);
    params.push(...modes);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

function ambiguousProductError(term, products) {
  const options = products
    .slice(0, 5)
    .map(product => `${product.nombre} (${product.siigo_code})`)
    .join('; ');
  return httpError(
    409,
    `"${term}" puede referirse a varios productos: ${options}. Indica la presentacion o el SKU.`,
    'PRODUCT_REFERENCE_AMBIGUOUS',
    { candidates: products.map(product => ({ id: product.id, sku: product.siigo_code, name: product.nombre })) }
  );
}

async function resolveProductReference(conn, value, options = {}) {
  const term = String(value || '').trim();
  if (!term) throw httpError(400, 'Indica el producto', 'PRODUCT_REFERENCE_REQUIRED');
  if (term.length > 200) throw httpError(400, 'La referencia del producto es demasiado larga', 'PRODUCT_REFERENCE_TOO_LONG');
  const numericId = /^\d+$/.test(term) ? Number(term) : 0;
  const filters = filterClause(options);
  const [exact] = await conn.execute(
    `SELECT DISTINCT p.id, p.siigo_code, p.nombre, p.tipo_producto, p.modalidad_operativa, p.unit_label
       FROM productos p
       LEFT JOIN skus s ON s.producto_id = p.id AND s.activo = 1
      WHERE p.activo = 1
        AND (p.id = ? OR UPPER(p.siigo_code) = UPPER(?) OR UPPER(s.sku) = UPPER(?))${filters.sql}
      LIMIT 2`,
    [numericId, term, term, ...filters.params]
  );
  if (exact.length === 1) {
    const matchedBy = numericId === Number(exact[0].id)
      ? 'id'
      : String(exact[0].siigo_code).toUpperCase() === term.toUpperCase()
        ? 'sku'
        : 'external_sku';
    return { ...exact[0], matched_by: matchedBy, matched_term: term };
  }
  if (exact.length > 1) throw ambiguousProductError(term, exact);

  const normalized = normalizeProductReference(term);
  if (!normalized) throw httpError(400, 'Indica el producto', 'PRODUCT_REFERENCE_REQUIRED');
  let aliases;
  try {
    [aliases] = await conn.execute(
      `SELECT DISTINCT p.id, p.siigo_code, p.nombre, p.tipo_producto, p.modalidad_operativa,
              p.unit_label, pa.alias
         FROM producto_aliases pa
         JOIN productos p ON p.id = pa.producto_id
        WHERE pa.activo = 1 AND p.activo = 1
          AND pa.alias_normalizado = ?${filters.sql}
        ORDER BY CASE pa.origen WHEN 'CLIENTE' THEN 1 WHEN 'NOMBRE_OFICIAL' THEN 2 ELSE 3 END,
                 p.siigo_code
        LIMIT 6`,
      [normalized, ...filters.params]
    );
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    aliases = [];
  }
  if (aliases.length === 1) {
    return { ...aliases[0], matched_by: 'alias', matched_term: term };
  }
  if (aliases.length > 1) throw ambiguousProductError(term, aliases);
  throw httpError(404, `Producto "${term}" no encontrado`, 'PRODUCT_REFERENCE_NOT_FOUND');
}

module.exports = {
  normalizeProductReference,
  resolveProductReference,
  ambiguousProductError,
};
