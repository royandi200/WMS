async function preferredLocationsByProduct(db, productIds = []) {
  const ids = [...new Set(productIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  let rows;
  try {
    [rows] = await db.execute(
      `SELECT pu.producto_id, pu.prioridad, pu.tipo_asignacion,
              u.id AS ubicacion_id, u.codigo AS ubicacion
         FROM producto_ubicaciones pu
         JOIN ubicaciones u ON u.id = pu.ubicacion_id AND u.activa = 1
         JOIN bodegas b ON b.id = u.bodega_id AND b.activa = 1
        WHERE pu.activa = 1 AND pu.producto_id IN (${placeholders})
        ORDER BY pu.producto_id, pu.prioridad, u.codigo`,
      ids
    );
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') return new Map(ids.map(id => [id, []]));
    throw error;
  }
  const grouped = new Map(ids.map(id => [id, []]));
  for (const row of rows) {
    grouped.get(Number(row.producto_id))?.push({
      id: Number(row.ubicacion_id),
      codigo: row.ubicacion,
      prioridad: Number(row.prioridad),
      tipo: row.tipo_asignacion,
    });
  }
  return grouped;
}

async function addPreferredLocations(db, items = []) {
  const grouped = await preferredLocationsByProduct(db, items.map(item => item.producto_id));
  return items.map(item => {
    const locations = grouped.get(Number(item.producto_id)) || [];
    return {
      ...item,
      ubicacion_sugerida_id: locations[0]?.id || null,
      ubicacion_sugerida: locations[0]?.codigo || null,
      ubicaciones_sugeridas: locations,
    };
  });
}

module.exports = { addPreferredLocations, preferredLocationsByProduct };
