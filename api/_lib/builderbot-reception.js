const { preparePurchaseOrderReception } = require('./purchase-order-reception');
const { createHash } = require('crypto');
const { resolveProductReference } = require('./product-references');

function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function purchaseOrderReference(params = {}) {
  return {
    id: Number(params.orden_compra_id || params.purchase_order_id || 0) || null,
    number: String(params.numero_oc || params.orden_compra || params.purchase_order_number || '').trim(),
  };
}

async function listAvailablePurchaseOrderReceptions({ db, limit = 10 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 10);
  const [orders] = await db.execute(
    `SELECT oc.id, oc.numero, oc.proveedor_nombre, oc.fecha_orden, oc.estado
       FROM ordenes_compra_proveedor oc
      WHERE oc.estado IN ('CARGADA', 'RECIBIDA', 'RECIBIDA_PARCIAL')
        AND EXISTS (
          SELECT 1 FROM orden_compra_proveedor_items existing
           WHERE existing.orden_compra_id = oc.id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM orden_compra_proveedor_items blocked
            JOIN productos blocked_product ON blocked_product.id = blocked.producto_id
           WHERE blocked.orden_compra_id = oc.id
             AND blocked_product.modalidad_operativa IN ('PR', 'PT')
        )
      ORDER BY COALESCE(oc.fecha_orden, DATE(oc.creado_en)), oc.id
      LIMIT 50`
  );
  if (!orders.length) return [];

  const orderIds = orders.map(order => Number(order.id));
  const placeholders = orderIds.map(() => '?').join(',');
  const [orderedItems] = await db.execute(
    `SELECT oci.orden_compra_id, oci.producto_id, p.siigo_code AS sku,
            p.nombre AS producto, p.requiere_lote, p.modalidad_operativa,
            SUM(oci.cantidad_ordenada) AS cantidad_ordenada,
            CASE WHEN COUNT(DISTINCT COALESCE(NULLIF(oci.unidad, ''), 'und')) = 1
                 THEN MIN(COALESCE(NULLIF(oci.unidad, ''), 'und')) ELSE NULL END AS unidad
       FROM orden_compra_proveedor_items oci
       JOIN productos p ON p.id = oci.producto_id
      WHERE oci.orden_compra_id IN (${placeholders})
      GROUP BY oci.orden_compra_id, oci.producto_id, p.siigo_code, p.nombre,
               p.requiere_lote, p.modalidad_operativa
      ORDER BY MIN(oci.id)`,
    orderIds
  );
  const [acceptedItems] = await db.execute(
    `SELECT accepted.orden_compra_id, accepted.producto_id,
            SUM(accepted.cantidad) AS cantidad_aceptada
       FROM (
         SELECT r.orden_compra_id, ri.id, ri.producto_id,
                CASE WHEN COUNT(rd.id) > 0
                     THEN COALESCE(SUM(CASE WHEN rd.condicion = 'DISPONIBLE' THEN rd.cantidad ELSE 0 END), 0)
                     ELSE LEAST(ri.cantidad_rec, ri.cantidad_esp) END AS cantidad
           FROM recepciones r
           JOIN recepcion_items ri ON ri.recepcion_id = r.id
           LEFT JOIN recepcion_distribuciones rd
             ON rd.recepcion_id = r.id AND rd.recepcion_item_id = ri.id
          WHERE r.orden_compra_id IN (${placeholders}) AND r.estado = 'completada'
          GROUP BY r.orden_compra_id, ri.id, ri.producto_id, ri.cantidad_rec, ri.cantidad_esp
       ) accepted
      GROUP BY accepted.orden_compra_id, accepted.producto_id`,
    orderIds
  );

  const acceptedByOrderProduct = new Map(acceptedItems.map(item => [
    `${Number(item.orden_compra_id)}:${Number(item.producto_id)}`,
    Number(item.cantidad_aceptada || 0),
  ]));
  const incompatibleUnitOrders = new Set(
    orderedItems.filter(item => !item.unidad).map(item => Number(item.orden_compra_id))
  );
  const itemsByOrder = new Map();
  for (const item of orderedItems) {
    const orderId = Number(item.orden_compra_id);
    if (incompatibleUnitOrders.has(orderId)) continue;
    const ordered = Number(item.cantidad_ordenada || 0);
    const accepted = acceptedByOrderProduct.get(`${orderId}:${Number(item.producto_id)}`) || 0;
    const pending = Number(Math.max(ordered - accepted, 0).toFixed(4));
    if (pending <= 0.0001) continue;
    if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
    itemsByOrder.get(orderId).push({
      producto_id: Number(item.producto_id),
      sku: item.sku,
      producto: item.producto,
      modalidad_operativa: item.modalidad_operativa,
      requiere_lote: Boolean(item.requiere_lote),
      cantidad_pendiente: pending,
      unidad: item.unidad || 'und',
    });
  }

  return orders
    .map(order => {
      const items = itemsByOrder.get(Number(order.id)) || [];
      const modes = new Set(items.map(item => item.modalidad_operativa));
      const receptionType = modes.size === 1 && modes.has('IO')
        ? 'IN_OUT'
        : modes.has('IO')
          ? 'MIXTA'
          : 'INSUMOS_MP';
      return { ...order, tipo_recepcion: receptionType, items };
    })
    .filter(order => !incompatibleUnitOrders.has(Number(order.id)) && order.items.length)
    .slice(0, safeLimit);
}

