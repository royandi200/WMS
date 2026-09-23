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

function preparationRequestFromText(rawText) {
  const text = normalizedSpeech(rawText).trim();
  const match = text.match(/^(?:POR FAVOR[\s,]+)?(?:PREPARA|PREPARAR|PREPARAME|QUIERO PREPARAR|VAMOS A PREPARAR)\s+(?:LA\s+)?RECEPCION\b/u);
  return match ? text.slice(match[0].length).trim() : null;
}

function preparationIntentFromText(rawText) {
  const remainder = preparationRequestFromText(rawText);
  if (remainder === null) return null;
  const references = typedReceptionReferences(rawText);
  if (references.length) {
    return references.length === 1 && ['OC', 'IO'].includes(references[0].kind)
      ? references[0]
      : null;
  }
  // Solo en la orden de PREPARAR: el dictado puede convertir "OC ID 38" en
  // "OC y B38" u "OCIB38". No se acepta esta variante para confirmar stock.
  const noisy = remainder.match(/^(OC|IO)\s*[YI]\s*B\s*(\d+)\s*[.!]?$/u);
  const id = Number(noisy?.[2]);
  return noisy && Number.isSafeInteger(id) && id > 0
    ? { kind: noisy[1], id }
    : null;
}

function confirmedPreparationReference(rawText, previousUserText, previousBotMessage) {
  if (!/^(?:SI|CORRECTO|EXACTO|ASI ES)[.!]?$/u.test(normalizedSpeech(rawText).trim())) return null;
  if (preparationRequestFromText(previousUserText) === null) return null;
  const reply = normalizedSpeech(previousBotMessage);
  if (!/\b(?:TE REFIERES|ME CONFIRMAS|CONFIRMAS|ES ESA)\b/u.test(reply)
    || !reply.includes('?')) return null;
  const references = typedReceptionReferences(reply);
  return references.length === 1 && ['OC', 'IO'].includes(references[0].kind)
    ? references[0]
    : null;
}

module.exports = {
  typedReceptionReferences,
  singleTypedReceptionReference,
  purchaseOrderParamsFromText,
  preparationIntentFromText,
  confirmedPreparationReference,
};
