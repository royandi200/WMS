const { createHash } = require('crypto');
const { MAX_PDF_BYTES } = require('./purchase-order-documents');
const { assertDocumentTypeMarker } = require('./document-type-markers');
const { enrichItemsFromLineEvidence } = require('./document-evidence-items');
const { documentDraftStatus } = require('./document-draft-status');
const {
  deriveCatalogItemsFromPdfTokens,
  extractPdfTextLayer,
  preferNativeItems,
} = require('./pdf-text-layer');

const MAX_DOCUMENT_ITEMS = 100;
const DOCUMENT_TYPE = 'ORDEN_COMPRA';

function normalizePurchaseOrderDocumentInput(body = {}, { evidenceText = '' } = {}) {
  const source = body.params && typeof body.params === 'object' ? body.params : body;
  const documentType = cleanText(source.tipo_documento || source.document_type, 50).toUpperCase();
  const reference = cleanText(source.referencia_documento || source.numero || source.order_number, 80);
  const documentDate = normalizeDate(source.fecha_documento || source.fecha_orden || source.order_date);
  const supplierName = cleanText(source.proveedor_nombre || source.supplier_name, 200);
  const supplierTaxId = optionalText(source.proveedor_nit || source.nit_proveedor || source.supplier_tax_id, 80);
  const currency = optionalText(source.moneda || source.currency, 10);
  const sourceFileName = optionalText(source.nombre_archivo || source.file_name, 255);
  const sourceReference = optionalText(source.referencia_origen || source.source_reference, 255);
  const rawItems = Array.isArray(source.items) ? source.items : [];

  if (documentType !== DOCUMENT_TYPE) throw inputError(`El documento debe ser una ${DOCUMENT_TYPE}`);
  if (!reference) throw inputError('La orden de compra requiere un numero o referencia visible');
  if (!documentDate) throw inputError('La orden de compra requiere una fecha visible');
  if (!supplierName) throw inputError('La orden de compra requiere un proveedor visible');
  if (!rawItems.length) throw inputError('La orden de compra debe incluir al menos un item');
  if (rawItems.length > MAX_DOCUMENT_ITEMS) throw inputError(`La orden supera ${MAX_DOCUMENT_ITEMS} items`);

  const evidence = cleanEvidenceText(evidenceText);
  assertDocumentTypeMarker(DOCUMENT_TYPE, evidence);
  if (evidence && !evidenceIncludes(evidence, reference)) {
    throw inputError('El numero de la orden no aparece literalmente en el documento');
  }
  const sourceWarnings = normalizeWarnings(source.advertencias || source.warnings);
  const modelReportedMissingFields = sourceWarnings.some(isModelMissingItemWarning);
  const warnings = sourceWarnings
    .filter((warning) => !isModelDerivedValidationWarning(warning));
  const normalizedItems = rawItems.map((item, index) => normalizeItem(item, index));
  const items = enrichItemsFromLineEvidence(normalizedItems, evidenceText).map((normalized) => {
    if (evidence && !evidenceIncludes(evidence, normalized.sku)) {
      throw inputError(`El SKU ${normalized.sku} no aparece literalmente en el documento`);
    }
    if (evidence && !evidenceIncludesQuantity(evidence, normalized.quantity)) {
      throw inputError(`La cantidad ${normalized.quantity} de ${normalized.sku} no aparece en el documento`);
    }
    if (evidence && normalized.lot && !evidenceIncludes(evidence, normalized.lot)) {
      warnings.push(`El lote propuesto para ${normalized.sku} no aparece literalmente en el documento; se dejo pendiente`);
      normalized.lot = null;
    }
    if (evidence && normalized.expiryDate && !evidenceIncludesDate(evidence, normalized.expiryDate)) {
      warnings.push(`El vencimiento propuesto para ${normalized.sku} no aparece en el documento; se dejo pendiente`);
      normalized.expiryDate = null;
    }
    if (!normalized.unit) warnings.push(`El item ${normalized.sku} no tiene unidad de medida`);
    return normalized;
  });
  if (modelReportedMissingFields) {
    const missingLots = items.filter((item) => !item.lot).map((item) => item.sku);
    const missingExpiries = items.filter((item) => !item.expiryDate).map((item) => item.sku);
    if (missingLots.length) warnings.push(`Lote no asociado de forma inequivoca: ${missingLots.join(', ')}`);
    if (missingExpiries.length) warnings.push(`Vencimiento no asociado de forma inequivoca: ${missingExpiries.join(', ')}`);
  }
  const suppliedTotal = optionalNonNegativeNumber(source.total_unidades ?? source.total_units, 'total_unidades');
  const totalsByUnit = calculateTotalsByUnit(items);
  const calculatedTotal = items.every((item) => item.unit)
    ? comparableCalculatedTotal(totalsByUnit, suppliedTotal)
    : 0;
  if (suppliedTotal != null && Math.abs(suppliedTotal - calculatedTotal) > 0.0001) {
    warnings.push(`El total declarado (${suppliedTotal}) no coincide con la suma de items (${calculatedTotal})`);
  }

  const normalized = {
    documentType,
    reference,
    documentDate,
    supplierName,
    supplierTaxId,
    currency,
    totalUnits: suppliedTotal == null ? calculatedTotal : suppliedTotal,
    calculatedTotal,
    sourceFileName,
    sourceReference,
    warnings: [...new Set(warnings)].slice(0, 50),
    items,
  };
  normalized.hash = createHash('sha256').update(canonicalJson(documentIdentity(normalized))).digest('hex');
  normalized.operationalHash = createHash('sha256')
    .update(canonicalJson(operationalIdentity(normalized)))
    .digest('hex');
  return normalized;
}