async function listAvailableOutsourcingReceptions({ db, limit = 10 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 10);
  const [rows] = await db.execute(
    `SELECT om.id, om.codigo, om.estado, om.orden_compra_id,
            oc.numero AS orden_compra_numero, om.proveedor_nombre,
            om.cantidad_objetivo, om.cantidad_recibida,
            p.siigo_code AS sku, p.nombre AS producto,
            p.requiere_lote, COALESCE(NULLIF(p.unit_label, ''), 'und') AS unidad
       FROM ordenes_maquila om
       JOIN ordenes_compra_proveedor oc ON oc.id = om.orden_compra_id
       JOIN productos p ON p.id = om.producto_id
      WHERE om.estado IN ('EN_3Q', 'RECIBIDA_PARCIAL')
        AND om.cantidad_recibida + 0.0001 < om.cantidad_objetivo
      ORDER BY COALESCE(om.enviado_en, om.creado_en), om.id
      LIMIT ${safeLimit}`
  );
  return rows.map(row => ({
    ...row,
    cantidad_pendiente: Number((Number(row.cantidad_objetivo) - Number(row.cantidad_recibida)).toFixed(4)),
    tipo_recepcion: 'MAQUILA_3Q',
  }));
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
            cantidad, unidad, precio_unitario, lote, fecha_vencimiento
       FROM documento_bodega_borrador_items WHERE documento_id = ? ORDER BY id`,
    [draft.id]
  );
  draft.items = items;
  return draft;
}

async function reviewPurchaseOrderDocumentDraft({ db, params }) {
  return findPurchaseOrderDocumentDraft(db, params);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function confirmationMatchesReference(text, entity, idParam) {
  const reference = typeof entity === 'object'
    ? entity.referencia_documento || entity.numero
    : entity;
  const id = Number(typeof entity === 'object' ? entity.id : idParam);
  const hasReference = reference
    && text.toUpperCase().includes(String(reference).toUpperCase());
  const hasShortId = Number.isSafeInteger(id) && id > 0
    && new RegExp(`\\bid\\s*#?\\s*${escapeRegExp(id)}\\b`, 'iu').test(text);
  return Boolean(hasReference || hasShortId);
}

