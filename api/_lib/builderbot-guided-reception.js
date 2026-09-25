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

function skuReviewReply(rawText) {
  const text = String(rawText || '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '').toUpperCase()
    .replace(/[.!?]+$/u, '').replace(/[,;]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (/^(?:SI(?: ESTA BIEN| TODO ESTA BIEN| CORRECTO| ASI ES)?|CORRECTO|EXACTO|ASI ES|ESTA BIEN|TODO BIEN|TODO ESTA BIEN|ESTA CORRECTO)$/u.test(text)) return 'YES';
  if (/^(?:NO|INCORRECTO|NO ESTA BIEN|NO ES CORRECTO|ESTA MAL)$/u.test(text)) return 'NO';
  return null;
}

function documentMismatch(rawText) {
  const text = String(rawText || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
  const differs = /(?:no coincide|no corresponde|es diferente|es distinto|esta mal|es incorrect[oa])/u;
  return {
    lote: /\blote\b/u.test(text) && differs.test(text),
    fecha_vencimiento: /\b(?:vencimiento|vence|fecha(?: de vencimiento)?|caducidad)\b/u.test(text)
      && differs.test(text),
  };
}

function isReceptionCorrectionRequest(rawText) {
  const text = String(rawText || '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  return /^(?:correccion|corrige|corrijo|cambia|modifica|quiero corregir|quiero cambiar|quisiera cambiar|necesito corregir)\b/u.test(text)
    && !/\b(?:op\s*id|orden de produccion|despacho)\b/u.test(text);
}

function correctionFieldsFromText(rawText) {
  if (!isReceptionCorrectionRequest(rawText)) return {};
  const text = String(rawText).trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/^(?:correccion|corrige|corrijo|cambia|modifica|quiero corregir|quiero cambiar|quisiera cambiar|necesito corregir)\b\s*[,;:-]?\s*/iu, '')
    .replace(/[.!?]+$/u, '').trim();
  const patterns = [
    ['ubicacion', /^(?:la\s+)?ubicacion\s+(?:de|del)\s+(.+?)\s+(?:(?:a|en|es|fue)\s+)?([a-z]+\d[a-z0-9-]*)$/iu],
    ['cantidad', /^(?:la\s+)?cantidad\s+(?:de|del)\s+(.+?)\s+(?:(?:a|es|fue)\s+)?(\d+(?:[.,]\d+)?)\s*(?:und|unidades?|gramos?|g)?$/iu],
    ['lote', /^(?:el\s+)?lote\s+(?:de|del)\s+(.+?)\s+(?:(?:a|es|fue)\s+)?([a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*)$/iu],
    ['fecha_vencimiento', /^(?:el\s+)?(?:vencimiento|fecha de vencimiento)\s+(?:de|del)\s+(.+?)\s+(?:(?:a|es|fue)\s+)?(\d{4}-\d{2}-\d{2})$/iu],
    ['condicion', /^(?:la\s+)?condicion\s+(?:de|del)\s+(.+?)\s+(?:(?:a|es|fue)\s+)?(disponible|cuarentena|rechazado|pendiente de disposicion)$/iu],
  ];
  for (const [field, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) return { producto: match[1].trim(), [field]: match[2].trim() };
  }
  const withoutProduct = [
    ['ubicacion', /^(?:la\s+)?ubicacion\s+(?:a|en|es|fue)?\s*([a-z]+\d[a-z0-9-]*)$/iu],
    ['cantidad', /^(?:la\s+)?cantidad\s+(?:a|es|fue)?\s*(\d+(?:[.,]\d+)?)\s*(?:und|unidades?|gramos?|g)?$/iu],
    ['lote', /^(?:el\s+)?lote\s+(?:a|es|fue)?\s*([a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*)$/iu],
    ['fecha_vencimiento', /^(?:el\s+)?(?:vencimiento|fecha de vencimiento)\s+(?:a|es|fue)?\s*(\d{4}-\d{2}-\d{2})$/iu],
    ['condicion', /^(?:la\s+)?condicion\s+(?:a|es|fue)?\s*(disponible|cuarentena|rechazado|pendiente de disposicion)$/iu],
  ];
  for (const [field, pattern] of withoutProduct) {
    const match = text.match(pattern);
    if (match) return { [field]: match[1].trim() };
  }
  return {};
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

async function hasPendingSkuReview(db, userId) {
  const session = await activeUserSession(db, userId);
  if (!session) return false;
  const payload = parseDraft(session, session.orden_compra_id, session.recepcion_id, userId);
  return payload.version === 2 && (Boolean(payload.reviewSku)
    || Object.values(payload.entries).some(entry => entry && !entry.verified
      && entry.cantidad && entry.condicion && entry.ubicacion));
}

async function hasSelectedGuidedSku(db, userId) {
  const session = await activeUserSession(db, userId);
  if (!session) return false;
  const payload = parseDraft(session, session.orden_compra_id, session.recepcion_id, userId);
  return payload.version === 2 && Boolean(payload.reviewSku || payload.selectedSku);
}

async function hasActiveReceptionSession(db, userId) {
  return Boolean(await activeUserSession(db, userId, { allowPreview: true }));
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
      verified: true,
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
  if (Object.hasOwn(advance, 'lote') && entry.lote) entry.lote_discrepa_pdf = false;
  if (Object.hasOwn(advance, 'fecha_vencimiento') && entry.fecha_vencimiento) {
    entry.vencimiento_discrepa_pdf = false;
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
  if (!entry.lote && (entry.lote_discrepa_pdf || !prepared.lote_documento)) {
    missing.push(entry.lote_discrepa_pdf ? 'lote físico correcto' : 'lote de la etiqueta');
  }
  if (!entry.fecha_vencimiento
    && (entry.vencimiento_discrepa_pdf || !prepared.fecha_vencimiento_documento)) {
    missing.push(entry.vencimiento_discrepa_pdf
      ? 'vencimiento físico correcto' : 'vencimiento de la etiqueta');
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
    || !entries[item.sku].verified || missingFields(entries[item.sku], item).length).map(item =>
    `- ${item.sku} - ${item.producto}: ${Number(item.cantidad_pendiente)} ${item.unidad || 'und'}`
  );
}

function receivedQuantityPrompt(unit) {
  const normalized = String(unit || 'und').trim().toLowerCase();
  if (['g', 'gr', 'gramo', 'gramos'].includes(normalized)) {
    return 'Indica cuántos gramos recibiste (g).';
  }
  if (['und', 'unidad', 'unidades'].includes(normalized)) {
    return 'Indica cuántas unidades recibiste (und).';
  }
  return `Indica cuánto recibiste en ${unit}.`;
}

function skuReviewMessage(order, reception, prepared, entry) {
  const loteFromPdf = !entry.lote && Boolean(prepared.lote_documento);
  const expiryFromPdf = !entry.fecha_vencimiento && Boolean(prepared.fecha_vencimiento_documento);
  return [
    `🧾 Revisa ${purchaseOrderReceptionIdentifier(order)} | ${reception.numero}`,
    `Producto: ${prepared.sku} - ${prepared.producto}`,
    entry.referencia_interpretada
      ? `Interpreté «${entry.referencia_interpretada}» como ${prepared.sku}; verifica que sea correcto.` : null,
    `Cantidad recibida: ${entry.cantidad} ${prepared.unidad || 'und'} (pendiente según OC: ${Number(prepared.cantidad_pendiente)} ${prepared.unidad || 'und'}).`,
    `Condición: ${entry.condicion}.`,
    `Ubicación registrada: ${entry.ubicacion}.`,
    prepared.ubicacion_sugerida
      ? `Ubicación sugerida: ${prepared.ubicacion_sugerida} (verifica físicamente).` : null,
    `Lote: ${entry.lote || prepared.lote_documento}${loteFromPdf ? ' (propuesto por PDF; coteja con la etiqueta)' : ''}.`,
    `Vencimiento: ${entry.fecha_vencimiento || prepared.fecha_vencimiento_documento}${expiryFromPdf ? ' (propuesto por PDF; coteja con la etiqueta)' : ''}.`,
    entry.motivo ? `Motivo de condición: ${entry.motivo}.` : null,
    entry.motivo_diferencia ? `Motivo de diferencia: ${entry.motivo_diferencia}.` : null,
    '¿Está correcto este SKU? Responde «sí» para continuar o dime qué dato debo corregir. Puedes cambiar el lote o el vencimiento si no coinciden con la etiqueta.',
    'Este paso no confirma la recepción ni modifica inventario.',
  ].filter(Boolean).join('\n');
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
  const correctionRequested = params.correccion === true || isReceptionCorrectionRequest(rawText);
  const advance = { ...cleanAdvance(params), ...correctionFieldsFromText(rawText) };
  const explicitId = typedOrderId(rawText);
  let order;
  if (explicitId) {
    order = await findPurchaseOrder(db, { orden_compra_id: explicitId });
    assertPurchaseOrderTextReference(rawText, order);
  } else if (params.numero_oc && String(rawText || '').toUpperCase().includes(String(params.numero_oc).toUpperCase())) {
    order = await findPurchaseOrder(db, { numero_oc: params.numero_oc });
    assertPurchaseOrderTextReference(rawText, order);
  } else {
    // An explicit correction belongs to the operator's active draft, even if
    // another OC was prepared recently in the same chat.
    const session = correctionRequested
      ? await activeUserSession(db, user.id, { allowPreview: true })
        || await recentlyPreparedSession(db, from)
      : await recentlyPreparedSession(db, from)
        || await activeUserSession(db, user.id);
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
    if (existing?.version === 1 && !correctionRequested) {
      await db.commit();
      return { message: buildReceptionReview(order, reception, existing.items),
        inventory_changed: false, requires_confirmation: true };
    }
    const payload = existing?.version === 1
      ? fromCompletedPreview(existing)
      : existing || { version: 2, orderId: Number(order.id), receptionId: Number(reception.id),
        selectedSku: null, entries: {} };
    if (existing?.version === 1 && correctionRequested) payload.editingSummary = true;
    if (payload.editingSummary && preparedItems.length === 1
      && !payload.selectedSku && !payload.reviewSku) {
      payload.selectedSku = preparedItems[0].sku;
    }
    if (payload.editingSummary && !payload.selectedSku && !payload.reviewSku
      && !String(advance.producto || advance.sku || '').trim()) {
      await saveGuidedDraft(db, order, reception, user.id, payload);
      await db.commit();
      return { message: [
        `🧾 Corrección del resumen ${purchaseOrderReceptionIdentifier(order)} | ${reception.numero}`,
        'Indica qué SKU o producto quieres corregir y el dato nuevo (cantidad, condición, ubicación, lote o vencimiento).',
        'Productos de esta recepción:',
        ...preparedItems.map(item => `- ${item.sku} - ${item.producto}`),
        'El inventario no se modifica hasta que revises de nuevo el resumen y confirmes la recepción.',
      ].join('\n'), inventory_changed: false };
    }
    if (!payload.reviewSku) {
      // Borradores creados antes de esta revisión pueden tener un SKU completo
      // sin validar. Muéstralo antes de aceptar cualquier siguiente producto.
      const unreviewed = preparedItems.find(item => payload.entries[item.sku]
        && !payload.entries[item.sku].verified
        && !missingFields(payload.entries[item.sku], item).length);
      if (unreviewed) {
        payload.reviewSku = unreviewed.sku;
        payload.selectedSku = unreviewed.sku;
        await saveGuidedDraft(db, order, reception, user.id, payload);
        await db.commit();
        return { message: skuReviewMessage(order, reception, unreviewed,
          payload.entries[unreviewed.sku]), inventory_changed: false, sku_review: true };
      }
    }

    const reviewSku = payload.reviewSku;
    const reviewItem = preparedItems.find(item => item.sku === reviewSku);
    if (reviewSku && !reviewItem) throw inputError('El SKU en revisión ya no pertenece a esta recepción', 409);
    const reviewReply = skuReviewReply(rawText);
    const mismatches = documentMismatch(rawText);
    const hasFields = Object.keys(advance).some(key => !['producto', 'sku'].includes(key))
      || mismatches.lote || mismatches.fecha_vencimiento;
    const reference = String(advance.producto || advance.sku || '').trim();
    let confirmedSku = null;
    if (reviewItem && reviewReply === 'YES') {
      if (missingFields(payload.entries[reviewSku], reviewItem).length) {
        throw inputError('Faltan datos del SKU antes de validarlo', 409);
      }
      payload.entries[reviewSku].verified = true;
      payload.reviewSku = null;
      payload.selectedSku = null;
      confirmedSku = reviewSku;
    } else if (reviewItem && !hasFields) {
      if (reference) {
        const requested = await resolveProductReference(db, reference, {
          productIds: preparedItems.map(item => item.producto_id),
          allowContextualPartial: true,
          allowScopedApproximate: true,
        });
        if (requested.siigo_code !== reviewSku) {
          await db.commit();
          return { message: `Antes de pasar a otro producto, revisa ${reviewSku}.\n${skuReviewMessage(order, reception, reviewItem, payload.entries[reviewSku])}`,
            inventory_changed: false, sku_review: true };
        }
      }
      await db.commit();
      return { message: reviewReply === 'NO'
        ? `Indica qué dato de ${reviewSku} debo corregir; puedes dictar los datos corregidos juntos o por separado.\n${skuReviewMessage(order, reception, reviewItem, payload.entries[reviewSku])}`
        : skuReviewMessage(order, reception, reviewItem, payload.entries[reviewSku]),
      inventory_changed: false, sku_review: true };
    }

    if (!confirmedSku && reference) {
      const product = await resolveProductReference(db, reference, {
        productIds: preparedItems.map(item => item.producto_id),
        allowContextualPartial: true,
        allowScopedApproximate: true,
      });
      if (reviewSku && product.siigo_code !== reviewSku) {
        throw inputError(`Antes de pasar a otro producto, revisa ${reviewSku} y responde si está correcto o corrige sus datos`, 409);
      }
      payload.selectedSku = product.siigo_code;
      if (!payload.entries[product.siigo_code]) payload.entries[product.siigo_code] = { sku: product.siigo_code };
      if (product.matched_by === 'scoped_approximate') {
        payload.entries[product.siigo_code].referencia_interpretada = reference;
      }
    }
    if (reviewSku && !confirmedSku) payload.selectedSku = reviewSku;
    const selected = preparedItems.find(item => item.sku === payload.selectedSku);
    if (!selected && Object.keys(advance).some(key => !['producto', 'sku'].includes(key))) {
      throw inputError('Indica primero cuál SKU de esta recepción vas a registrar', 409);
    }
    if (selected && hasFields) {
      const safeAdvance = { ...advance };
      for (const key of ['lote', 'fecha_vencimiento']) {
        if (mismatches[key] && safeAdvance[key]
          && (/^(?:no coincide|no corresponde|diferente|distinto|incorrect[oa])$/iu
            .test(String(safeAdvance[key]).trim())
            || documentMismatch(String(safeAdvance[key]))[key])) delete safeAdvance[key];
      }
      if (mismatches.lote || mismatches.fecha_vencimiento) {
        if (safeAdvance.motivo && /(?:lote|vencimiento|caducidad|fecha)/iu.test(safeAdvance.motivo)
          && /(?:no coincide|no corresponde|diferente|distinto|incorrect[oa])/iu
            .test(safeAdvance.motivo)) delete safeAdvance.motivo;
      }
      applyFields(payload.entries[selected.sku], safeAdvance);
      const updated = payload.entries[selected.sku];
      if (mismatches.lote && !updated.lote) updated.lote_discrepa_pdf = true;
      if (mismatches.fecha_vencimiento && !updated.fecha_vencimiento) {
        updated.vencimiento_discrepa_pdf = true;
      }
      if (mismatches.lote && !Object.hasOwn(safeAdvance, 'lote')) {
        updated.lote = null;
        updated.lote_discrepa_pdf = true;
      }
      if (mismatches.fecha_vencimiento && !Object.hasOwn(safeAdvance, 'fecha_vencimiento')) {
        updated.fecha_vencimiento = null;
        updated.vencimiento_discrepa_pdf = true;
      }
      if (Object.hasOwn(advance, 'cantidad') && !Object.hasOwn(advance, 'motivo_diferencia')
        && Math.abs(Number(updated.cantidad) - Number(selected.cantidad_pendiente)) < 0.0001) {
        updated.motivo_diferencia = null;
      }
      if (Object.hasOwn(advance, 'condicion') && !Object.hasOwn(safeAdvance, 'motivo')
        && updated.condicion === 'DISPONIBLE') updated.motivo = null;
      if (updated.condicion === 'DISPONIBLE') updated.motivo = null;
      payload.entries[selected.sku].verified = false;
      payload.reviewSku = null;
    } else if (selected && (correctionRequested || payload.editingSummary)) {
      payload.entries[selected.sku].verified = false;
    }
    const entry = selected ? payload.entries[selected.sku] : null;
    const missing = selected ? missingFields(entry, selected) : [];
    if (selected && !missing.length) {
      await buildConfirmationItems(db, [selected], { items: [itemFromEntry(entry, selected)] },
        { warehouseId: reception.bodega_id });
      if (!entry.verified) {
        payload.reviewSku = selected.sku;
        await saveGuidedDraft(db, order, reception, user.id, payload);
        await db.commit();
        return { message: skuReviewMessage(order, reception, selected, entry),
          inventory_changed: false, sku_review: true };
      }
      payload.selectedSku = null;
    }
    const pending = preparedItems.filter(item => {
      const saved = payload.entries[item.sku];
      return !saved || !saved.verified || missingFields(saved, item).length;
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
      return { message: [
        `🧾 Recepción guiada ${identifier} | ${reception.numero}`,
        `Producto: ${selected.sku} - ${selected.producto}`,
        entry.referencia_interpretada
          ? `Interpreté «${entry.referencia_interpretada}» como ${selected.sku}; verifica que sea correcto.` : null,
        `Cantidad pendiente según OC: ${Number(selected.cantidad_pendiente)} ${selected.unidad || 'und'} (referencia; no es la cantidad recibida).`,
        entry.cantidad ? `Cantidad registrada: ${entry.cantidad} ${selected.unidad || 'und'}.` : null,
        !entry.cantidad ? receivedQuantityPrompt(selected.unidad || 'und') : null,
        entry.condicion ? `Condición registrada: ${entry.condicion}.` : null,
        entry.ubicacion ? `Ubicación registrada: ${entry.ubicacion}.` : null,
        selected.ubicacion_sugerida
          ? `Ubicación sugerida: ${selected.ubicacion_sugerida} (verifica físicamente; no se asigna automáticamente).` : null,
        entry.lote ? `Lote registrado: ${entry.lote}.`
          : selected.lote_documento ? `Lote propuesto por PDF: ${selected.lote_documento}${entry.lote_discrepa_pdf ? ' (no coincide; indica el lote físico correcto)' : ''}.` : null,
        entry.fecha_vencimiento ? `Vencimiento registrado: ${entry.fecha_vencimiento}.`
          : selected.fecha_vencimiento_documento
            ? `Vencimiento propuesto por PDF: ${selected.fecha_vencimiento_documento}${entry.vencimiento_discrepa_pdf ? ' (no coincide; indica el vencimiento físico correcto)' : ''}.` : null,
        entry.motivo && entry.condicion !== 'DISPONIBLE' ? `Motivo de condición: ${entry.motivo}.` : null,
        entry.motivo_diferencia ? `Motivo de diferencia: ${entry.motivo_diferencia}.` : null,
        `Falta: ${missing.join(', ')}.`,
        'Puedes responder todo junto o dato por dato. Los datos del PDF deben cotejarse con la etiqueta física.',
        'Aún no se modificó inventario.',
      ].filter(Boolean).join('\n'), inventory_changed: false };
    }
    return { message: [
      `🧾 Recepción guiada ${identifier} | ${reception.numero}`,
      confirmedSku ? `${confirmedSku} quedó revisado en el borrador. No se modificó inventario.`
        : selected ? `${selected.sku} quedó registrado en el borrador. No se modificó inventario.`
          : 'Elige el primer SKU para registrar.',
      'Productos pendientes:',
      ...availableChoices(preparedItems, payload.entries),
      'Puedes decir el SKU o un nombre inequívoco. Si un nombre puede referirse a varios productos, te pediré precisarlo.',
    ].join('\n'), inventory_changed: false };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  }
}

module.exports = { advanceGuidedReception, hasPendingSkuReview, hasSelectedGuidedSku,
  hasActiveReceptionSession, isReceptionCorrectionRequest,
  skuReviewReply, documentMismatch,
  parseDraft, missingFields, itemFromEntry };
