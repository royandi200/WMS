const { createHash } = require('crypto');
const { resolveProductReference } = require('./product-references');
const { singleTypedReceptionReference } = require('./typed-reception-reference');
const {
  assertPurchaseOrderTextReference,
  buildConfirmationItems,
  buildReceptionReview,
  canonicalJson,
  findPurchaseOrder,
  prepareReceptionFromPurchaseOrder,
  purchaseOrderReceptionIdentifier,
  saveReceptionDraft,
} = require('./builderbot-reception');

function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function digest(payload) {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function parseDraft(row, orderId, receptionId, userId) {
  if (!row) return null;
  if (Number(row.usuario_id) !== Number(userId)) {
    throw inputError('El borrador de recepción pertenece a otro usuario', 409);
  }
  let payload;
  try {
    payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
  } catch {
    throw inputError('El borrador de recepción no es válido; vuelve a prepararla', 409);
  }
  if (digest(payload) !== row.payload_hash
    || Number(payload?.orderId) !== Number(orderId)
    || Number(payload?.receptionId) !== Number(receptionId)
    || ![1, 2].includes(payload?.version)) {
    throw inputError('El borrador de recepción no es válido; vuelve a prepararla', 409);
  }
  if (payload.version === 2 && (!payload.entries || Array.isArray(payload.entries)
    || typeof payload.entries !== 'object')) {
    throw inputError('El avance de recepción no es válido; vuelve a prepararla', 409);
  }
  if (payload.version === 1 && (!Array.isArray(payload.items) || !payload.items.length)) {
    throw inputError('La vista previa de recepción no es válida; vuelve a registrarla', 409);
  }
  return payload;
}

function typedOrderId(text) {
  const reference = singleTypedReceptionReference(text);
  if (reference?.kind === 'MQ') {
    throw inputError('MQ ID corresponde a la recepción de maquila, no a una OC directa', 409);
  }
  return reference?.id || null;
}

async function activeUserSession(db, userId, { allowPreview = false } = {}) {
  const [rows] = await db.execute(
    `SELECT d.recepcion_id, d.orden_compra_id, d.usuario_id, d.payload_json, d.payload_hash
       FROM recepcion_confirmacion_borradores d
       JOIN recepciones r ON r.id = d.recepcion_id
      WHERE d.usuario_id = ? AND d.estado = 'PENDIENTE' AND d.expira_en > NOW()
        AND r.estado IN ('borrador', 'en_proceso')
      ORDER BY d.actualizado_en DESC LIMIT 21`,
    [userId]
  );
  const sessions = rows.filter(row => {
    const payload = parseDraft(row, row.orden_compra_id, row.recepcion_id, userId);
    return payload.version === 2 || allowPreview && payload.version === 1;
  });
  if (sessions.length > 1) {
    throw inputError('Hay varias recepciones guiadas abiertas. Indica OC ID N o IO ID N', 409);
  }
  return sessions[0] || null;
}

async function recentlyPreparedSession(db, from) {
  if (!from) return null;
  const [rows] = await db.execute(
    `SELECT action, response
       FROM webhook_logs
      WHERE from_phone = ? AND status = 'PROCESSED'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
      ORDER BY id DESC LIMIT 5`,
    [from]
  );
  for (const row of rows) {
    let response;
    try {
      response = typeof row.response === 'string' ? JSON.parse(row.response) : row.response;
    } catch {
      return null;
    }
    if (response?.duplicate === true) continue;
    if (row.action !== 'PREPARAR_RECEPCION_OC') return null;
    const context = response?.context?.reception;
    const receptionId = Number(context?.reception_id);
    const orderId = Number(context?.purchase_order_id);
    if (!Number.isSafeInteger(receptionId) || receptionId <= 0
      || !Number.isSafeInteger(orderId) || orderId <= 0
      || context?.already_completed || context?.inventory_changed !== false) return null;
    const [active] = await db.execute(
      `SELECT id AS recepcion_id, orden_compra_id
         FROM recepciones
        WHERE id = ? AND orden_compra_id = ?
          AND estado IN ('borrador', 'en_proceso')
        LIMIT 1`,
      [receptionId, orderId]
    );
    return active[0] || null;
  }
  return null;
}

function fromCompletedPreview(payload) {
  const entries = {};
  for (const item of payload.items || []) {
    if (!Array.isArray(item.distributions) || item.distributions.length !== 1) {
      throw inputError('Esta vista previa tiene divisiones; corrígela con un reporte completo', 409);
    }
    const row = item.distributions[0];
    entries[item.sku] = {
      sku: item.sku,
      cantidad: Number(row.cantidad),
      condicion: row.condicion,
      ubicacion: row.ubicacion,
      lote: row.lote,
      fecha_vencimiento: row.fecha_venc,
      motivo: row.motivo || null,
      motivo_diferencia: item.motivo || null,
      referencia_interpretada: item.referencia_interpretada || null,
    };
  }
  return { version: 2, orderId: payload.orderId, receptionId: payload.receptionId,
    selectedSku: null, entries };
}

function cleanAdvance(params = {}) {
  const advance = params.avance || {};
  if (!advance || typeof advance !== 'object' || Array.isArray(advance)) {
    throw inputError('El avance de recepción debe ser un objeto');
  }
  const allowed = new Set(['producto', 'sku', 'cantidad', 'condicion', 'ubicacion',
    'lote', 'fecha_vencimiento', 'motivo', 'motivo_diferencia']);
  if (Object.keys(advance).some(key => !allowed.has(key))) {
    throw inputError('El avance de recepción contiene campos no válidos');
  }
  return advance;
}

function applyFields(entry, advance) {
  if (Object.hasOwn(advance, 'cantidad')) {
    const quantity = Number(String(advance.cantidad).replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) {
      throw inputError('Indica una cantidad positiva');
    }
    entry.cantidad = quantity;
  }
  const stringFields = ['condicion', 'ubicacion', 'lote', 'fecha_vencimiento',
    'motivo', 'motivo_diferencia'];
  for (const key of stringFields) {
    if (!Object.hasOwn(advance, key)) continue;
    const value = String(advance[key] ?? '').trim();
    if (value.length > (key.startsWith('motivo') ? 2000 : 255)) {
      throw inputError(`${key} supera el límite permitido`);
    }
    entry[key] = value || null;
  }
  if (entry.condicion) {
    entry.condicion = entry.condicion.toUpperCase();
    if (!['DISPONIBLE', 'CUARENTENA', 'RECHAZADO', 'PENDIENTE_DISPOSICION'].includes(entry.condicion)) {
      throw inputError('La condición debe ser disponible, cuarentena, rechazado o pendiente de disposición');
    }
  }
  if (entry.ubicacion) entry.ubicacion = entry.ubicacion.toUpperCase();
}

function missingFields(entry, prepared) {
  const missing = [];
  if (!entry.cantidad) missing.push('cantidad');
  if (!entry.condicion) missing.push('condición');
  if (!entry.ubicacion) missing.push('ubicación');
  if (!entry.lote && !prepared.lote_documento) missing.push('lote de la etiqueta');
  if (!entry.fecha_vencimiento && !prepared.fecha_vencimiento_documento) {
    missing.push('vencimiento de la etiqueta');
  }
  if (entry.condicion && entry.condicion !== 'DISPONIBLE' && !entry.motivo) {
    missing.push('motivo de la condición');
  }
  const expected = Number(prepared.cantidad_pendiente ?? prepared.cantidad_esp);
  if (entry.cantidad && Number.isFinite(expected)
    && Math.abs(entry.cantidad - expected) > 0.0001 && !entry.motivo_diferencia) {
    missing.push('motivo de la diferencia frente a la OC');
  }
  return missing;
}

function itemFromEntry(entry, prepared) {
  return {
    sku: entry.sku,
    cantidad_recibida: entry.cantidad,
    motivo_diferencia: entry.motivo_diferencia || null,
    distribuciones: [{
      cantidad: entry.cantidad,
      condicion: entry.condicion,
      ubicacion: entry.ubicacion,
      lote: entry.lote || prepared.lote_documento,
      fecha_vencimiento: entry.fecha_vencimiento || prepared.fecha_vencimiento_documento,
      motivo: entry.motivo || null,
    }],
  };
}

function availableChoices(preparedItems, entries) {
  return preparedItems.filter(item => !entries[item.sku]
    || missingFields(entries[item.sku], item).length).map(item =>
    `- ${item.sku} - ${item.producto}: ${Number(item.cantidad_pendiente)} ${item.unidad || 'und'}`
  );
}

async function saveGuidedDraft(db, order, reception, userId, payload) {
  const payloadJson = canonicalJson(payload);
  await db.execute(
    `INSERT INTO recepcion_confirmacion_borradores
       (recepcion_id, orden_compra_id, usuario_id, payload_json, payload_hash,
        estado, expira_en, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       orden_compra_id = VALUES(orden_compra_id), usuario_id = VALUES(usuario_id),
       payload_json = VALUES(payload_json), payload_hash = VALUES(payload_hash),
       estado = 'PENDIENTE', expira_en = VALUES(expira_en),
       consumido_en = NULL, actualizado_en = NOW()`,
    [reception.id, order.id, userId, payloadJson, digest(payload)]
  );
}

async function advanceGuidedReception({ db, params = {}, rawText, user, from }) {
  if (params.confirmacion_final === true || params.confirmacion_final === 'true') {
    throw inputError('Los avances no confirman inventario; revisa primero el resumen');
  }
  const advance = cleanAdvance(params);
  const explicitId = typedOrderId(rawText);
  let order;
  if (explicitId) {
    order = await findPurchaseOrder(db, { orden_compra_id: explicitId });
    assertPurchaseOrderTextReference(rawText, order);
  } else if (params.numero_oc && String(rawText || '').toUpperCase().includes(String(params.numero_oc).toUpperCase())) {
    order = await findPurchaseOrder(db, { numero_oc: params.numero_oc });
    assertPurchaseOrderTextReference(rawText, order);
  } else {
    const recent = await recentlyPreparedSession(db, from);
    const session = recent || await activeUserSession(db, user.id, {
      allowPreview: params.correccion === true,
    });
    if (!session) {
      throw inputError('Para empezar, indica OC ID N o IO ID N de la recepción preparada', 409);
    }
    order = await findPurchaseOrder(db, { orden_compra_id: session.orden_compra_id });
  }
  const prepared = await prepareReceptionFromPurchaseOrder({
    db, params: { orden_compra_id: order.id }, userId: user.id,
  });
  if (prepared.alreadyCompleted) {
    return { message: `${purchaseOrderReceptionIdentifier(order)} ya fue recibida. No se modificó inventario.`,
      inventory_changed: false, already_completed: true };
  }
  const reception = prepared.reception;
  const preparedItems = reception.items;
  await db.beginTransaction();
  try {
    await db.execute('SELECT id FROM recepciones WHERE id = ? FOR UPDATE', [reception.id]);
    const [rows] = await db.execute(
      `SELECT usuario_id, payload_json, payload_hash
         FROM recepcion_confirmacion_borradores
        WHERE recepcion_id = ? AND estado = 'PENDIENTE' AND expira_en > NOW()
        LIMIT 1 FOR UPDATE`,
      [reception.id]
    );
    const existing = parseDraft(rows[0], order.id, reception.id, user.id);
    if (existing?.version === 1 && params.correccion !== true) {
      await db.commit();
      return { message: buildReceptionReview(order, reception, existing.items),
        inventory_changed: false, requires_confirmation: true };
    }
    const payload = existing?.version === 1
      ? fromCompletedPreview(existing)
      : existing || { version: 2, orderId: Number(order.id), receptionId: Number(reception.id),
        selectedSku: null, entries: {} };
    const reference = String(advance.producto || advance.sku || '').trim();
    if (reference) {
      const product = await resolveProductReference(db, reference, {
        productIds: preparedItems.map(item => item.producto_id),
        allowContextualPartial: true,
        allowScopedApproximate: true,
      });
      payload.selectedSku = product.siigo_code;
      if (!payload.entries[product.siigo_code]) payload.entries[product.siigo_code] = { sku: product.siigo_code };
      if (product.matched_by === 'scoped_approximate') {
        payload.entries[product.siigo_code].referencia_interpretada = reference;
      }
    }
    const selected = preparedItems.find(item => item.sku === payload.selectedSku);
    if (!selected && Object.keys(advance).some(key => !['producto', 'sku'].includes(key))) {
      throw inputError('Indica primero cuál SKU de esta recepción vas a registrar', 409);
    }
    if (selected) applyFields(payload.entries[selected.sku], advance);
    const entry = selected ? payload.entries[selected.sku] : null;
    const missing = selected ? missingFields(entry, selected) : [];
    if (selected && !missing.length) {
      await buildConfirmationItems(db, [selected], { items: [itemFromEntry(entry, selected)] },
        { warehouseId: reception.bodega_id });
      payload.selectedSku = null;
    }
    const pending = preparedItems.filter(item => {
      const saved = payload.entries[item.sku];
      return !saved || missingFields(saved, item).length;
    });
    if (!pending.length) {
      const items = await buildConfirmationItems(db, preparedItems, {
        items: preparedItems.map(item => itemFromEntry(payload.entries[item.sku], item)),
      }, { warehouseId: reception.bodega_id });
      for (const item of items) {
        const saved = payload.entries[item.sku];
        if (saved.referencia_interpretada) item.referencia_interpretada = saved.referencia_interpretada;
        if (!saved.lote && preparedItems.find(row => row.sku === item.sku)?.lote_documento) {
          item.distributions[0].lote_fuente = 'DOCUMENTO';
        }
        if (!saved.fecha_vencimiento && preparedItems.find(row => row.sku === item.sku)?.fecha_vencimiento_documento) {
          item.distributions[0].fecha_venc_fuente = 'DOCUMENTO';
        }
      }
      await saveReceptionDraft(db, { order, reception, items, userId: user.id });
      await db.commit();
      return { message: buildReceptionReview(order, reception, items),
        inventory_changed: false, requires_confirmation: true, item_count: items.length };
    }
    await saveGuidedDraft(db, order, reception, user.id, payload);
    await db.commit();
    const identifier = purchaseOrderReceptionIdentifier(order);
    if (selected && missing.length) {
      const hints = [
        !entry.lote && selected.lote_documento ? `Lote propuesto por PDF: ${selected.lote_documento}` : null,
        !entry.fecha_vencimiento && selected.fecha_vencimiento_documento
          ? `Vencimiento propuesto por PDF: ${selected.fecha_vencimiento_documento}` : null,
      ].filter(Boolean);
      return { message: [
        `🧾 Recepción guiada ${identifier} | ${reception.numero}`,
        `Producto: ${selected.sku} - ${selected.producto}`,
        entry.referencia_interpretada
          ? `Interpreté «${entry.referencia_interpretada}» como ${selected.sku}; verifica que sea correcto.` : null,
        `Falta: ${missing.join(', ')}.`,
        ...hints,
        'Puedes responder todo junto o dato por dato. Los datos del PDF deben cotejarse con la etiqueta física.',
        'Aún no se modificó inventario.',
      ].filter(Boolean).join('\n'), inventory_changed: false };
    }
    return { message: [
      `🧾 Recepción guiada ${identifier} | ${reception.numero}`,
      selected ? `${selected.sku} quedó registrado en el borrador. No se modificó inventario.` : 'Elige el primer SKU para registrar.',
      'Productos pendientes:',
      ...availableChoices(preparedItems, payload.entries),
      'Puedes decir el SKU o un nombre inequívoco. Si un nombre puede referirse a varios productos, te pediré precisarlo.',
    ].join('\n'), inventory_changed: false };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}

module.exports = { advanceGuidedReception, parseDraft, missingFields, itemFromEntry };
