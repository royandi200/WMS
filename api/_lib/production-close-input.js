const MONTHS = Object.freeze({
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
});

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function hasProductionCloseIntent(text) {
  return /\b(cerr|cierre|cerramos|finaliz|termin)\w*\b/i.test(String(text || ''))
    && /\b(op|orden|producci[oó]n|produccion)\b/i.test(String(text || ''));
}

function normalizeExpiryDate(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  let year;
  let month;
  let day;
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else {
    const natural = raw.match(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:de\s+)?(\d{4})\b/i);
    if (!natural) return null;
    day = Number(natural[1]);
    month = MONTHS[natural[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
    year = Number(natural[3]);
  }
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseProductionCloseFromText(text) {
  const raw = String(text || '');
  if (!hasProductionCloseIntent(raw)) return null;
  const orderCodeMatch = raw.match(/\b(?:OP|ORD|P)-[A-Z0-9-]+\b/i);
  const shortOrderMatch = raw.match(/\borden(?:\s+id)?\s*#?\s*(\d+)\b/i);
  if (!orderCodeMatch && !shortOrderMatch) return null;
  const normalized = raw.toLowerCase().replace(/,/g, '.');
  const conforming =
    normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:und|unidad(?:es)?|uds?|u)?\s*(?:conforme(?:s)?|resultante(?:s)?|buen(?:a|as|o|os)|producid(?:a|as|o|os))/i)
    || normalized.match(/(?:conforme(?:s)?|resultante(?:s)?|salieron|producid(?:a|as|o|os))\s*(?:con|:)?\s*(\d+(?:\.\d+)?)/i)
    || normalized.match(/\bcon\s+(\d+(?:\.\d+)?)\s*(?:und|unidad(?:es)?|uds?|u)\b/i);
  const waste =
    normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:und|unidad(?:es)?|uds?|u)?\s*(?:de\s+)?(?:merma|mermas|no conforme(?:s)?|rechazo(?:s)?|desperdicio(?:s)?)/i)
    || normalized.match(/(?:merma|mermas|no conforme(?:s)?|rechazo(?:s)?|desperdicio(?:s)?)\s*(?:de|:)?\s*(\d+(?:\.\d+)?)/i);
  const params = { id_orden: orderCodeMatch ? orderCodeMatch[0].toUpperCase() : Number(shortOrderMatch[1]) };
  if (conforming) params.cantidad_real = Number(conforming[1]);
  if (waste) params.merma = Number(waste[1]);
  const reason = raw.match(/(?:por|porque|motivo|causa)\s+(.+?)(?=,\s*(?:(?:los?\s+)?conformes?\s+quedan?|dejar|ubicar|ubicaci[oó]n|vence|vencimiento|fecha)\b|$)/i);
  if (reason && params.merma > 0) params.motivo_merma = reason[1].trim();
  const location = raw.match(/(?:quedan?\s+en|dejar(?:\s+el\s+producto\s+terminado)?\s+en|ubicar(?:\s+el\s+producto\s+terminado)?\s+en|ubicaci[oó]n\s*[:\-]?)\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)/i);
  if (location) params.ubicacion = location[1].toUpperCase();
  return { action: 'CERRAR_ORDEN_PRODUCCION', params };
}

function normalizeProductionCloseParams(params = {}) {
  const next = { ...params };
  next.cantidad_real = firstDefined(next.cantidad_real, next.qty_real, next.cantidad_conforme,
    next.cantidad_conformes, next.conformes, next.unidades_conformes, next.unidades_resultantes,
    next.resultantes, next.producidas);
  next.merma = firstDefined(next.merma, next.qty_waste, next.cantidad_merma,
    next.cantidad_no_conforme, next.no_conformes, next.merma_declarada, next.unidades_merma);
  next.motivo_merma = firstDefined(next.motivo_merma, next.motivo, next.razon_merma, next.causa_merma);
  next.ubicacion = firstDefined(next.ubicacion, next.ubicacion_codigo, next.location_code);
  delete next.fecha_venc;
  delete next.fecha_vencimiento;
  delete next.expiry_date;
  delete next.vencimiento;
  return next;
}

module.exports = { hasProductionCloseIntent, normalizeExpiryDate, normalizeProductionCloseParams, parseProductionCloseFromText };
