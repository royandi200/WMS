// GET/POST /api/v1/reception
const crypto = require('crypto');
const { createConnection, query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES, hasCapability } = require('../_lib/capabilities');
const { pushCompraToSiigo } = require('../_lib/siigo.purchases');
const { normalizeReceptionDistributions } = require('../_lib/reception-distributions');
const { resolvePrimaryWarehouse } = require('../_lib/warehouses');
const { workflowFlags } = require('../_lib/feature-flags');
const { PRODUCT_MODES } = require('../_lib/product-modes');
const { reconcileOutsourcingReception } = require('../_lib/outsourcing-workflow');

const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function getDefaultBodega(conn) {
  return resolvePrimaryWarehouse(conn);
}

async function findProduct(conn, value) {
  const term = String(value || '').trim();
  const [rows] = await conn.execute(
    `SELECT id, siigo_id, siigo_code, nombre
     FROM productos
     WHERE id = ? OR siigo_code = ?
     LIMIT 1`,
    [Number.isFinite(Number(term)) ? Number(term) : 0, term]
  );
  if (!rows.length) throw httpError(404, 'Producto no encontrado');
  return rows[0];
}

function canSyncSiigo(user) {
  return hasCapability(user.rol, CAPABILITIES.SIIGO_SYNC);
}

async function validateSiigoReception(conn, { terceroId, product, price, invoiceNumber }) {
  if (!terceroId) throw httpError(400, 'tercero_id es obligatorio para sincronizar con SIIGO');
  if (!product.siigo_id) throw httpError(400, 'El producto no esta sincronizado con SIIGO');
  if (!Number.isFinite(price) || price <= 0) {
    throw httpError(400, 'precio_unitario debe ser positivo para sincronizar con SIIGO');
  }
  if (!invoiceNumber) throw httpError(400, 'proveedor_invoice_number es obligatorio');

  const [rows] = await conn.execute(
    `SELECT id, siigo_id, identification, nombre, nombre_comercial
     FROM terceros WHERE id = ? LIMIT 1`,
    [terceroId]
  );
  if (!rows.length || !rows[0].siigo_id) {
    throw httpError(400, 'El proveedor no esta sincronizado con SIIGO');
  }

  if (String(process.env.SIIGO_USERNAME || '').toLowerCase() === SHARED_SANDBOX_USERNAME) {
    const prefix = String(process.env.SIIGO_TEST_PREFIX || DEFAULT_TEST_PREFIX).toUpperCase();
    const terceroName = `${rows[0].nombre || ''} ${rows[0].nombre_comercial || ''}`.toUpperCase();
    if (!String(product.siigo_code || '').toUpperCase().startsWith(prefix) || !terceroName.includes(prefix)) {
      throw httpError(400, `En sandbox solo se permiten registros ${prefix}`);
    }
  }

  return rows[0];
}

