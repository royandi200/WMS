const WORD_QUANTITIES = Object.freeze({
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
});

function currentMessage(rawText) {
  const text = String(rawText || '').trim();
  const tagged = text.match(/^\{name\}="[^"\r\n]+"\r?\n\[[^\]\r\n]+\]:\s*([^\r\n]+)$/u);
  return tagged ? tagged[1].trim() : text;
}

function productionRequestIntent(rawText) {
  const text = currentMessage(rawText).normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '').trim();
  const match = text.match(/^(?:(?:vamos|quiero|queremos|necesito|necesitamos)\s+a?\s*(?:producir|fabricar|hacer)|(?:produce|produzcamos|fabrica|prepara))\s+(\d+|un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:tarros?|frascos?|unidades?|und)\s+de\s+(.+?)(?:\s+para\s+(?:el\s+)?stock\s+de\s+seguridad)?[.!]?$/iu);
  if (!match) return null;
  const quantity = /^\d+$/u.test(match[1]) ? Number(match[1]) : WORD_QUANTITIES[match[1].toLowerCase()];
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100000) return null;
  const product = match[2].trim();
  if (product.length < 3 || product.length > 120
    || /\s+para\s+(?:un\s+|el\s+)?(?:pedido|cliente|oc|orden\s+de\s+compra)\b/iu.test(product)) return null;
  return { id_producto_final: product, cantidad_planificada: quantity,
    ...(/\bpara\s+(?:el\s+)?stock\s+de\s+seguridad[.!]?$/iu.test(text)
      ? { origen_tipo: 'STOCK_SEGURIDAD' } : {}) };
}

function stockProductionIntent(rawText) {
  const intent = productionRequestIntent(rawText);
  return intent?.origen_tipo === 'STOCK_SEGURIDAD' ? intent : null;
}

function productionDestinationReply(rawText) {
  const text = currentMessage(rawText).normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '').trim().toLowerCase();
  if (/^(?:para\s+)?(?:el\s+)?stock(?:\s+de\s+seguridad)?[.!]?$/u.test(text)) return 'STOCK_SEGURIDAD';
  if (/^(?:para\s+)?(?:un\s+)?(?:pedido|oc|orden\s+de\s+compra)(?:\s+de[l]?\s+cliente)?[.!]?$/u.test(text)
    || /^(?:para\s+)?(?:el\s+)?cliente[.!]?$/u.test(text)) return 'OC_CLIENTE';
  return null;
}

function contextualProductionReply(rawText, previousUserText, previousBotMessage) {
  const origin = productionDestinationReply(rawText);
  if (!origin || !/stock de seguridad[\s\S]*pedido de cliente/iu.test(String(previousBotMessage || ''))) return null;
  const request = productionRequestIntent(previousUserText);
  if (!request || request.origen_tipo) return null;
  return { origin, request };
}

module.exports = { stockProductionIntent, productionRequestIntent,
  productionDestinationReply, contextualProductionReply };
