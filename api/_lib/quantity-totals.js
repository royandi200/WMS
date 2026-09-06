function normalizeUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (['g', 'gr', 'gramo', 'gramos'].includes(unit)) return 'g';
  if (['und', 'ud', 'uds', 'un', 'unidad', 'unidades'].includes(unit)) return 'und';
  return unit || 'sin unidad';
}

function quantityTotals(rows, quantityKey = 'cantidad', unitKey = 'unidad') {
  const totals = new Map();
  for (const row of rows) {
    const quantity = Number(row[quantityKey]);
    if (!Number.isFinite(quantity)) throw new Error('Cantidad invalida en resumen');
    const unit = normalizeUnit(row[unitKey]);
    totals.set(unit, (totals.get(unit) || 0) + quantity);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([unit, quantity]) => ({
    unit, quantity: Number(quantity.toFixed(4)),
  }));
}

function formatQuantityTotals(totals) {
  return totals.map(({ quantity, unit }) =>
    `${Number(quantity).toLocaleString('es-CO', { maximumFractionDigits: 4 })} ${unit}`
  ).join(' | ') || 'Sin cantidades';
}

async function draftQuantitySummary(db, documentId) {
  // Read persisted lines, including on retries; never summarize the new OCR payload.
  const [rows] = await db.execute(
    'SELECT cantidad, unidad FROM documento_bodega_borrador_items WHERE documento_id = ? ORDER BY id',
    [documentId]
  );
  return formatQuantityTotals(quantityTotals(rows));
}

module.exports = { normalizeUnit, quantityTotals, formatQuantityTotals, draftQuantitySummary };
