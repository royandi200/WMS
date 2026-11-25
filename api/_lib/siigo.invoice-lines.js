// Líneas de envío o servicio que no mueven inventario. Códigos exactos,
// separados por coma en SIIGO_IGNORED_CODES.
function inventoryLines(items) {
  const ignored = new Set(String(process.env.SIIGO_IGNORED_CODES || 'env-1')
    .split(',').map(code => code.trim().toLowerCase()).filter(Boolean));
  return (Array.isArray(items) ? items : [])
    .filter(item => !ignored.has(String(item?.code || '').trim().toLowerCase()));
}

module.exports = { inventoryLines };