async function nextReceptionNumber(conn) {
  const [rows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM recepciones WHERE numero LIKE 'REC-DASH-%'`);
  return `REC-DASH-${String((rows[0]?.cnt || 0) + 1).padStart(6, '0')}`;
}

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.RECEPTION_READ);
  const limit = Math.min(Number(req.query?.limit || 100), 200);
  const rows = await query(
    `SELECT
       r.id,
       r.numero,
       r.orden_compra_id,
       oc.numero AS orden_compra_numero,
       (SELECT GROUP_CONCAT(DISTINCT om.codigo ORDER BY om.codigo SEPARATOR ', ')
          FROM maquila_recepciones mr
          JOIN ordenes_maquila om ON om.id = mr.orden_maquila_id
         WHERE mr.recepcion_id = r.id) AS ordenes_maquila,
       r.proveedor_nombre,
       r.estado,
       r.siigo_purchase_id,
       r.siigo_purchase_name,
       r.observaciones,
       r.creado_en,
       r.completado_en,
       (SELECT COUNT(*)
          FROM recepcion_novedades rn
         WHERE rn.recepcion_id = r.id AND rn.estado = 'ABIERTA') AS novedades_abiertas,
       u.nombre AS usuario_nombre,
       ri.id AS recepcion_item_id,
       ri.producto_id,
       p.siigo_code AS sku,
       p.nombre AS producto_nombre,
       p.modalidad_operativa,
       ri.lote,
       ri.fecha_venc,
       ri.cantidad_esp,
       ri.cantidad_rec
       ,rci.cantidad_oc
       ,rci.cantidad_factura
       ,rci.cantidad_factura_acumulada
       ,rci.cantidad_fisica
       ,rci.cantidad_fisica_acumulada
       ,rci.cantidad_aceptada_acumulada
       ,rci.saldo_oc
       ,rci.diferencia_oc_factura
       ,rci.diferencia_factura_fisica
     FROM recepciones r
     LEFT JOIN recepcion_items ri ON ri.recepcion_id = r.id
     LEFT JOIN productos p ON p.id = ri.producto_id
     LEFT JOIN usuarios u ON u.id = r.usuario_id
     LEFT JOIN ordenes_compra_proveedor oc ON oc.id = r.orden_compra_id
     LEFT JOIN recepcion_conciliacion_items rci
       ON rci.recepcion_id = r.id AND rci.producto_id = ri.producto_id
     ORDER BY COALESCE(r.completado_en, r.creado_en) DESC
     LIMIT ?`,
    [limit]
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

function receivedItemInput(body, item, totalItems) {
  const inputs = Array.isArray(body.items) ? body.items : [];
  const match = inputs.find(input => Number(input.item_id) === Number(item.id))
    || inputs.find(input => Number(input.product_id) === Number(item.producto_id));
  if (match) return match;
  return totalItems === 1 ? body : null;
}

async function processDistributedItem(conn, { item, input, reception, user, receptionId, body, txId }) {
  const normalized = normalizeReceptionDistributions(input);
  if (!normalized) return null;
  const { distributions, totals } = normalized;
  const expected = Number(item.cantidad_esp);
  const shortage = Math.max(expected - totals.received, 0);
  const overage = Math.max(totals.received - expected, 0);
  const locationIds = [...new Set(distributions.map(entry => entry.locationId).filter(Boolean))];
  if (locationIds.length) {
    const placeholders = locationIds.map(() => '?').join(',');
    const [locations] = await conn.execute(
      `SELECT id FROM ubicaciones WHERE bodega_id = ? AND activa = 1 AND id IN (${placeholders})`,
      [reception.bodega_id, ...locationIds]
    );
    if (locations.length !== locationIds.length) throw httpError(400, 'Una ubicacion no pertenece a la bodega de recepcion');
  }

  const groupedLots = new Map();
  for (const entry of distributions) {
    const current = groupedLots.get(entry.lot) || { ...entry, quantity: 0 };
    current.quantity += entry.quantity;
    groupedLots.set(entry.lot, current);
  }
  for (const lot of groupedLots.values()) {
    const [existing] = await conn.execute(`SELECT id FROM lots WHERE lpn = ? LIMIT 1`, [lot.lot]);
    if (existing.length) throw httpError(409, `El lote ${lot.lot} ya existe`);
    const lotId = crypto.randomUUID();
    lot.id = lotId;
    await conn.execute(
      `INSERT INTO lots
         (id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier,
          origin, status, received_by, notes, expiry_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEPCION', ?, ?, ?, ?, NOW())`,
      [lotId, lot.lot, item.producto_id, reception.bodega_id,
       lot.quantity, lot.quantity, reception.proveedor_nombre || null, lot.condition,
       user.id, body.notes || `Recepcion ${reception.numero}`, lot.expiryDate]
    );
  }

  const availableBalances = new Map();
  for (const entry of distributions) {
    await conn.execute(
      `INSERT INTO recepcion_distribuciones
         (recepcion_id, recepcion_item_id, ubicacion_id, lote, fecha_venc,
          condicion, cantidad, motivo, usuario_id, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [receptionId, item.id, entry.locationId, entry.lot, entry.expiryDate,
       entry.condition, entry.quantity, entry.reason, user.id]
    );
    if (entry.condition === 'DISPONIBLE') {
      await conn.execute(
        `INSERT INTO stock
           (producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
        [item.producto_id, reception.bodega_id, entry.locationId, entry.lot,
         entry.expiryDate, entry.quantity]
      );
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_dest, ubicacion_dest, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id, siigo_sync)
         VALUES ('entrada', ?, ?, ?, ?, ?, ?, 'recepcion_siigo_import', ?, 1)`,
        [item.producto_id, reception.bodega_id, entry.locationId, entry.lot,
         entry.quantity, receptionId, user.id]
      );
      const balanceAfter = Number((Number(availableBalances.get(entry.lot) || 0) + entry.quantity).toFixed(4));
      availableBalances.set(entry.lot, balanceAfter);
      await conn.execute(
        `INSERT INTO kardex
           (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
            reference, notes, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'INGRESO_RECEPCION', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), txId, groupedLots.get(entry.lot).id, item.producto_id,
         user.id, entry.quantity, balanceAfter, `recepcion:${reception.numero}`,
         `Condicion ${entry.condition} | Ubicacion ${entry.locationId}`, user.id]
      );
    }
  }

  const reason = String(input.reason || input.motivo || body.reason || body.motivo || '').trim();
  const reasonsFor = conditions => [...new Set(distributions
    .filter(entry => conditions.includes(entry.condition) && entry.reason)
    .map(entry => entry.reason))].join('; ');
  const issues = [
    { type: 'FALTANTE', quantity: shortage, reason },
    { type: 'SOBRANTE', quantity: overage, reason },
    { type: 'CUARENTENA', quantity: totals.CUARENTENA, reason: reasonsFor(['CUARENTENA']) },
    { type: 'RECHAZADO', quantity: totals.RECHAZADO + totals.PENDIENTE_DISPOSICION, reason: reasonsFor(['RECHAZADO', 'PENDIENTE_DISPOSICION']) },
  ].filter(issue => issue.quantity > 0);
  for (const issue of issues) {
    await conn.execute(
      `INSERT INTO recepcion_novedades
         (recepcion_id, recepcion_item_id, tipo, cantidad, motivo, estado, usuario_id, creado_en)
       VALUES (?, ?, ?, ?, ?, 'ABIERTA', ?, NOW())`,
      [receptionId, item.id, issue.type, issue.quantity,
       issue.reason || reason || `${issue.type} detectado durante la recepcion fisica`, user.id]
    );
  }
  const first = distributions[0];
  await conn.execute(
    `UPDATE recepcion_items SET lote = ?, fecha_venc = ?, cantidad_rec = ? WHERE id = ?`,
    [groupedLots.size === 1 ? first.lot : null, groupedLots.size === 1 ? first.expiryDate : null,
     totals.received, item.id]
  );
  return {
    item_id: item.id,
    sku: item.siigo_code,
    esperado: expected,
    recibido: totals.received,
    disponible: totals.DISPONIBLE,
    cuarentena: totals.CUARENTENA,
    rechazado: totals.RECHAZADO + totals.PENDIENTE_DISPOSICION,
    faltante: shortage,
    sobrante: overage,
    distribuciones: distributions,
    novedades: issues.map(issue => ({ tipo: issue.type, cantidad: issue.quantity })),
    hasDifference: issues.length > 0,
  };
}

