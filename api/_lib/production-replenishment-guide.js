const { createConnection } = require('./db');
const { resolveProductReference } = require('./product-references');
const { buildReplenishmentRequirements, prepareProductionReplenishment } = require('./production-replenishment');
const { reconcileProductionOrderId, referenceKey } = require('./production-order-reference');

function guideError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function positiveQuantity(value, unit) {
  const quantity = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999999
    || Math.round(quantity * 10000) / 10000 !== quantity) {
    throw guideError('Indica una cantidad positiva de hasta cuatro decimales');
  }
  if (!['g', 'gr', 'gramo', 'gramos'].includes(String(unit || '').toLowerCase())
    && !Number.isInteger(quantity)) {
    throw guideError(`Este SKU se repone en unidades enteras (${unit || 'und'})`);
  }
  return quantity;
}

function cleanAdvance(params = {}) {
  const advance = params.avance || params;
  if (!advance || typeof advance !== 'object' || Array.isArray(advance)) {
    throw guideError('El avance debe ser un objeto');
  }
  const list = advance.items || (advance.producto || advance.sku || advance.id_item
    ? [{ producto: advance.producto || advance.sku || advance.id_item, cantidad: advance.cantidad }]
    : []);
  if (!Array.isArray(list) || list.length > 30) {
    throw guideError('Indica como máximo treinta SKU por mensaje');
  }
  return {
    items: list,
    quantity: advance.cantidad,
    reason: advance.motivo,
    remove: advance.eliminar,
    allUnits: advance.unidades_bom_completo,
  };
}

function confirmedByUser(text, orderId) {
  const raw = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (!/\bCONFIRM(?:O|AR|A)\b/u.test(raw) || !/\b(?:PREPARAR|PREPARACION|REPOSICION)\b/u.test(raw)) {
    return false;
  }
  return referenceKey(reconcileProductionOrderId({}, text)) === Number(orderId);
}

function draftFromRow(row) {
  if (!row) return null;
  try {
    const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
    if (payload?.version !== 1 || !payload.entries || typeof payload.entries !== 'object'
      || Array.isArray(payload.entries)) throw new Error('bad draft');
    return payload;
  } catch {
    throw guideError('El borrador de reposición no es válido; vuelve a iniciarlo', 409);
  }
}

function formatQuantity(quantity) {
  return Number(quantity).toLocaleString('es-CO', { maximumFractionDigits: 4 });
}

function guideSummary(order, materials, draft, { introductory = false } = {}) {
  const byId = new Map(materials.map(material => [Number(material.producto_id), material]));
  const entries = Object.values(draft.entries).map(entry => ({
    ...entry, material: byId.get(Number(entry.productId)),
  })).filter(entry => entry.material);
  const unitTotals = new Map();
  for (const entry of entries) {
    const unit = entry.material.unidad || 'und';
    unitTotals.set(unit, (unitTotals.get(unit) || 0) + entry.quantity);
  }
  const lines = [
    '*Reposición en borrador*',
    '',
    `Orden: *OP ID ${order.id}* | ${order.codigo_orden}`,
    `Producto final: ${order.producto_nombre}`,
    '',
  ];
  if (introductory && !entries.length) {
    lines.push('*Materiales de esta OP*');
    lines.push(...materials.flatMap((material, index) => [
      `${index + 1}. *${material.sku}* — ${material.nombre}`,
      `   Unidad: ${material.unidad || 'und'}`,
    ]));
    lines.push('', 'Dime qué material repondremos y cuánto. Puedes usar un alias como «tapas», enviar varios materiales juntos o responder por partes.');
  } else {
    lines.push('*Cantidades a reponer*');
    lines.push(...(entries.length ? entries.flatMap((entry, index) => [
      `${index + 1}. *${entry.material.sku}* — ${entry.material.nombre}`,
      `   Cantidad: ${formatQuantity(entry.quantity)} ${entry.material.unidad || 'und'}`,
    ]) : ['Aún no hay materiales registrados.']));
    lines.push('', `Total: ${entries.length} SKU${unitTotals.size ? ` | ${[...unitTotals].map(([unit, qty]) => `${formatQuantity(qty)} ${unit}`).join(' + ')}` : ''}`);
  }
  lines.push(`Motivo: ${draft.reason || 'pendiente'}`);
  if (draft.selectedProductId) {
    const selected = byId.get(Number(draft.selectedProductId));
    if (selected) lines.push(`Falta la cantidad de *${selected.sku}* en ${selected.unidad || 'und'}.`);
  }
  if (draft.selectedProductId) {
    lines.push('', 'Puedes responder solo la cantidad; conservaré el material y la OP de este borrador.');
  } else if (entries.length && !draft.reason) {
    lines.push('', 'Falta el motivo de la reposición. Por ejemplo: «ruptura de una tapa». Conservaré las cantidades ya registradas.');
  } else if (entries.length && draft.reason) {
    lines.push('', 'Si todo está correcto, responde: *Confirmo preparar la reposición de OP ID '
      + `${order.id}*. También puedes corregir o agregar otro SKU.`);
  } else if (!introductory && !draft.selectedProductId) {
    lines.push('', 'Indica los SKU y cantidades que faltan; puedes hacerlo en uno o varios mensajes.');
  }
  lines.push('', 'Este borrador no reserva ni descuenta inventario.');
  return lines.join('\n');
}

