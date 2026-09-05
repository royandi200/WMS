const { DEFAULT_DWELL_DAYS, normalizeDwellDays } = require('./inventory-aging');

const MAX_STOCK_THRESHOLD = 99999999999;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeProductId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Producto invalido');
  return id;
}

function normalizeMinimumStock(value) {
  if (value == null || String(value).trim() === '') {
    throw httpError(400, 'El stock minimo es obligatorio');
  }
  const minimum = Number(value);
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > MAX_STOCK_THRESHOLD) {
    throw httpError(400, 'El stock minimo debe ser un numero entre 0 y 99999999999');
  }
  return Math.round(minimum * 10000) / 10000;
}

function normalizeConfiguredDwellDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw httpError(400, 'La permanencia debe estar entre 1 y 3650 dias');
  }
  return normalizeDwellDays(days, DEFAULT_DWELL_DAYS);
}

module.exports = {
  MAX_STOCK_THRESHOLD,
  normalizeProductId,
  normalizeMinimumStock,
  normalizeConfiguredDwellDays,
};