async function downloadBuilderBotPdf(documentUrl, fallbackName) {
  if (!documentUrl) return null;
  const url = validateBuilderBotDocumentUrl(documentUrl);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/pdf,application/octet-stream' },
    });
  } catch (error) {
    throw inputError(`No fue posible descargar el PDF de BuilderBot: ${error.message}`);
  }
  if (!response.ok) throw inputError(`BuilderBot no permitio descargar el PDF (HTTP ${response.status})`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PDF_BYTES) throw inputError(`El PDF supera el limite de ${MAX_PDF_BYTES} bytes`);
  const chunks = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) throw inputError('BuilderBot no entrego contenido para el PDF');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PDF_BYTES) {
      await reader.cancel().catch(() => {});
      throw inputError(`El PDF supera el limite de ${MAX_PDF_BYTES} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  const content = Buffer.concat(chunks, total);
  if (!content.length) {
    throw inputError(`El PDF supera el limite de ${MAX_PDF_BYTES} bytes o esta vacio`);
  }
  if (content.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw inputError('El archivo recibido desde BuilderBot no contiene una firma PDF valida');
  }
  const pathName = safeDecodePathName(url.pathname.split('/').pop() || 'orden-compra.pdf');
  const requestedName = cleanText(fallbackName || pathName, 255);
  const name = /\.pdf$/i.test(requestedName) ? requestedName : `${requestedName || 'orden-compra'}.pdf`;
  return {
    name,
    mimeType: 'application/pdf',
    size: content.length,
    hash: createHash('sha256').update(content).digest('hex'),
    content,
  };
}

function validateBuilderBotDocumentUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw inputError('La URL del PDF de BuilderBot no es valida');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw inputError('La URL del PDF de BuilderBot no esta permitida');
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'builderbot.cloud'
    || host.endsWith('.builderbot.cloud')
    || /^runtime-sessions\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/u.test(host);
  if (!allowed) throw inputError('El dominio del PDF de BuilderBot no esta permitido');
  return url;
}

async function registerPurchaseOrderDocumentDraft({
  db,
  body,
  userId,
  evidenceText = '',
  documentUrl = '',
  documentName = '',
}) {
  const document = await downloadBuilderBotPdf(documentUrl, documentName);
  const nativeEvidence = await nativePdfEvidence(db, document, body);
  const input = normalizePurchaseOrderDocumentInput(nativeEvidence.body, {
    evidenceText: nativeEvidence.text || evidenceText,
  });
  if (!document) input.warnings.push('El PDF original no fue transferido al WMS; reenvia el documento');

  await db.beginTransaction();
  try {
    const [existing] = await db.execute(
      `SELECT id, tipo_documento, referencia_documento, fecha_documento,
              destinatario_nombre, proveedor_nit, total_unidades, sha256,
              estado, advertencias, orden_compra_id,
              (SELECT COUNT(*) FROM documento_bodega_borrador_archivos a
                WHERE a.documento_id = documentos_bodega_borrador.id) AS file_count
         FROM documentos_bodega_borrador
        WHERE tipo_documento = ? AND origen = 'BUILDERBOT'
          AND referencia_documento = ?
        LIMIT 1 FOR UPDATE`,
      [DOCUMENT_TYPE, input.reference]
    );
    if (existing.length) {
      if (existing[0].sha256 !== input.hash) {
        const [storedItems] = await db.execute(
          `SELECT sku_extraido, cantidad, unidad, lote, fecha_vencimiento
             FROM documento_bodega_borrador_items
            WHERE documento_id = ? ORDER BY id`,
          [existing[0].id]
        );
        const storedHash = createHash('sha256').update(canonicalJson(operationalIdentity({
          documentType: existing[0].tipo_documento,
          reference: existing[0].referencia_documento,
          documentDate: dateOnly(existing[0].fecha_documento),
          supplierName: existing[0].destinatario_nombre,
          supplierTaxId: existing[0].proveedor_nit,
          totalUnits: Number(existing[0].total_unidades),
          items: storedItems.map((item) => ({
            sku: item.sku_extraido,
            quantity: Number(item.cantidad),
            unit: item.unidad,
            lot: item.lote || null,
            expiryDate: dateOnly(item.fecha_vencimiento),
          })),
        }))).digest('hex');
        if (storedHash !== input.operationalHash) {
          throw conflictError(`La orden ${input.reference} ya existe, pero cambian proveedor, SKU, cantidades o unidades`);
        }
      }
      if (document) {
        const [storedFiles] = await db.execute(
          `SELECT sha256 FROM documento_bodega_borrador_archivos WHERE documento_id = ? LIMIT 1 FOR UPDATE`,
          [existing[0].id]
        );
        if (storedFiles.length && storedFiles[0].sha256 !== document.hash) {
          throw conflictError(`La orden ${input.reference} ya existe con un PDF diferente`);
        }
        if (!storedFiles.length) await storeDraftFile(db, existing[0].id, document);
      }
      await db.commit();
      return draftResult(existing[0], input, true);
    }

    const supplier = await resolveSupplier(db, input);
    if (!supplier) input.warnings.push('Proveedor no encontrado de forma inequivoca en el catalogo sincronizado');
    const resolved = [];
    for (const item of input.items) {
      const [products] = await db.execute(
        `SELECT id, siigo_code, nombre FROM productos
          WHERE UPPER(siigo_code) = ? AND activo = 1 LIMIT 1`,
        [item.sku]
      );
      if (!products.length) input.warnings.push(`SKU no encontrado o inactivo: ${item.sku}`);
      resolved.push({ ...item, product: products[0] || null });
    }
    input.warnings = [...new Set(input.warnings)].slice(0, 50);
    const status = documentDraftStatus(input.warnings);
    const [created] = await db.execute(
      `INSERT INTO documentos_bodega_borrador
         (tipo_documento, origen, referencia_documento, fecha_documento,
          destinatario_nombre, nit, proveedor_nit, tercero_id, moneda, total_unidades,
          total_calculado, nombre_archivo, referencia_origen, advertencias,
          sha256, estado, creado_por, creado_en, actualizado_en)
       VALUES (?, 'BUILDERBOT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [DOCUMENT_TYPE, input.reference, input.documentDate, input.supplierName,
       input.supplierTaxId, input.supplierTaxId, supplier?.id || null, input.currency, input.totalUnits,
       input.calculatedTotal, document?.name || input.sourceFileName,
       input.sourceReference, input.warnings.length ? JSON.stringify(input.warnings) : null,
       input.hash, status, userId]
    );
    for (const item of resolved) {
      await db.execute(
        `INSERT INTO documento_bodega_borrador_items
           (documento_id, producto_id, sku_extraido, descripcion_extraida,
            cantidad, unidad, precio_unitario, fecha_vencimiento, lote, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [created.insertId, item.product?.id || null, item.sku, item.description,
         item.quantity, item.unit, item.unitPrice, item.expiryDate, item.lot]
      );
    }
    if (document) await storeDraftFile(db, created.insertId, document);
    await db.commit();
    return {
      id: created.insertId,
      referencia_documento: input.reference,
      estado: status,
      duplicate: false,
      warnings: input.warnings,
      itemCount: input.items.length,
      totalUnits: input.totalUnits,
      supplierId: supplier?.id || null,
      pdfStored: Boolean(document),
      extractionSource: nativeEvidence.used ? 'PDF_TEXT_LAYER' : 'BUILDERBOT',
    };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}

async function resolveSupplier(db, input) {
  const [rows] = await db.execute(
    `SELECT id, identification, COALESCE(NULLIF(nombre_comercial, ''), nombre) AS nombre
       FROM terceros
      WHERE tipo = 'Supplier' AND activo = 1
        AND siigo_id IS NOT NULL AND siigo_id <> ''`,
    []
  );
  const taxId = normalizedTaxId(input.supplierTaxId);
  const byTaxId = taxId ? rows.filter((row) => normalizedTaxId(row.identification) === taxId) : [];
  if (byTaxId.length === 1) return byTaxId[0];
  const targetName = normalizedName(input.supplierName);
  const byName = rows.filter((row) => normalizedName(row.nombre) === targetName);
  return byName.length === 1 ? byName[0] : null;
}

async function storeDraftFile(db, documentId, document) {
  await db.execute(
    `INSERT INTO documento_bodega_borrador_archivos
       (documento_id, nombre_original, mime_type, tamano_bytes, sha256, contenido, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [documentId, document.name, document.mimeType, document.size, document.hash, document.content]
  );
}

function draftResult(row, input, duplicate) {
  return {
    id: row.id,
    referencia_documento: row.referencia_documento,
    estado: row.estado,
    duplicate,
    warnings: parseWarnings(row.advertencias),
    itemCount: input.items.length,
    totalUnits: Number(row.total_unidades || 0),
    pdfStored: Number(row.file_count || 0) > 0,
    ordenCompraId: row.orden_compra_id || null,
  };
}

function normalizeItem(item = {}, index) {
  const source = Array.isArray(item)
    ? {
        sku: item[0],
        descripcion: item[1],
        cantidad: item[2],
        unidad: item[3],
        lote: item[4],
        fecha_vencimiento: item[5],
        precio_unitario: item[6],
      }
    : item;
  const sku = cleanText(source.sku || source.codigo || source.codigo_barras, 80).toUpperCase();
  const description = cleanText(source.descripcion || source.producto || source.description, 255);
  const quantity = Number(source.cantidad ?? source.quantity);
  const unitPriceRaw = source.precio_unitario ?? source.unit_price;
  const unitPrice = unitPriceRaw == null || unitPriceRaw === '' ? null : Number(unitPriceRaw);
  if (!sku) throw inputError(`El item ${index + 1} requiere SKU exacto`);
  if (!description) throw inputError(`El item ${index + 1} requiere descripcion`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw inputError(`La cantidad de ${sku} debe ser positiva`);
  if (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0)) throw inputError(`El precio de ${sku} no es valido`);
  return {
    sku,
    description,
    quantity: roundQty(quantity),
    unit: optionalText(source.unidad || source.unit, 20),
    unitPrice: unitPrice == null ? null : Number(unitPrice.toFixed(6)),
    expiryDate: normalizeDate(source.fecha_vencimiento || source.expiry_date),
    lot: optionalText(source.lote || source.lot, 100),
  };
}

async function nativePdfEvidence(db, document, body) {
  if (!document) return { body, text: '', used: false };
  try {
    const extracted = await extractPdfTextLayer(document.content);
    if (!extracted.text.trim()) return { body, text: '', used: false };
    const [products] = await db.execute(
      `SELECT siigo_code, nombre FROM productos
        WHERE activo = 1 AND siigo_code IS NOT NULL AND siigo_code <> ''`,
      []
    );
    const nativeItems = deriveCatalogItemsFromPdfTokens(extracted.tokens, products);
    return {
      body: preferNativeItems(body, nativeItems),
      text: extracted.text,
      used: nativeItems.length > 0,
    };
  } catch {
    return { body, text: '', used: false };
  }
}

function operationalIdentity(input) {
  return {
    documentType: input.documentType,
    reference: input.reference,
    documentDate: input.documentDate,
    supplierName: normalizedName(input.supplierName),
    supplierTaxId: normalizedTaxId(input.supplierTaxId),
    totalUnits: roundQty(input.totalUnits),
    items: (input.items || []).map((item) => ({
      sku: String(item.sku || '').toUpperCase(),
      quantity: roundQty(item.quantity),
      unit: normalizedUnit(item.unit),
      lot: item.lot || null,
      expiryDate: item.expiryDate || null,
    })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
}

function documentIdentity(input) {
  const { warnings, sourceReference, hash, operationalHash, ...stable } = input;
  return stable;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function optionalNonNegativeNumber(value, label) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw inputError(`${label} debe ser no negativo`);
  return roundQty(number);
}

function evidenceIncludesQuantity(evidence, quantity) {
  const number = Number(quantity);
  const forms = new Set([
    String(number),
    String(number).replace('.', ','),
    number.toLocaleString('en-US', { maximumFractionDigits: 4 }),
    number.toLocaleString('es-CO', { maximumFractionDigits: 4 }),
  ]);
  return [...forms].some((form) => {
    const escaped = escapeRegExp(form.toUpperCase());
    return new RegExp(`(?<![0-9.,])${escaped}(?![0-9.,])`, 'u').test(evidence);
  });
}

function evidenceIncludesDate(evidence, isoDate) {
  const [year, month, day] = String(isoDate || '').split('-');
  if (!year || !month || !day) return false;
  return [
    `${year}-${month}-${day}`,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day}.${month}.${year}`,
  ].some(form => evidence.includes(form.toUpperCase()));
}

function cleanEvidenceText(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200_000).toUpperCase();
}

function evidenceIncludes(evidence, value) {
  const escaped = escapeRegExp(String(value || '').trim().toUpperCase());
  return new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`, 'u').test(evidence);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeDecodePathName(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return 'orden-compra.pdf';
  }
}

function normalizedTaxId(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizedName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function normalizedUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (/^(u|und|unidad|unidades)$/u.test(unit)) return 'und';
  if (/^(g|gr|gramo|gramos)$/u.test(unit)) return 'g';
  if (/^(kg|kilo|kilos|kilogramo|kilogramos)$/u.test(unit)) return 'kg';
  return unit;
}

function calculateTotalsByUnit(items) {
  const totals = new Map();
  for (const item of items) {
    const unit = normalizedUnit(item.unit) || 'sin_unidad';
    totals.set(unit, roundQty((totals.get(unit) || 0) + item.quantity));
  }
  return totals;
}

function comparableCalculatedTotal(totalsByUnit, suppliedTotal) {
  const entries = [...totalsByUnit.entries()];
  if (!entries.length) return 0;
  if (entries.length === 1) return entries[0][1];
  // `total_unidades` must be compared with physical units when a document also
  // contains weight-based materials. Never let a grams subtotal validate it.
  if (totalsByUnit.has('und')) return totalsByUnit.get('und');
  if (suppliedTotal != null) {
    const exactMatches = entries.filter(([, total]) => Math.abs(total - suppliedTotal) <= 0.0001);
    if (exactMatches.length === 1) return exactMatches[0][1];
  }
  return suppliedTotal == null ? entries[0][1] : suppliedTotal;
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((warning) => cleanText(warning, 255)).filter(Boolean);
}

function isModelDerivedValidationWarning(value) {
  const warning = normalizedName(value);
  return warning.includes('NOCOINCIDE') && warning.includes('TOTAL')
    || isModelMissingItemWarning(value);
}

function isModelMissingItemWarning(value) {
  const warning = normalizedName(value);
  return warning.includes('FALTANLOTE')
    || warning.includes('FALTANVENCIMIENTO')
    || warning.includes('FALTANLOTEYVENCIMIENTO')
    || warning.includes('NOMUESTRALOTE')
    || warning.includes('NOMUESTRAVENCIMIENTO');
}

function parseWarnings(value) {
  if (Array.isArray(value)) return normalizeWarnings(value);
  if (!value) return [];
  try {
    return normalizeWarnings(JSON.parse(value));
  } catch {
    return [];
  }
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function optionalText(value, maxLength) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function roundQty(value) {
  return Number(Number(value || 0).toFixed(4));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function dateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function conflictError(message) {
  return Object.assign(new Error(message), { status: 409 });
}

module.exports = {
  DOCUMENT_TYPE,
  MAX_DOCUMENT_ITEMS,
  normalizePurchaseOrderDocumentInput,
  validateBuilderBotDocumentUrl,
  downloadBuilderBotPdf,
  registerPurchaseOrderDocumentDraft,
  operationalIdentity,
};
