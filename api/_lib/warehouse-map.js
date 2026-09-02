function manifestAssignments(manifest = {}) {
  const canonical = manifest.canonical_sku_overrides || {};
  return Object.entries(manifest.assignments || {}).flatMap(([location, skus]) =>
    skus.map(documentedSku => ({
      location,
      documentedSku,
      catalogSku: canonical[documentedSku] || documentedSku,
    }))
  );
}

function assignmentsByLocation({ manifest, catalogProducts = [], linkedAssignments = [] }) {
  const productsBySku = new Map(catalogProducts.map(product => [product.siigo_code, product]));
  const linkedByLocationProduct = new Map(linkedAssignments.map(assignment => [
    `${assignment.ubicacion_codigo}:${assignment.siigo_code}`,
    assignment,
  ]));
  const grouped = new Map();
  for (const assignment of manifestAssignments(manifest)) {
    const product = productsBySku.get(assignment.catalogSku);
    const linked = linkedByLocationProduct.get(`${assignment.location}:${assignment.catalogSku}`);
    const item = {
      sku: assignment.documentedSku,
      sku_catalogo: product?.siigo_code || null,
      nombre: product?.nombre || 'Referencia asignada en plano',
      producto_id: product?.id ? Number(product.id) : null,
      vinculada_catalogo: Boolean(linked),
      modalidad_operativa: product?.modalidad_operativa || null,
    };
    if (!grouped.has(assignment.location)) grouped.set(assignment.location, []);
    grouped.get(assignment.location).push(item);
  }
  for (const items of grouped.values()) {
    items.sort((left, right) => left.sku.localeCompare(right.sku, 'es', { numeric: true }));
  }
  return grouped;
}

module.exports = { assignmentsByLocation, manifestAssignments };
