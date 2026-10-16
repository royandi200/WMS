const { resolveProductReference } = require('./product-references');
const { allocatePackaging } = require('./dispatch-packaging');

const NUMBER_WORDS = { cero: 0, un: 1, una: 1, uno: 1, dos: 2, tres: 3,
  cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUMBER = '(\\d+|cero|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

function number(value) {
  const raw = normalize(value);
  return Object.hasOwn(NUMBER_WORDS, raw) ? NUMBER_WORDS[raw] : /^\d+$/u.test(raw) ? Number(raw) : null;
}

function guideError(message) { return Object.assign(new Error(message), { status: 409 }); }

async function pendingDispatchPackagingDraft(db, userId) {
  let rows;
  try {
    [rows] = await db.execute(
      `SELECT tipo, referencia_id, payload_json FROM despacho_embalaje_borradores
        WHERE usuario_id = ? AND expira_en > NOW() LIMIT 1`, [userId]
    );
  } catch (error) {
    // Al desplegar sobre una base aún sin migrar, las demás acciones del agente
    // siguen funcionando. La confirmación de despacho permanece cerrada.
    if (error.code === 'ER_NO_SUCH_TABLE') return null;
    throw error;
  }
  if (!rows.length) return null;
  const value = rows[0].payload_json;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function saveDraft(db, userId, draft) {
  await db.execute(
    `INSERT INTO despacho_embalaje_borradores
       (usuario_id, tipo, referencia_id, payload_json, expira_en)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 4 HOUR))
     ON DUPLICATE KEY UPDATE tipo = VALUES(tipo), referencia_id = VALUES(referencia_id),
       payload_json = VALUES(payload_json), expira_en = VALUES(expira_en)`,
    [userId, draft.type, draft.referenceId, JSON.stringify(draft)]
  );
}

async function clearDispatchPackagingDraft(db, userId) {
  await db.execute('DELETE FROM despacho_embalaje_borradores WHERE usuario_id = ?', [userId]);
}

async function catalog(db, kind) {
  const [rows] = await db.execute(
    `SELECT p.id, p.siigo_code AS sku, p.nombre AS name, c.clase AS class
       FROM despacho_embalaje_catalogo c
       JOIN productos p ON p.id = c.producto_id
      WHERE c.clase = ? AND c.activo = 1 AND p.activo = 1 AND p.control_stock = 1
      ORDER BY p.siigo_code`, [kind]
  );
  return rows;
}

function dispatchReference(text, params = {}) {
  const match = String(text || '').match(/\b(?:DSP\s+)?ID\s+(3Q-)?(\d+)\b/iu);
  const raw = String(params.despacho_id || params.id_despacho || '').trim();
  const fromParams = raw.match(/^(?:3Q-)?(\d+)$/iu);
  if (match && fromParams && (Number(match[2]) !== Number(fromParams[1])
    || (!match[1] && /^3Q-/iu.test(raw)))) {
    throw guideError('El ID de despacho interpretado no coincide con el mensaje. No se modificó inventario.');
  }
  const id = Number(match?.[2] || fromParams?.[1] || 0);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const type = match?.[1] || /^3Q-/iu.test(raw) ? 'MAQUILA_3Q' : 'SIIGO';
  return { type, referenceId: id };
}

async function assertPendingDispatch(db, reference) {
  if (reference.type === 'MAQUILA_3Q') {
    const [rows] = await db.execute('SELECT id, estado FROM maquila_envios WHERE id = ? LIMIT 1', [reference.referenceId]);
    if (!rows.length) throw guideError('La salida 3Q no existe.');
    if (rows[0].estado === 'CONFIRMADO') return 'CONFIRMADO';
    if (rows[0].estado !== 'BORRADOR') throw guideError('La salida 3Q no está pendiente de confirmar.');
  } else {
    const [rows] = await db.execute('SELECT id, estado FROM despachos WHERE id = ? LIMIT 1', [reference.referenceId]);
    if (!rows.length) throw guideError('El despacho Siigo no existe.');
    if (rows[0].estado === 'despachado') return 'CONFIRMADO';
    if (rows[0].estado !== 'picking') throw guideError('El despacho Siigo no está en picking.');
  }
  return 'PENDIENTE';
}

function declarationParts(text) {
  return String(text || '').split(/\s*[,;\n]\s*|\s+y\s+(?=(?:\d+|cero|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:cajas?|tapas?))/iu)
    .map(part => part.trim()).filter(Boolean);
}

function parseDeclarations(text) {
  const result = { boxes: [], lids: null, noBoxes: false, pendingBox: null };
  const raw = normalize(text);
  if (/\b(?:no\s+(?:use|usamos|utilice|consumi)|sin|cero|0)\s+(?:ninguna?\s+)?cajas?\b/u.test(raw)) result.noBoxes = true;
  if (/\b(?:no\s+(?:use|usamos|utilice|consumi)|sin|cero|0)\s+(?:ninguna?\s+)?tapas?\b/u.test(raw)) result.lids = 0;
  for (const part of declarationParts(text)) {
    const normalized = normalize(part);
    const match = new RegExp(`\\b${NUMBER}\\s*(?:und|unidades?)?\\s*(?:de\\s+)?(cajas?|tapas?)\\b(.*)$`, 'u').exec(normalized);
    if (!match) continue;
    const quantity = number(match[1]);
    if (quantity == null || !Number.isSafeInteger(quantity)) continue;
    if (/^tapa/u.test(match[2])) result.lids = quantity;
    else if (quantity === 0) result.noBoxes = true;
    else {
      const term = match[3].replace(/^(?:de|del|las?|el)\s+/u, '').trim();
      result.boxes.push({ quantity, term });
    }
  }
  return result;
}

function boxOptions(boxes) {
  return ['Indica cuál caja usaste; puedes responder con el SKU o «opción N»:',
    ...boxes.map((box, i) => `${i + 1}. ${box.name} (${box.sku})`)].join('\n');
}

async function resolveBox(db, boxes, term) {
  if (!term) return null;
  try {
    const product = await resolveProductReference(db, term, {
      productIds: boxes.map(row => row.id), allowContextualPartial: true,
      allowScopedApproximate: true,
    });
    return boxes.find(row => Number(row.id) === Number(product.id)) || null;
  } catch (error) {
    if (['PRODUCT_REFERENCE_NOT_FOUND', 'PRODUCT_REFERENCE_AMBIGUOUS'].includes(error.code)) return null;
    throw error;
  }
}

async function preview(db, draft) {
  const lids = await catalog(db, 'TAPA_CAJA_MASTER');
  if (draft.lidsQuantity > 0 && lids.length !== 1) {
    throw guideError('La tapa de caja máster 00283-TPDCJM aún no está activa en el catálogo. No se confirmó el despacho.');
  }
  const declarations = [...draft.boxes.map(box => ({ ...box, class: 'CAJA' })),
    ...(draft.lidsQuantity > 0 ? [{ productId: Number(lids[0].id),
      sku: lids[0].sku, name: lids[0].name, class: 'TAPA_CAJA_MASTER',
      quantity: draft.lidsQuantity }] : [])];
  draft.lines = await allocatePackaging(db, declarations);
  draft.reviewShown = true;
  const ref = draft.type === 'MAQUILA_3Q' ? `3Q-${draft.referenceId}` : `${draft.referenceId}`;
  const masterBoxes = draft.boxes.filter(box => /\bCAJA MASTER\b/iu.test(box.name))
    .reduce((sum, box) => sum + box.quantity, 0);
  return [
    `📦 *Revisa el embalaje del despacho ID ${ref}*`,
    '', '*Cajas declaradas*',
    ...(draft.boxes.length ? draft.boxes.map(box => `• ${box.name} (${box.sku}): ${box.quantity} und`) : ['• 0 cajas']),
    `*Tapas de caja máster*: ${draft.lidsQuantity} und`,
    '', '*Lotes y ubicaciones previstos para consumo*',
    ...(draft.lines.length ? draft.lines.map(line => `• ${line.sku}: ${line.quantity} und | lote ${line.lot} | ${line.location}`) : ['• Ninguno']),
    ...(masterBoxes !== draft.lidsQuantity
      ? ['', `⚠️ Declaraste ${masterBoxes} caja(s) máster y ${draft.lidsQuantity} tapa(s) de caja máster. Verifica si es correcto; no ajusté ninguna cantidad automáticamente.`]
      : []),
    '', 'Verifica físicamente las partidas. Puedes corregir las cantidades o el tipo de caja antes de confirmar.',
    'No calculé cajas ni tapas a partir de las unidades despachadas.',
    `Si todo coincide, responde *confirmo despacho ID ${ref}*. Hasta entonces no se modifica inventario.`,
  ].join('\n');
}

async function advanceDispatchPackaging({ db, userId, rawText, params = {} }) {
  const text = String(rawText || '').trim();
  let draft = await pendingDispatchPackagingDraft(db, userId);
  // Una respuesta de cantidad no debe cambiar de despacho por un ID heredado
  // o inventado en los parámetros del clasificador.
  let reference = dispatchReference(text, draft ? {} : params);
  if (!reference && !draft) {
    const invoice = String(params.siigo_invoice_id || params.id_factura || '').trim();
    const dispatchNumber = String(params.despacho_id || params.id_despacho || '').trim();
    if (invoice || dispatchNumber) {
      const [rows] = await db.execute(
        `SELECT id FROM despachos
          WHERE (? <> '' AND (siigo_invoice_id = ? OR siigo_invoice_name = ?))
             OR (? <> '' AND numero = ?) LIMIT 2`,
        [invoice, invoice, invoice, dispatchNumber, dispatchNumber]
      );
      if (rows.length === 1) reference = { type: 'SIIGO', referenceId: Number(rows[0].id) };
    }
  }
  if (draft && reference && (draft.type !== reference.type || draft.referenceId !== reference.referenceId)) {
    throw guideError('Ese ID no coincide con el despacho cuyo embalaje está en curso. Descarta el borrador de embalaje si deseas iniciar otro; no se modificó inventario.');
  }
  if (reference && !draft) {
    const state = await assertPendingDispatch(db, reference);
    if (state === 'CONFIRMADO') {
      return { message: `El despacho ID ${reference.type === 'MAQUILA_3Q' ? `3Q-${reference.referenceId}` : reference.referenceId} ya estaba confirmado. No se modificó inventario.` };
    }
    draft = { ...reference, boxes: [], boxesDeclared: false, lidsDeclared: false,
      lidsQuantity: null, pendingBoxQty: null, lines: [], reviewShown: false,
      expectedQuantity: params.expectedQuantity ?? null };
  }
  if (!draft) throw guideError('Indica el ID del despacho pendiente. No se modificó inventario.');
  if (/^(?:cancela|descarta|anula)\s+(?:este\s+)?(?:borrador|embalaje)/iu.test(text)) {
    await clearDispatchPackagingDraft(db, userId);
    return { message: 'Descarté el borrador del embalaje. El despacho sigue pendiente y no se modificó inventario.' };
  }
  const ref = draft.type === 'MAQUILA_3Q' ? `3Q-${draft.referenceId}` : `${draft.referenceId}`;
  const confirmation = new RegExp(`^confirmo\\s+(?:el\\s+)?despacho\\s+(?:ID\\s+)?${ref}$`, 'iu').test(text);
  if (confirmation && draft.reviewShown && draft.boxesDeclared && draft.lidsDeclared) {
    return { type: draft.type, referenceId: draft.referenceId,
      expectedQuantity: draft.expectedQuantity,
      packaging: { boxesDeclared: true, lidsDeclared: true, lines: draft.lines } };
  }
  const boxes = await catalog(db, 'CAJA');
  if (draft.pendingBoxQty != null && /^(?:opci[oó]n\s+)?\d+$/iu.test(text)) {
    const index = Number(text.match(/\d+/u)?.[0]) - 1;
    if (!boxes[index]) return { message: boxOptions(boxes), draft };
    draft.boxes.push({ productId: Number(boxes[index].id), sku: boxes[index].sku,
      name: boxes[index].name, quantity: draft.pendingBoxQty });
    draft.boxesDeclared = true;
    draft.pendingBoxQty = null;
    draft.reviewShown = false;
  } else {
    const parsed = parseDeclarations(text);
    if (parsed.noBoxes) { draft.boxes = []; draft.boxesDeclared = true; draft.pendingBoxQty = null; }
    if (parsed.lids != null) {
      draft.lidsQuantity = parsed.lids;
      draft.lidsDeclared = true;
    }
    for (const declared of parsed.boxes) {
      const box = !declared.term && draft.boxes.length === 1
        ? boxes.find(row => row.sku === draft.boxes[0].sku)
        : await resolveBox(db, boxes, declared.term);
      if (!box) {
        draft.pendingBoxQty = declared.quantity;
        await saveDraft(db, userId, draft);
        return { message: boxOptions(boxes), draft };
      }
      const index = draft.boxes.findIndex(line => line.sku === box.sku);
      const item = { productId: Number(box.id), sku: box.sku,
        name: box.name, quantity: declared.quantity };
      if (index >= 0) draft.boxes[index] = item;
      else draft.boxes.push(item);
      draft.boxesDeclared = true;
      draft.reviewShown = false;
    }
    if (parsed.noBoxes || parsed.lids != null) draft.reviewShown = false;
  }
  if (!draft.boxesDeclared) {
    await saveDraft(db, userId, draft);
    return { message: `📦 Para el despacho ID ${ref}, indica cuántas cajas usaste y de qué SKU o tipo. Si no usaste ninguna, di «0 cajas». La capacidad nominal de la caja no determina la cantidad consumida.\n${boxOptions(boxes)}\nNo se modificó inventario.`, draft };
  }
  if (!draft.lidsDeclared) {
    await saveDraft(db, userId, draft);
    return { message: `📦 Cajas registradas para despacho ID ${ref}. ¿Cuántas tapas de caja máster (00283-TPDCJM) usaste? Indica la cantidad real, incluso si es 0. No se modificó inventario.`, draft };
  }
  try {
    const message = await preview(db, draft);
    await saveDraft(db, userId, draft);
    return { message, draft };
  } catch (error) {
    draft.reviewShown = false;
    await saveDraft(db, userId, draft);
    return { message: `${error.message}\nPuedes corregir la cantidad o el SKU; el despacho sigue pendiente.`, draft };
  }
}

module.exports = { advanceDispatchPackaging, pendingDispatchPackagingDraft,
  clearDispatchPackagingDraft, parseDeclarations };
