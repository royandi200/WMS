const { resolvePrimaryWarehouse } = require('./warehouses');
const { addPreferredLocations } = require('./product-locations');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeUnit(value) {
  return String(value || '').trim().toLowerCase() || 'sin unidad';
}

function groupQuantitiesByUnit(items = []) {
  const totals = new Map();
  for (const item of items) {
    const quantity = Number(item.quantity ?? item.cantidad ?? item.cantidad_ordenada ?? 0);
    if (!Number.isFinite(quantity)) continue;
    const unit = normalizeUnit(item.unit ?? item.unidad);
    totals.set(unit, Number(((totals.get(unit) || 0) + quantity).toFixed(4)));
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([unit, quantity]) => ({ unit, quantity }));
}

function remainingPurchaseOrderItems(orderedItems = [], acceptedItems = []) {
  const acceptedByProduct = new Map(
    acceptedItems.map((item) => [Number(item.producto_id), Number(item.cantidad_aceptada || 0)])
  );
  return orderedItems.map((item) => {
    const ordered = Number(item.cantidad_ordenada || 0);
    const accepted = Number(acceptedByProduct.get(Number(item.producto_id)) || 0);
    return {
      ...item,
      cantidad_ordenada: ordered,
      cantidad_aceptada: accepted,
      cantidad_pendiente: Number(Math.max(ordered - accepted, 0).toFixed(4)),
    };
  }).filter((item) => item.cantidad_pendiente > 0.0001);
}

async function loadPreparedReception(conn, preparationKey) {
  const [rows] = await conn.execute(
    `SELECT id, numero, orden_compra_id, proveedor_nombre, estado
       FROM recepciones
      WHERE preparacion_clave = ? AND estado IN ('borrador', 'en_proceso')
      LIMIT 1`,
    [preparationKey]
  );
  if (!rows.length) return null;
  const reception = rows[0];
  const [loadedItems] = await conn.execute(
    `SELECT ri.id AS item_id, ri.producto_id, p.siigo_code AS sku,
            p.nombre AS producto, p.modalidad_operativa, p.requiere_lote,
            ri.cantidad_esp AS cantidad_pendiente,
            COALESCE(
              CASE WHEN COUNT(DISTINCT COALESCE(NULLIF(oci.unidad, ''), 'und')) = 1
                   THEN MIN(COALESCE(NULLIF(oci.unidad, ''), 'und')) ELSE NULL END,
              p.unit_label, 'und'
            ) AS unidad,
            CASE WHEN COUNT(DISTINCT NULLIF(oci.lote_documento, '')) = 1
                 THEN MIN(NULLIF(oci.lote_documento, '')) ELSE NULL END AS lote_documento,
            CASE WHEN COUNT(DISTINCT oci.fecha_vencimiento_documento) = 1
                 THEN DATE_FORMAT(MIN(oci.fecha_vencimiento_documento), '%Y-%m-%d') ELSE NULL END AS fecha_vencimiento_documento
       FROM recepcion_items ri
       JOIN productos p ON p.id = ri.producto_id
       LEFT JOIN orden_compra_proveedor_items oci
         ON oci.orden_compra_id = ? AND oci.producto_id = ri.producto_id
      WHERE ri.recepcion_id = ?
      GROUP BY ri.id, ri.producto_id, p.siigo_code, p.nombre,
               p.modalidad_operativa, p.requiere_lote, ri.cantidad_esp, p.unit_label
      ORDER BY ri.id`,
    [reception.orden_compra_id, reception.id]
  );
  const items = await addPreferredLocations(conn, loadedItems);
  return { ...reception, items, duplicate: true };
}

