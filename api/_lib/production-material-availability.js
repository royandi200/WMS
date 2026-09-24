const { createConnection } = require('./db');
const { resolvePrimaryWarehouse } = require('./warehouses');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function roundQty(value) {
  return Number(Number(value).toFixed(4));
}

async function planProductionMaterials(conn, { productId, productSku, quantity, warehouseId, lockStock = false }) {
  const [bom] = await conn.execute(
    `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
            p.siigo_code AS sku, p.nombre
       FROM bom b JOIN productos p ON p.id = b.insumo_id
      WHERE b.producto_final_id = ? AND b.etapa = 'PRODUCCION' ORDER BY b.id`,
    [productId]
  );
  if (!bom.length) throw httpError(422, `No existe BOM para ${productSku || 'este producto'}`);

  const plan = [];
  const shortages = [];
  for (const component of bom) {
    const required = roundQty(Number(component.cantidad_por_unidad) * quantity);
    const [stockRows] = await conn.execute(
      `SELECT s.id, s.lote, s.ubicacion_id, COALESCE(l.expiry_date, s.fecha_venc) AS fecha_venc,
              (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
              u.codigo AS ubicacion_codigo
         FROM stock s
         JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
         JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
        WHERE s.producto_id = ? AND s.bodega_id = ?
          AND l.status = 'DISPONIBLE'
          AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
          AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
               OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
        ORDER BY CASE WHEN COALESCE(l.expiry_date, s.fecha_venc) IS NULL THEN 1 ELSE 0 END,
                 COALESCE(l.expiry_date, s.fecha_venc) ASC, l.created_at ASC, s.id ASC${lockStock ? ' FOR UPDATE' : ''}`,
      [component.insumo_id, warehouseId]
    );
    const available = roundQty(stockRows.reduce((sum, stock) => sum + Number(stock.disponible), 0));
    let remaining = required;
    const allocations = [];
    for (const stock of stockRows) {
      if (remaining <= 0.0001) break;
      const take = roundQty(Math.min(Number(stock.disponible), remaining));
      allocations.push({
        stockId: stock.id,
        lot: stock.lote,
        locationId: stock.ubicacion_id,
        locationCode: stock.ubicacion_codigo,
        expiryDate: stock.fecha_venc,
        quantity: take,
      });
      remaining = roundQty(remaining - take);
    }
    if (remaining > 0.0001) {
      shortages.push({ sku: component.sku, requerido: required, faltante: remaining });
    }
    plan.push({ component, required, available, missing: Math.max(0, remaining), allocations });
  }
  return { plan, shortages };
}

async function previewCustomerOrderMaterials({ orderId, itemId }) {
  const customerOrderId = Number(orderId);
  const customerItemId = Number(itemId);
  if (!Number.isSafeInteger(customerOrderId) || customerOrderId <= 0
    || !Number.isSafeInteger(customerItemId) || customerItemId <= 0) {
    throw httpError(400, 'Indica un PED ID y un ítem ID válidos');
  }

  const conn = await createConnection();
  try {
    const [items] = await conn.execute(
      `SELECT pc.id AS order_id, pc.estado, i.id AS item_id, i.producto_id,
              i.cantidad_ordenada, p.siigo_code AS sku, p.nombre AS producto,
              p.modalidad_operativa
         FROM pedidos_cliente pc
         JOIN pedido_cliente_items i ON i.pedido_cliente_id = pc.id
         JOIN productos p ON p.id = i.producto_id
        WHERE pc.id = ? AND i.id = ? LIMIT 1`,
      [customerOrderId, customerItemId]
    );
    const item = items[0];
    if (!item || item.estado !== 'ACTIVO') throw httpError(404, 'El pedido de cliente no está disponible');
    if (item.modalidad_operativa !== 'PR') throw httpError(409, 'El producto no es de producción propia');

    const [released] = await conn.execute(
      `SELECT COALESCE(SUM(CASE WHEN estado = 'CERRADA' THEN cantidad_real ELSE cantidad_planeada END), 0) AS total
         FROM ordenes_produccion
        WHERE pedido_cliente_item_id = ? AND estado <> 'CANCELADA'`,
      [customerItemId]
    );
    const quantity = roundQty(Number(item.cantidad_ordenada) - Number(released[0]?.total || 0));
    if (quantity <= 0) throw httpError(409, 'Este ítem ya no tiene unidades pendientes de producción');

    const warehouseId = await resolvePrimaryWarehouse(conn);
    const { plan, shortages } = await planProductionMaterials(conn, {
      productId: item.producto_id, productSku: item.sku, quantity, warehouseId,
    });
    return {
      order_id: customerOrderId,
      item_id: customerItemId,
      sku: item.sku,
      product: item.producto,
      planned_quantity: quantity,
      ready: shortages.length === 0,
      checked_at: new Date().toISOString(),
      materials: plan.map(({ component, required, available, missing }) => ({
        sku: component.sku, product: component.nombre, unit: component.unidad,
        required, available, missing,
      })),
    };
  } finally {
    await conn.end();
  }
}

module.exports = { planProductionMaterials, previewCustomerOrderMaterials, roundQty };
