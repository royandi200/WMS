const DEFAULT_DWELL_DAYS = 90;

function normalizeDwellDays(value, fallback = process.env.INVENTORY_DWELL_ALERT_DAYS) {
  const candidate = Number(value ?? fallback ?? DEFAULT_DWELL_DAYS);
  if (!Number.isFinite(candidate)) return DEFAULT_DWELL_DAYS;
  return Math.min(3650, Math.max(1, Math.trunc(candidate)));
}

module.exports = { DEFAULT_DWELL_DAYS, normalizeDwellDays };