async function loadOrderAndMaterials(conn, reference) {
  const [orders] = await conn.execute(
    `SELECT op.id, op.codigo_orden, op.estado, op.cantidad_planeada,
            p.nombre AS producto_nombre
       FROM ordenes_produccion op JOIN productos p ON p.id = op.producto_id
      WHERE op.id = ? OR op.codigo_orden = ? LIMIT 1`,
    [reference, reference]
  );
  if (!orders.length) throw guideError('OP no encontrada', 404);
  if (orders[0].estado !== 'EN_PROCESO') throw guideError('La OP debe estar EN_PROCESO', 409);
  const [materials] = await conn.execute(
    `SELECT pm.id, pm.producto_id, pm.cantidad_teorica, pm.unidad,
            p.siigo_code AS sku, p.nombre
       FROM produccion_materiales pm JOIN productos p ON p.id = pm.producto_id
      WHERE pm.orden_produccion_id = ? ORDER BY pm.id`,
    [orders[0].id]
  );
  if (!materials.length) throw guideError('La OP no tiene materiales de BOM', 409);
  return { order: orders[0], materials };
}

async function recentWasteOrderContext(conn, from) {
  if (!from) return null;
  const [rows] = await conn.execute(
    `SELECT DISTINCT m.orden_produccion_id AS order_id
       FROM notificaciones_salida n
       JOIN mermas m ON n.evento = CONCAT('production_waste:', m.numero)
      WHERE n.destinatario = ? AND n.estado = 'ENVIADA'
        AND n.creado_en >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY order_id DESC LIMIT 20`, [from]
  );
  return rows.length === 1 ? Number(rows[0].order_id) : null;
}

async function applyAdvance(conn, draft, materials, advance) {
  const productIds = materials.map(material => Number(material.producto_id));
  const byId = new Map(materials.map(material => [Number(material.producto_id), material]));
  if (advance.reason !== undefined) {
    const reason = String(advance.reason || '').trim();
    if (!reason || reason.length > 500) throw guideError('Indica un motivo de hasta 500 caracteres');
    draft.reason = reason;
  }
  if (advance.allUnits !== undefined) {
    if (advance.items.length || advance.remove || Object.keys(draft.entries).length) {
      throw guideError('Para reponer todo el BOM no mezcles cantidades de SKU individuales');
    }
    const units = positiveQuantity(advance.allUnits, 'und');
    const order = draft.order;
    const requirements = buildReplenishmentRequirements(materials, order.cantidad_planeada, units);
    for (const item of requirements) {
      draft.entries[item.material.producto_id] = {
        productId: Number(item.material.producto_id), quantity: item.required,
      };
    }
    draft.fullBomUnits = units;
  }
  if (advance.remove) {
    const product = await resolveProductReference(conn, advance.remove, {
      productIds, allowContextualPartial: true, allowScopedApproximate: true,
    });
    delete draft.entries[product.id];
    draft.fullBomUnits = null;
    if (draft.selectedProductId === product.id) draft.selectedProductId = null;
  }
  if (advance.items.length) {
    draft.fullBomUnits = null;
    const seenInMessage = new Set();
    for (const item of advance.items) {
      const term = String(item?.producto ?? item?.sku ?? item?.id_item ?? '').trim();
      if (!term) throw guideError('Indica el producto que quieres reponer');
      const product = await resolveProductReference(conn, term, {
        productIds, allowContextualPartial: true, allowScopedApproximate: true,
      });
      const material = byId.get(Number(product.id));
      if (seenInMessage.has(Number(product.id))) {
        throw guideError(`${material.sku} aparece dos veces en el mensaje. Indica una cantidad total para ese SKU`);
      }
      seenInMessage.add(Number(product.id));
      if (item.cantidad === undefined || item.cantidad === null || item.cantidad === '') {
        if (advance.items.length > 1) throw guideError(`Falta la cantidad de ${material.sku}`);
        draft.selectedProductId = Number(product.id);
        continue;
      }
      draft.entries[product.id] = {
        productId: Number(product.id), quantity: positiveQuantity(item.cantidad, material.unidad),
      };
      draft.selectedProductId = null;
    }
  } else if (advance.quantity !== undefined && draft.selectedProductId) {
    const material = byId.get(Number(draft.selectedProductId));
    draft.entries[material.producto_id] = {
      productId: Number(material.producto_id),
      quantity: positiveQuantity(advance.quantity, material.unidad),
    };
    draft.selectedProductId = null;
  } else if (advance.quantity !== undefined) {
    throw guideError('Indica a qué SKU de esta OP corresponde la cantidad');
  }
  return draft;
}

