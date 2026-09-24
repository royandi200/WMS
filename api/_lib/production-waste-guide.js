const { resolveProductReference } = require('./product-references');
const { explicitReferences, reconcileProductionOrderId, referenceKey } = require('./production-order-reference');
const { assertWasteReasonEvidence } = require('./operational-intent-guard');

const NUMBER_WORDS = Object.freeze({ un: 1, una: 1, uno: 1, dos: 2, tres: 3,
  cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 });
const ORDER_ACTIONS = new Set(['REPORTE_MERMA', 'CONFIRMAR_MATERIALES_PRODUCCION',
  'AVANCE_FASES', 'AJUSTAR_MATERIALES_PRODUCCION', 'PREPARAR_REPOSICION_PRODUCCION',
  'GUIAR_REPOSICION_PRODUCCION', 'CERRAR_ORDEN_PRODUCCION']);

function guideError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
}

function parseWasteMessage(value) {
  const text = normalized(value);
  if (!/\bmerma\b/u.test(text)) return null;
  const cause = text.match(/\b(?:por|debido a|causa|motivo)\s+([^.,;]+)$/u)?.[1]?.trim() || null;
  const afterWaste = text.split(/\bmerma\b/u).slice(1).join('merma')
    .replace(/^\s*(?:de|del)?\s*/u, '')
    .replace(/\s+\b(?:por|debido a|causa|motivo)\b.*$/u, '')
    .replace(/\s+\b(?:de|en)\s+(?:la\s+)?(?:orden|op)\b.*$/u, '')
    .trim();
  const match = afterWaste.match(/^(?:(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?(.+)$/u);
  const quantity = match?.[1] ? (NUMBER_WORDS[match[1]] || Number(match[1].replace(',', '.'))) : null;
  const product = match?.[2]?.replace(/\s+(?:unidades?|und|gramos?|g)$/u, '').trim() || null;
  return { product, quantity, cause };
}

function parseCauseReply(value) {
  const text = normalized(value).replace(/[.!?]+$/u, '').trim();
  const explicit = text.match(/^(?:(?:el\s+)?(?:motivo|causa|razon)(?:\s+(?:fue|es))?\s*[:\-]?\s*|por\s+)(.{3,100})$/u);
  if (explicit) return explicit[1].trim();
  if (/^(?:ruptura|rotura|derrame|vencimiento|contaminacion|defecto|caida|despegue|dano|danada?|roto|rota|se rompio)$/u.test(text)) return text;
  return null;
}

function jsonObject(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

async function pendingWasteDraft(db, userId) {
  const [rows] = await db.execute(
    `SELECT payload_json FROM produccion_merma_borradores
      WHERE usuario_id = ? AND estado = 'PENDIENTE' AND expira_en > NOW() LIMIT 1`,
    [userId]
  );
  return rows.length ? jsonObject(rows[0].payload_json) : null;
}

async function recentOrderContext(db, from) {
  if (!from) return null;
  const [rows] = await db.execute(
    `SELECT action, payload FROM webhook_logs
      WHERE from_phone = ? AND status = 'PROCESSED'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      ORDER BY id DESC LIMIT 80`, [from]
  );
  const ids = new Set();
  for (const row of rows) {
    if (!ORDER_ACTIONS.has(row.action)) continue;
    const payload = jsonObject(row.payload);
    const info = jsonObject(payload.info);
    const params = info.params || payload.params || {};
    const structured = referenceKey(params.id_orden || params.orden_produccion_id);
    const spoken = explicitReferences(payload.body || info.body || info.text || '')
      .map(referenceKey).filter(Boolean);
    if (structured) ids.add(structured);
    for (const id of spoken) ids.add(id);
    if (ids.size > 1) return null;
  }
  return ids.size === 1 ? [...ids][0] : null;
}

async function loadOrder(db, reference) {
  const id = referenceKey(reference);
  if (!id) return null;
  const [orders] = await db.execute(
    `SELECT id, codigo_orden, estado FROM ordenes_produccion WHERE id = ? LIMIT 1`, [id]
  );
  const order = orders[0];
  if (!order) throw guideError(`La OP ID ${id} no existe`, 404);
  if (order.estado !== 'EN_PROCESO') throw guideError(`La OP ID ${id} no está en proceso`);
  const [materials] = await db.execute(
    `SELECT pm.producto_id, pm.unidad, p.siigo_code, p.nombre
       FROM produccion_materiales pm JOIN productos p ON p.id = pm.producto_id
      WHERE pm.orden_produccion_id = ?`, [id]
  );
  return { order, materials };
}

async function saveDraft(db, userId, draft) {
  await db.execute(
    `INSERT INTO produccion_merma_borradores
      (usuario_id, orden_produccion_id, payload_json, estado, expira_en)
     VALUES (?, ?, ?, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 45 MINUTE))
     ON DUPLICATE KEY UPDATE orden_produccion_id = VALUES(orden_produccion_id),
       payload_json = VALUES(payload_json), estado = 'PENDIENTE',
       expira_en = VALUES(expira_en), actualizado_en = NOW()`,
    [userId, draft.orderId || null, JSON.stringify(draft)]
  );
}

async function finishDraft(db, userId, draft) {
  await db.execute(
    `UPDATE produccion_merma_borradores SET estado = 'CONFIRMADO', actualizado_en = NOW()
      WHERE usuario_id = ? AND estado = 'PENDIENTE' AND JSON_CONTAINS(payload_json, ?)`,
    [userId, JSON.stringify(draft)]
  );
}

async function advanceWasteGuide({ db, userId, from, rawText, params = {} }) {
  const prior = await pendingWasteDraft(db, userId);
  const parsed = parseWasteMessage(rawText);
  const draft = parsed ? { orderId: null, product: null, quantity: null, cause: null } : (prior || {
    orderId: null, product: null, quantity: null, cause: null,
  });
  const explicitOrder = explicitReferences(rawText).length
    ? reconcileProductionOrderId(params, rawText) : null;
  if (explicitOrder && draft.orderId && referenceKey(explicitOrder) !== draft.orderId) {
    throw guideError(`La conversación está en OP ID ${draft.orderId}. Indica si deseas iniciar una merma de otra OP.`);
  }
  draft.orderId = referenceKey(explicitOrder) || draft.orderId || await recentOrderContext(db, from);
  if (parsed) {
    draft.product = String(parsed.product || params.id_item || params.producto || '').trim() || null;
    draft.quantity = Number(parsed.quantity || params.cantidad) || null;
    draft.cause = parsed.cause || null;
  } else {
    const cause = parseCauseReply(rawText);
    if (cause) draft.cause = cause;
    else if (params.motivo && normalized(rawText).includes(normalized(params.motivo))) draft.cause = params.motivo;
    if (params.id_item) draft.product = String(params.id_item);
    if (params.cantidad) draft.quantity = Number(params.cantidad);
  }
  const context = draft.orderId ? await loadOrder(db, draft.orderId) : null;
  let material = null;
  if (draft.product && context) {
    const product = await resolveProductReference(db, draft.product, {
      productIds: context.materials.map(item => Number(item.producto_id)),
      allowContextualPartial: true, allowScopedApproximate: true,
    });
    material = context.materials.find(item => Number(item.producto_id) === Number(product.id));
    draft.product = material.siigo_code;
  }
  if (draft.cause) draft.cause = assertWasteReasonEvidence(rawText, draft.cause);
  if (!draft.orderId || !draft.product || !draft.quantity || !draft.cause) {
    await saveDraft(db, userId, draft);
    const lines = ['🏭 *Merma en preparación*'];
    if (draft.orderId) lines.push(`Orden: *OP ID ${draft.orderId}*`);
    if (material) lines.push(`Material: ${material.nombre} (${material.siigo_code})`);
    else if (draft.product) lines.push(`Material indicado: ${draft.product}`);
    if (draft.quantity) lines.push(`Cantidad: ${draft.quantity} ${material?.unidad || 'und'}`);
    if (draft.cause) lines.push(`Causa: ${draft.cause}`);
    lines.push('');
    if (!draft.orderId) lines.push('¿A qué OP ID corresponde? Hay más de una orden posible o no hay contexto reciente.');
    else if (!draft.product) lines.push('¿De qué material de esta OP fue la merma?');
    else if (!draft.quantity) lines.push('¿Qué cantidad se dañó?');
    else lines.push('¿Cuál fue la causa concreta de la merma?');
    lines.push('', 'Todavía no se registró ninguna merma ni se modificó inventario.');
    return { message: lines.join('\n'), draft };
  }
  return { params: {
    id_orden: draft.orderId, id_item: draft.product,
    cantidad: draft.quantity, motivo: draft.cause,
  }, draft };
}

module.exports = { advanceWasteGuide, finishDraft, parseCauseReply, parseWasteMessage,
  pendingWasteDraft, recentOrderContext };
