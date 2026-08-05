function classifyInventoryRow(row, today = new Date()) {
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
    saldo_fisico: physicalAvailable,
    disponible: operationalAvailable,
    bloqueada: Math.max(physicalAvailable - operationalAvailable, 0),
    qty_initial: row.qty_initial == null ? null : Number(row.qty_initial),
    qty_current: row.qty_current == null ? null : Number(row.qty_current),
    estado_calculado: status,
  };
}

module.exports = { classifyInventoryRow };
