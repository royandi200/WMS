function normalizeTextDate(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : local ? [Number(local[3]), Number(local[2]), Number(local[1])] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function textReceptionPartidas(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text || text.length > 32000) return [];
  const candidateLines = text.split(/\r?\n/u).map(line => line.trim()).filter(line =>
    /^[A-Z0-9][A-Z0-9-]{2,79}\s*:/iu.test(line)
  );
  if (!candidateLines.length) return [];
  const pattern = /^([A-Z0-9][A-Z0-9-]{2,79})\s*:\s*cantidad\s+([0-9]+(?:[.,][0-9]+)?)\s+(?:und|unidad(?:es)?|g|gr|gramos?|kg)\s*,\s*condici[oó]n\s+(DISPONIBLE|CUARENTENA|RECHAZADO|PENDIENTE_DISPOSICION)\s*,\s*lote\s+([^,]{1,80})\s*,\s*vencimiento\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s*,\s*ubicaci[oó]n\s+([A-Z0-9-]{1,80})(?:\s*,\s*motivo\s+(.{1,2000}?))?\.?$/iu;
  const rows = candidateLines.map((line) => {
    const match = line.match(pattern);
    if (!match) throw Object.assign(new Error(`No pude leer todos los campos de la linea: ${line.slice(0, 120)}`), { status: 400 });
    const quantity = Number(match[2].replace(',', '.'));
    const expiry = normalizeTextDate(match[5]);
    if (!Number.isFinite(quantity) || quantity <= 0 || !expiry) {
      throw Object.assign(new Error(`Cantidad o vencimiento invalido para ${match[1]}`), { status: 400 });
    }
    return {
      sku: match[1].toUpperCase(),
      total_recibido: quantity,
      cantidad: quantity,
      condicion: match[3].toUpperCase(),
      lote: match[4].trim(),
      fecha_vencimiento: expiry,
      ubicacion: match[6].toUpperCase(),
      motivo: match[7]?.trim() || undefined,
    };
  });
  return rows;
}

// Transport adapter only: domain validation and inventory confirmation stay in the receipt service.
function receptionPartidas(params = {}, { rawText = '' } = {}) {
  const rowKeys = ['partidas', 'items', 'productos', 'lineas'];
  const hasRows = rowKeys.some(key => Array.isArray(params[key]) && params[key].length);
  if (!hasRows) {
    const parsed = textReceptionPartidas(rawText);
    if (parsed.length) {
      const clean = { ...params, confirmacion_final: false, partidas: parsed };
      for (const key of ['items', 'productos', 'lineas']) {
        if (Array.isArray(clean[key]) && !clean[key].length) delete clean[key];
      }
      const ocId = String(rawText).match(/\bOC\s+ID\s+(\d+)\b/iu)?.[1];
      const mqId = String(rawText).match(/\bMQ\s+ID\s+(\d+)\b/iu)?.[1];
      if (!clean.orden_compra_id && ocId) clean.orden_compra_id = Number(ocId);
      if (!clean.orden_maquila_id && mqId) clean.orden_maquila_id = Number(mqId);
      params = clean;
    }
  }
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

module.exports = { receptionPartidas, textReceptionPartidas };
