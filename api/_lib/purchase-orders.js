const crypto = require('crypto');

function normalizePurchaseOrderInput(body = {}) {
  const numero = String(body.numero || body.order_number || '').trim();
  const terceroId = Number(body.tercero_id || body.supplier_id || 0) || null;
  const fechaOrden = body.fecha_orden || body.order_date || null;
  const archivoNombre = String(body.archivo_nombre || body.file_name || '').trim() || null;
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!numero) throw inputError('numero es obligatorio');
  if (!terceroId) throw inputError('Debes seleccionar un proveedor sincronizado');
  if (!rawItems.length) throw inputError('La orden debe tener al menos un item');

  const items = rawItems.map((item, index) => {
    const productId = Number(item.producto_id || item.product_id || 0) || null;
    const sku = String(item.sku || item.siigo_code || item.referencia || '').trim() || null;
    const quantity = Number(item.cantidad_ordenada ?? item.quantity ?? item.cantidad);
    const unitPriceRaw = item.precio_unitario ?? item.unit_price;
    const unitPrice = unitPriceRaw == null || unitPriceRaw === '' ? null : Number(unitPriceRaw);
    const documentLot = String(item.lote_documento || item.document_lot || item.lote || '').trim() || null;
    if (documentLot && documentLot.length > 100) throw inputError(`Lote documental demasiado largo en item ${index + 1}`);
    const documentExpiry = normalizeDate(item.fecha_vencimiento_documento
      || item.document_expiry_date || item.fecha_vencimiento || item.expiry_date);
    if (!productId && !sku) throw inputError(`El item ${index + 1} no tiene producto o SKU`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw inputError(`Cantidad invalida en item ${index + 1}`);
    if (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      throw inputError(`Precio invalido en item ${index + 1}`);
    }
    return {
      productId,
      sku,
      quantity,
      unit: String(item.unidad || item.unit || '').trim() || null,
      unitPrice,
      description: String(item.descripcion || item.description || '').trim() || null,
      documentLot,
      documentExpiry,
    };
  });

  const canonical = { numero, terceroId, fechaOrden, items };
  return {
    ...canonical,
    proveedorNombre: null,
    archivoNombre,
    sourceData: body.datos_origen || body.source_data || null,
    hash: crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
  };
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw inputError('La fecha de vencimiento documental debe usar YYYY-MM-DD');
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw inputError('La fecha de vencimiento documental no es valida');
  }
  return text;
}

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

module.exports = { normalizePurchaseOrderInput };