async function guideProductionReplenishment({ userId, orderId, from, params = {}, rawText = '', confirm = false }) {
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT * FROM produccion_reposicion_borradores WHERE usuario_id = ? LIMIT 1 FOR UPDATE`,
      [userId]
    );
    const row = rows[0] || null;
    const active = row?.estado === 'PENDIENTE' && new Date(row.expira_en) > new Date();
    const reference = orderId || ((active || (confirm && row?.estado === 'CONFIRMADO'))
      ? row.orden_produccion_id : null) || await recentWasteOrderContext(conn, from);
    if (!reference) throw guideError('¿De cuál *OP ID* repondremos material? Por ejemplo: *OP ID 98*. Si recibiste varios avisos, elige uno; aún no se reservó inventario.');
    if (confirm && row?.estado === 'CONFIRMADO'
      && referenceKey(reference) === Number(row.orden_produccion_id) && row.reposicion_id
      && confirmedByUser(rawText, row.orden_produccion_id)) {
      await conn.commit();
      return { confirmed: true, replenishment: {
        already_prepared: true, order_id: Number(row.orden_produccion_id),
        replenishment_id: Number(row.reposicion_id), picking: [],
      } };
    }
    const { order, materials } = await loadOrderAndMaterials(conn, reference);
    if (active && Number(row.orden_produccion_id) !== Number(order.id)) {
      throw guideError(`Ya tienes un borrador de reposición para OP ID ${row.orden_produccion_id}. Termínalo antes de iniciar otro`, 409);
    }
    let draft = active ? draftFromRow(row) : {
      version: 1, orderId: order.id, reason: null, entries: {},
      selectedProductId: null, fullBomUnits: null,
    };
    draft.order = { cantidad_planeada: Number(order.cantidad_planeada) };
    if (confirm) {
      if (!active) throw guideError('No hay una reposición guiada pendiente para confirmar', 409);
      if (!confirmedByUser(rawText, order.id)) {
        throw guideError(`Para reservar, responde: Confirmo preparar la reposición de OP ID ${order.id}`, 409);
      }
      const entries = Object.values(draft.entries);
      if (!entries.length || !draft.reason || draft.selectedProductId) {
        throw guideError('Completa producto, cantidad y motivo antes de confirmar', 409);
      }
      const input = draft.fullBomUnits
        ? { quantity: draft.fullBomUnits, fullBomConfirmed: true }
        : { items: entries.map(entry => ({
          producto: materials.find(material => Number(material.producto_id) === entry.productId)?.sku,
          cantidad: entry.quantity,
        })) };
      const replenishment = await prepareProductionReplenishment({
        orderId: order.id, reason: draft.reason, userId, ...input,
      });
      await conn.execute(
        `UPDATE produccion_reposicion_borradores
            SET payload_json = ?, estado = 'CONFIRMADO', reposicion_id = ?, actualizado_en = NOW()
          WHERE usuario_id = ? AND estado = 'PENDIENTE'`,
        [JSON.stringify(draft), replenishment.replenishment_id, userId]
      );
      await conn.commit();
      return { confirmed: true, replenishment };
    }
    const advance = cleanAdvance(params);
    draft = await applyAdvance(conn, draft, materials, advance);
    if (row) {
      await conn.execute(
        `UPDATE produccion_reposicion_borradores
            SET orden_produccion_id = ?, payload_json = ?, estado = 'PENDIENTE',
                reposicion_id = NULL, expira_en = DATE_ADD(NOW(), INTERVAL 24 HOUR),
                actualizado_en = NOW()
          WHERE usuario_id = ?`,
        [order.id, JSON.stringify(draft), userId]
      );
    } else {
      await conn.execute(
        `INSERT INTO produccion_reposicion_borradores
           (usuario_id, orden_produccion_id, payload_json, estado, expira_en)
         VALUES (?, ?, ?, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
        [userId, order.id, JSON.stringify(draft)]
      );
    }
    await conn.commit();
    return { confirmed: false, order_id: order.id,
      message: guideSummary(order, materials, draft, { introductory: !active && !Object.keys(draft.entries).length }) };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = {
  applyAdvance, cleanAdvance, confirmedByUser, guideProductionReplenishment, guideSummary,
  positiveQuantity, recentWasteOrderContext,
};
