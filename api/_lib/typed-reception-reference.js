function normalizedSpeech(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase();
}

function typedReceptionReferences(rawText) {
  const text = normalizedSpeech(rawText);
  const candidates = [];
  const shortPattern = /(?:^|[^A-Z0-9])(O[\s.]*C|I[\s.]*O|M[\s.]*Q)(?:\s*[-:.,/]?\s*(?:I\s*D|NUMERO|NRO)\s*[-#:.,/]?\s*|\s+)(\d+)(?![A-Z0-9_-])/gu;
  for (const match of text.matchAll(shortPattern)) {
    const kind = match[1].replace(/[\s.]/gu, '');
    candidates.push({ kind, id: Number(match[2]) });
  }
  const longPatterns = [
    ['OC', /(?:^|[^A-Z0-9])ORDEN\s+DE\s+COMPRA\s*(?:ID|NUMERO|NRO)?\s*#?\s*(\d+)(?![A-Z0-9_-])/gu],
    ['IO', /(?:^|[^A-Z0-9])IN\s*(?:&|AND|Y)\s*OUT\s*(?:ID|NUMERO|NRO)?\s*#?\s*(\d+)(?![A-Z0-9_-])/gu],
    ['MQ', /(?:^|[^A-Z0-9])ORDEN\s+(?:DE\s+)?MAQUILA\s*(?:ID|NUMERO|NRO)?\s*#?\s*(\d+)(?![A-Z0-9_-])/gu],
  ];
  for (const [kind, pattern] of longPatterns) {
    for (const match of text.matchAll(pattern)) candidates.push({ kind, id: Number(match[1]) });
  }
  return [...new Map(candidates.filter(candidate => Number.isSafeInteger(candidate.id)
    && candidate.id > 0).map(candidate => [`${candidate.kind}:${candidate.id}`, candidate])).values()];
}

function singleTypedReceptionReference(rawText) {
  const references = typedReceptionReferences(rawText);
  if (references.length > 1) {
    throw Object.assign(new Error('Mencionaste varias recepciones. Indica solo un OC ID, IO ID o MQ ID'), {
      status: 409,
    });
  }
  return references[0] || null;
}

function purchaseOrderParamsFromText(params = {}, rawText = '') {
  const reference = singleTypedReceptionReference(rawText);
  if (!reference) return params;
  if (reference.kind === 'MQ') {
    throw Object.assign(new Error('MQ ID corresponde a maquila, no a una OC directa'), { status: 409 });
  }
  const clean = { ...params };
  for (const key of ['orden_compra_id', 'purchase_order_id', 'numero_oc',
    'orden_compra', 'purchase_order_number']) delete clean[key];
  return { ...clean, orden_compra_id: reference.id };
}

function preparationRequestFromText(rawText, { allowTruncated = false } = {}) {
  const text = normalizedSpeech(rawText).trim();
  const match = text.match(/^(?:POR FAVOR[\s,]+)?(?:PREPARA|PREPARAR|PREPARAME|QUIERO PREPARAR|VAMOS A PREPARAR)\s+(?:(?:LA\s+)?RECEPCION\b\s*|(?:LA\s+)?ORDEN\b\s*(?=(?:O\s*C|I\s*O|M\s*Q))|(?=(?:O\s*C|I\s*O|M\s*Q)))/u);
  if (match) return text.slice(match[0].length).trim();
  if (!allowTruncated) return null;
  // Solo si el clasificador ya eligió PREPARAR: el audio puede perder
  // «prepara» o transcribirlo como «pregunta». Nunca se usa al confirmar.
  const truncated = text.match(/^(?:PARA|PREGUNTA\s+DE)\s+LA\s+ORDEN\s+(?=(?:O\s*C|I\s*O|M\s*Q))/u);
  return truncated ? text.slice(truncated[0].length).trim() : null;
}

function noisySpokenPreparationReference(rawText) {
  const text = normalizedSpeech(rawText).replace(/[.,;:]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
  // Variantes frecuentes de "OC ID" / "IO ID" / "MQ ID" en audio: OCIP, OCIB,
  // "O, C y D". Solo se usan al PREPARAR, nunca al confirmar inventario.
  const match = text.match(/^(O\s*C|I\s*O|M\s*Q)\s*(?:I|Y)\s*(?:D|B|P|V)\s*(\d+)$/u);
  const id = Number(match?.[2]);
  return match && Number.isSafeInteger(id) && id > 0
    ? { kind: match[1].replace(/\s/gu, ''), id }
    : null;
}

function preparationIntentFromText(rawText, options = {}) {
  const remainder = preparationRequestFromText(rawText, options);
  if (remainder === null) return null;
  const normalized = normalizedSpeech(remainder).replace(/[.,;:]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
  const references = typedReceptionReferences(rawText);
  for (const match of normalized.matchAll(/(?:^|[^A-Z0-9])(O\s*C|I\s*O|M\s*Q)\s*(?:I|Y)\s*(?:D|B|P|V)\s*(\d+)(?![A-Z0-9_-])/gu)) {
    const id = Number(match[2]);
    if (Number.isSafeInteger(id) && id > 0) {
      references.push({ kind: match[1].replace(/\s/gu, ''), id });
    }
  }
  const distinct = [...new Map(references.map(reference =>
    [`${reference.kind}:${reference.id}`, reference])).values()];
  return distinct.length === 1 ? distinct[0] : null;
}

function preparationClarificationCandidate(rawText) {
  const text = normalizedSpeech(rawText).replace(/[.,;:]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
  if (!/^(?:NO\s+)?(?:ES\s+)?(?:O\s*C|I\s*O|M\s*Q)\s*(?:(?:I\s*D|NUMERO|NRO|[IY]\s*[DBPV])\s*)?#?\s*\d+$/u.test(text)) {
    return null;
  }
  const selected = typedReceptionReferences(rawText);
  return selected.length === 1 ? selected[0]
    : selected.length ? null : noisySpokenPreparationReference(rawText);
}

function clarifiedPreparationReference(rawText, previousUserText, previousBotMessage) {
  if (preparationRequestFromText(previousUserText) === null) return null;
  const reply = normalizedSpeech(previousBotMessage);
  if (!/\b(?:TE REFIERES|ME CONFIRMAS|CONFIRMAS|ES ESA)\b/u.test(reply)
    || !reply.includes('?')) return null;
  const reference = preparationClarificationCandidate(rawText);
  if (!reference || !['OC', 'IO', 'MQ'].includes(reference.kind)) return null;
  const proposed = typedReceptionReferences(reply);
  return proposed.some(item => item.kind === reference.kind && item.id === reference.id)
    ? reference : null;
}

function confirmedPreparationReference(rawText, previousUserText, previousBotMessage) {
  if (!/^(?:SI|CORRECTO|EXACTO|ASI ES)[.!]?$/u.test(normalizedSpeech(rawText).trim())) return null;
  if (preparationRequestFromText(previousUserText) === null) return null;
  const reply = normalizedSpeech(previousBotMessage);
  if (!/\b(?:TE REFIERES|ME CONFIRMAS|CONFIRMAS|ES ESA)\b/u.test(reply)
    || !reply.includes('?')) return null;
  const references = typedReceptionReferences(reply);
  return references.length === 1 && ['OC', 'IO', 'MQ'].includes(references[0].kind)
    ? references[0]
    : null;
}

module.exports = {
  typedReceptionReferences,
  singleTypedReceptionReference,
  purchaseOrderParamsFromText,
  preparationIntentFromText,
  preparationClarificationCandidate,
  confirmedPreparationReference,
  clarifiedPreparationReference,
};
