const { extractPdfTextLayer, deriveCatalogItemsFromPdfTokens, preferNativeItems } = require('./pdf-text-layer');
const { recoverWarehousePdfHeaders } = require('./document-pdf-headers');

function safePdfFailure(error) {
  const message = String(error?.message || '');
  if (/DOMMatrix|ImageData|Path2D|canvas|native binding/i.test(message)) return 'PDF_CANVAS_UNAVAILABLE';
  if (/worker/i.test(message)) return 'PDF_WORKER_UNAVAILABLE';
  if (/Cannot find|module not found|module_not_found/i.test(message)) return 'PDF_MODULE_UNAVAILABLE';
  if (/password|encrypted/i.test(message)) return 'PDF_PASSWORD_REQUIRED';
  if (/supera|limite/i.test(message)) return 'PDF_LIMIT_EXCEEDED';
  return 'PDF_READ_FAILED';
}

async function nativePdfEvidence(db, document, body) {
  const source = body?.params && typeof body.params === 'object' ? body.params : body;
  const modelItems = Array.isArray(source?.items) ? source.items : [];
  const diagnostics = {
    status: 'NO_PDF', model_rows: Math.min(modelItems.length, 101),
    compact_rows: Math.min(modelItems.filter(Array.isArray).length, 101), native_rows: 0,
  };
  if (!document) return { body, text: '', used: false, diagnostics };
  let stage = 'PDF_PARSE_FAILED';
  try {
    const extracted = await extractPdfTextLayer(document.content);
    if (!extracted.text.trim()) {
      diagnostics.status = 'NO_TEXT_LAYER';
      return { body, text: '', used: false, diagnostics };
    }
    stage = 'CATALOG_READ_FAILED';
    const [products] = await db.execute(
      `SELECT siigo_code, nombre FROM productos
        WHERE activo = 1 AND siigo_code IS NOT NULL AND siigo_code <> ''`, []
    );
    stage = 'NATIVE_ROWS_FAILED';
    const nativeItems = deriveCatalogItemsFromPdfTokens(extracted.tokens, products);
    const recoveredBody = preferNativeItems(body, nativeItems);
    const used = recoveredBody !== body;
    diagnostics.native_rows = nativeItems.length;
    diagnostics.status = used ? 'NATIVE_APPLIED' : 'MODEL_FALLBACK';
    return { body: recoverWarehousePdfHeaders(recoveredBody, extracted.text), text: extracted.text, used, diagnostics, pages: extracted.pages };
  } catch (cause) {
    diagnostics.status = stage;
    diagnostics.failure = stage === 'PDF_PARSE_FAILED' ? safePdfFailure(cause) : stage;
    const error = new Error('No fue posible verificar el PDF original. No se guardo el borrador; requiere revision tecnica.');
    error.status = 503;
    error.documentDiagnostics = diagnostics;
    throw error;
  }
}

function pdfReviewWarning(evidence) {
  return ['NO_TEXT_LAYER', 'MODEL_FALLBACK'].includes(evidence.diagnostics.status)
    ? 'No se pudo verificar la tabla completa con el texto nativo del PDF; coteja todas las filas con el original'
    : null;
}

module.exports = { nativePdfEvidence, safePdfFailure, pdfReviewWarning };
