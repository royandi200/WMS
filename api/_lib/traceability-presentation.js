function round(value) {
  return Number(Number(value || 0).toFixed(4));
}

function productionMaterialSummaries(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.siigo_code, row.unidad].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        sku: row.siigo_code,
        name: row.nombre,
        unit: row.unidad || 'und',
        netDelivered: 0,
        processWaste: 0,
        lots: new Map(),
      });
    }
    const group = groups.get(key);
    const net = round(Number(row.cantidad_consumida || 0) - Number(row.cantidad_devuelta || 0));
    group.netDelivered = round(group.netDelivered + net);
    group.processWaste = Math.max(group.processWaste, Number(row.merma_proceso || 0));
    const lotKey = [row.lote || 'N/A', row.ubicacion || 'N/A'].join('|');
    if (!group.lots.has(lotKey)) {
      group.lots.set(lotKey, {
        lot: row.lote || 'N/A',
        location: row.ubicacion || 'N/A',
        quantity: 0,
        purchaseOrder: row.orden_compra || 'N/A',
        siigo: row.siigo_purchase_name || 'N/A',
        supplier: row.supplier || 'proveedor N/A',
      });
    }
    const lot = group.lots.get(lotKey);
    lot.quantity = round(lot.quantity + net);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    processWaste: round(group.processWaste),
    productiveUse: round(Math.max(group.netDelivered - group.processWaste, 0)),
    lots: [...group.lots.values()],
  }));
}

function productionUseSummaries(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.codigo_orden, row.producto_final, row.unidad].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        order: row.codigo_orden,
        finalProduct: row.producto_final,
        unit: row.unidad || 'und',
        netDelivered: 0,
        processWaste: 0,
      });
    }
    const group = groups.get(key);
    group.netDelivered = round(group.netDelivered
      + Number(row.cantidad_consumida || 0)
      - Number(row.cantidad_devuelta || 0));
    group.processWaste = Math.max(group.processWaste, Number(row.merma_proceso || 0));
  }
  return [...groups.values()].map((group) => ({
    ...group,
    processWaste: round(group.processWaste),
    productiveUse: round(Math.max(group.netDelivered - group.processWaste, 0)),
  }));
}

function balancesByMovement(rows = [], currentBalance = 0) {
  let laterDelta = 0;
  const balances = new Map();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    balances.set(row.id ?? index, round(Number(currentBalance) - laterDelta));
    laterDelta = round(laterDelta + Number(row.qty || 0));
  }
  return balances;
}

function paginateMessage(value, maxLength = 3400) {
  if (!Number.isInteger(maxLength) || maxLength < 500) throw new Error('Longitud de pagina invalida');
  const lines = String(value || '').split('\n');
  const pages = [];
  let current = '';
  for (const originalLine of lines) {
    const chunks = [];
    let line = originalLine;
    while (line.length > maxLength) {
      chunks.push(line.slice(0, maxLength));
      line = line.slice(maxLength);
    }
    chunks.push(line);
    for (const chunk of chunks) {
      const candidate = current ? `${current}\n${chunk}` : chunk;
      if (candidate.length > maxLength && current) {
        pages.push(current);
        current = chunk;
      } else {
        current = candidate;
      }
    }
  }
  if (current || !pages.length) pages.push(current);
  return pages;
}

module.exports = {
  balancesByMovement,
  paginateMessage,
  productionMaterialSummaries,
  productionUseSummaries,
};
