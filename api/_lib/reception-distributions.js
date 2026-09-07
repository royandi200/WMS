const { randomUUID, createHash } = require('crypto');

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

function newKardexEntryIds() {
  return { id: randomUUID(), txId: randomUUID() };
}

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

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeReceptionDistributions(input = {}, options = {}) {
  if (!Array.isArray(input.distributions) || !input.distributions.length) return null;
  const distributions = input.distributions.map((entry, index) => {
    const condition = CONDITION_ALIASES[String(entry.condicion || entry.condition || '').trim().toUpperCase()];
    const quantity = Number(entry.cantidad ?? entry.quantity);
    const supplierLot = String(entry.lote || entry.lpn || entry.lot_id || '').trim();
    const lot = supplierLot;
    const rawLocationId = Number(entry.ubicacion_id || entry.location_id || 0);
    const locationId = Number.isSafeInteger(rawLocationId) && rawLocationId > 0 ? rawLocationId : null;
    const reason = String(entry.motivo || entry.reason || '').trim() || null;
    const expiryDate = String(entry.fecha_venc || entry.expiry_date || '').trim();
    if (!condition) throw inputError(`Condicion invalida en distribucion ${index + 1}`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw inputError(`Cantidad invalida en distribucion ${index + 1}`);
    if (!lot) throw inputError(`Lote del proveedor requerido en distribucion ${index + 1}`);
    if (/^RECBLK-/iu.test(lot)) throw inputError('Indica el lote del proveedor, no la partida interna RECBLK');
    if (lot.length > 50) throw inputError(`Lote demasiado largo en distribucion ${index + 1}`);
    if (!isValidIsoDate(expiryDate)) {
      throw inputError(`Vencimiento requerido en formato YYYY-MM-DD en distribucion ${index + 1}`);
    }
    if (!locationId) throw inputError(`Ubicacion requerida en distribucion ${index + 1}`);
    if (condition !== 'DISPONIBLE' && !reason) {
      throw inputError(`Motivo requerido en distribucion ${index + 1}`);
    }
    return {
      condition,
      quantity,
      lot,
      supplierLot,
      internalLot: false,
      locationId,
      expiryDate,
      reason,
    };
  });

  const expiryByLot = new Map();
  for (const entry of distributions) {
    const previous = expiryByLot.get(entry.supplierLot);
    if (previous && previous !== entry.expiryDate) {
      throw inputError(`El lote ${entry.supplierLot} no puede tener vencimientos diferentes`);
    }
    expiryByLot.set(entry.supplierLot, entry.expiryDate);
  }

  const totals = distributions.reduce((result, entry) => {
    result.received += entry.quantity;
    result[entry.condition] += entry.quantity;
    return result;
  }, { received: 0, DISPONIBLE: 0, CUARENTENA: 0, RECHAZADO: 0, PENDIENTE_DISPOSICION: 0 });
  const declared = input.qty_received ?? input.cantidad_recibida ?? input.qty_total;
  if (!Number.isFinite(totals.received)) throw inputError('Cantidad recibida invalida');
  if (declared != null && (!Number.isFinite(Number(declared))
      || Math.abs(Number(declared) - totals.received) > 0.0001)) {
    throw inputError('La suma de distribuciones no coincide con la cantidad recibida');
  }
  return { distributions, totals };
}

// Blocked physical quantities must never share the available lot's global status.
function assignReceptionPartitions(normalized, receptionId, itemId) {
  internalReceptionLot(receptionId, itemId);
  const distributions = normalized.distributions.map(entry => {
    if (entry.condition === 'DISPONIBLE') return { ...entry };
    const hash = createHash('sha256').update(JSON.stringify([
      Number(receptionId), Number(itemId), entry.supplierLot, entry.condition,
    ])).digest('hex').slice(0, 32);
    return { ...entry, lot: `RECBLK-${hash}`, internalLot: true };
  });
  return { ...normalized, distributions };
}

function validateReceptionItem(input, expected, sku, fallbackReason = '') {
  const normalized = normalizeReceptionDistributions(input);
  if (!normalized) throw inputError(`Faltan distribuciones para ${sku}`);
  assertAvailableQuantityWithinExpected(normalized.totals, expected, sku);
  const reason = String(input.reason || input.motivo || fallbackReason || '').trim();
  if (Math.abs(normalized.totals.received - Number(expected)) > 0.0001 && !reason) {
    throw inputError(`Debes indicar el motivo de la diferencia para ${sku}`);
  }
  return normalized;
}

function assertAvailableQuantityWithinExpected(totals, expected, sku = 'el producto') {
  const available = Number(totals?.DISPONIBLE || 0);
  const planned = Number(expected);
  if (!Number.isFinite(planned) || planned < 0) {
    throw inputError(`Cantidad esperada invalida para ${sku}`);
  }
  if (available > planned + 0.0001) {
    const error = inputError(
      `El sobrante de ${sku} no puede ingresar como disponible. `
      + 'Registra como DISPONIBLE hasta la cantidad esperada y deja el excedente en CUARENTENA o PENDIENTE_DISPOSICION'
    );
    error.status = 409;
    throw error;
  }
}

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

module.exports = {
  assertAvailableQuantityWithinExpected,
  internalReceptionLot,
  newKardexEntryIds,
  normalizeReceptionDistributions,
  assignReceptionPartitions,
  validateReceptionItem,
};