async function handlePut(req, res) {
  const user = await requireCapability(req, CAPABILITIES.RECEPTION_CONFIRM);
  const body = req.body || {};
  const receptionId = Number(body.reception_id || body.recepcion_id || 0);
  if (!Number.isInteger(receptionId) || receptionId <= 0) {
    throw httpError(400, 'recepcion_id es obligatorio');
  }

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const [receptions] = await conn.execute(
      `SELECT * FROM recepciones WHERE id = ? LIMIT 1 FOR UPDATE`,
      [receptionId]
    );
    if (!receptions.length) throw httpError(404, 'Recepcion no encontrada');
    const reception = receptions[0];
    if (reception.estado === 'completada') {
      await conn.commit();
      return res.status(200).json({
        ok: true,
        data: {
          recepcion_id: receptionId,
          numero: reception.numero,
          estado: reception.estado,
          already_completed: true,
        },
      });
    }
    if (!['borrador', 'en_proceso'].includes(reception.estado)) {
      throw httpError(409, `La recepcion esta ${reception.estado} y no puede completarse`);
    }

    const purchaseOrderId = Number(body.orden_compra_id || body.purchase_order_id || reception.orden_compra_id || 0) || null;
    if (reception.siigo_purchase_id && workflowFlags().requirePurchaseOrderForSiigoReceipt && !purchaseOrderId) {
      throw httpError(400, 'Debes vincular una orden de compra antes de confirmar esta recepcion Siigo');
    }
    let purchaseOrder = null;
    if (purchaseOrderId) {
      const [purchaseOrders] = await conn.execute(
        `SELECT * FROM ordenes_compra_proveedor WHERE id = ? LIMIT 1 FOR UPDATE`,
        [purchaseOrderId]
      );
      if (!purchaseOrders.length) throw httpError(404, 'Orden de compra no encontrada');
      purchaseOrder = purchaseOrders[0];
      if (['CANCELADA', 'CERRADA'].includes(purchaseOrder.estado)) {
        throw httpError(409, `La orden de compra esta ${purchaseOrder.estado}`);
      }
      if (purchaseOrder.tercero_id && reception.tercero_id
          && Number(purchaseOrder.tercero_id) !== Number(reception.tercero_id)) {
        throw httpError(409, 'El proveedor de la OC no coincide con la factura Siigo');
      }
      await conn.execute(`UPDATE recepciones SET orden_compra_id = ? WHERE id = ?`, [purchaseOrderId, receptionId]);
    }

    const [items] = await conn.execute(
      `SELECT ri.*, p.siigo_code, p.modalidad_operativa
       FROM recepcion_items ri
       JOIN productos p ON p.id = ri.producto_id
       WHERE ri.recepcion_id = ?
       ORDER BY ri.id ASC
       FOR UPDATE`,
      [receptionId]
    );
    if (!items.length) throw httpError(409, 'La recepcion no tiene items importados');

    const outsourcingOrderIds = new Set();
    for (const item of items) {
      const input = receivedItemInput(body, item, items.length) || {};
      const outsourcingOrderId = Number(
        input.orden_maquila_id || input.outsourcing_order_id
        || body.orden_maquila_id || body.outsourcing_order_id || 0
      ) || null;
      if (item.modalidad_operativa === PRODUCT_MODES.OUTSOURCED) {
        if (!hasCapability(user.rol, CAPABILITIES.OUTSOURCING_RECEIVE)) {
          throw httpError(403, 'No tienes permiso para vincular recepciones de maquila');
        }
        if (!outsourcingOrderId) {
          throw httpError(400, `Debes vincular una orden 3Q para ${item.siigo_code}`);
        }
        const [outsourcingOrders] = await conn.execute(
          `SELECT id, codigo, orden_compra_id, producto_id, estado
             FROM ordenes_maquila WHERE id = ? LIMIT 1 FOR UPDATE`,
          [outsourcingOrderId]
        );
        if (!outsourcingOrders.length) throw httpError(404, `Orden 3Q no encontrada para ${item.siigo_code}`);
        const outsourcingOrder = outsourcingOrders[0];
        if (Number(outsourcingOrder.producto_id) !== Number(item.producto_id)) {
          throw httpError(409, `La orden ${outsourcingOrder.codigo} no corresponde a ${item.siigo_code}`);
        }
        if (!['EN_3Q', 'RECIBIDA_PARCIAL'].includes(outsourcingOrder.estado)) {
          throw httpError(409, `La orden ${outsourcingOrder.codigo} esta ${outsourcingOrder.estado}`);
        }
        if (!purchaseOrder || Number(outsourcingOrder.orden_compra_id) !== Number(purchaseOrder.id)) {
          throw httpError(409, `La orden ${outsourcingOrder.codigo} no pertenece a la OC seleccionada`);
        }
        await conn.execute(
          `INSERT INTO maquila_recepciones
             (orden_maquila_id, recepcion_id, producto_id, vinculado_por, creado_en)
           VALUES (?, ?, ?, ?, NOW())`,
          [outsourcingOrder.id, receptionId, item.producto_id, user.id]
        );
        outsourcingOrderIds.add(outsourcingOrder.id);
      } else if (outsourcingOrderId) {
        throw httpError(409, `${item.siigo_code} no es un producto de maquila tercerizada`);
      }
    }

    const results = [];
    const receptionTxId = crypto.randomUUID();
    let hasDifference = false;
    for (const item of items) {
      const input = receivedItemInput(body, item, items.length);
      if (!input) throw httpError(400, `Falta confirmar el item ${item.siigo_code}`);
      if (item.modalidad_operativa === PRODUCT_MODES.OUTSOURCED
          && (!Array.isArray(input.distributions) || !input.distributions.length)) {
        throw httpError(400, `La recepcion 3Q de ${item.siigo_code} requiere distribuciones por condicion`);
      }

      const distributed = await processDistributedItem(conn, {
        item, input, reception, user, receptionId, body, txId: receptionTxId,
      });
      if (distributed) {
        hasDifference = hasDifference || distributed.hasDifference;
        delete distributed.hasDifference;
        results.push(distributed);
        continue;
      }

      const received = Number(input.qty_received ?? input.cantidad_recibida ?? input.qty_total);
      const damaged = Number(input.qty_damaged ?? input.cantidad_danada ?? 0);
      const lot = String(input.lot_id || input.lpn || input.lote || '').trim();
      const expiryDate = input.expiry_date || input.fecha_vencimiento || null;
      if (!Number.isFinite(received) || received < 0) {
        throw httpError(400, `Cantidad recibida invalida para ${item.siigo_code}`);
      }
      if (!Number.isFinite(damaged) || damaged < 0 || damaged > received) {
        throw httpError(400, `Cantidad danada invalida para ${item.siigo_code}`);
      }

      const expected = Number(item.cantidad_esp);
      const good = received - damaged;
      const requestedAccepted = input.qty_accepted ?? input.cantidad_aceptada;
      const accepted = requestedAccepted == null
        ? Math.min(good, expected)
        : Number(requestedAccepted);
      if (!Number.isFinite(accepted) || accepted < 0 || accepted > good) {
        throw httpError(400, `Cantidad aceptada invalida para ${item.siigo_code}`);
      }
      const shortage = Math.max(expected - received, 0);
      const overage = Math.max(good - accepted, 0);
      if (accepted > 0 && !lot) throw httpError(400, `Lote requerido para ${item.siigo_code}`);
      hasDifference = hasDifference
        || shortage > 0
        || damaged > 0
        || overage > 0;

      await conn.execute(
        `UPDATE recepcion_items
         SET lote = ?, fecha_venc = ?, cantidad_rec = ?
         WHERE id = ?`,
        [lot || null, expiryDate, received, item.id]
      );

      if (accepted > 0) {
        const [existingLots] = await conn.execute(
          `SELECT id FROM lots WHERE lpn = ? LIMIT 1`,
          [lot]
        );
        if (existingLots.length) throw httpError(409, `El lote ${lot} ya existe`);

        const lotId = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO lots
             (id, lpn, product_id, bodega_id, qty_initial, qty_current,
              supplier, origin, status, received_by, notes, expiry_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEPCION', 'DISPONIBLE', ?, ?, ?, NOW())`,
          [lotId, lot, item.producto_id, reception.bodega_id, accepted, accepted,
           reception.proveedor_nombre || null, user.id,
           body.notes || `Recepcion desde SIIGO ${reception.siigo_purchase_name || ''}`,
           expiryDate]
        );

        await conn.execute(
          `INSERT INTO stock
             (producto_id, bodega_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
           VALUES (?, ?, ?, ?, ?, 0, NOW())`,
          [item.producto_id, reception.bodega_id, lot, expiryDate, accepted]
        );

        await conn.execute(
          `INSERT INTO movimientos
             (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id,
              referencia_tipo, usuario_id, siigo_sync)
           VALUES ('entrada', ?, ?, ?, ?, ?, 'recepcion_siigo_import', ?, 1)`,
          [item.producto_id, reception.bodega_id, lot, accepted, receptionId, user.id]
        );
        await conn.execute(
          `INSERT INTO kardex
             (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
              reference, notes, approved_by, created_at)
           VALUES (?, ?, ?, ?, ?, 'INGRESO_RECEPCION', ?, ?, ?, ?, ?, NOW())`,
          [crypto.randomUUID(), receptionTxId, lotId, item.producto_id, user.id,
           accepted, accepted, `recepcion:${reception.numero}`,
           `Recepcion simple | Lote ${lot}`, user.id]
        );
      }

      const reason = String(input.reason || input.motivo || body.reason || body.motivo || '').trim();
      const issues = [
        { type: 'FALTANTE', quantity: shortage },
        { type: 'DANADO', quantity: damaged },
        { type: 'SOBRANTE', quantity: overage },
      ].filter(issue => issue.quantity > 0);
      for (const issue of issues) {
        await conn.execute(
          `INSERT INTO recepcion_novedades
             (recepcion_id, recepcion_item_id, tipo, cantidad, motivo, estado, usuario_id, creado_en)
           VALUES (?, ?, ?, ?, ?, 'ABIERTA', ?, NOW())`,
          [receptionId, item.id, issue.type, issue.quantity,
           reason || `${issue.type} detectado durante la recepcion fisica`, user.id]
        );
      }

      results.push({
        item_id: item.id,
        sku: item.siigo_code,
        esperado: expected,
        recibido: received,
        danado: damaged,
        aceptado: accepted,
        faltante: shortage,
        sobrante: overage,
        lote: lot || null,
        novedades: issues.map(issue => ({ tipo: issue.type, cantidad: issue.quantity })),
      });
    }

    const reconciliation = [];
    if (purchaseOrder) {
      const [orderedItems] = await conn.execute(
        `SELECT producto_id, SUM(cantidad_ordenada) AS cantidad
         FROM orden_compra_proveedor_items WHERE orden_compra_id = ? GROUP BY producto_id`,
        [purchaseOrder.id]
      );
      const ordered = new Map(orderedItems.map(item => [Number(item.producto_id), Number(item.cantidad)]));
      const invoiced = new Map(items.map(item => [Number(item.producto_id), Number(item.cantidad_esp)]));
      const physical = new Map(items.map((item, index) => [Number(item.producto_id), Number(results[index]?.recibido || 0)]));
      const productIds = [...new Set([...ordered.keys(), ...invoiced.keys(), ...physical.keys()])];
      const cumulativeProgress = new Map();
      for (const productId of productIds) {
        const qtyOrdered = ordered.get(productId) || 0;
        const qtyInvoiced = invoiced.get(productId) || 0;
        const qtyPhysical = physical.get(productId) || 0;
        const [cumulativeRows] = await conn.execute(
          `SELECT COALESCE(SUM(ri.cantidad_esp), 0) AS facturada,
                  COALESCE(SUM(ri.cantidad_rec), 0) AS fisica
             FROM recepciones r
             JOIN recepcion_items ri ON ri.recepcion_id = r.id
            WHERE r.orden_compra_id = ? AND r.estado <> 'anulada' AND ri.producto_id = ?`,
          [purchaseOrder.id, productId]
        );
        const [acceptedRows] = await conn.execute(
          `SELECT COALESCE(SUM(rd.cantidad), 0) AS aceptada
             FROM recepciones r
             JOIN recepcion_items ri ON ri.recepcion_id = r.id
             JOIN recepcion_distribuciones rd
               ON rd.recepcion_id = r.id AND rd.recepcion_item_id = ri.id
            WHERE r.orden_compra_id = ? AND r.estado <> 'anulada'
              AND ri.producto_id = ? AND rd.condicion = 'DISPONIBLE'`,
          [purchaseOrder.id, productId]
        );
        const cumulativeInvoiced = Number(cumulativeRows[0]?.facturada || 0);
        const cumulativePhysical = Number(cumulativeRows[0]?.fisica || 0);
        const cumulativeAccepted = Number(acceptedRows[0]?.aceptada || 0);
        const pending = Number(Math.max(qtyOrdered - cumulativeAccepted, 0).toFixed(4));
        cumulativeProgress.set(productId, { ordered: qtyOrdered, accepted: cumulativeAccepted });
        const orderInvoiceDiff = Number((qtyInvoiced - qtyOrdered).toFixed(4));
        const invoicePhysicalDiff = Number((qtyPhysical - qtyInvoiced).toFixed(4));
        if (qtyOrdered <= 0 || cumulativeInvoiced > qtyOrdered + 0.0001
            || cumulativeAccepted > qtyOrdered + 0.0001) hasDifference = true;
        await conn.execute(
          `INSERT INTO recepcion_conciliacion_items
             (recepcion_id, orden_compra_id, producto_id, cantidad_oc,
              cantidad_factura, cantidad_factura_acumulada, cantidad_fisica,
              cantidad_fisica_acumulada, cantidad_aceptada_acumulada,
              diferencia_oc_factura, diferencia_factura_fisica, saldo_oc, creado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [receptionId, purchaseOrder.id, productId, qtyOrdered, qtyInvoiced,
           cumulativeInvoiced, qtyPhysical, cumulativePhysical, cumulativeAccepted,
           orderInvoiceDiff, invoicePhysicalDiff, pending]
        );
        reconciliation.push({
          producto_id: productId,
          cantidad_oc: qtyOrdered,
          cantidad_factura: qtyInvoiced,
          cantidad_factura_acumulada: cumulativeInvoiced,
          cantidad_fisica: qtyPhysical,
          cantidad_fisica_acumulada: cumulativePhysical,
          cantidad_aceptada_acumulada: cumulativeAccepted,
          saldo_oc: pending,
          diferencia_oc_factura: orderInvoiceDiff,
          diferencia_factura_fisica: invoicePhysicalDiff,
        });
      }
      const allFulfilled = ordered.size > 0 && [...ordered.entries()].every(([productId, qty]) => {
        const progress = cumulativeProgress.get(productId);
        return progress && progress.accepted + 0.0001 >= qty;
      });
      const anyAccepted = [...cumulativeProgress.values()].some(progress => progress.accepted > 0.0001);
      await conn.execute(
        `UPDATE ordenes_compra_proveedor SET estado = ?, actualizado_en = NOW() WHERE id = ?`,
        [allFulfilled ? 'CERRADA' : anyAccepted ? 'RECIBIDA' : 'FACTURA_VINCULADA', purchaseOrder.id]
      );
    }

    const discrepancy = hasDifference
      ? `Diferencia fisica registrada en recepcion_novedades ${new Date().toISOString()}`
      : null;
    await conn.execute(
      `UPDATE recepciones
       SET estado = 'completada', completado_en = NOW(), usuario_id = ?,
           aprobado_por = ?, aprobado_en = NOW(),
           observaciones = CASE
             WHEN ? IS NULL THEN observaciones
             WHEN observaciones IS NULL OR observaciones = '' THEN ?
             ELSE CONCAT(observaciones, '\n', ?)
           END
       WHERE id = ?`,
      [user.id, user.id, discrepancy, discrepancy, discrepancy, receptionId]
    );

    const outsourcing = [];
    for (const outsourcingOrderId of outsourcingOrderIds) {
      outsourcing.push(await reconcileOutsourcingReception(conn, {
        outsourcingOrderId,
        userId: user.id,
      }));
    }

    await conn.commit();
    return res.status(200).json({
      ok: true,
      data: {
        recepcion_id: receptionId,
        numero: reception.numero,
        estado: 'completada',
        siigo_purchase_id: reception.siigo_purchase_id,
        diferencia: hasDifference,
        items: results,
        conciliacion: reconciliation,
        maquila: outsourcing,
      },
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    throw err;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function handlePost(req, res) {
  const user = await requireCapability(req, CAPABILITIES.RECEPTION_CONFIRM);
  if (!workflowFlags().allowManualReception) {
    throw httpError(409, 'La recepcion manual esta desactivada. Vincula una OC con la factura de compra de Siigo.');
  }
  const body = req.body || {};
  const qtyTotal = Number(body.qty_total || body.cantidad || body.qty);
  const qtyDamaged = Number(body.qty_damaged || 0);
  const syncSiigo = body.sync_siigo === true;
  const price = Number(body.precio_unitario || body.unit_price || 0);
  const discount = Number(body.descuento || 0);
  const terceroId = Number(body.tercero_id || 0) || null;
  const invoiceNumber = String(body.proveedor_invoice_number || '').trim();
  if (!Number.isFinite(qtyTotal) || qtyTotal <= 0) throw httpError(400, 'Cantidad total invalida');
  if (!Number.isFinite(qtyDamaged) || qtyDamaged < 0 || qtyDamaged > qtyTotal) throw httpError(400, 'Cantidad danada invalida');
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw httpError(400, 'Descuento invalido');
  if (syncSiigo && discount !== 0) throw httpError(400, 'Las pruebas SIIGO requieren descuento 0');
  if (syncSiigo && !canSyncSiigo(user)) throw httpError(403, 'Solo Admin o Supervisor puede sincronizar con SIIGO');

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const product = await findProduct(conn, body.product_id || body.sku);
    const tercero = syncSiigo
      ? await validateSiigoReception(conn, { terceroId, product, price, invoiceNumber })
      : null;
    const bodegaId = await getDefaultBodega(conn);
    const qtyReceived = qtyTotal - qtyDamaged;
    const numero = await nextReceptionNumber(conn);
    const lpn = body.lot_id || body.lpn || `L-REC-${product.siigo_code}-${Date.now()}`;

    const [rec] = await conn.execute(
      `INSERT INTO recepciones
         (numero, tercero_id, bodega_id, proveedor_nombre, proveedor_invoice_prefix,
          proveedor_invoice_number, proveedor_invoice_date, estado, usuario_id,
          observaciones, completado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completada', ?, ?, NOW())`,
      [numero, terceroId, bodegaId,
       tercero?.nombre || body.supplier || body.proveedor || null,
       body.proveedor_invoice_prefix || null,
       invoiceNumber || null,
       body.proveedor_invoice_date || null,
       user.id, body.notes || null]
    );

    await conn.execute(
      `INSERT INTO recepcion_items
         (recepcion_id, producto_id, lote, fecha_venc, cantidad_esp, cantidad_rec,
          precio_unitario, descuento, bodega_siigo_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rec.insertId, product.id, lpn, body.expiry_date || null, qtyTotal, qtyReceived,
       price || null, discount, body.bodega_siigo_id || null]
    );

    const lotId = crypto.randomUUID();
    await conn.execute(
      `INSERT INTO lots
         (id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier, origin, status, received_by, notes, expiry_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEPCION', 'DISPONIBLE', ?, ?, ?, NOW())`,
      [lotId, lpn, product.id, bodegaId, qtyReceived, qtyReceived, body.supplier || null, user.id, body.notes || null, body.expiry_date || null]
    );

    if (qtyReceived > 0) {
      await conn.execute(
        `INSERT INTO stock (producto_id, bodega_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
         VALUES (?, ?, ?, ?, ?, 0, NOW())
         ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad), actualizado_en = NOW()`,
        [product.id, bodegaId, lpn, body.expiry_date || null, qtyReceived]
      ).catch(async () => {
        await conn.execute(
          `INSERT INTO stock (producto_id, bodega_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
           VALUES (?, ?, ?, ?, ?, 0, NOW())`,
          [product.id, bodegaId, lpn, body.expiry_date || null, qtyReceived]
        );
      });
    }

    await conn.execute(
      `INSERT INTO movimientos
         (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id,
          referencia_tipo, usuario_id, siigo_sync)
       VALUES ('entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [product.id, bodegaId, lpn, qtyReceived, rec.insertId,
       syncSiigo ? 'recepcion_siigo' : 'recepcion_dashboard', user.id, syncSiigo ? 0 : 1]
    );

    await conn.commit();
    await conn.end();
    conn = null;

    let siigo = null;
    let siigoError = null;
    if (syncSiigo) {
      try {
        siigo = await pushCompraToSiigo(rec.insertId);
      } catch (err) {
        siigoError = err.response?.data || err.message;
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        numero,
        recepcion_id: rec.insertId,
        sku: product.siigo_code,
        lote: lpn,
        cantidad_recibida: qtyReceived,
        siigo,
        siigo_pendiente: syncSiigo && !siigo,
        siigo_error: siigoError,
      },
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    throw err;
  } finally {
    if (conn) {
      try { await conn.end(); } catch (_) {}
    }
  }
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST,PUT');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'PUT') return await handlePut(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[reception]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
