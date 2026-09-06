const crypto = require('crypto');
const { normalizedDate, normalizedUnit } = require('./document-evidence-items');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function clean(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeWarehouseDraftReview(body = {}) {
  const id = Number(body.id || body.document_draft_id || 0);
  const reason = clean(body.motivo || body.reason, 300);
  const documentDate = normalizedDate(body.fecha_documento || body.document_date);
  const destinationName = clean(body.destinatario_nombre || body.destination_name, 200);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Borrador documental invalido');
  if (reason.length < 5) throw httpError(400, 'El motivo de la correccion es obligatorio');
  if (!documentDate) throw httpError(400, 'Fecha de documento invalida');
  if (!destinationName) throw httpError(400, 'Destinatario obligatorio');
  if (!items.length || items.length > 100) throw httpError(400, 'El borrador debe contener entre 1 y 100 items');
  const normalizedItems = items.map((item, index) => {
    const sku = clean(item.sku || item.sku_extraido, 80).toUpperCase();
    const description = clean(item.descripcion || item.descripcion_extraida, 255);
    const quantity = Number(item.cantidad ?? item.quantity);
    const unit = normalizedUnit(item.unidad || item.unit);
    const lot = clean(item.lote || item.lot, 100) || null;
    const expiryDate = item.fecha_vencimiento || item.expiry_date
      ? normalizedDate(item.fecha_vencimiento || item.expiry_date)
      : null;
    if (!sku) throw httpError(400, `El item ${index + 1} requiere SKU`);
    if (!description) throw httpError(400, `El item ${sku} requiere descripcion`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, `Cantidad invalida para ${sku}`);
    if (!unit) throw httpError(400, `Unidad obligatoria para ${sku}`);
    if ((item.fecha_vencimiento || item.expiry_date) && !expiryDate) {
      throw httpError(400, `Vencimiento invalido para ${sku}`);
    }
    return { sku, description, quantity: Number(quantity.toFixed(4)), unit, lot, expiryDate };
  });
  return {
    id,
    reason,
    documentDate,
    destinationName,
    totalPackages: body.total_bultos == null || body.total_bultos === '' ? null : Number(body.total_bultos),
    items: normalizedItems,
  };
}

function itemSummary(items) {
  return items.map((item) => ({
    sku: item.sku || item.sku_extraido,
    cantidad: Number(item.quantity ?? item.cantidad),
    unidad: item.unit || item.unidad,
    lote: item.lot ?? item.lote ?? null,
    vencimiento: item.expiryDate ?? item.fecha_vencimiento ?? null,
  }));
}

function totalsByUnit(items) {
  const totals = new Map();
  for (const item of items) totals.set(item.unit, Number(((totals.get(item.unit) || 0) + item.quantity).toFixed(4)));
  return totals;
}

async function reviewWarehouseDocumentDraft(conn, input, userId) {
  const [drafts] = await conn.execute(
    `SELECT id, referencia_documento, estado, fecha_documento, destinatario_nombre,
            total_bultos, orden_compra_id, maquila_envio_id
       FROM documentos_bodega_borrador
      WHERE id = ? AND tipo_documento = 'SALIDA_BODEGA_3Q'
      LIMIT 1 FOR UPDATE`,
    [input.id]
  );
  if (!drafts.length) throw httpError(404, 'Borrador de remision 3Q no encontrado');
  const draft = drafts[0];
  if (draft.orden_compra_id || draft.maquila_envio_id || draft.estado === 'VINCULADO') {
    throw httpError(409, 'El borrador ya esta vinculado y no admite correcciones');
  }
  if (!['PENDIENTE_REVISION', 'REQUIERE_CORRECCION'].includes(draft.estado)) {
    throw httpError(409, `El borrador no admite correcciones en estado ${draft.estado}`);
  }

  const [previousItems] = await conn.execute(
    `SELECT sku_extraido, cantidad, unidad, lote, fecha_vencimiento
       FROM documento_bodega_borrador_items WHERE documento_id = ? ORDER BY id`,
    [input.id]
  );
  const resolved = [];
  for (const item of input.items) {
    const [products] = await conn.execute(
      `SELECT id, siigo_code, nombre FROM productos
        WHERE UPPER(siigo_code) = ? AND activo = 1 LIMIT 1`,
      [item.sku]
    );
    if (!products.length) throw httpError(409, `SKU no encontrado o inactivo: ${item.sku}`);
    resolved.push({ ...item, product: products[0] });
  }
  if (input.totalPackages != null && (!Number.isFinite(input.totalPackages) || input.totalPackages < 0)) {
    throw httpError(400, 'Total de bultos invalido');
  }
  const totals = totalsByUnit(resolved);
  const totalUnits = totals.get('und') ?? (totals.size === 1 ? [...totals.values()][0] : 0);

  await conn.execute('DELETE FROM documento_bodega_borrador_items WHERE documento_id = ?', [input.id]);
  for (const item of resolved) {
    await conn.execute(
      `INSERT INTO documento_bodega_borrador_items
         (documento_id, producto_id, sku_extraido, descripcion_extraida,
          cantidad, unidad, fecha_vencimiento, lote, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [input.id, item.product.id, item.sku, item.description, item.quantity,
       item.unit, item.expiryDate, item.lot]
    );
  }
  const [updated] = await conn.execute(
    `UPDATE documentos_bodega_borrador
        SET fecha_documento = ?, destinatario_nombre = ?, total_bultos = ?,
            total_unidades = ?, total_calculado = ?, advertencias = NULL,
            estado = 'PENDIENTE_REVISION', revisado_por = ?, revisado_en = NOW(),
            actualizado_en = NOW()
      WHERE id = ? AND estado IN ('PENDIENTE_REVISION', 'REQUIERE_CORRECCION')
        AND orden_compra_id IS NULL AND maquila_envio_id IS NULL`,
    [input.documentDate, input.destinationName, input.totalPackages, totalUnits,
     totalUnits, userId, input.id]
  );
  if (updated.affectedRows !== 1) throw httpError(409, 'El borrador cambio mientras se corregia');

  const audit = {
    documento_borrador_id: input.id,
    referencia_documento: draft.referencia_documento,
    motivo: input.reason,
    antes: itemSummary(previousItems),
    despues: itemSummary(resolved),
  };
  await conn.execute(
    `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
     VALUES ('warehouse_documents', 'INFO', ?, ?, ?, NOW())`,
    [`Borrador 3Q ${draft.referencia_documento} corregido`, userId, JSON.stringify(audit)]
  );
  return {
    id: input.id,
    referencia_documento: draft.referencia_documento,
    estado: 'PENDIENTE_REVISION',
    itemCount: resolved.length,
    totals: Object.fromEntries(totals),
    auditId: crypto.createHash('sha256').update(JSON.stringify(audit)).digest('hex').slice(0, 16),
  };
}

module.exports = {
  normalizeWarehouseDraftReview,
  reviewWarehouseDocumentDraft,
};
