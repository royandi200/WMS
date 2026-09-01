const { preparePurchaseOrderReception } = require('./purchase-order-reception');
const { createHash } = require('crypto');

function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function purchaseOrderReference(params = {}) {
  return {
    id: Number(params.orden_compra_id || params.purchase_order_id || 0) || null,
    number: String(params.numero_oc || params.orden_compra || params.purchase_order_number || '').trim(),
  };
}

function parseWarnings(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function findPurchaseOrderDocumentDraft(db, params = {}) {
  const id = Number(params.documento_borrador_id || params.document_draft_id || 0) || null;
  const reference = String(params.referencia_documento || params.numero_oc || '').trim();
  if (!id && !reference) throw inputError('Indica la referencia de la orden de compra');
  const [rows] = id
    ? await db.execute(
        `SELECT id, referencia_documento, fecha_documento, destinatario_nombre,
                tercero_id, estado, advertencias, orden_compra_id
           FROM documentos_bodega_borrador
          WHERE id = ? AND tipo_documento = 'ORDEN_COMPRA' LIMIT 1`,
        [id]
      )
    : await db.execute(
        `SELECT id, referencia_documento, fecha_documento, destinatario_nombre,
                tercero_id, estado, advertencias, orden_compra_id
           FROM documentos_bodega_borrador
          WHERE tipo_documento = 'ORDEN_COMPRA'
            AND UPPER(referencia_documento) = UPPER(?)
          LIMIT 1`,
        [reference]
      );
  if (!rows.length) throw inputError('Borrador de orden de compra no encontrado', 404);
  const draft = { ...rows[0], warnings: parseWarnings(rows[0].advertencias) };
  const [items] = await db.execute(
    `SELECT producto_id, sku_extraido AS sku, descripcion_extraida AS descripcion,
            cantidad, unidad, precio_unitario
       FROM documento_bodega_borrador_items WHERE documento_id = ? ORDER BY id`,
    [draft.id]
  );
  draft.items = items;
  return draft;
}

async function reviewPurchaseOrderDocumentDraft({ db, params }) {
  return findPurchaseOrderDocumentDraft(db, params);
}

function explicitPurchaseOrderConfirmation(rawText, reference, params = {}) {
  if (params.confirmacion_final !== true && params.confirmacion_final !== 'true') return false;
  const text = String(rawText || '').trim();
  return /\bconfirm(?:o|amos)\s+(?:la\s+)?orden\s+de\s+compra\b/iu.test(text)
    && text.toUpperCase().includes(String(reference || '').toUpperCase());
}

async function confirmPurchaseOrderDocumentDraft({ db, params, rawText, user }) {
  const draft = await findPurchaseOrderDocumentDraft(db, params);
  if (draft.orden_compra_id) {
    return {
      id: draft.orden_compra_id,
      numero: draft.referencia_documento,
      estado: 'CARGADA',
      duplicate: true,
    };
  }
  if (draft.estado !== 'PENDIENTE_REVISION') {
    throw inputError('La OC requiere correccion en el dashboard antes de poder confirmarse', 409);
  }
  if (draft.warnings.length) {
    throw inputError('La OC tiene advertencias pendientes y no puede confirmarse por WhatsApp', 409);
  }
  if (!draft.tercero_id) {
    throw inputError('El proveedor no esta identificado de forma inequivoca', 409);
  }
  if (!draft.items.length || draft.items.some(item => !item.producto_id)) {
    throw inputError('Todos los SKU deben existir en el catalogo antes de confirmar la OC', 409);
  }
  if (!explicitPurchaseOrderConfirmation(rawText, draft.referencia_documento, params)) {
    throw inputError(
      `Para crear la OC escribe: Confirmo la orden de compra ${draft.referencia_documento}`,
      409
    );
  }
  const { createPurchaseOrderForUser } = require('../v1/purchase-orders');
  const created = await createPurchaseOrderForUser({
    user: { id: user.id, rol: user.rol_nombre || user.rol },
    body: {
      document_draft_id: draft.id,
      numero: draft.referencia_documento,
      tercero_id: draft.tercero_id,
      fecha_orden: draft.fecha_documento,
      items: draft.items.map(item => ({
        producto_id: item.producto_id,
        sku: item.sku,
        descripcion: item.descripcion,
        cantidad: Number(item.cantidad),
        unidad: item.unidad,
        precio_unitario: item.precio_unitario,
      })),
    },
  });
  return created.data;
}

async function findPurchaseOrder(db, params = {}) {
  const reference = purchaseOrderReference(params);
  if (!reference.id && !reference.number) {
    throw inputError('Indica el numero de la orden de compra');
  }
  const [rows] = reference.id
    ? await db.execute(
        `SELECT id, numero, estado, proveedor_nombre
           FROM ordenes_compra_proveedor WHERE id = ? LIMIT 1`,
        [reference.id]
      )
    : await db.execute(
        `SELECT id, numero, estado, proveedor_nombre
           FROM ordenes_compra_proveedor WHERE UPPER(numero) = UPPER(?) LIMIT 1`,
        [reference.number]
      );
  if (!rows.length) throw inputError('Orden de compra no encontrada', 404);
  if (reference.number && rows[0].numero.toUpperCase() !== reference.number.toUpperCase()) {
    throw inputError('El numero de OC no coincide con la orden seleccionada', 409);
  }
  return rows[0];
}

async function findCompletedReception(db, purchaseOrderId) {
  const [rows] = await db.execute(
    `SELECT id, numero, estado, completado_en
       FROM recepciones
      WHERE orden_compra_id = ? AND estado = 'completada'
      ORDER BY completado_en DESC, id DESC
      LIMIT 1`,
    [purchaseOrderId]
  );
  return rows[0] || null;
}

async function prepareReceptionFromPurchaseOrder({ db, params, userId }) {
  const order = await findPurchaseOrder(db, params);
  const completed = await findCompletedReception(db, order.id);
  if (order.estado === 'CERRADA' && completed) {
    return { order, reception: completed, alreadyCompleted: true };
  }
  if (['CANCELADA', 'CERRADA'].includes(order.estado)) {
    throw inputError(`La orden de compra esta ${order.estado}`, 409);
  }

  await db.beginTransaction();
  try {
    const reception = await preparePurchaseOrderReception(db, {
      purchaseOrderId: order.id,
      userId,
    });
    await db.commit();
    return { order, reception, alreadyCompleted: false };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}

function explicitConfirmation(rawText, orderNumber, params = {}) {
  if (params.confirmacion_final !== true && params.confirmacion_final !== 'true') return false;
  const text = String(rawText || '').trim();
  return /\bconfirm(?:o|amos)\s+(?:la\s+)?recepci[oó]n\b/iu.test(text)
    && text.toUpperCase().includes(String(orderNumber || '').toUpperCase());
}

function receptionConfirmationKey(orderId, receptionId, params = {}) {
  const items = suppliedItems(params).map(item => {
    const distributions = itemDistributions(item).map(entry => ({
      cantidad: Number(entry.cantidad ?? entry.quantity),
      lote: String(entry.lote || entry.lpn || entry.lot_id || '').trim(),
      fecha_venc: String(entry.fecha_venc || entry.fecha_vencimiento || entry.expiry_date || '').trim(),
      condicion: String(entry.condicion || entry.condition || '').trim().toUpperCase(),
      ubicacion: String(entry.ubicacion || entry.codigo_ubicacion || entry.location_code || '').trim().toUpperCase(),
      motivo: String(entry.motivo || entry.reason || '').trim(),
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return {
      sku: itemSku(item),
      cantidad_recibida: Number(distributions.reduce((sum, entry) => sum + entry.cantidad, 0).toFixed(4)),
      motivo: String(item.motivo_diferencia || item.motivo || '').trim(),
      distribuciones: distributions,
    };
  }).sort((left, right) => left.sku.localeCompare(right.sku));
  const hash = createHash('sha256').update(JSON.stringify({
    orderId: Number(orderId),
    receptionId: Number(receptionId),
    items,
  })).digest('hex');
  return `WA:${hash}`;
}

async function findPreparedReception(db, orderId, params = {}) {
  const id = Number(params.recepcion_id || params.reception_id || 0) || null;
  const number = String(params.numero_recepcion || params.recepcion || '').trim();
  if (!id && !number) {
    throw inputError('Prepara primero la recepcion e indica su numero REC-', 409);
  }
  const [rows] = id
    ? await db.execute(
        `SELECT id, numero, estado FROM recepciones
          WHERE id = ? AND orden_compra_id = ? LIMIT 1`,
        [id, orderId]
      )
    : await db.execute(
        `SELECT id, numero, estado FROM recepciones
          WHERE UPPER(numero) = UPPER(?) AND orden_compra_id = ? LIMIT 1`,
        [number, orderId]
      );
  if (!rows.length) throw inputError('La recepcion no pertenece a la OC indicada', 404);
  return rows[0];
}

function suppliedItems(params = {}) {
  const items = params.items || params.productos || params.lineas;
  if (!Array.isArray(items) || !items.length) {
    throw inputError('Incluye todos los items recibidos con sus lotes, cantidades, condiciones y ubicaciones');
  }
  if (items.length > 100) throw inputError('La recepcion supera el maximo de 100 items');
  return items;
}

function itemSku(item = {}) {
  return String(item.sku || item.id_item || item.producto || '').trim().toUpperCase();
}

function itemDistributions(item = {}) {
  const distributions = item.distributions || item.distribuciones;
  if (!Array.isArray(distributions) || !distributions.length) {
    throw inputError(`Faltan distribuciones para ${itemSku(item) || 'un item'}`);
  }
  if (distributions.length > 20) {
    throw inputError(`Un item no puede superar 20 distribuciones`);
  }
  return distributions;
}

async function resolveLocation(db, code) {
  const locationCode = String(code || '').trim();
  if (!locationCode) return null;
  const [rows] = await db.execute(
    `SELECT id, codigo FROM ubicaciones WHERE UPPER(codigo) = UPPER(?) AND activa = 1 LIMIT 2`,
    [locationCode]
  );
  if (!rows.length) throw inputError(`Ubicacion no encontrada: ${locationCode}`, 404);
  if (rows.length > 1) throw inputError(`La ubicacion ${locationCode} no es unica`, 409);
  return rows[0];
}

async function buildConfirmationItems(db, preparedItems, params = {}) {
  const incoming = suppliedItems(params);
  const preparedBySku = new Map(preparedItems.map(item => [String(item.sku).toUpperCase(), item]));
  const seen = new Set();
  const result = [];

  for (const item of incoming) {
    const sku = itemSku(item);
    if (!sku || !preparedBySku.has(sku)) {
      throw inputError(`El SKU ${sku || '(vacio)'} no pertenece al saldo pendiente de la OC`, 409);
    }
    if (seen.has(sku)) throw inputError(`El SKU ${sku} esta repetido`);
    seen.add(sku);
    const prepared = preparedBySku.get(sku);
    const distributions = [];
    for (const entry of itemDistributions(item)) {
      const location = await resolveLocation(
        db,
        entry.ubicacion || entry.codigo_ubicacion || entry.location_code
      );
      distributions.push({
        cantidad: entry.cantidad ?? entry.quantity,
        lote: entry.lote || entry.lpn || entry.lot_id,
        fecha_venc: entry.fecha_venc || entry.fecha_vencimiento || entry.expiry_date || null,
        condicion: entry.condicion || entry.condition,
        motivo: entry.motivo || entry.reason || null,
        ubicacion_id: location?.id || null,
      });
    }
    result.push({
      item_id: prepared.item_id,
      product_id: prepared.producto_id,
      cantidad_recibida: item.cantidad_recibida ?? item.cantidad_total ?? null,
      motivo: item.motivo_diferencia || item.motivo || null,
      distributions,
    });
  }

  const missing = preparedItems.filter(item => !seen.has(String(item.sku).toUpperCase()));
  if (missing.length) {
    throw inputError(`Falta confirmar: ${missing.map(item => item.sku).join(', ')}`);
  }
  return result;
}

async function confirmReceptionFromWhatsApp({ db, params, rawText, user }) {
  const order = await findPurchaseOrder(db, params);
  if (!explicitConfirmation(rawText, order.numero, params)) {
    throw inputError(
      `Para modificar inventario escribe: Confirmo la recepcion ${order.numero}`,
      409
    );
  }
  const requestedReception = await findPreparedReception(db, order.id, params);
  if (requestedReception.estado === 'completada') {
    return {
      recepcion_id: requestedReception.id,
      numero: requestedReception.numero,
      estado: requestedReception.estado,
      already_completed: true,
      orden_compra_numero: order.numero,
    };
  }
  if (!['borrador', 'en_proceso'].includes(requestedReception.estado)) {
    throw inputError(`La recepcion esta ${requestedReception.estado}`, 409);
  }
  const confirmationKey = receptionConfirmationKey(order.id, requestedReception.id, params);
  const [previous] = await db.execute(
    `SELECT id, numero, estado FROM recepciones WHERE confirmacion_clave = ? LIMIT 1`,
    [confirmationKey]
  );
  if (previous.length) {
    if (previous[0].estado !== 'completada') {
      throw inputError('La misma confirmacion de recepcion ya esta en proceso', 409);
    }
    return {
      recepcion_id: previous[0].id,
      numero: previous[0].numero,
      estado: previous[0].estado,
      already_completed: true,
      orden_compra_numero: order.numero,
    };
  }
  const prepared = await prepareReceptionFromPurchaseOrder({
    db,
    params: { orden_compra_id: order.id },
    userId: user.id,
  });
  if (prepared.alreadyCompleted) {
    return {
      recepcion_id: prepared.reception.id,
      numero: prepared.reception.numero,
      estado: prepared.reception.estado,
      already_completed: true,
      orden_compra_numero: prepared.order.numero,
    };
  }
  if (Number(prepared.reception.id) !== Number(requestedReception.id)) {
    throw inputError('El borrador REC- no coincide con el saldo activo de la OC', 409);
  }
  const items = await buildConfirmationItems(db, prepared.reception.items, params);
  const { confirmReceptionForUser } = require('../v1/reception');
  const result = await confirmReceptionForUser({
    user: { id: user.id, rol: user.rol_nombre || user.rol },
    body: {
      recepcion_id: prepared.reception.id,
      orden_compra_id: prepared.order.id,
      confirmation_key: confirmationKey,
      notes: params.notas || params.observaciones || 'Recepcion confirmada por WhatsApp',
      items,
    },
  });
  return { ...result, orden_compra_numero: prepared.order.numero };
}

module.exports = {
  findPurchaseOrderDocumentDraft,
  reviewPurchaseOrderDocumentDraft,
  explicitPurchaseOrderConfirmation,
  confirmPurchaseOrderDocumentDraft,
  purchaseOrderReference,
  findPurchaseOrder,
  prepareReceptionFromPurchaseOrder,
  explicitConfirmation,
  receptionConfirmationKey,
  findPreparedReception,
  buildConfirmationItems,
  confirmReceptionFromWhatsApp,
};
