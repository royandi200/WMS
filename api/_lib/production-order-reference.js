function inputError(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function referenceKey(reference) {
  if (typeof reference === 'number') return Number.isSafeInteger(reference) && reference > 0 ? reference : null;
  const raw = String(reference || '').trim();
  if (!raw) return null;
  if (/^[1-9]\d*$/u.test(raw)) return Number(raw);
  const long = raw.match(/^OP-\d{8}-(\d{6})$/iu);
  if (long) return Number(long[1]);
  const short = normalizeText(raw).match(/^(?:O\s*P\s*(?:I\s*D\s*)?|ORDEN(?:\s+DE\s+PRODUCCION)?\s*(?:(?:NUMERO|ID)\s*)?)#?\s*([1-9]\d*)$/u);
  return short ? Number(short[1]) : null;
}

function canonicalReference(reference) {
  if (reference === undefined || reference === null || reference === '') return null;
  const key = referenceKey(reference);
  if (!Number.isSafeInteger(key) || key <= 0) {
    throw inputError('No pude identificar el OP ID. Usa, por ejemplo, OP ID 97. No se modificó inventario.');
  }
  const long = String(reference).trim().toUpperCase();
  return /^OP-\d{8}-\d{6}$/u.test(long) ? long : key;
}

function explicitReferences(text) {
  const source = normalizeText(text);
  const found = [];
  for (const match of source.matchAll(/\bOP-\d{8}-\d{6}\b/gu)) found.push(match[0]);
  for (const match of source.matchAll(/\bO\s*P\s*(?:I\s*D\s*)?#?\s*([1-9]\d*)\b/gu)) found.push(Number(match[1]));
  for (const match of source.matchAll(/\bORDEN(?:\s+DE\s+PRODUCCION)?\s*(?:(?:NUMERO|ID)\s*)?#?\s*([1-9]\d*)\b/gu)) found.push(Number(match[1]));
  return found;
}

function reconcileProductionOrderId(params = {}, currentText = '') {
  const structured = canonicalReference(params.id_orden);
  const mentioned = explicitReferences(currentText);
  const unique = new Set(mentioned.map(referenceKey));
  if (unique.size > 1) {
    throw inputError('El mensaje menciona más de una OP. Indica solo un OP ID; no se modificó inventario.');
  }
  const spoken = mentioned.find(reference => typeof reference === 'string') ?? mentioned[0] ?? null;
  if (spoken && structured && referenceKey(spoken) !== referenceKey(structured)) {
    throw inputError('El OP ID interpretado no coincide con el mensaje. Repite el OP ID; no se modificó inventario.');
  }
  return spoken || structured;
}

module.exports = { explicitReferences, reconcileProductionOrderId, referenceKey };
