const { normalizeProductReference } = require('./product-references');

const EMPTY_MARKERS = new Set(['', '-', 'na', 'n a', 'no aplica']);
const ALIAS_STATUS_MARKERS = new Set([...EMPTY_MARKERS, 'descontinuado', 'descontinuada']);
const CLIENT_STATUS_MARKERS = new Set([
  ...EMPTY_MARKERS,
  'no se comercializ',
  'no se comercializa',
  'ya no se comercializa',
]);

function cleanLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function relationshipKey(value) {
  return normalizeProductReference(cleanLabel(value));
}

function isUsableAlias(value) {
  return !ALIAS_STATUS_MARKERS.has(relationshipKey(value));
}

function isUsableProvider(value) {
  return !EMPTY_MARKERS.has(relationshipKey(value));
}

function canonicalClientLabel(value) {
  const label = cleanLabel(value);
  if (relationshipKey(label) === 'famarmatodo') return 'FARMATODO';
  return label;
}

function splitClientLabels(value) {
  const unique = new Map();
  for (const part of cleanLabel(value).split(/\s*-\s*/u)) {
    const label = canonicalClientLabel(part);
    const key = relationshipKey(label);
    if (!CLIENT_STATUS_MARKERS.has(key)) unique.set(key, label);
  }
  return [...unique.values()];
}

function parseOptionalNonNegativeNumber(value, field = 'valor') {
  const raw = cleanLabel(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99999999999) {
    throw new Error(`${field} invalido: ${raw}`);
  }
  return Math.round(parsed * 10000) / 10000;
}

function parseOptionalDwellDays(value) {
  const raw = cleanLabel(value);
  if (!raw) return null;
  const match = raw.match(/^(\d+)\s*d[ií]as?$/iu);
  if (!match) throw new Error(`alerta_rotacion invalida: ${raw}`);
  const days = Number(match[1]);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error(`alerta_rotacion fuera de rango: ${raw}`);
  }
  return days;
}

function prepareOperationalSettings(document) {
  if (!document || !Array.isArray(document.rows)) throw new Error('La fuente no contiene rows');
  const seen = new Set();
  return document.rows.map((row, index) => {
    const sku = cleanLabel(row.sku).toUpperCase();
    if (!sku) throw new Error(`Fila ${row.source_row || index + 1}: SKU vacio`);
    if (seen.has(sku)) throw new Error(`SKU duplicado en la fuente: ${sku}`);
    seen.add(sku);
    const alias = isUsableAlias(row.alias) ? cleanLabel(row.alias) : null;
    const provider = isUsableProvider(row.proveedor) ? cleanLabel(row.proveedor) : null;
    return {
      source_row: Number(row.source_row || index + 1),
      sku,
      item: cleanLabel(row.item),
      alias,
      alias_key: alias ? relationshipKey(alias) : null,
      provider,
      provider_key: provider ? relationshipKey(provider) : null,
      clients: splitClientLabels(row.cliente).map(label => ({ label, key: relationshipKey(label) })),
      stock_minimo: parseOptionalNonNegativeNumber(row.stock_minimo, 'stock_minimo'),
      permanencia_max_dias: parseOptionalDwellDays(row.alerta_rotacion),
    };
  });
}

module.exports = {
  cleanLabel,
  relationshipKey,
  isUsableAlias,
  isUsableProvider,
  splitClientLabels,
  parseOptionalNonNegativeNumber,
  parseOptionalDwellDays,
  prepareOperationalSettings,
};
