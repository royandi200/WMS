const crypto = require('node:crypto');
const { explicitReferences, referenceKey } = require('./production-order-reference');
const { resolveProductReference } = require('./product-references');
const { roundQty } = require('./production-material-availability');

function pickError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

function explicitPickConfirmation(text) {
  const raw = normalize(text);
  const prefix = /^confirmo\s+(?:los\s+)?materiales(?:\s+e\s+inicio\s+de\s+produccion)?(?:\s+(?:de\s+la\s+orden|para|de|orden))?\s+/u;
  const remainder = raw.replace(prefix, '');
  return remainder !== raw && /^(?:op\s*(?:id|iv|i\s*[dv]|y\s+de)?\s*#?\s*[1-9]\d*|op-\d{8}-\d{6})[.!]?$/u.test(remainder);
}

function isPickCorrection(text) {
  return /\b(?:correccion|corrijo|corrige|cambia|cambio|ajusta|ajuste|reparte|divide|partir|no\s+estaban?|no\s+estan|en\s+vez\s+de)\b/u.test(normalize(text));
}

function isPickReviewIntent(text) {
  return /\b(?:revisa|revisar|confirma|confirmo|confirmar)\s+(?:los\s+)?materiales\b/u.test(normalize(text))
    || /\b(?:alistamiento|materiales)\s+(?:de\s+la\s+)?op\s*(?:id\s*)?\d+/u.test(normalize(text));
}

function allocationFingerprint(rows) {
  const canonical = [...rows].sort((a, b) => Number(a.id) - Number(b.id))
    .map(row => [Number(row.id), Number(row.stock_id),
    String(row.lote), Number(row.ubicacion_id), roundQty(row.cantidad_reservada)]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function pendingPickReview(db, userId) {
  const [rows] = await db.execute(
    `SELECT orden_produccion_id AS order_id, huella
       FROM produccion_alistamiento_revisiones
      WHERE usuario_id = ? AND expira_en > NOW() LIMIT 1`, [userId]
  );
  return rows[0] || null;
}

async function recentPickNotificationReference(db, from) {
  if (!from) return null;
  const [notices] = await db.execute(
    `SELECT evento FROM notificaciones_salida
      WHERE destinatario = ? AND estado = 'ENVIADA'
        AND evento LIKE 'production_released:%'
        AND creado_en >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      ORDER BY id DESC LIMIT 20`, [from]
  );
  const ids = [...new Set(notices.map(row => referenceKey(String(row.evento || '').split(':')[1]))
    .filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

async function loadAllocations(db, orderId, lock = false) {
  const [rows] = await db.execute(
    `SELECT pml.id, pml.produccion_material_id, pml.stock_id, pml.lote,
            pml.ubicacion_id, pml.cantidad_reservada, pm.producto_id, pm.unidad,
            s.bodega_id, p.siigo_code AS sku, p.nombre AS producto,
            u.codigo AS ubicacion
       FROM produccion_material_lotes pml
       JOIN produccion_materiales pm ON pm.id = pml.produccion_material_id
       JOIN stock s ON s.id = pml.stock_id
       JOIN productos p ON p.id = pm.producto_id
       LEFT JOIN ubicaciones u ON u.id = pml.ubicacion_id
      WHERE pm.orden_produccion_id = ?
      ORDER BY pml.id${lock ? ' FOR UPDATE' : ''}`, [orderId]
  );
  return rows;
}

function pickSummary(order, rows, note = '') {
  const lines = [
    `🏭 *Revisa el alistamiento de OP ID ${order.id} | ${order.codigo_orden}*`,
    `Producto terminado: ${order.producto_nombre} (${order.producto_sku}).`,
    '', '*Materiales reservados*',
    ...rows.flatMap((row, index) => [
      `${index + 1}. *${row.producto}* (${row.sku}): ${roundQty(row.cantidad_reservada)} ${row.unidad || 'und'}`,
      `   Lote: ${row.lote} | ubicación: ${row.ubicacion || 'sin ubicación'}`,
    ]),
    '', note || 'Verifica físicamente cada partida antes de iniciar la producción.',
    '', 'Para corregir, di «corrección: partida 1, ubicación A10». Si hay varias partidas del mismo producto, usa su número; no necesitas repetir el SKU ni el lote anterior.',
    'Para dividir una partida, di «corrección: reparte partida 1: 4 en A10 y 3 en A11». Indica el lote nuevo en cada parte si cambia.',
    `Si *todo el resumen* está correcto, responde exactamente: *Confirmo materiales OP ID ${order.id}*.`,
    'Hasta esa confirmación no se consumen materiales ni se inicia la OP.',
  ];
  return lines.join('\n');
}

function mentionedOrderId(text) {
  const fuzzy = [...normalize(text).matchAll(/\bop\s*(?:iv|i\s*[dv]|y\s+de)\s*#?\s*([1-9]\d*)\b/gu)]
    .map(match => Number(match[1]));
  const ids = [...new Set([...explicitReferences(text).map(referenceKey), ...fuzzy].filter(Boolean))];
  if (ids.length > 1) throw pickError('Mencionaste varias OP. Indica solo una; no se inició producción.');
  return ids[0] || null;
}

function pickLocations(text) {
  const raw = normalize(text).replace(/\b([a-z]{1,5})\s+(\d{1,3})\b/gu, '$1$2');
  const direct = [...raw.matchAll(/\b(?:ubicacion\s*(?:(?:correcta|nueva|es)\s*)?[:\-]?\s*|(?:en|para|a)\s+(?:la\s+ubicacion\s*)?)([a-z][a-z0-9-]*\d[a-z0-9-]*)\b/gu)]
    .map(match => match[1].toUpperCase());
  if (direct.length) return direct;
  const natural = /\bubicacion(?: correcta)?\s+de\s+(?:los?|las?)\s+.+?\s+(?:es|fue|queda)\s+([a-z][a-z0-9-]*\d[a-z0-9-]*)\b/u.exec(raw);
  return natural ? [natural[1].toUpperCase()] : [];
}

function pickLots(text) {
  return [...normalize(text).matchAll(/\blote\s+(?:(?:es|fue|correcto|nuevo|del?)\s+)?([a-z0-9]+(?:-[a-z0-9]+)+|[a-z]*\d+[a-z0-9]*)\b/gu)]
    .map(match => match[1].toUpperCase());
}

function parseSplit(text, oldQuantity) {
  const raw = normalize(text);
  const marker = /\b(?:reparte|divide|partir)\s+partida\s+\d+\s*:\s*/u.exec(raw)
    || /\bpartida\s+\d+\s*:\s*(?=\d)/u.exec(raw);
  if (!marker) return null;
  const body = raw.slice(marker.index + marker[0].length);
  const pieces = body.split(/\s+y\s+(?=\d)|\s*;\s*/u).filter(Boolean);
  if (pieces.length < 2) return null;
  const segments = pieces.map(piece => {
    const amount = /^(\d+(?:[.,]\d+)?)\s*(?:und|unidades?|g|gramos?)?\b/u.exec(piece);
    const location = pickLocations(piece).at(-1);
    const lot = pickLots(piece).at(-1) || null;
    if (!amount || !location) throw pickError('Para repartir, indica cantidad y ubicación de cada parte. No cambié las reservas.');
    return { quantity: roundQty(Number(amount[1].replace(',', '.'))), location, lot };
  });
  if (segments.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0)
    || roundQty(segments.reduce((sum, item) => sum + item.quantity, 0)) !== roundQty(oldQuantity)) {
    throw pickError(`Las partes deben sumar ${roundQty(oldQuantity)}. No cambié las reservas.`);
  }
  return segments;
}

async function selectedAllocation(db, rows, text) {
  const index = /\b(?:partida|fila|renglon|numero)\s*#?\s*(\d+)\b/u.exec(normalize(text));
  if (index) {
    const selected = rows[Number(index[1]) - 1];
    if (!selected) throw pickError(`No existe la partida ${index[1]} de esta OP. No cambié las reservas.`);
    return selected;
  }
  const sku = rows.find(row => normalize(text).includes(normalize(row.sku)));
  if (sku && rows.filter(row => row.producto_id === sku.producto_id).length === 1) return sku;
  const productPhrase = /\b(?:los?|las?)\s+(.+?)\s+(?:no\s+)?(?:estaban?|estan|salen?|van|se\s+sacan)\b/u.exec(normalize(text))?.[1]
    || /\b(?:de\s+)?(?:los?|las?)\s+(.+?)\s+(?:en\s+|a\s+)(?:la\s+)?ubicacion\b/u.exec(normalize(text))?.[1]
    || /\bubicacion(?: correcta)?\s+de\s+(?:los?|las?)\s+(.+?)\s+(?:es|fue|queda)\b/u.exec(normalize(text))?.[1];
  if (productPhrase && !/^(?:dos|tres|cuatro|cinco|un|una|uno|materiales?)$/u.test(productPhrase)) {
    try {
      const product = await resolveProductReference(db, productPhrase,
        { productIds: [...new Set(rows.map(row => Number(row.producto_id)))],
          allowContextualPartial: true, allowScopedApproximate: true });
      const matching = rows.filter(row => Number(row.producto_id) === Number(product.id));
      if (matching.length === 1) return matching[0];
    } catch (error) {
      if (!['PRODUCT_REFERENCE_NOT_FOUND', 'PRODUCT_REFERENCE_AMBIGUOUS'].includes(error.code)) throw error;
    }
  }
  const locations = pickLocations(text);
  if (locations.length > 1) {
    const matching = rows.filter(row => row.ubicacion?.toUpperCase() === locations[0]);
    if (matching.length === 1) return matching[0];
  }
  if (rows.length === 1) return rows[0];
  throw pickError('No identifiqué una sola partida. Di «corrección: partida N, ubicación A10» usando el número del resumen. No cambié las reservas.');
}

async function replacementStock(db, row, segment) {
  const lot = segment.lot || row.lote;
  const [options] = await db.execute(
    `SELECT s.id, s.lote, s.ubicacion_id, s.cantidad, s.reservada,
            u.codigo AS ubicacion, l.status, COALESCE(l.expiry_date, s.fecha_venc) AS vence
       FROM stock s
       JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
       JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
       JOIN bodegas b ON b.id = s.bodega_id AND b.activa = 1
      WHERE s.producto_id = ? AND s.bodega_id = ? AND UPPER(s.lote) = UPPER(?)
        AND (? IS NULL OR UPPER(u.codigo) = UPPER(?))
        AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
             OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
      ORDER BY s.id FOR UPDATE`,
    [row.producto_id, row.bodega_id, lot, segment.location || null, segment.location || null]
  );
  const usable = options.filter(option => option.status === 'DISPONIBLE');
  if (!usable.length) throw pickError(`No hay saldo registrado y disponible de ${row.producto} del lote ${lot}${segment.location ? ` en ${segment.location}` : ''}. No cambié las reservas. Si físicamente está allí, concilia su ubicación en inventario antes de iniciar la OP.`);
  if (usable.length > 1) throw pickError(`El lote ${lot} está en varias ubicaciones. Indica la ubicación de destino; no cambié las reservas.`);
  return usable[0];
}

async function correctAllocation(db, rows, text) {
  const selected = await selectedAllocation(db, rows, text);
  const segments = parseSplit(text, selected.cantidad_reservada);
  const desired = segments || [{ quantity: roundQty(selected.cantidad_reservada),
    location: pickLocations(text).at(-1) || null, lot: pickLots(text).at(-1) || null }];
  if (!segments && !desired[0].location && !desired[0].lot) {
    throw pickError('Indica el dato nuevo de la partida: ubicación o lote. No cambié las reservas.');
  }
  const resolved = [];
  for (const segment of desired) resolved.push({ ...segment,
    stock: await replacementStock(db, selected, segment) });
  if (new Set(resolved.map(part => Number(part.stock.id))).size !== resolved.length) {
    throw pickError('Dos partes apuntan al mismo lote y ubicación. Indica el total en una sola partida; no cambié las reservas.');
  }
  const totals = new Map();
  for (const part of resolved) {
    const current = totals.get(part.stock.id) || { stock: part.stock, quantity: 0 };
    current.quantity = roundQty(current.quantity + part.quantity);
    totals.set(part.stock.id, current);
  }
  for (const { stock, quantity } of totals.values()) {
    const available = roundQty(Number(stock.cantidad) - Number(stock.reservada)
      + (Number(stock.id) === Number(selected.stock_id) ? Number(selected.cantidad_reservada) : 0));
    if (available + 0.0001 < quantity) throw pickError(
      `En ${stock.ubicacion} del lote ${stock.lote} solo hay ${available} disponibles para esta corrección; se requieren ${quantity}. No cambié las reservas.`
    );
  }
  const [released] = await db.execute(
    `UPDATE stock SET reservada = reservada - ?, actualizado_en = NOW()
      WHERE id = ? AND reservada >= ?`,
    [selected.cantidad_reservada, selected.stock_id, selected.cantidad_reservada]
  );
  if (released.affectedRows !== 1) throw pickError('La reserva original cambió; vuelve a revisar la OP.');
  for (const { stock, quantity } of totals.values()) {
    const [reserved] = await db.execute(
      `UPDATE stock SET reservada = reservada + ?, actualizado_en = NOW()
        WHERE id = ? AND (cantidad - reservada) >= ?`, [quantity, stock.id, quantity]
    );
    if (reserved.affectedRows !== 1) throw pickError('El saldo cambió durante la corrección; no se modificó la reserva.');
  }
  for (const [index, part] of resolved.entries()) {
    if (index === 0) {
      await db.execute(
        `UPDATE produccion_material_lotes
            SET stock_id = ?, lote = ?, ubicacion_id = ?, cantidad_reservada = ?
          WHERE id = ?`,
        [part.stock.id, part.stock.lote, part.stock.ubicacion_id, part.quantity, selected.id]
      );
    } else {
      await db.execute(
        `INSERT INTO produccion_material_lotes
           (produccion_material_id, stock_id, lote, ubicacion_id, cantidad_reservada, creado_en)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [selected.produccion_material_id, part.stock.id, part.stock.lote,
          part.stock.ubicacion_id, part.quantity]
      );
    }
  }
  return { selected, resolved };
}

async function advanceProductionPick({ db, userId, from, rawText }) {
  const explicitId = mentionedOrderId(rawText);
  const active = await pendingPickReview(db, userId);
  const notifiedId = !explicitId && !active && (isPickCorrection(rawText) || isPickReviewIntent(rawText))
    ? await recentPickNotificationReference(db, from) : null;
  const orderId = explicitId || Number(active?.order_id) || notifiedId || null;
  if (!orderId) return { message: 'Indica la OP que vas a alistar, por ejemplo «Revisa materiales OP ID 110». No se inició producción.' };
  const confirmationRequested = explicitPickConfirmation(rawText);
  let originalReview = null;
  await db.beginTransaction();
  try {
    const [orders] = await db.execute(
      `SELECT op.id, op.codigo_orden, op.estado, op.fase,
              p.siigo_code AS producto_sku, p.nombre AS producto_nombre
         FROM ordenes_produccion op JOIN productos p ON p.id = op.producto_id
        WHERE op.id = ? LIMIT 1 FOR UPDATE`, [orderId]
    );
    const order = orders[0];
    if (!order) throw pickError(`No existe la OP ID ${orderId}.`, 404);
    if (order.estado === 'EN_PROCESO') {
      await db.commit();
      return { message: `La OP ID ${order.id} ya inició producción. No volví a consumir materiales. Si la ubicación usada fue otra, requiere conciliación de inventario; no cambies solo el texto del alistamiento.` };
    }
    if (order.estado !== 'APROBADA' || order.fase !== 'F0') {
      throw pickError(`La OP ID ${order.id} está ${order.estado} en fase ${order.fase}; no se puede alistar.`);
    }
    const rows = await loadAllocations(db, order.id, true);
    if (!rows.length) throw pickError('La OP no tiene partidas reservadas; no se inició producción.');
    originalReview = { order, rows };
    if (confirmationRequested && active) {
      if (Number(active.order_id) !== Number(order.id)
        || active.huella !== allocationFingerprint(rows)) {
        throw pickError('El resumen de materiales cambió o no fue revisado. Pide «Revisa materiales OP ID ' + order.id + '» antes de confirmar; no se inició producción.');
      }
      await db.commit();
      return { orderId: order.id, confirm: true };
    }
    let note = confirmationRequested
      ? 'Antes de confirmar, revisa físicamente todas las partidas de este resumen. No se inició producción.' : '';
    if (isPickCorrection(rawText)) {
      const correction = await correctAllocation(db, rows, rawText);
      note = `Corrección aplicada a la partida ${rows.findIndex(row => row.id === correction.selected.id) + 1} en el borrador. Revisa de nuevo todo el resumen.`;
      await db.execute(
        `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
         VALUES ('produccion', 'INFO', ?, ?, ?, NOW())`,
        [`Alistamiento corregido para OP ID ${order.id}`, userId, JSON.stringify({
          orden_produccion_id: order.id,
          partida_id: correction.selected.id,
          anterior: { stock_id: correction.selected.stock_id, lote: correction.selected.lote,
            ubicacion: correction.selected.ubicacion, cantidad: roundQty(correction.selected.cantidad_reservada) },
          nuevo: correction.resolved.map(part => ({ stock_id: part.stock.id,
            lote: part.stock.lote, ubicacion: part.stock.ubicacion, cantidad: part.quantity })),
        })]
      );
    } else if (!isPickReviewIntent(rawText)) {
      note = 'No interpreté tu mensaje como confirmación. No se consumieron materiales. Si querías corregir, empieza con «corrección» e indica la partida.';
    }
    const current = await loadAllocations(db, order.id, true);
    await db.execute(
      `INSERT INTO produccion_alistamiento_revisiones
         (usuario_id, orden_produccion_id, huella, expira_en)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))
       ON DUPLICATE KEY UPDATE orden_produccion_id = VALUES(orden_produccion_id),
         huella = VALUES(huella), expira_en = VALUES(expira_en), actualizado_en = NOW()`,
      [userId, order.id, allocationFingerprint(current)]
    );
    await db.commit();
    return { message: pickSummary(order, current, note), orderId: order.id };
  } catch (error) {
    await db.rollback().catch(() => {});
    if (error.status === 409 && isPickCorrection(rawText) && originalReview) {
      return { message: `⚠️ ${error.message}\n\n${pickSummary(originalReview.order,
        originalReview.rows, 'No se cambiaron las reservas. Corrige la partida indicada y vuelve a revisar el resumen.')}` };
    }
    throw error;
  }
}

module.exports = { advanceProductionPick, allocationFingerprint, explicitPickConfirmation,
  isPickCorrection, isPickReviewIntent, loadAllocations, pendingPickReview,
  pickLocations, pickLots, pickSummary, recentPickNotificationReference };
