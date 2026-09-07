// Transport adapter only: domain validation and inventory confirmation stay in the receipt service.
function receptionPartidas(params = {}) {
  if (!Object.hasOwn(params, 'partidas')) return params;
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (params.confirmacion_final !== false) fail('Las partidas solo se envian para revisar la recepcion, no para confirmarla');
  if (['items', 'productos', 'lineas'].some(key => Object.hasOwn(params, key))) {
    fail('Envia un solo formato de recepcion: partidas o items, no ambos');
  }
  if (!Array.isArray(params.partidas) || !params.partidas.length || params.partidas.length > 2000) {
    fail('Incluye las partidas fisicas de la recepcion (maximo 2000)');
  }
  const allowed = new Set(['sku', 'total_recibido', 'cantidad', 'condicion', 'lote',
    'fecha_vencimiento', 'ubicacion', 'motivo', 'motivo_diferencia']);
  const groups = new Map();
  for (const row of params.partidas) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some(key => !allowed.has(key))) fail('Una partida contiene campos no validos');
    for (const key of ['sku', 'condicion', 'lote', 'fecha_vencimiento', 'ubicacion']) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 255) {
        fail(`Falta ${key} valido en una partida de recepcion`);
      }
    }
    for (const key of ['total_recibido', 'cantidad']) {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] <= 0
        || row[key] > Number.MAX_SAFE_INTEGER) fail(`La ${key} de cada partida debe ser un numero positivo`);
    }
    if (!['DISPONIBLE', 'CUARENTENA', 'RECHAZADO', 'PENDIENTE_DISPOSICION'].includes(row.condicion)) {
      fail('Condicion de recepcion no valida');
    }
    for (const key of ['motivo', 'motivo_diferencia']) {
      if (row[key] != null && (typeof row[key] !== 'string' || row[key].length > 2000)) fail(`El ${key} no es valido`);
    }
    if (row.condicion !== 'DISPONIBLE' && !row.motivo?.trim()) fail('Indica el motivo de la partida no disponible');
    const sku = row.sku.trim().toUpperCase();
    const reason = row.motivo_diferencia?.trim() || null;
    if (!groups.has(sku)) groups.set(sku, {
      sku, cantidad_recibida: row.total_recibido, motivo_diferencia: reason, distribuciones: [],
    });
    const item = groups.get(sku);
    if (item.cantidad_recibida !== row.total_recibido || item.motivo_diferencia !== reason) {
      fail(`El total recibido o el motivo de diferencia de ${sku} cambia entre partidas`);
    }
    const { cantidad, condicion, lote, fecha_vencimiento, ubicacion, motivo } = row;
    item.distribuciones.push({ cantidad, condicion, lote, fecha_vencimiento, ubicacion, motivo });
    if (item.distribuciones.length > 20 || groups.size > 100) fail('La recepcion supera el limite de productos o divisiones');
  }
  for (const item of groups.values()) {
    const sum = item.distribuciones.reduce((total, row) => total + row.cantidad, 0);
    if (!Number.isFinite(sum) || Math.abs(sum - item.cantidad_recibida) > 0.000001) {
      fail(`La suma de partidas de ${item.sku} no coincide con el total recibido`);
    }
  }
  const { partidas, ...rest } = params;
  return { ...rest, items: [...groups.values()] };
}

module.exports = { receptionPartidas };
