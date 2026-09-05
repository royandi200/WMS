const MAX_ITEM_BLOCK_LINES = 12;

function enrichItemsFromLineEvidence(items, evidenceText) {
  if (!String(evidenceText || '').trim() || !Array.isArray(items) || !items.length) return items;
  const lines = evidenceLines(evidenceText);
  const skuSet = new Set(items.map((item) => String(item.sku || '').trim().toUpperCase()).filter(Boolean));
  const positions = new Map([...skuSet].map((sku) => [sku, []]));

  lines.forEach((line, index) => {
    const key = line.toUpperCase();
    if (positions.has(key)) positions.get(key).push(index);
  });

  const lineEnriched = items.map((item) => {
    const sku = String(item.sku || '').trim().toUpperCase();
    const matches = positions.get(sku) || [];
    if (matches.length !== 1) return item;

    const start = matches[0];
    let end = Math.min(lines.length, start + 1 + MAX_ITEM_BLOCK_LINES);
    for (let index = start + 1; index < end; index += 1) {
      if (skuSet.has(lines[index].toUpperCase())) {
        end = index;
        break;
      }
    }
    const block = lines.slice(start + 1, end);
    const quantityIndexes = block
      .map((line, index) => quantityLineMatches(line, item.quantity) ? index : -1)
      .filter((index) => index >= 0);
    if (quantityIndexes.length !== 1) return item;

    const quantityIndex = quantityIndexes[0];
    const unitMatches = block
      .map((line, index) => index > quantityIndex && index <= quantityIndex + 2
        ? normalizedUnit(line)
        : null)
      .map((unit, index) => ({ unit, index }))
      .filter(({ unit }) => Boolean(unit));
    const unitHint = unitMatches.length === 1 ? unitMatches[0] : null;

    const dateMatches = block
      .map((line, index) => ({ date: normalizedDate(line), index }))
      .filter(({ date, index }) => Boolean(date) && index > quantityIndex);
    const dateHint = dateMatches.length === 1 ? dateMatches[0] : null;

    const lotStart = unitHint ? unitHint.index + 1 : quantityIndex + 1;
    const lotEnd = dateHint ? dateHint.index : block.length;
    const lotCandidates = block
      .slice(lotStart, lotEnd)
      .filter((line) => isUnambiguousLot(line, skuSet));

    return {
      ...item,
      unit: item.unit || unitHint?.unit || null,
      lot: item.lot || (lotCandidates.length === 1 ? lotCandidates[0] : null),
      expiryDate: item.expiryDate || dateHint?.date || null,
    };
  });

  return enrichItemsFromFlattenedEvidence(lineEnriched, evidenceText, skuSet);
}

function enrichItemsFromFlattenedEvidence(items, evidenceText, skuSet) {
  const evidence = String(evidenceText || '').replace(/\s+/gu, ' ').trim();
  const upperEvidence = evidence.toUpperCase();
  const positions = new Map();

  for (const sku of skuSet) {
    const matches = [...upperEvidence.matchAll(new RegExp(`(?<![A-Z0-9])${escapeRegExp(sku)}(?![A-Z0-9])`, 'gu'))];
    positions.set(sku, matches.map((match) => match.index));
  }

  return items.map((item) => {
    const sku = String(item.sku || '').trim().toUpperCase();
    const matches = positions.get(sku) || [];
    if (matches.length !== 1 || (item.unit && item.lot && item.expiryDate)) return item;

    const start = matches[0] + sku.length;
    const nextStarts = [...positions.entries()]
      .filter(([otherSku]) => otherSku !== sku)
      .flatMap(([, starts]) => starts)
      .filter((position) => position > start);
    const end = Math.min(
      upperEvidence.length,
      start + 1_000,
      nextStarts.length ? Math.min(...nextStarts) : upperEvidence.length
    );
    const block = evidence.slice(start, end);
    const quantityMatches = findQuantityMatches(block, item.quantity)
      .filter(({ end: quantityEnd }) => {
        const nearbyUnit = block.slice(quantityEnd, quantityEnd + 40)
          .match(/(?<![A-Za-z])(und|unidades?|u|gramos?|gr|g|kilogramos?|kg|kilos?)(?![A-Za-z])/iu);
        if (!nearbyUnit) return false;
        const expectedUnit = normalizedUnit(item.unit);
        return !expectedUnit || normalizedUnit(nearbyUnit[0]) === expectedUnit;
      });
    if (quantityMatches.length !== 1) return item;

    const quantityEnd = quantityMatches[0].end;
    const afterQuantity = block.slice(quantityEnd);
    const unitMatches = [...afterQuantity.matchAll(/(?<![A-Za-z])(und|unidades?|u|gramos?|gr|g|kilogramos?|kg|kilos?)(?![A-Za-z])/giu)]
      .map((match) => ({ unit: normalizedUnit(match[0]), index: quantityEnd + match.index, end: quantityEnd + match.index + match[0].length }))
      .filter(({ unit, index }) => unit && index <= quantityEnd + 80);
    const unitHint = unitMatches.length === 1 ? unitMatches[0] : null;

    const dateMatches = findDateMatches(block)
      .filter(({ index }) => index >= quantityEnd);
    const dateHint = dateMatches.length === 1 ? dateMatches[0] : null;
    const lotStart = unitHint ? unitHint.end : quantityEnd;
    const lotEnd = dateHint ? dateHint.index : block.length;
    const lotCandidates = [...block.slice(lotStart, lotEnd).matchAll(/[A-Za-z0-9][A-Za-z0-9._/]*[-_/][A-Za-z0-9._/-]*/gu)]
      .map((match) => match[0])
      .filter((candidate) => isUnambiguousLot(candidate, skuSet));

    return {
      ...item,
      unit: item.unit || unitHint?.unit || null,
      lot: item.lot || (lotCandidates.length === 1 ? lotCandidates[0] : null),
      expiryDate: item.expiryDate || dateHint?.date || null,
    };
  });
}

