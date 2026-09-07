function classifyInventoryRow(row, today = new Date()) {
  const physicalQuantity = Number(row.cantidad || 0);
  const physicalAvailable = Number(row.disponible || 0);
  const expiry = row.expiry_date || row.fecha_venc;
  const expiryDate = expiry ? new Date(expiry) : null;
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);

  let status = String(row.lot_status || 'DISPONIBLE').toUpperCase();
  if (!row.lot_id) status = 'SIN_LOTE_MAESTRO';
  else if (!row.ubicacion_id || !row.ubicacion_codigo) status = 'SIN_UBICACION';
  else if (!Number(row.ubicacion_activa) || !Number(row.bodega_activa)) status = 'UBICACION_INACTIVA';
  else if (expiryDate && expiryDate < day) status = 'VENCIDO';

  const operationalAvailable = status === 'DISPONIBLE' ? physicalAvailable : 0;
  return {
    ...row,
    cantidad: Number(row.cantidad || 0),
    reservada: Number(row.reservada || 0),
    saldo_fisico: physicalQuantity,
    disponible: operationalAvailable,
    bloqueada: status === 'DISPONIBLE' ? 0 : Math.max(physicalQuantity, 0),
    qty_initial: row.qty_initial == null ? null : Number(row.qty_initial),
    qty_current: row.qty_current == null ? null : Number(row.qty_current),
    estado_calculado: status,
  };
}

// Fixed aliases for read-only stock queries; never interpolate user identifiers.
const ELIGIBLE_STOCK_SQL = `l.id IS NOT NULL
  AND l.status = 'DISPONIBLE'
  AND l.product_id = s.producto_id AND BINARY l.lpn = BINARY s.lote
  AND u.id = s.ubicacion_id AND u.bodega_id = s.bodega_id AND u.activa = 1
  AND b.id = s.bodega_id AND b.activa = 1
  AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
       OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())`;
const STOCK_JOINS_SQL = `LEFT JOIN lots l ON l.product_id = s.producto_id AND BINARY l.lpn = BINARY s.lote
  LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.bodega_id = s.bodega_id
  LEFT JOIN bodegas b ON b.id = s.bodega_id`;
const AVAILABLE_STOCK_SQL = `CASE WHEN ${ELIGIBLE_STOCK_SQL}
  THEN GREATEST(s.cantidad - COALESCE(s.reservada, 0), 0) ELSE 0 END`;

module.exports = { classifyInventoryRow, ELIGIBLE_STOCK_SQL, STOCK_JOINS_SQL, AVAILABLE_STOCK_SQL };
