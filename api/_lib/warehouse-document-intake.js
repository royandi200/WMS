const { createHash } = require('crypto');

const MAX_DOCUMENT_ITEMS = 100;

function normalizeWarehouseDocumentInput(body = {}) {
  const source = body.params && typeof body.params === 'object' ? body.params : body;
  const documentType = cleanText(source.tipo_documento || source.document_type, 50).toUpperCase();
  const reference = cleanText(source.referencia_documento || source.document_reference, 80);
  const documentDate = normalizeDate(source.fecha_documento || source.document_date, 'fecha_documento');
  const destinationName = cleanText(source.nombre_cliente || source.destinatario || source.customer_name, 200);
  const items = Array.isArray(source.items) ? source.items : [];

  if (documentType !== 'SALIDA_BODEGA_3Q') {
    throw inputError('El documento debe ser una SALIDA_BODEGA_3Q');
  }
  if (!reference) throw inputError('referencia_documento es obligatoria');
  if (!documentDate) throw inputError('fecha_documento es obligatoria');
  if (!destinationName) throw inputError('nombre_cliente o destinatario es obligatorio');
  if (!items.length) throw inputError('El documento debe incluir al menos un item');
  if (items.length > MAX_DOCUMENT_ITEMS) throw inputError(`El documento supera ${MAX_DOCUMENT_ITEMS} items`);

  const normalizedItems = items.map((item, index) => normalizeItem(item, index));
  const calculatedTotal = roundQty(normalizedItems.reduce((sum, item) => sum + item.quantity, 0));
  const suppliedTotal = optionalPositiveNumber(source.total_unidades ?? source.total_units, 'total_unidades');
  const warnings = normalizeWarnings(source.advertencias || source.warnings);
  if (suppliedTotal != null && Math.abs(suppliedTotal - calculatedTotal) > 0.0001) {
    warnings.push(`El total declarado (${suppliedTotal}) no coincide con la suma de items (${calculatedTotal})`);
  }
  for (const item of normalizedItems) {
    if (!item.lot) warnings.push(`El item ${item.sku} no tiene lote`);
    if (!item.expiryDate) warnings.push(`El item ${item.sku} no tiene fecha de vencimiento`);
  }

  const normalized = {
    documentType,
    reference,
    documentDate,
    destinationName,
    address: optionalText(source.direccion || source.address, 255),
    cityDepartment: optionalText(source.ciudad_departamento || source.city_department, 160),
    taxId: optionalText(source.nit || source.documento_identidad || source.tax_id, 80),
    phone: optionalText(source.telefono || source.phone, 40),
    totalPackages: optionalPositiveNumber(source.total_bultos ?? source.total_packages, 'total_bultos'),
    totalUnits: suppliedTotal == null ? calculatedTotal : suppliedTotal,
    calculatedTotal,
    deliveredBy: optionalText(source.entrega || source.delivered_by, 160),
    receivedBy: optionalText(source.recibe || source.received_by, 160),
    sourceFileName: optionalText(source.nombre_archivo || source.file_name, 255),
    sourceReference: optionalText(source.referencia_origen || source.source_reference, 255),
    warnings: [...new Set(warnings)].slice(0, 50),
    items: normalizedItems,
  };
  normalized.hash = createHash('sha256').update(canonicalJson(documentIdentity(normalized))).digest('hex');
  return normalized;
}

