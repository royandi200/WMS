const { resolveProductReference } = require('./product-references');
const { assertInternalProductionProduct } = require('./product-modes');
const { productionRequestIntent } = require('./stock-production-intent');

const WORD_NUMBERS = Object.freeze({ un: 1, uno: 1, una: 1, dos: 2, tres: 3,
  cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20 });
const NUMBER = '(\\d+(?:[.,]\\d+)?|un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte)';

function normalized(value) {
  let text = String(value || '').trim();
  const named = text.match(/^\{name\}="[^"\r\n]+"\r?\n\[[^\]\r\n]+\]:\s*([^\r\n]+)$/u);
  if (named) text = named[1];
  text = text.replace(/^\[(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\s+\d{2}:\d{2}:\d{2}\]:\s*/u, '');
  return text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

function productionReleaseConfirmation(text) {
  const raw = normalized(text).replace(/[.!]+$/u, '');
  return /^(?:confirmo|confirmamos|apruebo|autorizo)\s+(?:(?:crear|liberar|hacer)\s+)?(?:la\s+|esta\s+|nueva\s+)?(?:op|orden(?:\s+de\s+produccion)?|produccion)(?:\s+para\s+(?:el\s+)?stock(?:\s+de\s+seguridad)?)?$/u.test(raw);
}

function productionReleaseCancellation(text) {
  const raw = normalized(text).replace(/[.!]+$/u, '');
  const match = /^(?:cancela|cancele|cancelar|descarta|descarte|descartar|anula|anule|anular)\s+(?:(?:esta|este|la|el)\s+)?(.+?)(?:\s+de\s+stock)?$/u.exec(raw);
  if (!match) return false;
  if (/^(?:orden(?:\s+de\s+produccion)?|borrador)$/u.test(match[1])) return true;
  // En un borrador activo, «OPF», «OPE», «OB», «OOB» y variantes cercanas
  // son la misma referencia oral a la OP. Nunca se acepta «OC» ni un ID.
  const spokenOp = match[1].replace(/[.\s-]/gu, '');
  return /^o{1,2}[pbf](?:[eifb]){0,2}$/u.test(spokenOp);
}

function productionReleaseAffirmation(text) {
  return /^(?:si|yes|correcto|asi\s+es|de\s+acuerdo)[.!]?$/u.test(normalized(text));
}

function productionReleaseFollowup(text) {
  const raw = normalized(text);
  return productionReleaseConfirmation(raw) || productionReleaseCancellation(raw)
    || productionReleaseAffirmation(raw)
    || /^(?:no|todavia\s+no)\s+confirmo\b/u.test(raw)
    || /^(?:no\s*[,;]?\s*)?(?:(?:corrige|correccion|corrijo|cambia|cambio|modifica|mejor|perdon)\s*[,;:-]?\s*)?(?:la\s+|el\s+)?(?:cantidad|producto|sku|referencia)\b/u.test(raw)
    || new RegExp(`^(?:no\\s*[,;]?\\s*)?(?:son|seran|eran|quedan|fueron)\\s+${NUMBER}\\b`, 'u').test(raw)
    || /^(?:no\s*[,;]?\s*)?(?:cambia|cambio|corrige|modifica|mejor)\s+(?:a|por)\s+[a-z0-9]/u.test(raw)
    || /^(?:es|va|seria)\s+para\s+(?:(?:el\s+)?stock|(?:un\s+)?pedido)\b/u.test(raw)
    || /^(?:the\s+)?(?:quantity|amount)\s+(?:will\s+be|should\s+be|is|to|:)\s*\d+\s*(?:units?|pcs?)\b/u.test(raw)
    || new RegExp(`^(?:correccion|corrijo|mejor)\\s*[,;:-]?\\s*${NUMBER}\\s*(?:und|unidades?|tarros?|frascos?)\\b`, 'u').test(raw)
    || new RegExp(`^${NUMBER}\\s*(?:und|unidades?|tarros?|frascos?|units?|pcs?)\\b`, 'u').test(raw);
}

function positiveQuantity(value) {
  const raw = normalized(value).replace(',', '.');
  const number = WORD_NUMBERS[raw] ?? Number(raw);
  return Number.isSafeInteger(number) && number > 0 && number <= 100000 ? number : null;
}

function correctionFields(text) {
  const raw = normalized(text).replace(/^no\s*[,;]\s*/u, '').replace(/[.!]+$/u, '');
  const full = productionRequestIntent(text);
  if (full?.origen_tipo === 'STOCK_SEGURIDAD') {
    return { product: full.id_producto_final, quantity: full.cantidad_planificada };
  }
  const quantityMatch = raw.match(new RegExp(`\\b(?:cantidad(?:\\s+(?:nueva|correcta))?\\s*(?:es|sera|a|por|de)?|son|seran|eran|quedan)\\s*${NUMBER}\\b`, 'u'))
    || raw.match(/^(?:the\s+)?(?:quantity|amount)\s+(?:will\s+be|should\s+be|is|to|:)\s*(\d+)\s*(?:units?|pcs?)\b/u)
    || raw.match(new RegExp(`^(?:(?:correccion|corrijo|mejor|cambia|corrige|modifica)\\s*[:,]?\\s*(?:a\\s+)?)?${NUMBER}\\s*(?:und|unidades?|tarros?|frascos?|units?|pcs?)\\b`, 'u'));
  const quantity = quantityMatch ? positiveQuantity(quantityMatch[1]) : null;
  let product = raw.match(/\b(?:producto|referencia|sku)\s*(?:es|sera|a|por|:|debe\s+ser)\s+(.+)$/u)?.[1]
    || raw.match(/\b(?:producto|referencia|sku)\s+([a-z0-9][a-z0-9 -]+)$/u)?.[1]
    || raw.match(/^(?:cambia|cambio|corrige|modifica|mejor)\s+(?:a|por)\s+([a-z0-9][a-z0-9 -]+)$/u)?.[1]
    || null;
  if (quantity != null && /^\d+\s*(?:und|unidades?|tarros?|frascos?)$/u.test(product || '')) product = null;
  if (product) product = product
    .replace(/\s+y\s+(?:son|seran|cantidad\s+(?:es|a))\s*\d+\s*(?:und|unidades?|tarros?|frascos?)?$/u, '')
    .replace(/\s+para\s+(?:el\s+)?stock(?:\s+de\s+seguridad)?$/u, '').trim();
  if (product && /^(?:el\s+)?stock(?:\s+de\s+seguridad)?$/u.test(product)) product = null;
  return { product, quantity };
}

function productionReleaseSummary(draft) {
  return [
    '🏭 *Revisa la nueva OP antes de liberarla*',
    `Producto: ${draft.name} (${draft.sku})`,
    `Cantidad planeada: ${draft.quantity} und`,
    'Destino: stock de seguridad',
    '',
    'Si necesitas corregir, di «serán [cantidad] unidades» o «cambia el producto a [nombre o SKU]». Puedes cambiar ambos datos antes de confirmar; te mostraré el resumen actualizado.',
    'Si está correcto, responde *confirmo crear OP para stock de seguridad*. Para descartarla, di *cancela esta orden* (también puedes decir *cancela esta OP*).',
    '',
    'Aún no se creó la OP, no se reservaron materiales y no se avisó al alistador.',
  ].join('\n');
}

async function advanceProductionReleaseGuide({ db, rawText, draft, request }) {
  if (!request && !draft) return null;
  if (!request && productionReleaseAffirmation(rawText)) {
    return { status: 'PENDING', draft,
      message: `El borrador sigue pendiente. Revisa los datos y, para crear la OP, di «confirmo crear OP para stock de seguridad».\n\n${productionReleaseSummary(draft)}` };
  }
  if (!request && /^(?:no|todavia\s+no)\s+confirmo\b/u.test(normalized(rawText))) {
    return { status: 'PENDING', draft,
      message: `No liberé la OP. Puedes corregir el producto o la cantidad, o descartarla.\n\n${productionReleaseSummary(draft)}` };
  }
  if (!request && productionReleaseCancellation(rawText)) {
    return { status: 'CANCELLED', message: 'Descarté el borrador de la OP. No se creó la orden, no se reservó material y no se avisó al alistador.' };
  }
  if (!request && /^(?:es|va|seria)\s+para\s+(?:un\s+)?pedido\s+de\s+cliente[.!]?$/u.test(normalized(rawText))) {
    return { status: 'CANCELLED', message: 'Descarté el borrador de stock de seguridad. Para producir por un pedido de cliente, pide la lista de pedidos pendientes y elige su PED ID. No se creó ninguna OP.' };
  }
  if (!request && productionReleaseConfirmation(rawText)) {
    if (!draft || draft.status !== 'PENDING') return null;
    return { status: 'CONFIRMED', release: {
      product: draft.sku, quantity: draft.quantity, originType: 'STOCK_SEGURIDAD',
    } };
  }
  const fields = request ? {
    product: request.product, quantity: positiveQuantity(request.quantity),
  } : correctionFields(rawText);
  if (request && fields.quantity == null) {
    const error = new Error('Indica una cantidad positiva de unidades para la OP; no se creó ninguna orden.');
    error.status = 400;
    throw error;
  }
  if (!request && !fields.product && fields.quantity == null) {
    return { status: 'PENDING', draft, message: `No identifiqué qué dato cambiar.\n\n${productionReleaseSummary(draft)}` };
  }
  const product = fields.product
    ? await resolveProductReference(db, fields.product, {
      modes: ['PR'], allowContextualPartial: true, allowCatalogContextual: true,
    }) : null;
  if (product) assertInternalProductionProduct(product);
  const next = {
    status: 'PENDING', sku: product?.siigo_code || draft?.sku,
    name: product?.nombre || draft?.name,
    quantity: fields.quantity ?? draft?.quantity,
  };
  if (!next.sku || !next.quantity) {
    const error = new Error('Faltan producto o cantidad; no se creó la OP.');
    error.status = 400;
    throw error;
  }
  return { status: 'PENDING', draft: next, message: productionReleaseSummary(next) };
}

module.exports = { advanceProductionReleaseGuide, correctionFields, productionReleaseAffirmation,
  productionReleaseCancellation, productionReleaseConfirmation,
  productionReleaseFollowup, productionReleaseSummary };