function explicitPurchaseOrderConfirmation(rawText, draft, params = {}) {
  if (params.confirmacion_final !== true && params.confirmacion_final !== 'true') return false;
  const text = String(rawText || '').trim();
  return /\bconfirm(?:o|amos)\s+(?:la\s+)?orden\s+de\s+compra\b/iu.test(text)
    && confirmationMatchesReference(text, draft, params.documento_borrador_id);
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
  if (!explicitPurchaseOrderConfirmation(rawText, draft, params)) {
    throw inputError(
      `Para crear la OC escribe: Confirmo la orden de compra ID ${draft.id}`,
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
        lote_documento: item.lote,
        fecha_vencimiento_documento: item.fecha_vencimiento,
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

function explicitConfirmation(rawText, order, params = {}) {
  if (params.confirmacion_final !== true && params.confirmacion_final !== 'true') return false;
  const text = String(rawText || '').trim();
  return /\bconfirm(?:o|amos)\s+(?:la\s+)?recepci[oó]n\b/iu.test(text)
    && confirmationMatchesReference(text, order, params.orden_compra_id);
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

async function findPreparedReception(db, orderId, params = {}, options = {}) {
  const id = Number(params.recepcion_id || params.reception_id || 0) || null;
  const number = String(params.numero_recepcion || params.recepcion || '').trim();
  if (!id && !number) {
    const [active] = await db.execute(
      `SELECT id, numero, estado FROM recepciones
        WHERE orden_compra_id = ? AND estado IN ('borrador', 'en_proceso')
        ORDER BY id DESC LIMIT 2`,
      [orderId]
    );
    if (active.length === 1) return active[0];
    if (active.length > 1) {
      throw inputError('Hay varias recepciones activas para la OC; indica el numero REC-', 409);
    }
    if (options.allowCompleted) {
      const completed = await findCompletedReception(db, orderId);
      if (completed) return completed;
    }
    throw inputError('Prepara primero la recepcion de la OC', 409);
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
    throw inputError('Incluye todos los items recibidos con cantidades, condiciones, ubicaciones y el lote del proveedor cuando sea obligatorio');
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
  const preparedByProduct = new Map(preparedItems.map(item => [Number(item.producto_id), item]));
  const seen = new Set();
  const result = [];

  for (const item of incoming) {
    const reference = itemSku(item);
    const product = await resolveProductReference(db, reference, {
      productIds: preparedItems.map(prepared => prepared.producto_id),
    });
    const productId = Number(product.id);
    const prepared = preparedByProduct.get(productId);
    if (!prepared) throw inputError(`El producto ${reference} no pertenece al saldo pendiente de la OC`, 409);
    if (seen.has(productId)) throw inputError(`El producto ${product.siigo_code} esta repetido`);
    seen.add(productId);
    const distributions = [];
    for (const entry of itemDistributions(item)) {
      const location = await resolveLocation(
        db,
        entry.ubicacion || entry.codigo_ubicacion || entry.location_code
      );
      distributions.push({
        cantidad: entry.cantidad ?? entry.quantity,
        lote: entry.lote || entry.lpn || entry.lot_id || prepared.lote_documento || null,
        lote_fuente: entry.lote_fuente
          || (entry.lote || entry.lpn || entry.lot_id ? 'OPERARIO' : prepared.lote_documento ? 'DOCUMENTO' : null),
        lote_documento: prepared.lote_documento || null,
        fecha_venc: entry.fecha_venc || entry.fecha_vencimiento || entry.expiry_date
          || prepared.fecha_vencimiento_documento || null,
        fecha_venc_fuente: entry.fecha_venc_fuente
          || (entry.fecha_venc || entry.fecha_vencimiento || entry.expiry_date
            ? 'OPERARIO'
            : prepared.fecha_vencimiento_documento ? 'DOCUMENTO' : null),
        fecha_vencimiento_documento: prepared.fecha_vencimiento_documento || null,
        condicion: entry.condicion || entry.condition,
        motivo: entry.motivo || entry.reason || null,
        ubicacion_id: location?.id || null,
        ubicacion: location?.codigo || null,
      });
    }
    result.push({
      item_id: prepared.item_id,
      product_id: prepared.producto_id,
      sku: product.siigo_code,
      producto: product.nombre || prepared.producto,
      unidad: prepared.unidad || 'und',
      requiere_lote: Boolean(prepared.requiere_lote),
      cantidad_recibida: item.cantidad_recibida ?? item.cantidad_total ?? null,
      motivo: item.motivo_diferencia || item.motivo || null,
      distributions,
    });
  }

  const missing = preparedItems.filter(item => !seen.has(Number(item.producto_id)));
  if (missing.length) {
    throw inputError(`Falta confirmar: ${missing.map(item => item.sku).join(', ')}`);
  }
  return result;
}

function buildReceptionReview(order, reception, items) {
  const lines = items.flatMap(item => {
    const total = item.distributions.reduce(
      (sum, entry) => sum + Number(entry.cantidad || 0),
      0
    );
    const header = `- ${item.sku} - ${item.producto}: ${Number(total.toFixed(4))} ${item.unidad}`;
    const details = item.distributions.map(entry => {
      const parts = [
        `${Number(entry.cantidad)} ${item.unidad}`,
        String(entry.condicion || '').toUpperCase(),
        entry.ubicacion || 'sin ubicacion',
        entry.lote
          ? entry.lote_fuente === 'DOCUMENTO'
            ? `lote ${entry.lote} (propuesto por PDF; verifica la etiqueta fisica)`
            : entry.lote_documento && entry.lote !== entry.lote_documento
              ? `lote fisico ${entry.lote} (PDF: ${entry.lote_documento})`
              : `lote ${entry.lote}`
          : item.requiere_lote
            ? 'lote proveedor faltante'
            : 'sin lote proveedor; partida interna WMS',
        entry.fecha_venc
          ? entry.fecha_venc_fuente === 'DOCUMENTO'
            ? `vence ${entry.fecha_venc} (propuesto por PDF)`
            : `vence ${entry.fecha_venc}`
          : null,
        entry.motivo ? `motivo ${entry.motivo}` : null,
      ].filter(Boolean);
      return `  ${parts.join(' | ')}`;
    });
    return [header, ...details];
  });
  const usesDocumentSuggestion = items.some(item => item.distributions.some(
    entry => entry.lote_fuente === 'DOCUMENTO' || entry.fecha_venc_fuente === 'DOCUMENTO'
  ));
  return [
    `Resumen de recepcion para OC ${order.numero} (ID ${order.id}).`,
    `Borrador interno: ${reception.numero}`,
    ...lines,
    'No se modifico inventario.',
    usesDocumentSuggestion
      ? 'Verifica que lote y vencimiento propuestos por el PDF coincidan con la etiqueta fisica. Al confirmar declaras que los cotejaste.'
      : null,
    `Si todo coincide, escribe: Confirmo la recepcion ID ${order.id}`,
  ].filter(Boolean).join('\n');
}

function receptionDraftPayload(order, reception, items) {
  return {
    version: 1,
    orderId: Number(order.id),
    receptionId: Number(reception.id),
    items,
  };
}

function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(
      key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseReceptionDraft(row, { orderId, receptionId, userId }) {
  if (!row) return null;
  if (Number(row.usuario_id) !== Number(userId)) {
    throw inputError('La vista previa fue creada por otro usuario; vuelve a registrar los datos fisicos', 409);
  }
  let payload;
  try {
    payload = typeof row.payload_json === 'string'
      ? JSON.parse(row.payload_json)
      : row.payload_json;
  } catch {
    throw inputError('El borrador fisico de recepcion no es valido; vuelve a registrar los datos', 409);
  }
  const canonical = canonicalJson(payload);
  const hash = createHash('sha256').update(canonical).digest('hex');
  if (hash !== row.payload_hash
      || payload?.version !== 1
      || Number(payload.orderId) !== Number(orderId)
      || Number(payload.receptionId) !== Number(receptionId)
      || !Array.isArray(payload.items)
      || !payload.items.length) {
    throw inputError('El borrador fisico de recepcion no es valido; vuelve a registrar los datos', 409);
  }
  return payload;
}

async function saveReceptionDraft(db, { order, reception, items, userId }) {
  const payload = receptionDraftPayload(order, reception, items);
  const payloadJson = canonicalJson(payload);
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
  const [active] = await db.execute(
    `SELECT usuario_id
       FROM recepcion_confirmacion_borradores
      WHERE recepcion_id = ? AND estado = 'PENDIENTE' AND expira_en > NOW()
      LIMIT 1`,
    [reception.id]
  );
  if (active.length && Number(active[0].usuario_id) !== Number(userId)) {
    throw inputError('La vista previa vigente pertenece a otro usuario', 409);
  }
  await db.execute(
    `INSERT INTO recepcion_confirmacion_borradores
       (recepcion_id, orden_compra_id, usuario_id, payload_json, payload_hash,
        estado, expira_en, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       orden_compra_id = VALUES(orden_compra_id),
       usuario_id = VALUES(usuario_id),
       payload_json = VALUES(payload_json),
       payload_hash = VALUES(payload_hash),
       estado = 'PENDIENTE',
       expira_en = VALUES(expira_en),
       consumido_en = NULL,
       actualizado_en = NOW()`,
    [reception.id, order.id, userId, payloadJson, payloadHash]
  );
  return payload;
}

async function loadReceptionDraft(db, { orderId, receptionId, userId }) {
  const [rows] = await db.execute(
    `SELECT usuario_id, payload_json, payload_hash
       FROM recepcion_confirmacion_borradores
      WHERE recepcion_id = ? AND orden_compra_id = ?
        AND estado = 'PENDIENTE' AND expira_en > NOW()
      LIMIT 1`,
    [receptionId, orderId]
  );
  return parseReceptionDraft(rows[0], { orderId, receptionId, userId });
}

async function consumeReceptionDraft(db, receptionId, userId) {
  await db.execute(
    `UPDATE recepcion_confirmacion_borradores
        SET estado = 'CONSUMIDO', consumido_en = NOW(), actualizado_en = NOW()
      WHERE recepcion_id = ? AND usuario_id = ? AND estado = 'PENDIENTE'`,
    [receptionId, userId]
  );
}

async function confirmReceptionFromWhatsApp({ db, params, rawText, user }) {
  const order = await findPurchaseOrder(db, params);
  const requestedReception = await findPreparedReception(db, order.id, params, {
    allowCompleted: order.estado === 'CERRADA',
  });
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
  const isExplicitConfirmation = explicitConfirmation(rawText, order, params);
  let items;
  if (!isExplicitConfirmation) {
    items = await buildConfirmationItems(db, prepared.reception.items, params);
    await saveReceptionDraft(db, {
      order,
      reception: prepared.reception,
      items,
      userId: user.id,
    });
    return {
      requires_confirmation: true,
      inventory_changed: false,
      recepcion_id: prepared.reception.id,
      numero: prepared.reception.numero,
      orden_compra_id: order.id,
      orden_compra_numero: order.numero,
      item_count: items.length,
      message: buildReceptionReview(order, prepared.reception, items),
    };
  }
  const draft = await loadReceptionDraft(db, {
    orderId: order.id,
    receptionId: prepared.reception.id,
    userId: user.id,
  });
  if (!draft) {
    throw inputError('No hay una vista previa vigente. Registra primero los datos fisicos de la recepcion', 409);
  }
  items = await buildConfirmationItems(db, prepared.reception.items, { items: draft.items });
  const effectiveParams = { ...params, items };
  const confirmationKey = receptionConfirmationKey(
    order.id,
    requestedReception.id,
    effectiveParams
  );
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
  await consumeReceptionDraft(db, prepared.reception.id, user.id);
  return { ...result, orden_compra_numero: prepared.order.numero };
}

module.exports = {
  listAvailablePurchaseOrderReceptions,
  listAvailableOutsourcingReceptions,
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
  buildReceptionReview,
  canonicalJson,
  receptionDraftPayload,
  parseReceptionDraft,
  saveReceptionDraft,
  loadReceptionDraft,
  confirmReceptionFromWhatsApp,
};