function findQuantityMatches(value, quantity) {
  const number = Number(quantity);
  if (!Number.isFinite(number)) return [];
  const forms = [...new Set([
    String(number),
    String(number).replace('.', ','),
    number.toLocaleString('en-US', { maximumFractionDigits: 4 }),
    number.toLocaleString('es-CO', { maximumFractionDigits: 4 }),
  ])].sort((left, right) => right.length - left.length);
  const pattern = forms.map(escapeRegExp).join('|');
  return [...String(value || '').matchAll(new RegExp(`(?<![0-9.,])(?:${pattern})(?![0-9.,])`, 'gu'))]
    .map((match) => ({ index: match.index, end: match.index + match[0].length }));
}

function findDateMatches(value) {
  const matches = [...String(value || '').matchAll(/(?<!\d)(\d{4}[-/.]\d{2}[-/.]\d{2}|\d{2}[-/.]\d{2}[-/.]\d{4})(?!\d)/gu)];
  return matches
    .map((match) => ({ date: normalizedDate(match[0]), index: match.index }))
    .filter(({ date }) => Boolean(date));
}

function evidenceLines(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 10_000);
}

function quantityLineMatches(line, quantity) {
  const value = Number(quantity);
  if (!Number.isFinite(value)) return false;
  const normalized = String(line || '').trim().replace(/\s/g, '');
  const forms = new Set([
    String(value),
    String(value).replace('.', ','),
    value.toLocaleString('en-US', { maximumFractionDigits: 4 }),
    value.toLocaleString('es-CO', { maximumFractionDigits: 4 }),
  ].map((form) => form.replace(/\s/g, '')));
  return forms.has(normalized);
}

function normalizedUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (/^(u|und|unidad|unidades)$/u.test(unit)) return 'und';
  if (/^(g|gr|gramo|gramos)$/u.test(unit)) return 'g';
  if (/^(kg|kilo|kilos|kilogramo|kilogramos)$/u.test(unit)) return 'kg';
  return null;
}

function normalizedDate(value) {
  const text = String(value || '').trim();
  let year;
  let month;
  let day;
  let match = text.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/u);
  if (match) [, year, month, day] = match;
  if (!match) {
    match = text.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/u);
    if (match) [, day, month, year] = match;
  }
  if (!year || !month || !day) return null;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function isUnambiguousLot(value, skuSet) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{1,99}$/u.test(text)) return false;
  if (!/[A-Za-z]/u.test(text) || !/\d/u.test(text)) return false;
  if (normalizedDate(text) || normalizedUnit(text)) return false;
  return !skuSet.has(text.toUpperCase());
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  enrichItemsFromLineEvidence,
  evidenceLines,
  normalizedDate,
  normalizedUnit,
  quantityLineMatches,
};
