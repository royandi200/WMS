const WORD_QUANTITIES = Object.freeze({
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
});

function currentMessage(rawText) {
  const text = String(rawText || '').trim();
  const tagged = text.match(/^\{name\}="[^"\r\n]+"\r?\n\[[^\]\r\n]+\]:\s*([^\r\n]+)$/u);
  return tagged ? tagged[1].trim() : text;
}

function stockProductionIntent(rawText) {
  const text = currentMessage(rawText).normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '').trim();
  const match = text.match(/^(?:(?:vamos|quiero|queremos|necesito|necesitamos)\s+a?\s*(?:producir|fabricar|hacer)|(?:produce|produzcamos|fabrica|prepara))\s+(\d+|un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:tarros?|frascos?|unidades?|und)\s+de\s+(.+?)\s+para\s+(?:el\s+)?stock\s+de\s+seguridad[.!]?$/iu);
  if (!match) return null;
  const quantity = /^\d+$/u.test(match[1]) ? Number(match[1]) : WORD_QUANTITIES[match[1].toLowerCase()];
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100000) return null;
  const product = match[2].trim();
  if (product.length < 3 || product.length > 120) return null;
  return { id_producto_final: product, cantidad_planificada: quantity,
    origen_tipo: 'STOCK_SEGURIDAD' };
}

module.exports = { stockProductionIntent };