async function preparePurchaseOrderReception(conn, { purchaseOrderId, userId }) {
  const orderId = Number(purchaseOrderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw httpError(400, 'orden_compra_id es obligatorio');
  }
  const preparationKey = `OC_DIRECTA:${orderId}`;
  const [orders] = await conn.execute(
    `SELECT id, numero, tercero_id, proveedor_nombre, estado
       FROM ordenes_compra_proveedor
      WHERE id = ? LIMIT 1 FOR UPDATE`,
    [orderId]
  );
  if (!orders.length) throw httpError(404, 'Orden de compra no encontrada');
  const order = orders[0];
  if (!['CARGADA', 'RECIBIDA', 'RECIBIDA_PARCIAL'].includes(order.estado)) {
    throw httpError(409, `La orden de compra esta ${order.estado}`);
  }

  const prepared = await loadPreparedReception(conn, preparationKey);
  if (prepared) return prepared;

  const [orderedItems] = await conn.execute(
    `SELECT oci.producto_id, p.siigo_code AS sku, p.nombre AS producto,
            p.modalidad_operativa, p.requiere_lote,
            SUM(oci.cantidad_ordenada) AS cantidad_ordenada,
            CASE WHEN COUNT(DISTINCT COALESCE(NULLIF(oci.unidad, ''), 'und')) = 1
                 THEN MIN(COALESCE(NULLIF(oci.unidad, ''), 'und')) ELSE NULL END AS unidad,
            CASE WHEN COUNT(DISTINCT NULLIF(oci.lote_documento, '')) = 1
                 THEN MIN(NULLIF(oci.lote_documento, '')) ELSE NULL END AS lote_documento,
            CASE WHEN COUNT(DISTINCT oci.fecha_vencimiento_documento) = 1
                 THEN DATE_FORMAT(MIN(oci.fecha_vencimiento_documento), '%Y-%m-%d') ELSE NULL END AS fecha_vencimiento_documento
       FROM orden_compra_proveedor_items oci
       JOIN productos p ON p.id = oci.producto_id
      WHERE oci.orden_compra_id = ?
      GROUP BY oci.producto_id, p.siigo_code, p.nombre, p.modalidad_operativa, p.requiere_lote
      ORDER BY MIN(oci.id)`,
    [orderId]
  );
  if (!orderedItems.length) throw httpError(409, 'La orden de compra no tiene items');
  const internal = orderedItems.filter((item) => item.modalidad_operativa === 'PR');
  if (internal.length) {
    throw httpError(409, `Los productos ${internal.map((item) => item.sku).join(', ')} deben ingresar mediante una orden de produccion interna`);
  }
  const outsourced = orderedItems.filter((item) => item.modalidad_operativa === 'PT');
  if (outsourced.length) {
    throw httpError(409, `Los productos ${outsourced.map((item) => item.sku).join(', ')} deben recibirse desde una orden de maquila 3Q`);
  }
  if (orderedItems.some((item) => !item.unidad)) {
    throw httpError(409, 'Una referencia de la OC tiene unidades incompatibles');
  }

  const [acceptedItems] = await conn.execute(
    `SELECT accepted.producto_id, SUM(accepted.cantidad) AS cantidad_aceptada
       FROM (
         SELECT ri.id, ri.producto_id,
                CASE WHEN COUNT(rd.id) > 0
                     THEN COALESCE(SUM(CASE WHEN rd.condicion = 'DISPONIBLE' THEN rd.cantidad ELSE 0 END), 0)
                     ELSE LEAST(ri.cantidad_rec, ri.cantidad_esp) END AS cantidad
           FROM recepciones r
           JOIN recepcion_items ri ON ri.recepcion_id = r.id
           LEFT JOIN recepcion_distribuciones rd
             ON rd.recepcion_id = r.id AND rd.recepcion_item_id = ri.id
          WHERE r.orden_compra_id = ? AND r.estado = 'completada'
          GROUP BY ri.id, ri.producto_id, ri.cantidad_rec, ri.cantidad_esp
       ) accepted
      GROUP BY accepted.producto_id`,
    [orderId]
  );
  const remaining = remainingPurchaseOrderItems(orderedItems, acceptedItems);
  if (!remaining.length) throw httpError(409, `La orden ${order.numero} no tiene cantidades pendientes`);

  const bodegaId = await resolvePrimaryWarehouse(conn);
  const [sequenceRows] = await conn.execute(
    `SELECT COUNT(*) AS cantidad FROM recepciones WHERE orden_compra_id = ?`,
    [orderId]
  );
  const sequence = Number(sequenceRows[0]?.cantidad || 0) + 1;
  const number = `REC-OC-${orderId}-${String(sequence).padStart(3, '0')}`;
  const [inserted] = await conn.execute(
    `INSERT INTO recepciones
       (numero, orden_compra_id, tercero_id, proveedor_nombre, bodega_id, estado,
        usuario_id, observaciones, preparacion_clave, creado_en)
     VALUES (?, ?, ?, ?, ?, 'borrador', ?, ?, ?, NOW())`,
    [number, orderId, order.tercero_id, order.proveedor_nombre, bodegaId, userId,
     `Recepcion fisica preparada desde OC ${order.numero}`, preparationKey]
  );
  const preparedItems = [];
  for (const item of remaining) {
    const [createdItem] = await conn.execute(
      `INSERT INTO recepcion_items
         (recepcion_id, producto_id, cantidad_esp, cantidad_rec)
       VALUES (?, ?, ?, 0)`,
      [inserted.insertId, item.producto_id, item.cantidad_pendiente]
    );
    preparedItems.push({
      item_id: createdItem.insertId,
      producto_id: item.producto_id,
      sku: item.sku,
      producto: item.producto,
      modalidad_operativa: item.modalidad_operativa,
      requiere_lote: Boolean(item.requiere_lote),
      cantidad_ordenada: item.cantidad_ordenada,
      cantidad_aceptada: item.cantidad_aceptada,
      cantidad_pendiente: item.cantidad_pendiente,
      unidad: item.unidad,
      lote_documento: item.lote_documento || null,
      fecha_vencimiento_documento: item.fecha_vencimiento_documento || null,
    });
  }
  const itemsWithLocations = await addPreferredLocations(conn, preparedItems);
  return {
    id: inserted.insertId,
    numero: number,
    orden_compra_id: orderId,
    orden_compra_numero: order.numero,
    proveedor_nombre: order.proveedor_nombre,
    estado: 'borrador',
    items: itemsWithLocations,
    duplicate: false,
  };
}

module.exports = {
  groupQuantitiesByUnit,
  normalizeUnit,
  preparePurchaseOrderReception,
  remainingPurchaseOrderItems,
};
