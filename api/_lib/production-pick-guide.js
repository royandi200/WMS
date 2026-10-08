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
  const raw = normalize(text);
  return /\b(?:correccion|corrijo|corrige|corregir|cambia|cambiar|cambio|modifica|modificar|ajusta|ajustar|ajuste|reparte|divide|partir|no\s+estaban?|no\s+estan|en\s+vez\s+de)\b/u.test(raw)
    || /\b[a-z]{1,5}\s*\d{1,3}\s+y\s+no\s+(?:de\s+)?(?:la\s+)?[a-z]{1,5}\s*\d{1,3}\b/u.test(raw)
    || /\b(?:va|van|queda|quedan|lo\s+(?:pongo|dejo|ubico)|las?\s+(?:pongo|dejo|ubico))\s+(?:para|en|a)\s+(?:la\s+)?(?:ubicacion\s+)?[a-z][a-z0-9-]*\d[a-z0-9-]*[.!]?$/u.test(raw);
}

function isPickReviewIntent(text) {
  return /\b(?:revisa|revisar|confirma|confirmo|confirmar)\s+(?:los\s+)?materiales\b/u.test(normalize(text))
    || /\b(?:alistamiento|materiales)\s+(?:de\s+la\s+)?op\s*(?:id\s*)?\d+/u.test(normalize(text));
}

