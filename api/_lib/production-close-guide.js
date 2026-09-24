const { explicitReferences, referenceKey } = require('./production-order-reference');

const NUMBER_WORDS = Object.freeze({ cero: 0, ninguna: 0, ninguno: 0,
  una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 });
const NUMBER = '(\\d+(?:[.,]\\d+)?|cero|ninguna|ninguno|una|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';

function guideError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

function quantity(value) {
  if (value == null) return null;
  const text = normalize(value);
  const number = Object.hasOwn(NUMBER_WORDS, text) ? NUMBER_WORDS[text] : Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function closeOrderReference(text, params = {}) {
  const standard = explicitReferences(text).map(referenceKey).filter(Boolean);
  // Transcripciones de "OP ID": OPIV, OPID, OPI y OP y de.
  const normalized = normalize(text);
  const fuzzy = [
    ...normalized.matchAll(/\bop\s*(?:i\s*[dv]?|iv|y\s+de)?\s*#?\s*([1-9]\d*)\b/gu),
    ...normalized.matchAll(/\borden(?:\s+de\s+produccion)?\s+(?:id\s*)?([1-9]\d*)\b/gu),
  ].map(match => Number(match[1]));
  const unique = [...new Set([...standard, ...fuzzy])];
  if (unique.length > 1) throw guideError('El mensaje menciona más de una OP. Indica solo un OP ID; no se cerró nada.');
  const spoken = unique[0] || null;
  if (!spoken) return null;
  const interpreted = referenceKey(params.id_orden);
  if (interpreted && interpreted !== spoken) {
    throw guideError('El OP ID interpretado no coincide con el audio. Repite solo el OP ID; no se cerró nada.');
  }
  return spoken;
}

function contextualOrderCandidate(text, hasDraft) {
  const raw = normalize(text);
  const ambiguous = raw.match(/\b(?:oc\s*i\s*d|ocid|id)\s*#?\s*([1-9]\d*)\b/u);
  if (ambiguous && /\b(?:cerrar|cerramos|cierre|produccion)\b/u.test(raw)) return Number(ambiguous[1]);
  if (hasDraft) {
    const reply = raw.match(/^(?:(?:el|numero|id)\s+)?([1-9]\d*)[.!]?$/u);
    if (reply) return Number(reply[1]);
  }
  return null;
}

function fieldMatch(text, before, after) {
  const value = text.match(new RegExp(`${NUMBER}\\s*(?:und|unidad(?:es)?|uds?)?\\s*(?:de\\s+)?${after}`, 'u'))?.[1]
    || text.match(new RegExp(`${before}\\s*(?:de|son|fueron|quedaron|:)?\\s*${NUMBER}`, 'u'))?.[1];
  return quantity(value);
}

function closeFields(text) {
  const raw = normalize(text);
  const conformingText = raw.replace(/\bno\s+conformes?\b/gu, '');
  const conforming = fieldMatch(conformingText,
    '(?:conformes?|buenas?|buenos|resultantes?|producidas?)',
    '(?:conformes?|buenas?|buenos|resultantes?|producidas?)');
  let waste = fieldMatch(raw,
    '(?:mermas?|no\\s+conformes?|rechazos?|desperdicios?)',
    '(?:mermas?|no\\s+conformes?|rechazos?|desperdicios?)');
  if (waste == null && /\b(?:sin|ninguna|no hubo)\s+(?:merma|mermas|rechazos?)\b/u.test(raw)) waste = 0;
  const locationCandidate = [...raw.matchAll(/\b(?:ubicacion\s*[:\-]?|quedan?\s+en|dejar\s+en|ubicar\s+en|en)\s*([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/gu)]
    .map(match => match[1]).find(candidate => /\d/u.test(candidate));
  const location = locationCandidate && /\d/u.test(locationCandidate)
    ? locationCandidate.toUpperCase() : null;
  const rawReason = raw.match(/\b(?:por|motivo|causa|debido a)\s+(.+?)(?=\s+(?:ubicacion|quedan en|dejar en)\b|$)/u)?.[1]
    ?.replace(/[,;\s]+$/u, '').trim() || null;
  const locationTail = location ? ` en ${location.toLowerCase()}` : '';
  const reason = rawReason && locationTail && rawReason.endsWith(locationTail)
    ? rawReason.slice(0, -locationTail.length).trim() : rawReason;
  return { conforming, waste, reason, location };
}

function confirmed(text) {
  return /^(?:si|confirmo|confirmar|correcto|todo bien|adelante)(?:[,. ]+(?:el\s+)?cierre(?:\s+de\s+produccion)?)?[.!]?$/u
    .test(normalize(text));
}

function rejected(text) {
  return /^(?:no|incorrecto|esta mal|corrige|quiero corregir)[.!]?$/u.test(normalize(text));
}

function jsonObject(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

async function pendingCloseDraft(db, userId) {
  const [rows] = await db.execute(
    `SELECT payload_json FROM produccion_cierre_borradores
      WHERE usuario_id = ? AND estado = 'PENDIENTE' AND expira_en > NOW() LIMIT 1`, [userId]
  );
  return rows.length ? jsonObject(rows[0].payload_json) : null;
}

function isCloseFollowup(text, draft) {
  if (!draft) return false;
  const raw = normalize(text);
  if (confirmed(raw) || rejected(raw)) return true;
  if (!draft.orderId && contextualOrderCandidate(raw, true)) return true;
  if (/\b(?:conformes?|mermas?|no conformes?|motivo|causa|ubicacion|dejar en|quedan en|por)\b/u.test(raw)) return true;
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(raw) && /\d/u.test(raw)) return true;
  if (quantity(raw) != null) return true;
  if (draft.waste > 0 && !draft.reason && raw.length < 80 && !/[?¿]/u.test(raw)) return true;
  return false;
}

async function loadOrder(db, orderId) {
  const [rows] = await db.execute(
    `SELECT op.id, op.codigo_orden, op.estado, op.cantidad_planeada, op.producto_id,
            p.siigo_code AS sku, p.nombre AS producto
       FROM ordenes_produccion op JOIN productos p ON p.id = op.producto_id
      WHERE op.id = ? LIMIT 1`, [orderId]
  );
  const order = rows[0];
  if (!order) throw guideError(`No existe la OP ID ${orderId}`, 404);
  return order;
}

async function suggestedLocation(db, productId) {
  const [rows] = await db.execute(
    `SELECT u.codigo FROM producto_ubicaciones pu
      JOIN ubicaciones u ON u.id = pu.ubicacion_id AND u.activa = 1
      JOIN bodegas b ON b.id = u.bodega_id AND b.activa = 1
      WHERE pu.producto_id = ? AND pu.activa = 1
      ORDER BY pu.prioridad, u.codigo LIMIT 1`, [productId]
  );
  return rows[0]?.codigo || null;
}

async function saveDraft(db, userId, draft) {
  await db.execute(
    `INSERT INTO produccion_cierre_borradores
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
    `UPDATE produccion_cierre_borradores
        SET estado = 'CONFIRMADO', actualizado_en = NOW()
      WHERE usuario_id = ? AND estado = 'PENDIENTE' AND JSON_CONTAINS(payload_json, ?)`,
    [userId, JSON.stringify(draft)]
  );
}

function guideSummary(order, draft, locationHint) {
  const lines = ['🏭 *Cierre de producción en preparación*', '',
    `Orden: *OP ID ${order.id}* | ${order.codigo_orden}`,
    `Producto: ${order.producto} (${order.sku})`,
    `Cantidad planeada: ${Number(order.cantidad_planeada)} und`,
    `Conformes: ${draft.conforming == null ? 'pendiente' : `${draft.conforming} und`}`,
    `Merma de producto terminado: ${draft.waste == null ? 'pendiente' : `${draft.waste} und`}`];
  if (draft.waste > 0) lines.push(`Causa: ${draft.reason || 'pendiente'}`);
  if (draft.conforming > 0) lines.push(`Ubicación PT: ${draft.location || 'pendiente'}`);
  lines.push('');
  if (draft.conforming == null) lines.push('¿Cuántas unidades conformes salieron? Puedes decir «2 conformes».');
  else if (draft.waste == null) lines.push('¿Cuántas unidades terminadas fueron merma? Di «0 merma» si no hubo.');
  else if (draft.conforming === 0 && draft.waste === 0) lines.push('Ambas cantidades son cero. Corrige conformes o merma para poder cerrar.');
  else if (draft.waste > 0 && !draft.reason) lines.push('¿Cuál fue la causa de la merma de producto terminado?');
  else if (draft.conforming > 0 && !draft.location) {
    lines.push(`¿En qué ubicación quedará el producto terminado?${locationHint ? ` Sugerida: *${locationHint}*; verifica físicamente.` : ''}`);
  } else {
    const difference = Number(order.cantidad_planeada) - draft.conforming - draft.waste;
    if (difference !== 0) lines.push(`Diferencia frente al plan: ${difference} und. Verifica este dato.`);
    lines.push('Revisa el resumen. Si está correcto, responde *confirmo cierre*; también puedes corregir cualquier dato.');
  }
  lines.push('', 'Este borrador no cierra la OP ni modifica inventario.');
  return lines.join('\n');
}

async function advanceCloseGuide({ db, userId, rawText, params = {} }) {
  const prior = await pendingCloseDraft(db, userId);
  const spokenOrderId = closeOrderReference(rawText, params);
  if (spokenOrderId && prior?.orderId && spokenOrderId !== prior.orderId) {
    throw guideError(`Tienes un cierre pendiente para OP ID ${prior.orderId}. Termínalo o cancélalo antes de cambiar de OP.`);
  }
  const draft = prior || { orderId: null, conforming: null, waste: null,
    reason: null, location: null, reviewShown: false, candidateOrderId: null };
  if (spokenOrderId) {
    draft.orderId = spokenOrderId;
    draft.candidateOrderId = null;
  }
  if (!draft.orderId && confirmed(rawText) && draft.candidateOrderId) {
    draft.orderId = draft.candidateOrderId;
    draft.candidateOrderId = null;
  }
  if (!draft.orderId && rejected(rawText) && draft.candidateOrderId) {
    draft.candidateOrderId = null;
  }
  if (!draft.orderId) {
    const candidate = contextualOrderCandidate(rawText, !!prior);
    if (candidate) {
      const order = await loadOrder(db, candidate);
      if (order.estado !== 'EN_PROCESO') {
        throw guideError(`La OP ID ${candidate} está ${order.estado}. Indica una OP en proceso; no se cerró nada.`);
      }
      draft.candidateOrderId = candidate;
      await saveDraft(db, userId, draft);
      return { message: `🏭 ¿Te refieres al cierre de *OP ID ${candidate}*? Responde *sí* para continuar o indica otro OP ID. No se modificó inventario.`, draft };
    }
    await saveDraft(db, userId, draft);
    return { message: '🏭 ¿Cuál es el *OP ID* de la producción que vas a cerrar? No se modificó inventario.', draft };
  }
  const order = await loadOrder(db, draft.orderId);
  if (order.estado === 'CERRADA') return { message: `La *OP ID ${order.id}* ya estaba cerrada. No se modificó inventario.`, draft };
  if (order.estado !== 'EN_PROCESO') {
    throw guideError(`La OP ID ${order.id} está ${order.estado}. Confirma primero sus materiales; no se cerró.`);
  }
  const parsed = closeFields(rawText);
  if (parsed.conforming != null) draft.conforming = parsed.conforming;
  if (parsed.waste != null) draft.waste = parsed.waste;
  if (draft.waste === 0) draft.reason = null;
  if (draft.conforming === 0) draft.location = null;
  if (parsed.reason && draft.waste > 0) draft.reason = parsed.reason;
  if (parsed.location) draft.location = parsed.location;
  const singleQuantity = quantity(rawText);
  if (singleQuantity != null && parsed.conforming == null && parsed.waste == null) {
    if (draft.conforming == null) draft.conforming = singleQuantity;
    else if (draft.waste == null) draft.waste = singleQuantity;
  }
  if (draft.waste > 0 && !draft.reason && parsed.reason == null
    && !spokenOrderId && !parsed.location && parsed.conforming == null && parsed.waste == null
    && !confirmed(rawText) && !rejected(rawText)) {
    const candidate = String(rawText || '').trim();
    if (candidate && candidate.length <= 100 && !/[?¿]/u.test(candidate)
      && !(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/iu.test(candidate) && /\d/u.test(candidate))) draft.reason = candidate;
  }
  if (draft.conforming > 0 && !draft.location && !spokenOrderId) {
    const standalone = normalize(rawText).match(/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/u);
    if (standalone && /\d/u.test(standalone[1])) draft.location = standalone[1].toUpperCase();
  }
  if (draft.conforming != null && (!Number.isInteger(draft.conforming) || draft.conforming < 0
      || draft.conforming > Number(order.cantidad_planeada))) {
    throw guideError(`Los conformes deben ser unidades enteras entre 0 y ${Number(order.cantidad_planeada)}.`);
  }
  if (draft.waste != null && (!Number.isInteger(draft.waste) || draft.waste < 0)) {
    throw guideError('La merma debe ser cero o un número entero de unidades.');
  }
  if (draft.location) {
    const [locations] = await db.execute(
      `SELECT u.codigo FROM ubicaciones u JOIN bodegas b ON b.id = u.bodega_id
        WHERE UPPER(u.codigo) = UPPER(?) AND u.activa = 1 AND b.activa = 1 LIMIT 1`,
      [draft.location]
    );
    if (!locations.length) throw guideError(`La ubicación ${draft.location} no existe o no está activa. Indica otra.`);
    draft.location = locations[0].codigo;
  }
  const complete = draft.conforming != null && draft.waste != null
    && draft.conforming + draft.waste > 0 && (draft.waste === 0 || !!draft.reason)
    && (draft.conforming === 0 || !!draft.location);
  if (confirmed(rawText) && complete && draft.reviewShown) {
    return { params: { id_orden: draft.orderId, cantidad_real: draft.conforming,
      merma: draft.waste, motivo_merma: draft.reason, ubicacion: draft.location }, draft };
  }
  if (rejected(rawText)) draft.reviewShown = false;
  else draft.reviewShown = complete;
  await saveDraft(db, userId, draft);
  const locationHint = draft.conforming > 0 && draft.waste != null
    && (draft.waste === 0 || draft.reason) && !draft.location
    ? await suggestedLocation(db, order.producto_id) : null;
  return { message: guideSummary(order, draft, locationHint), draft };
}

module.exports = { advanceCloseGuide, closeFields, closeOrderReference, confirmed,
  finishDraft, guideSummary, isCloseFollowup, pendingCloseDraft };