async function registerWarehouseDocumentDraft({ db, body, userId, origin = 'BUILDERBOT' }) {
  const input = normalizeWarehouseDocumentInput(body);
  const normalizedOrigin = String(origin || 'BUILDERBOT').trim().toUpperCase();
  if (!['BUILDERBOT', 'DASHBOARD'].includes(normalizedOrigin)) throw inputError('Origen documental no soportado');

  await db.beginTransaction();
  try {
    const [existing] = await db.execute(
      `SELECT id, referencia_documento, sha256, estado, total_unidades, advertencias
         FROM documentos_bodega_borrador
        WHERE origen = ? AND referencia_documento = ?
        LIMIT 1 FOR UPDATE`,
      [normalizedOrigin, input.reference]
    );
    if (existing.length) {
      if (existing[0].sha256 !== input.hash) {
        throw conflictError(`El documento ${input.reference} ya existe con contenido diferente`);
      }
      await db.commit();
      return {
        ...existing[0],
        duplicate: true,
        warnings: parseStoredWarnings(existing[0].advertencias),
        itemCount: input.items.length,
        totalUnits: Number(existing[0].total_unidades || 0),
      };
    }

    const resolved = [];
    for (const item of input.items) {
      const [products] = await db.execute(
        `SELECT id, siigo_code, nombre
           FROM productos
          WHERE UPPER(siigo_code) = ? AND activo = 1
          LIMIT 1`,
        [item.sku]
      );
      if (!products.length) input.warnings.push(`SKU no encontrado o inactivo: ${item.sku}`);
      resolved.push({ ...item, product: products[0] || null });
    }
    input.warnings = [...new Set(input.warnings)].slice(0, 50);
    const status = input.warnings.length ? 'REQUIERE_CORRECCION' : 'PENDIENTE_REVISION';
    const [created] = await db.execute(
      `INSERT INTO documentos_bodega_borrador
         (tipo_documento, origen, referencia_documento, fecha_documento,
          destinatario_nombre, direccion, ciudad_departamento, nit, telefono,
          total_bultos, total_unidades, total_calculado, entrega, recibe,
          nombre_archivo, referencia_origen, advertencias, sha256, estado,
          creado_por, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [input.documentType, normalizedOrigin, input.reference, input.documentDate,
       input.destinationName, input.address, input.cityDepartment, input.taxId, input.phone,
       input.totalPackages, input.totalUnits, input.calculatedTotal, input.deliveredBy,
       input.receivedBy, input.sourceFileName, input.sourceReference,
       input.warnings.length ? JSON.stringify(input.warnings) : null, input.hash, status, userId]
    );
    for (const item of resolved) {
      await db.execute(
        `INSERT INTO documento_bodega_borrador_items
           (documento_id, producto_id, sku_extraido, descripcion_extraida,
            cantidad, fecha_vencimiento, lote, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [created.insertId, item.product?.id || null, item.sku, item.description,
         item.quantity, item.expiryDate, item.lot]
      );
    }
    await db.commit();
    return {
      id: created.insertId,
      referencia_documento: input.reference,
      estado: status,
      duplicate: false,
      warnings: input.warnings,
      itemCount: input.items.length,
      totalUnits: input.totalUnits,
    };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}

function normalizeItem(item = {}, index) {
  const sku = cleanText(item.sku || item.codigo_barras || item.barcode, 80).toUpperCase();
  const description = cleanText(item.descripcion || item.producto || item.description, 255);
  const quantity = Number(item.cantidad ?? item.quantity);
  if (!sku) throw inputError(`El item ${index + 1} requiere SKU exacto en codigo de barras`);
  if (!description) throw inputError(`El item ${index + 1} requiere descripcion`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw inputError(`La cantidad del item ${sku} debe ser positiva`);
  return {
    sku,
    description,
    quantity: roundQty(quantity),
    expiryDate: normalizeDate(item.fecha_vencimiento || item.expiry_date, `fecha_vencimiento de ${sku}`, true),
    lot: optionalText(item.lote || item.lot, 100),
  };
}

function normalizeDate(value, label, optional = false) {
  if (value == null || String(value).trim() === '') {
    if (optional) return null;
    return null;
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw inputError(`${label} debe usar YYYY-MM-DD`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw inputError(`${label} no es una fecha valida`);
  }
  return text;
}

function optionalPositiveNumber(value, label) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw inputError(`${label} debe ser un numero no negativo`);
  return roundQty(number);
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((warning) => cleanText(warning, 255)).filter(Boolean);
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function optionalText(value, maxLength) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function roundQty(value) {
  return Number(Number(value).toFixed(4));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function documentIdentity(normalized) {
  const { warnings, sourceReference, hash, ...stableDocument } = normalized;
  return stableDocument;
}

function parseStoredWarnings(value) {
  if (Array.isArray(value)) return normalizeWarnings(value);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeWarnings(parsed) : [];
  } catch {
    return [];
  }
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function conflictError(message) {
  return Object.assign(new Error(message), { status: 409 });
}

module.exports = {
  MAX_DOCUMENT_ITEMS,
  normalizeWarehouseDocumentInput,
  registerWarehouseDocumentDraft,
  canonicalJson,
  documentIdentity,
};
