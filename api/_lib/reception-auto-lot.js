function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeRule({ sigla, dias_retroceso: days, activa = true } = {}) {
  const initials = String(sigla || '').trim().toUpperCase();
  const offset = Number(days);
  if (!/^[A-Z]{1,8}$/u.test(initials)) throw inputError('La sigla del proveedor debe tener entre 1 y 8 letras');
  if (!Number.isInteger(offset) || offset < 0 || offset > 365) {
    throw inputError('Los días a restar deben ser un entero entre 0 y 365');
  }
  if (![true, false, 0, 1].includes(activa)) throw inputError('Indica si la regla está activa o inactiva');
  return { sigla: initials, dias_retroceso: offset, activa: Boolean(activa) };
}

function receptionDate(value) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/u.test(text)) return text.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function generatedReceptionLot({ receptionId, itemNumber, partitionNumber = 1,
  partitionCount = 1, receivedOn, sigla, dias_retroceso: offset }) {
  const rule = normalizeRule({ sigla, dias_retroceso: offset });
  const reception = Number(receptionId);
  const item = Number(itemNumber);
  const part = Number(partitionNumber);
  if (![reception, item, part].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw inputError('No fue posible identificar la partida para generar el lote');
  }
  const date = receptionDate(receivedOn);
  const calculated = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(calculated.getTime())) throw inputError('Fecha de recepción inválida');
  calculated.setUTCDate(calculated.getUTCDate() - rule.dias_retroceso);
  const year = calculated.getUTCFullYear();
  const month = String(calculated.getUTCMonth() + 1).padStart(2, '0');
  const day = String(calculated.getUTCDate()).padStart(2, '0');
  const itemLabel = String(item).padStart(2, '0');
  const partLabel = partitionCount > 1 ? `P${String(part).padStart(2, '0')}` : '';
  return `R${reception}-${itemLabel}${partLabel}-${day}${month}${year}-${rule.sigla}`;
}

module.exports = { normalizeRule, generatedReceptionLot, receptionDate };