function pickOptionNumber(text) {
  const raw = normalize(text).replace(/[.!?]+$/u, '').trim();
  // Igual que el cierre de OP: «7» solo también elige la opción mostrada. El
  // enrutamiento solo lo usa cuando hay una selección de lote pendiente.
  const numbered = /^(?:(?:la|el)\s+)?(?:(?:opcion|alternativa|lote|numero)\s*(?:numero\s*)?#?\s*)?(\d{1,2})$/u.exec(raw);
  if (numbered) return Number(numbered[1]);
  const words = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  const spoken = /^(?:(?:la|el)\s+)?(?:opcion|alternativa|lote|numero)\s+(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/u.exec(raw);
  if (spoken) return words[spoken[1]];
  const ordinals = { primera: 1, primero: 1, segunda: 2, segundo: 2,
    tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5 };
  const ordinal = /^(?:la|el)\s+(primera|primero|segunda|segundo|tercera|tercero|cuarta|cuarto|quinta|quinto)(?:\s+opcion|\s+lote)?$/u.exec(raw);
  return ordinal ? ordinals[ordinal[1]] : null;
}

function parsePendingChoice(value) {
  if (!value) return null;
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return null; }
}

function displayExpiry(value) {
  if (!value) return 'sin vencimiento registrado';
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return date;
}

function choicePrompt(choice, rows) {
  const index = rows.findIndex(row => Number(row.id) === Number(choice.allocationId));
  const selected = rows[index];
  if (!selected) return 'La partida cambió. Pide de nuevo el resumen de alistamiento; no se cambiaron reservas.';
  const choosingLocation = choice.kind === 'location';
  return [
    `🔎 Partida ${index + 1}: ${selected.producto} (${selected.sku}), ${roundQty(selected.cantidad_reservada)} ${selected.unidad || 'und'}.`,
    `Actual: lote ${selected.lote} | ubicación ${selected.ubicacion || 'sin ubicación'}.`,
    choosingLocation
      ? 'Elige la ubicación donde encontraste esta partida (cada opción tiene al menos un lote con saldo suficiente):'
      : `Para la ubicación ${choice.location}, elige el lote que verificaste físicamente:`,
    ...choice.options.map((option, number) => choosingLocation
      ? `${number + 1}. Ubicación ${option.location} | ${option.lotCount} ${option.lotCount === 1 ? 'lote apto' : 'lotes aptos'} | saldo máximo en un lote: ${roundQty(option.available)} ${selected.unidad || 'und'}`
      : `${number + 1}. Lote ${option.lot} | disponible ${roundQty(option.available)} ${selected.unidad || 'und'} | vence ${displayExpiry(option.expiry)}`),
    '', `Responde «opción 1», «opción 2», etc. No necesitas dictar ${choosingLocation ? 'la ubicación' : 'el lote'}. Aún no cambié la reserva ni se inició producción.`,
  ].join('\n');
}

function allocationFingerprint(rows) {
  const canonical = [...rows].sort((a, b) => Number(a.id) - Number(b.id))
    .map(row => [Number(row.id), Number(row.stock_id),
    String(row.lote), Number(row.ubicacion_id), roundQty(row.cantidad_reservada)]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function pendingPickReview(db, userId) {
  const [rows] = await db.execute(
    `SELECT orden_produccion_id AS order_id, huella, seleccion_pendiente AS choice_json
       FROM produccion_alistamiento_revisiones
      WHERE usuario_id = ? AND expira_en > NOW() LIMIT 1`, [userId]
  );
  return rows[0] ? { ...rows[0], choice: parsePendingChoice(rows[0].choice_json) } : null;
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

function pickSummary(order, rows, note = '', { choicePending = false } = {}) {
  const lines = [
    `🏭 *Revisa el alistamiento de OP ID ${order.id} | ${order.codigo_orden}*`,
    `Producto terminado: ${order.producto_nombre} (${order.producto_sku}).`,
    '', '*Materiales reservados*',
    ...rows.flatMap((row, index) => [
      `${index + 1}. *${row.producto}* (${row.sku}): ${roundQty(row.cantidad_reservada)} ${row.unidad || 'und'}`,
      `   Lote: ${row.lote} | ubicación: ${row.ubicacion || 'sin ubicación'}`,
    ]),
    '', note || 'Verifica físicamente cada partida antes de iniciar la producción.',
    '', 'Para corregir, puedes decir el producto o SKU si identifica una sola partida: «el tarro va para la A10» o «cambiar lote de las etiquetas». También puedes decir «partida 1 va para la A10».',
    'Si el mismo producto tiene varias partidas, indica su número o el lote y ubicación actuales para distinguirla.',
    'Para dividir una partida, di «corrección: reparte partida 1: 4 en A10 y 3 en A11». Indica el lote nuevo en cada parte si cambia.',
    choicePending
      ? 'Primero elige una de las opciones de lote mostradas arriba; todavía no confirmes los materiales.'
      : `Si *todo el resumen* está correcto, responde exactamente: *Confirmo materiales OP ID ${order.id}*.`,
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
  // Una transcripción puede conservar solo «A10 y no de la A14».
  // La segunda ubicación es la anterior; la primera es la corrección.
  const reversed = /\b([a-z]{1,5}\d{1,3})\s+y\s+no\s+(?:de\s+)?(?:la\s+)?([a-z]{1,5}\d{1,3})\b/u.exec(raw);
  if (reversed) return [reversed[2].toUpperCase(), reversed[1].toUpperCase()];
  const direct = [...raw.matchAll(/\b(?:ubicacion\s*(?:(?:correcta|nueva|es)\s*)?[:\-]?\s*|(?:en|para|a)\s+(?:la\s+)?(?:ubicacion\s*)?)([a-z][a-z0-9-]*\d[a-z0-9-]*)\b/gu)]
    .map(match => match[1].toUpperCase());
  if (direct.length) return direct;
  const natural = /\bubicacion(?: correcta)?\s+de\s+(?:los?|las?)\s+.+?\s+(?:es|fue|queda)\s+([a-z][a-z0-9-]*\d[a-z0-9-]*)\b/u.exec(raw);
  return natural ? [natural[1].toUpperCase()] : [];
}

function pickLots(text, { splitPart = false } = {}) {
  // «lote de 00006-TRP» nombra el SKU que se quiere corregir, no un lote nuevo.
  // «del lote R5» identifica el origen; tampoco es el lote de destino.
  const raw = normalize(text);
  return [...raw.matchAll(/\blote\s+(?:(?:es|fue|correcto|nuevo)\s+)?([a-z0-9]+(?:-[a-z0-9]+)+|[a-z]*\d+[a-z0-9]*)\b/gu)]
    .filter(match => splitPart || !/\b(?:de|del|desde)(?:\s+el)?\s+$/u.test(raw.slice(0, match.index)))
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
    const lot = pickLots(piece, { splitPart: true }).at(-1) || null;
    if (!amount || !location) throw pickError('Para repartir, indica cantidad y ubicación de cada parte. No cambié las reservas.');
    return { quantity: roundQty(Number(amount[1].replace(',', '.'))), location, lot };
  });
  if (segments.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0)
    || roundQty(segments.reduce((sum, item) => sum + item.quantity, 0)) !== roundQty(oldQuantity)) {
    throw pickError(`Las partes deben sumar ${roundQty(oldQuantity)}. No cambié las reservas.`);
  }
  return segments;
}

function correctionProductReference(text) {
  const raw = normalize(text).replace(/[.!?]+$/u, '').trim();
  const destination = '[a-z][a-z0-9-]*\\d[a-z0-9-]*';
  const field = /\b(?:lote|ubicacion)(?:\s+(?:correcta|nueva))?\s+(?:de|del)\s+(.+)$/u.exec(raw);
  const motion = /^(?:(?:correccion|corrijo|corrige|cambia|cambio|modifica|ajusta)\b\s*[,;:-]?\s*)?(?:(?:el|la|los|las)\s+)?(.+?)\s+(?:no\s+)?(?:estaban?|estan|salen?|va|van|queda|quedan|se\s+sacan)\b/u.exec(raw);
  const sourced = /^(?:(?:correccion|corrijo|corrige|cambia|cambio|modifica|ajusta)\b\s*[,;:-]?\s*)?(?:(?:el|la|los|las)\s+)?(.+?)\s+(?:del|desde\s+el)\s+lote\b/u.exec(raw);
  const direct = new RegExp(`^(?:(?:correccion|corrijo|corrige|cambia|cambio|modifica|ajusta)\\b\\s*[,;:-]?\\s*)?(?:(?:el|la|los|las)\\s+)?(.+?)\\s+(?:a|en|para)\\s+(?:la\\s+)?(?:ubicacion\\s+)?${destination}$`, 'u').exec(raw);
  const command = /^(?:(?:correccion|corrijo)\b\s*[,;:-]?\s*)?(?:(?:quiero|necesito)\s+)?(?:cambia|cambiar|corrige|corregir|modifica|modificar|ajusta|ajustar)\s+(?:(?:el|la|los|las)\s+)?(.+)$/u.exec(raw);
  let reference = field?.[1] || motion?.[1] || sourced?.[1] || direct?.[1] || command?.[1] || null;
  if (!reference) return null;
  reference = reference.replace(new RegExp(`\\s+(?:a|en|para|es|fue)\\s+(?:la\\s+)?(?:ubicacion\\s+)?${destination}$`, 'u'), '')
    .replace(new RegExp(`\\s+(?:desde|de|antes\\s+en)\\s+(?:la\\s+)?(?:ubicacion\\s+)?${destination}$`, 'u'), '')
    .replace(/\s+(?:del|desde\s+el)\s+lote\s+[a-z0-9][a-z0-9._-]*$/u, '')
    .replace(/\s+(?:ubicacion|lote)(?:\s+(?:correcta|nuevo|nueva))?$/u, '')
    .replace(/^(?:(?:de|del)\s+)?(?:el|la|los|las)\s+/u, '')
    .trim();
  return /^(?:va|van|queda|quedan|lote|ubicacion|partida|materiales?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/u.test(reference)
    ? null : reference || null;
}

function uniqueProductAllocation(rows, productId, reference, text) {
  const matching = rows.filter(row => Number(row.producto_id) === Number(productId));
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) {
    const raw = normalize(text);
    const sourceLot = /\b(?:del|desde\s+el)\s+lote\s+([a-z0-9][a-z0-9._-]*)\b/u.exec(raw)?.[1];
    const sourceLocation = /\b(?:desde|antes\s+en|estaba\s+en|estaban\s+en)\s+(?:la\s+)?(?:ubicacion\s+)?([a-z][a-z0-9-]*\d[a-z0-9-]*)\b/u.exec(raw)?.[1];
    const identified = matching.filter(row => (!sourceLot || normalize(row.lote) === sourceLot)
      && (!sourceLocation || normalize(row.ubicacion) === sourceLocation));
    if ((sourceLot || sourceLocation) && identified.length === 1) return identified[0];
    const numbers = matching.map(row => rows.indexOf(row) + 1).join(', ');
    throw pickError(`${reference} tiene ${matching.length} partidas (${numbers}). Indica «partida N» o el lote y ubicación actuales para saber cuál corriges. No cambié las reservas.`);
  }
  return null;
}

async function selectedAllocation(db, rows, text) {
  const index = /\b(?:partida|fila|renglon|numero)\s*#?\s*(\d+)\b/u.exec(normalize(text));
  if (index) {
    const selected = rows[Number(index[1]) - 1];
    if (!selected) throw pickError(`No existe la partida ${index[1]} de esta OP. No cambié las reservas.`);
    return selected;
  }
  const mentionedSkus = [...new Map(rows.filter(row => new RegExp(`(?<![a-z0-9-])${normalize(row.sku).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![a-z0-9-])`, 'u')
    .test(normalize(text))).map(row => [Number(row.producto_id), row])).values()];
  if (mentionedSkus.length > 1) throw pickError('Mencionaste varios SKU. Indica solo el producto o la partida que quieres corregir; no cambié las reservas.');
  if (mentionedSkus.length === 1) {
    return uniqueProductAllocation(rows, mentionedSkus[0].producto_id,
      `${mentionedSkus[0].producto} (${mentionedSkus[0].sku})`, text);
  }
  const productPhrase = correctionProductReference(text);
  if (productPhrase) {
    try {
      const product = await resolveProductReference(db, productPhrase,
        { productIds: [...new Set(rows.map(row => Number(row.producto_id)))],
          allowContextualPartial: true, allowScopedApproximate: true });
      return uniqueProductAllocation(rows, product.id, `${product.nombre} (${product.siigo_code})`, text);
    } catch (error) {
      if (error.code === 'PRODUCT_REFERENCE_AMBIGUOUS') throw pickError(`${error.message} No cambié las reservas.`);
      if (error.code !== 'PRODUCT_REFERENCE_NOT_FOUND') throw error;
      throw pickError(`No identifiqué «${productPhrase}» entre los materiales de esta OP. Indica el SKU o la partida; no cambié las reservas.`);
    }
  }
  const locations = pickLocations(text);
  if (locations.length > 1) {
    const matching = rows.filter(row => row.ubicacion?.toUpperCase() === locations[0]);
    if (matching.length === 1) return matching[0];
    if (matching.length > 1) {
      const numbers = matching.map(row => rows.indexOf(row) + 1).join(' y ');
      throw pickError(`En ${locations[0]} hay varias partidas (${numbers}). Di cuál quieres corregir, por ejemplo «corrección: partida ${rows.indexOf(matching[0]) + 1}, ubicación ${locations.at(-1)}». No cambié las reservas.`);
    }
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
        AND (? IS NULL OR s.id = ?)
        AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
             OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
      ORDER BY s.id FOR UPDATE`,
    [row.producto_id, row.bodega_id, lot, segment.location || null, segment.location || null,
      segment.stockId || null, segment.stockId || null]
  );
  const usable = options.filter(option => option.status === 'DISPONIBLE');
  if (!usable.length) throw pickError(`No hay saldo registrado y disponible de ${row.producto} del lote ${lot}${segment.location ? ` en ${segment.location}` : ''}. No cambié las reservas. Si físicamente está allí, concilia su ubicación en inventario antes de iniciar la OP.`);
  if (usable.length > 1) throw pickError(`El lote ${lot} está en varias ubicaciones. Indica la ubicación de destino; no cambié las reservas.`);
  return usable[0];
}

async function locationLotChoices(db, row, location) {
  const [options] = await db.execute(
    `SELECT s.id, s.lote, s.ubicacion_id, s.cantidad, s.reservada,
            u.codigo AS ubicacion, l.status, COALESCE(l.expiry_date, s.fecha_venc) AS vence
       FROM stock s
       JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
       JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
       JOIN bodegas b ON b.id = s.bodega_id AND b.activa = 1
      WHERE s.producto_id = ? AND s.bodega_id = ?
        AND (? IS NULL OR UPPER(u.codigo) = UPPER(?))
        AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
             OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
      ORDER BY COALESCE(l.expiry_date, s.fecha_venc), s.lote, s.id FOR UPDATE`,
    [row.producto_id, row.bodega_id, location || null, location || null]
  );
  const available = options.filter(option => option.status === 'DISPONIBLE').map(option => ({
    stockId: Number(option.id), lot: option.lote, location: option.ubicacion,
    available: roundQty(Number(option.cantidad) - Number(option.reservada)
      + (Number(option.id) === Number(row.stock_id) ? Number(row.cantidad_reservada) : 0)),
    expiry: option.vence instanceof Date ? option.vence.toISOString().slice(0, 10)
      : (option.vence ? String(option.vence).slice(0, 10) : null),
  })).filter(option => option.available > 0);
  return { eligible: available.filter(option => option.available + 0.0001
    >= Number(row.cantidad_reservada)), partial: available };
}

async function correctAllocation(db, rows, text) {
  const selected = await selectedAllocation(db, rows, text);
  const segments = parseSplit(text, selected.cantidad_reservada);
  const desired = segments || [{ quantity: roundQty(selected.cantidad_reservada),
    location: pickLocations(text).at(-1) || null, lot: pickLots(text).at(-1) || null }];
  const raw = normalize(text);
  const wantsAnotherLot = /\b(?:otro|diferente|distinto)\s+lote\b|\b(?:elegir|escoger|cambia|cambiar|corrige|corregir|modifica|modificar|ajusta|ajustar)\s+(?:(?:de|un|el)\s+)?(?:otro\s+)?lote\b|\blote\s+(?:no\s+es\s+(?:(?:este|ese|el)\s+)?correcto|no\s+es\s+(?:este|ese)|incorrecto|equivocado|esta\s+mal)\b|\b(?:lotes\s+disponibles|cambio\s+(?:de\s+)?lote)\b/u.test(raw);
  const wantsAnotherLocation = /\bubicacion\b/u.test(raw)
    && !desired[0].location && !desired[0].lot;
  if (!segments && !desired[0].location && !desired[0].lot && !wantsAnotherLot && !wantsAnotherLocation) {
    throw pickError('Indica el dato nuevo de la partida: ubicación o lote. No cambié las reservas.');
  }
  if (!segments && wantsAnotherLocation && wantsAnotherLot) {
    throw pickError('Mencionaste lote y ubicación sin indicar ninguno de los dos datos nuevos. Pide primero cambiar la ubicación o el lote de esa partida; no cambié las reservas.');
  }
  if (!segments && wantsAnotherLocation && !wantsAnotherLot) {
    const found = await locationLotChoices(db, selected, null);
    const byLocation = new Map();
    for (const option of found.eligible) {
      if (option.location === selected.ubicacion) continue;
      const current = byLocation.get(option.location) || {
        location: option.location, lots: [], available: 0,
      };
      if (!current.lots.includes(option.lot)) current.lots.push(option.lot);
      current.available = Math.max(current.available, option.available);
      byLocation.set(option.location, current);
    }
    const options = [...byLocation.values()].map(({ location, lots, available }) => ({
      location, lotCount: lots.length, available,
    })).sort((a, b) => a.location.localeCompare(b.location, 'es', { numeric: true }));
    if (!options.length) throw pickError(`No hay otra ubicación registrada con un lote disponible de ${selected.producto} que cubra ${roundQty(selected.cantidad_reservada)} ${selected.unidad || 'und'}. No cambié las reservas.`);
    return { selected, choice: { kind: 'location', allocationId: selected.id,
      options, expiresAt: Date.now() + 15 * 60 * 1000 } };
  }
  if (!segments && !desired[0].lot && (wantsAnotherLot
    || (desired[0].location && desired[0].location !== selected.ubicacion?.toUpperCase()))) {
    const targetLocation = desired[0].location || selected.ubicacion?.toUpperCase();
    if (!targetLocation) throw pickError('La partida no tiene ubicación registrada. Indica la nueva ubicación; no cambié las reservas.');
    const found = await locationLotChoices(db, selected, targetLocation);
    const options = wantsAnotherLot
      ? found.eligible.filter(option => option.stockId !== Number(selected.stock_id))
      : found.eligible;
    if (!options.length) {
      const highest = Math.max(0, ...found.partial.map(option => option.available));
      throw pickError(`No hay ${wantsAnotherLot ? 'otro ' : 'un '}lote disponible de ${selected.producto} en ${targetLocation} con saldo suficiente para ${roundQty(selected.cantidad_reservada)} ${selected.unidad || 'und'}${highest ? `; el mayor saldo por lote es ${highest}` : ''}. No cambié las reservas. Si hay saldos parciales, divide la partida o concilia inventario.`);
    }
    return { selected, choice: { kind: 'lot', allocationId: selected.id, location: targetLocation,
      options, expiresAt: Date.now() + 15 * 60 * 1000 } };
  }
  return applyAllocation(db, selected, desired);
}

async function applyAllocation(db, selected, desired) {
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
  const notifiedId = !explicitId && (isPickCorrection(rawText) || isPickReviewIntent(rawText))
    ? await recentPickNotificationReference(db, from) : null;
  if (!explicitId && active && notifiedId && Number(active.order_id) !== notifiedId) {
    return { message: `Hay un alistamiento revisado de OP ID ${active.order_id} y un aviso de OP ID ${notifiedId}. Indica cuál vas a corregir, por ejemplo «Revisa materiales OP ID ${notifiedId}». No se cambiaron reservas ni se inició producción.` };
  }
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
    const reviewedFingerprint = allocationFingerprint(rows);
    const activeChoice = active?.choice && Number(active.order_id) === Number(order.id)
      && active.huella === reviewedFingerprint
      && Number(active.choice.expiresAt) > Date.now() ? active.choice : null;
    if (confirmationRequested && active && !active.choice) {
      if (Number(active.order_id) !== Number(order.id)
        || active.huella !== reviewedFingerprint) {
        throw pickError('El resumen de materiales cambió o no fue revisado. Pide «Revisa materiales OP ID ' + order.id + '» antes de confirmar; no se inició producción.');
      }
      await db.commit();
      return { orderId: order.id, confirm: true };
    }
    let note = confirmationRequested
      ? 'Antes de confirmar, revisa físicamente todas las partidas de este resumen. No se inició producción.' : '';
    let pendingChoice = null;
    let correction = null;
    const selectedOption = pickOptionNumber(rawText);
    if (selectedOption !== null) {
      if (!activeChoice) {
        note = 'No hay una selección vigente. Di «corrección: partida N, cambiar ubicación» o «corrección: partida N, cambiar lote» para ver opciones. No se cambiaron reservas.';
      } else if (selectedOption < 1 || selectedOption > activeChoice.options.length) {
        pendingChoice = activeChoice;
        note = `La opción ${selectedOption} no existe.\n${choicePrompt(activeChoice, rows)}`;
      } else {
        const selected = rows.find(row => Number(row.id) === Number(activeChoice.allocationId));
        if (!selected) throw pickError('La partida cambió. Pide de nuevo el resumen; no se cambiaron reservas.');
        const option = activeChoice.options[selectedOption - 1];
        if (activeChoice.kind === 'location') {
          const found = await locationLotChoices(db, selected, option.location);
          if (!found.eligible.length) throw pickError(`Ya no hay saldo suficiente en ${option.location} para esta partida. No se cambiaron reservas; pide de nuevo las ubicaciones disponibles.`);
          if (found.eligible.length > 1) {
            pendingChoice = { kind: 'lot', allocationId: selected.id, location: option.location,
              options: found.eligible, expiresAt: Date.now() + 15 * 60 * 1000 };
            note = choicePrompt(pendingChoice, rows);
          } else {
            const lot = found.eligible[0];
            correction = await applyAllocation(db, selected, [{ quantity: roundQty(selected.cantidad_reservada),
              location: option.location, lot: lot.lot, stockId: lot.stockId }]);
          }
        } else {
          correction = await applyAllocation(db, selected, [{ quantity: roundQty(selected.cantidad_reservada),
            location: activeChoice.location, lot: option.lot, stockId: option.stockId }]);
        }
      }
    } else if (isPickCorrection(rawText)) {
      correction = await correctAllocation(db, rows, rawText);
      if (correction.choice) {
        pendingChoice = correction.choice;
        note = choicePrompt(pendingChoice, rows);
      }
    } else if (activeChoice) {
      pendingChoice = activeChoice;
      note = `Falta elegir ${activeChoice.kind === 'location' ? 'la ubicación' : 'el lote'} antes de confirmar.\n${choicePrompt(activeChoice, rows)}`;
    } else if (active?.choice) {
      note = 'La elección venció o cambió el resumen. Di de nuevo qué quieres corregir en la partida; no se inició producción.';
    } else if (!isPickReviewIntent(rawText)) {
      note = 'No interpreté tu mensaje como confirmación. No se consumieron materiales. Si querías corregir, empieza con «corrección» e indica la partida.';
    }
    if (correction?.resolved) {
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
    }
    const current = await loadAllocations(db, order.id, true);
    await db.execute(
      `INSERT INTO produccion_alistamiento_revisiones
         (usuario_id, orden_produccion_id, huella, seleccion_pendiente, expira_en)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))
       ON DUPLICATE KEY UPDATE orden_produccion_id = VALUES(orden_produccion_id),
         huella = VALUES(huella), seleccion_pendiente = VALUES(seleccion_pendiente),
         expira_en = VALUES(expira_en), actualizado_en = NOW()`,
      [userId, order.id, allocationFingerprint(current),
        pendingChoice ? JSON.stringify(pendingChoice) : null]
    );
    await db.commit();
    return { message: pendingChoice
      ? `🏭 OP ID ${order.id} | ${order.codigo_orden} - corrección de alistamiento\n\n${note}`
      : pickSummary(order, current, note), orderId: order.id };
  } catch (error) {
    await db.rollback().catch(() => {});
    if (error.status === 409 && (isPickCorrection(rawText) || pickOptionNumber(rawText) !== null)
      && originalReview) {
      return { message: `⚠️ ${error.message}\n\n${pickSummary(originalReview.order,
        originalReview.rows, 'No se cambiaron las reservas. Corrige la partida indicada y vuelve a revisar el resumen.')}` };
    }
    throw error;
  }
}

module.exports = { advanceProductionPick, allocationFingerprint, explicitPickConfirmation,
  isPickCorrection, isPickReviewIntent, pickOptionNumber, loadAllocations, pendingPickReview,
  pickLocations, pickLots, pickSummary, recentPickNotificationReference };
