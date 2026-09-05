function roundQty(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

async function getEligibleStock(conn, productId, warehouseId) {
  const [rows] = await conn.execute(
    `SELECT COALESCE(SUM(s.cantidad - COALESCE(s.reservada, 0)), 0) AS disponible
       FROM stock s
       JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
       JOIN ubicaciones u ON u.id = s.ubicacion_id
        AND u.bodega_id = s.bodega_id AND u.activa = 1
      WHERE s.producto_id = ? AND s.bodega_id = ?
        AND l.status = 'DISPONIBLE'
        AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
        AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
             OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())`,
    [productId, warehouseId]
  );
  return roundQty(rows[0]?.disponible || 0);
}

function formatCapacityCheck(component, needed, available, fallbackUnit = '') {
  const sku = typeof component === 'object' ? component.sku : component;
  const name = typeof component === 'object' ? component.name : '';
  const unit = (typeof component === 'object' ? component.unit : fallbackUnit) || '';
  const ok = available >= needed;
  const unitSuffix = unit ? ` ${unit}` : '';
  const shortage = ok ? '' : `, faltan ${roundQty(needed - available)}${unitSuffix}`;
  return {
    ok,
    line: `  ${ok ? '✅' : '❌'} ${name ? `${name} (${sku})` : sku}: necesita ${needed}${unitSuffix}, disponible ${available}${unitSuffix}${shortage}`,
  };
}

module.exports = { formatCapacityCheck, getEligibleStock };
