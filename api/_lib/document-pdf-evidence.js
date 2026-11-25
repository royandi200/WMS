const {
  extractPdfTextLayer, deriveCatalogItemsFromPdfTokens, preferNativeItems, unmatchedTableRowCodes,
} = require('./pdf-text-layer');
const { recoverWarehousePdfHeaders, recoverSiigoPurchaseOrderHeaders, siigoPurchaseOrderItems } = require('./document-pdf-headers');

// SIIGO OC PDFs interleave buyer and supplier names; take the name from terceros by NIT.
// When neither the AI nor the SKU-code reader found rows, read SIIGO's own table.
function withSiigoFallbackItems(body, tokens, products) {
  const target = body?.params && typeof body.params === 'object' ? body.params : body;
  if (Array.isArray(target?.items) && target.items.length) return body;
  const rows = siigoPurchaseOrderItems(tokens, products);
  if (!rows.length) return body;
  const matched = rows.filter((row) => row.sku);
  const warnings = [];
  if (matched.length) {
    warnings.push(`SKU asignado por descripcion (el PDF no trae codigo), confirmalo antes de crear la OC: ${matched
      .map((row) => `«${row.descripcion}» → ${row.sku}${row.alternativas.length ? ` (otras opciones: ${row.alternativas.join(', ')})` : ''}`).join('; ')}.`);
  }
  const unmatched = rows.filter((row) => !row.sku);
  if (unmatched.length) {
    warnings.push(`Producto por asignar (el PDF no trae codigo y no hay equivalente claro), elige el SKU al revisar: ${unmatched.map((row) => `«${row.descripcion}» x ${row.cantidad}${row.candidatos?.length ? ` (posibles: ${row.candidatos.join(', ')})` : ''}`).join('; ')}.`);
  }
  const updated = {
    ...target,
    items: rows.map(({ alternativas, candidatos, ...row }) => (row.sku
      ? { ...row, sku_por_descripcion: true }
      : { ...row, sku: '', por_asignar: true })),
    advertencias: [...(Array.isArray(target.advertencias) ? target.advertencias : []), ...warnings],
  };
  return body.params && typeof body.params === 'object' ? { ...body, params: updated } : updated;
}

async function supplierNameByTaxId(db, body, text = '') {
  const target = body?.params && typeof body.params === 'object' ? body.params : body;
  if (!target?.proveedor_nit || String(target.proveedor_nombre ?? '').trim()) return body;
  const digits = String(target.proveedor_nit).replace(/\D/g, '').slice(0, 9);
  if (digits.length < 6) return body;
  const [rows] = await db.execute(
    `SELECT COALESCE(NULLIF(nombre_comercial, ''), nombre) AS nombre FROM terceros
      WHERE activo = 1 AND REPLACE(REPLACE(identification, '.', ''), '-', '') LIKE ?`,
    [`${digits}%`]
  );
  const printed = String(text).match(/^([^\n\t]{3,120})\nPara\s*$/mu)?.[1]?.trim();
  const name = rows.length === 1 && rows[0].nombre ? rows[0].nombre : printed;
  if (!name) return body;
  const updated = { ...target, proveedor_nombre: name };
  return body.params && typeof body.params === 'object' ? { ...body, params: updated } : updated;
}

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
    let finalBody = recoverWarehousePdfHeaders(
      recoverSiigoPurchaseOrderHeaders(recoveredBody, extracted.text), extracted.text
    );
    finalBody = withSiigoFallbackItems(finalBody, extracted.tokens, products);
    stage = 'SUPPLIER_LOOKUP_FAILED';
    finalBody = await supplierNameByTaxId(db, finalBody, extracted.text);
    const unmatched = unmatchedTableRowCodes(extracted.text, products);
    if (unmatched.length) {
      const target = finalBody.params && typeof finalBody.params === 'object' ? finalBody.params : finalBody;
      const warning = `SKU no encontrado o inactivo: ${unmatched.join(', ')}. Esas filas del PDF no se cargaron; sincroniza el producto o corrige el documento.`;
      const updated = { ...target, advertencias: [...(Array.isArray(target.advertencias) ? target.advertencias : []), warning] };
      finalBody = finalBody.params && typeof finalBody.params === 'object' ? { ...finalBody, params: updated } : updated;
    }
    return { body: finalBody, text: extracted.text, used, diagnostics, pages: extracted.pages };
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
    ? 'No fue posible cotejar automaticamente todas las filas del PDF. Revisa SKU, cantidad, lote y vencimiento con el documento original.'
    : null;
}

module.exports = { nativePdfEvidence, safePdfFailure, pdfReviewWarning };
