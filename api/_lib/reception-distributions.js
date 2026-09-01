const CONDITION_ALIASES = Object.freeze({
  DISPONIBLE: 'DISPONIBLE',
  BUENA: 'DISPONIBLE',
  ACEPTADA: 'DISPONIBLE',
  CUARENTENA: 'CUARENTENA',
  RECHAZADO: 'RECHAZADO',
  RECHAZADA: 'RECHAZADO',
  DESECHADO: 'PENDIENTE_DISPOSICION',
  DESECHADA: 'PENDIENTE_DISPOSICION',
  PENDIENTE_DISPOSICION: 'PENDIENTE_DISPOSICION',
});

function internalReceptionLot(receptionId, itemId, distributionIndex = 0) {
  const reception = Number(receptionId);
  const item = Number(itemId);
  const index = Number(distributionIndex);
  if (!Number.isSafeInteger(reception) || reception <= 0
      || !Number.isSafeInteger(item) || item <= 0
      || !Number.isSafeInteger(index) || index < 0) {
    throw inputError('No se pudo generar la partida interna de recepcion');
  }
  return `RECINT-${reception}-${item}-${String(index + 1).padStart(2, '0')}`;
}

function normalizeReceptionDistributions(input = {}, options = {}) {
  if (!Array.isArray(input.distributions) || !input.distributions.length) return null;
  const requiresLot = options.requiresLot !== false;
  const distributions = input.distributions.map((entry, index) => {
    const condition = CONDITION_ALIASES[String(entry.condicion || entry.condition || '').trim().toUpperCase()];
    const quantity = Number(entry.cantidad ?? entry.quantity);
    const supplierLot = String(entry.lote || entry.lpn || entry.lot_id || '').trim();
    const lot = supplierLot || (!requiresLot
      ? internalReceptionLot(options.receptionId, options.itemId, index)
      : '');
    const locationId = Number(entry.ubicacion_id || entry.location_id || 0) || null;
    const reason = String(entry.motivo || entry.reason || '').trim() || null;
    if (!condition) throw inputError(`Condicion invalida en distribucion ${index + 1}`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw inputError(`Cantidad invalida en distribucion ${index + 1}`);
    if (!lot) throw inputError(`Lote requerido en distribucion ${index + 1}`);
    if (['DISPONIBLE', 'CUARENTENA'].includes(condition) && !locationId) {
      throw inputError(`Ubicacion requerida en distribucion ${index + 1}`);
    }
    if (condition !== 'DISPONIBLE' && !reason) {
      throw inputError(`Motivo requerido en distribucion ${index + 1}`);
    }
    return {
      condition,
      quantity,
      lot,
      supplierLot: supplierLot || null,
      internalLot: !supplierLot,
      locationId,
      expiryDate: entry.fecha_venc || entry.expiry_date || null,
      reason,
    };
  });

  const conditionByLot = new Map();
  for (const entry of distributions) {
    const previous = conditionByLot.get(entry.lot);
    if (previous && previous !== entry.condition) {
      throw inputError(`El lote ${entry.lot} no puede tener condiciones diferentes`);
    }
    conditionByLot.set(entry.lot, entry.condition);
  }

  const totals = distributions.reduce((result, entry) => {
    result.received += entry.quantity;
    result[entry.condition] += entry.quantity;
    return result;
  }, { received: 0, DISPONIBLE: 0, CUARENTENA: 0, RECHAZADO: 0, PENDIENTE_DISPOSICION: 0 });
  const declared = input.qty_received ?? input.cantidad_recibida ?? input.qty_total;
  if (declared != null && Math.abs(Number(declared) - totals.received) > 0.0001) {
    throw inputError('La suma de distribuciones no coincide con la cantidad recibida');
  }
  return { distributions, totals };
}

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

module.exports = { internalReceptionLot, normalizeReceptionDistributions };
