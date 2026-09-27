function assignedFinishedLot(orderCode) {
  const code = String(orderCode || '').trim();
  if (!code) throw new Error('La orden no tiene codigo para asignar el lote PT');
  return `LPN-${code}`;
}

module.exports = { assignedFinishedLot };
