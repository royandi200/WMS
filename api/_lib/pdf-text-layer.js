const { normalizedDate, normalizedUnit } = require('./document-evidence-items');

const MAX_PDF_PAGES = 50;
const MAX_TEXT_CHARS = 500_000;

function cleanToken(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

async function extractPdfTextLayer(content) {
  if (!Buffer.isBuffer(content) || !content.length) return { text: '', tokens: [], pages: 0 };
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(content),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  if (document.numPages > MAX_PDF_PAGES) throw new Error(`El PDF supera ${MAX_PDF_PAGES} paginas`);

  const pages = [];
  const allTokens = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const contentItems = await page.getTextContent({ disableNormalization: false });
    const positioned = contentItems.items
      .slice(0, 20_000)
      .map((item, index) => ({
        text: cleanToken(item.str),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0),
        index,
      }))
      .filter((item) => item.text);
    allTokens.push(...positioned.map((item) => item.text));

    const lineMap = new Map();
    for (const item of positioned.sort((left, right) => {
      if (Math.abs(left.y - right.y) > 2) return right.y - left.y;
      if (Math.abs(left.x - right.x) > 1) return left.x - right.x;
      return left.index - right.index;
    })) {
      const key = Math.round(item.y / 2);
      let line = lineMap.get(key);
      if (!line) lineMap.set(key, (line = { y: item.y, items: [] }));
      line.items.push(item);
    }
    pages.push([...lineMap.values()]
      .sort((left, right) => right.y - left.y)
      .map((line) => line.items.sort((left, right) => left.x - right.x).map((item) => item.text).join('\t'))
      .join('\n'));
  }
  const text = pages.join('\n\f\n').slice(0, MAX_TEXT_CHARS);
  return { text, tokens: allTokens.slice(0, 20_000), pages: document.numPages };
}

function parseNumberToken(value) {
  const text = cleanToken(value).replace(/\s/gu, '');
  if (/^\d+(?:[.,]\d{1,4})?$/u.test(text)) {
    if (/^\d+[.,]\d{3}$/u.test(text)) return null;
    const parsed = Number(text.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function dateFromToken(value) {
  const direct = normalizedDate(value);
  if (direct) return direct;
  const match = cleanToken(value).match(/(\d{4}[-/.]\d{2}[-/.]\d{2}|\d{2}[-/.]\d{2}[-/.]\d{4})/u);
  return match ? normalizedDate(match[1]) : null;
}

function lotFromTokens(tokens, unitIndex, expiryIndex, knownSkus) {
  const candidates = tokens.slice(unitIndex + 1, expiryIndex < 0 ? undefined : expiryIndex);
  const combined = tokens.slice(unitIndex + 1).join(' | ');
  const labelled = combined.match(/\blote(?:\s+(?:proveedor|propuesto))?\s*:\s*([A-Z0-9][A-Z0-9._/-]{1,99})/iu)?.[1];
  if (labelled) return labelled;
  return candidates.find((candidate) => {
    const text = cleanToken(candidate);
    return /^[A-Z0-9][A-Z0-9._/-]{1,99}$/iu.test(text)
      && /[A-Z]/iu.test(text)
      && /\d/u.test(text)
      && !knownSkus.has(text.toUpperCase())
      && !normalizedDate(text);
  }) || null;
}

function deriveCatalogItemsFromPdfTokens(tokens = [], products = []) {
  const catalog = new Map(products.map((product) => [String(product.siigo_code || '').toUpperCase(), product]));
  const knownSkus = new Set(catalog.keys());
  const normalizedTokens = tokens.map(cleanToken).filter(Boolean);
  const positions = normalizedTokens
    .map((token, index) => ({ token: token.toUpperCase(), index }))
    .filter(({ token }) => knownSkus.has(token));
  const items = [];
  for (let positionIndex = 0; positionIndex < positions.length && items.length < 100; positionIndex += 1) {
    const position = positions[positionIndex];
    const end = positions[positionIndex + 1]?.index ?? Math.min(normalizedTokens.length, position.index + 20);
    const block = normalizedTokens.slice(position.index + 1, Math.min(end, position.index + 20));
    let unitIndex = -1;
    let quantityIndex = -1;
    for (let index = 1; index < block.length; index += 1) {
      if (normalizedUnit(block[index]) && parseNumberToken(block[index - 1]) != null) {
        quantityIndex = index - 1;
        unitIndex = index;
        break;
      }
    }
    if (unitIndex < 0) continue;
    const quantity = parseNumberToken(block[quantityIndex]);
    const unit = normalizedUnit(block[unitIndex]);
    const expiryIndex = block.findIndex((token, index) => index > unitIndex && dateFromToken(token));
    const expiryDate = expiryIndex >= 0 ? dateFromToken(block[expiryIndex]) : null;
    const product = catalog.get(position.token);
    items.push({
      sku: position.token,
      descripcion: block.slice(0, quantityIndex).join(' ').slice(0, 255) || product?.nombre || position.token,
      cantidad: quantity,
      unidad: unit,
      lote: lotFromTokens(block, unitIndex, expiryIndex, knownSkus),
      fecha_vencimiento: expiryDate,
    });
  }
  return items;
}

function sourceObject(body = {}) {
  return body.params && typeof body.params === 'object' ? body.params : body;
}

function withNativeItems(body, items) {
  if (!items.length) return body;
  if (body.params && typeof body.params === 'object') {
    return { ...body, params: { ...body.params, items } };
  }
  return { ...body, items };
}

function preferNativeItems(body, nativeItems) {
  const modelItems = Array.isArray(sourceObject(body).items) ? sourceObject(body).items : [];
  if (!nativeItems.length || nativeItems.length < modelItems.length) return body;
  const remainingModelItems = [...modelItems];
  const mergedItems = nativeItems.map((nativeItem) => {
    const matchIndex = remainingModelItems.findIndex((modelItem) =>
      String(modelItem.sku || modelItem.codigo || '').trim().toUpperCase() === nativeItem.sku
    );
    const modelItem = matchIndex >= 0 ? remainingModelItems.splice(matchIndex, 1)[0] : {};
    return { ...modelItem, ...nativeItem };
  });
  return withNativeItems(body, mergedItems);
}

module.exports = {
  deriveCatalogItemsFromPdfTokens,
  extractPdfTextLayer,
  parseNumberToken,
  preferNativeItems,
};
