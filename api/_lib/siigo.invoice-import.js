const { createConnection } = require('./db');
const { workflowFlags } = require('./feature-flags');
const { notifyRoles } = require('./builderbot-notifications');
const { resolvePrimaryWarehouse } = require('./warehouses');
const { createHash } = require('crypto');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function buildSiigoDispatchNumber(invoice = {}) {
  const identity = String(invoice.id || invoice.name || '').trim();
  if (!identity) throw httpError(400, 'La factura Siigo no tiene identificador');
  const readable = String(invoice.name || invoice.id)
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(0, 10) || 'FACTURA';
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 8).toUpperCase();
  return `DSP-SIIGO-${readable}-${suffix}`.slice(0, 30);
}

function normalizeInvoice(invoice) {
  const customer = invoice?.customer || {};
  const observations = String(invoice?.observations || '').trim();
  const purchaseOrder = invoice?.additional_fields?.purchase_order || {};
  const quotationPrefix = String(
    process.env.SIIGO_QUOTATION_REFERENCE_PREFIX || 'WMSCOT'
  ).trim().toUpperCase();
  const purchaseOrderReference = String(purchaseOrder.number || '').trim();
  const markerReference = observations.match(/\[WMS-COT:([A-Za-z0-9-]+)\]/i)?.[1] || '';
  return {
    id: String(invoice?.id || '').trim(),
    name: String(invoice?.name || '').trim(),
    date: invoice?.date || null,
    customerId: String(customer.id || '').trim(),
    customerIdentification: String(customer.identification || '').trim(),
    customerName: String(customer.name || customer.commercial_name || '').trim(),
    total: Number(invoice?.total || 0),
    observations,
    quotationReference: String(purchaseOrder.prefix || '').trim().toUpperCase() === quotationPrefix
      ? purchaseOrderReference
      : markerReference,
    annulled: invoice?.annulled === true,
    cufe: String(invoice?.stamp?.cufe || invoice?.cufe || '').trim(),
    stampStatus: ['Draft', 'Accepted', 'Rejected'].includes(String(invoice?.stamp?.status || '').trim())
      ? String(invoice.stamp.status).trim()
      : null,
    items: Array.isArray(invoice?.items) ? invoice.items : [],
  };
}

async function resolveWarehouse(conn, remoteWarehouseId) {
  if (remoteWarehouseId) {
    const [mapped] = await conn.execute(
      `SELECT id FROM bodegas WHERE activa = 1 AND siigo_id = ? LIMIT 1`,
      [Number(remoteWarehouseId)]
    );
    if (mapped.length) return mapped[0].id;

    const warehouseCode = String(process.env.SIIGO_WMS_WAREHOUSE_CODE || 'BG-PPAL').trim();
    const [active] = await conn.execute(
      `SELECT id, siigo_id FROM bodegas WHERE activa = 1 AND codigo = ? LIMIT 1`,
      [warehouseCode]
    );
    const sharedSandbox = String(process.env.SIIGO_USERNAME || '').toLowerCase() === 'sandbox@siigoapi.com';
    if (active.length && (active[0].siigo_id == null || sharedSandbox)) {
      await conn.execute(
        `UPDATE bodegas SET siigo_id = ? WHERE id = ?`,
        [Number(remoteWarehouseId), active[0].id]
      );
      return active[0].id;
    }
    throw httpError(
      409,
      `Bodega SIIGO ${remoteWarehouseId} no esta mapeada a ${warehouseCode} en WMS`
    );
  }

  return resolvePrimaryWarehouse(conn);
}

async function allocateProduct(conn, { productId, bodegaId, quantity, invoiceName }) {
  const [rows] = await conn.execute(
    `SELECT s.id AS stock_id, s.ubicacion_id, u.codigo AS ubicacion, s.lote,
            (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
            COALESCE(l.expiry_date, s.fecha_venc) AS vence
     FROM stock s
     LEFT JOIN lots l ON BINARY l.lpn = BINARY s.lote
     JOIN ubicaciones u ON u.id = s.ubicacion_id
       AND u.bodega_id = s.bodega_id AND u.activa = 1
     WHERE s.producto_id = ? AND s.bodega_id = ?
       AND s.lote IS NOT NULL
       AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
       AND COALESCE(l.status, 'DISPONIBLE') = 'DISPONIBLE'
       AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL
            OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
     ORDER BY CASE WHEN COALESCE(l.expiry_date, s.fecha_venc) IS NULL THEN 1 ELSE 0 END,
              COALESCE(l.expiry_date, s.fecha_venc) ASC,
              s.id ASC
     FOR UPDATE`,
    [productId, bodegaId]
  );

  let remaining = Number(quantity);
  const allocations = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const available = Number(row.disponible || 0);
    const allocated = Math.min(available, remaining);
    if (allocated > 0) {
      allocations.push({
        stockId: row.stock_id,
        ubicacionId: row.ubicacion_id || null,
        ubicacion: row.ubicacion,
        lpn: row.lote,
        quantity: allocated,
        expiry: row.vence || null,
      });
      remaining = Number((remaining - allocated).toFixed(4));
    }
  }

  if (remaining > 0) {
    const available = Number(quantity) - remaining;
    if (!workflowFlags().reserveAvailableOnShortage) {
      throw httpError(
        409,
        `Stock WMS insuficiente para ${invoiceName}. Solicitado: ${quantity}; disponible trazable: ${available}`
      );
    }
  }
  allocations.shortage = remaining;
  return allocations;
}

async function upsertDemand(conn, { dispatchId, productId, invoiced, reserved, status }) {
  await conn.execute(
    `INSERT INTO despacho_demanda_items
       (despacho_id, producto_id, cantidad_facturada, cantidad_reservada,
        cantidad_despachada, estado, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, 0, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       cantidad_facturada = cantidad_facturada + VALUES(cantidad_facturada),
       cantidad_reservada = cantidad_reservada + VALUES(cantidad_reservada),
       estado = IF(estado = 'PENDIENTE_DATOS_CLIENTE', estado, VALUES(estado)),
       actualizado_en = NOW()`,
    [dispatchId, productId, invoiced, reserved, status]
  );
}

function invoiceSignature(items) {
  const totals = new Map();
  for (const item of items) {
    const code = String(item.code || item.siigo_code || '').trim();
    const price = Number(item.price ?? item.precio_unitario ?? 0);
    const discount = Number(item.discount?.percentage ?? item.discount ?? item.descuento ?? 0);
    const warehouse = Number(item.warehouse?.id ?? item.warehouse ?? item.bodega_siigo_id ?? 0);
    const quantity = Number(item.quantity ?? item.cantidad_sol ?? 0);
    const key = `${code}|${price}|${discount}|${warehouse}`;
    totals.set(key, Number(((totals.get(key) || 0) + quantity).toFixed(4)));
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
}

async function releaseReservations(conn, dispatchId, bodegaId) {
  const [items] = await conn.execute(
    `SELECT producto_id, ubicacion_id, lote, cantidad_sol
     FROM despacho_items
     WHERE despacho_id = ?
     ORDER BY id ASC
     FOR UPDATE`,
    [dispatchId]
  );
  const released = [];
  for (const item of items) {
    const quantity = Number(item.cantidad_sol || 0);
    if (!item.lote || quantity <= 0) continue;
    const [updated] = await conn.execute(
      `UPDATE stock
       SET reservada = COALESCE(reservada, 0) - ?, actualizado_en = NOW()
       WHERE producto_id = ? AND bodega_id = ? AND lote = ?
         AND (ubicacion_id <=> ?) AND COALESCE(reservada, 0) >= ?
       LIMIT 1`,
      [quantity, item.producto_id, bodegaId, item.lote, item.ubicacion_id, quantity]
    );
    if (updated.affectedRows !== 1) {
      throw httpError(409, `No se pudo liberar la reserva del lote ${item.lote}`);
    }
    released.push({ lote: item.lote, cantidad: quantity });
  }
  return released;
}

async function convertQuotationReservation(conn, {
  data,
  customer,
  customerName,
  bodegaId,
  numero,
  userId,
}) {
  if (!data.quotationReference) return null;

  const [reservations] = await conn.execute(
    `SELECT r.id AS reservation_id, r.despacho_id, r.estado, r.expira_en,
            (r.expira_en IS NOT NULL AND r.expira_en < NOW()) AS reserva_vencida,
            d.numero, d.estado AS despacho_estado, d.bodega_id, d.tercero_id
     FROM siigo_cotizacion_reservas r
     JOIN despachos d ON d.id = r.despacho_id
     WHERE BINARY r.siigo_quotation_name = BINARY ?
     LIMIT 2 FOR UPDATE`,
    [data.quotationReference]
  );
  if (!reservations.length) {
    throw httpError(409, `Cotizacion ${data.quotationReference} sin reserva WMS`);
  }
  if (reservations.length > 1) {
    throw httpError(409, `Cotizacion ${data.quotationReference} tiene reservas ambiguas`);
  }

  const reservation = reservations[0];
  if (reservation.estado !== 'RESERVADA' || reservation.despacho_estado !== 'picking') {
    throw httpError(
      409,
      `Cotizacion ${data.quotationReference} no tiene una reserva activa en picking`
    );
  }
  if (Number(reservation.reserva_vencida) === 1) {
    throw httpError(409, `La reserva de ${data.quotationReference} esta vencida`);
  }
  if (Number(reservation.tercero_id) !== Number(customer.id)) {
    throw httpError(409, `El cliente de la factura no coincide con ${data.quotationReference}`);
  }
  if (Number(reservation.bodega_id) !== Number(bodegaId)) {
    throw httpError(409, `La bodega de la factura no coincide con ${data.quotationReference}`);
  }

  const [currentItems] = await conn.execute(
    `SELECT p.siigo_code, di.cantidad_sol, di.precio_unitario,
            di.descuento, di.bodega_siigo_id, di.lote
     FROM despacho_items di
     JOIN productos p ON p.id = di.producto_id
     WHERE di.despacho_id = ?
     ORDER BY di.id ASC`,
    [reservation.despacho_id]
  );
  if (JSON.stringify(invoiceSignature(currentItems)) !== JSON.stringify(invoiceSignature(data.items))) {
    throw httpError(
      409,
      `La factura ${data.name} no coincide en productos, cantidades, precios o bodega con ${data.quotationReference}`
    );
  }

  const [updated] = await conn.execute(
    `UPDATE despachos
     SET numero = ?, tercero_id = ?, cliente_nombre = ?, bodega_id = ?, usuario_id = ?,
         observaciones = ?, siigo_invoice_id = ?, siigo_invoice_name = ?, cufe = ?,
         stamp_status = ?, total_factura = ?, siigo_synced_at = NOW()
     WHERE id = ? AND estado = 'picking' AND siigo_invoice_id IS NULL`,
    [numero, customer.id, customerName, bodegaId, userId,
     data.observations || `Convertido desde cotizacion ${data.quotationReference} a ${data.name}`,
     data.id, data.name, data.cufe || null, data.stampStatus || null,
     data.total || null, reservation.despacho_id]
  );
  if (updated.affectedRows !== 1) {
    throw httpError(409, `No se pudo convertir la reserva de ${data.quotationReference}`);
  }
  await conn.execute(
    `UPDATE siigo_cotizacion_reservas
     SET estado = 'CONVERTIDA', motivo = ?, expira_en = NULL, actualizado_en = NOW()
     WHERE id = ? AND estado = 'RESERVADA'`,
    [`Convertida a factura ${data.name}`, reservation.reservation_id]
  );

  return {
    status: 'converted',
    id: reservation.despacho_id,
    numero,
    estado: 'picking',
    siigo_invoice_id: data.id,
    siigo_invoice_name: data.name,
    siigo_quotation_name: data.quotationReference,
    reserved: currentItems.map(item => ({
      sku: item.siigo_code,
      lote: item.lote,
      cantidad: Number(item.cantidad_sol),
    })),
  };
}

async function rejectMissingQuotationReference(conn, { data, customer, bodegaId }) {
  if (data.quotationReference) return;

  const [candidates] = await conn.execute(
    `SELECT r.siigo_quotation_name, r.despacho_id
     FROM siigo_cotizacion_reservas r
     JOIN despachos d ON d.id = r.despacho_id
     WHERE r.estado = 'RESERVADA'
       AND (r.expira_en IS NULL OR r.expira_en >= NOW())
       AND d.estado = 'picking' AND d.tercero_id = ? AND d.bodega_id = ?
     ORDER BY r.creado_en ASC
     LIMIT 20 FOR UPDATE`,
    [customer.id, bodegaId]
  );
  if (!candidates.length) return;

  const remoteSignature = JSON.stringify(invoiceSignature(data.items));
  const matches = [];
  for (const candidate of candidates) {
    const [items] = await conn.execute(
      `SELECT p.siigo_code, di.cantidad_sol, di.precio_unitario,
              di.descuento, di.bodega_siigo_id
       FROM despacho_items di
       JOIN productos p ON p.id = di.producto_id
       WHERE di.despacho_id = ?`,
      [candidate.despacho_id]
    );
    if (JSON.stringify(invoiceSignature(items)) === remoteSignature) {
      matches.push(candidate.siigo_quotation_name);
    }
  }
  if (!matches.length) return;

  const reference = matches.length === 1 ? matches[0] : matches.join(', ');
  throw httpError(
    409,
    `La factura ${data.name} coincide con una reserva de cotizacion (${reference}) pero no incluye la referencia WMSCOT`
  );
}

async function importInvoice(invoice, userId) {
  const data = normalizeInvoice(invoice);
  if (!data.id || !data.name) throw httpError(400, 'Factura SIIGO sin id o nombre');
  if (data.annulled) throw httpError(409, `Factura ${data.name} anulada en SIIGO`);
  if (!data.items.length) throw httpError(400, `Factura ${data.name} sin items`);

  const conn = await createConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.execute(
      `SELECT id, numero, estado, bodega_id, tercero_id, total_factura,
              siigo_invoice_id, siigo_invoice_name
       FROM despachos WHERE siigo_invoice_id = ? LIMIT 1 FOR UPDATE`,
      [data.id]
    );
    if (existing.length && !['picking', 'borrador'].includes(existing[0].estado)) {
      await conn.commit();
      return { status: 'duplicate', ...existing[0] };
    }

    const [customerRows] = await conn.execute(
      `SELECT id, nombre, nombre_comercial
       FROM terceros
       WHERE siigo_id = ? OR identification = ?
       ORDER BY siigo_id = ? DESC
       LIMIT 1`,
      [data.customerId, data.customerIdentification, data.customerId]
    );
    const productCodes = [...new Set(data.items.map(item => String(item.code || '').trim()).filter(Boolean))];
    if (!productCodes.length) throw httpError(400, `Factura ${data.name} sin codigos de producto`);
    const placeholders = productCodes.map(() => '?').join(',');
    const [productRows] = await conn.execute(
      `SELECT id, siigo_code FROM productos WHERE siigo_code IN (${placeholders})`,
      productCodes
    );
    const products = new Map(productRows.map(row => [String(row.siigo_code), row.id]));
    const missing = productCodes.filter(code => !products.has(code));
    if (missing.length) throw httpError(409, `Productos no sincronizados: ${missing.join(', ')}`);

    const preparedItems = [];
    const warehouseIds = new Set();
    for (const item of data.items) {
      const code = String(item.code || '').trim();
      const quantity = Number(item.quantity || 0);
      if (!code || !Number.isFinite(quantity) || quantity <= 0) {
        throw httpError(400, `Item invalido en factura ${data.name}`);
      }
      const remoteWarehouse = item.warehouse?.id ?? item.warehouse ?? null;
      const bodegaId = await resolveWarehouse(conn, remoteWarehouse);
      warehouseIds.add(bodegaId);
      preparedItems.push({
        code,
        productId: products.get(code),
        quantity,
        price: Number(item.price || 0),
        discount: Number(item.discount?.percentage ?? item.discount ?? 0),
        remoteWarehouse: remoteWarehouse ? Number(remoteWarehouse) : null,
        bodegaId,
      });
    }
    if (warehouseIds.size !== 1) {
      throw httpError(409, `Factura ${data.name} usa multiples bodegas; requiere despachos separados`);
    }

    const bodegaId = [...warehouseIds][0];
    const numero = buildSiigoDispatchNumber(data);
    const customer = customerRows[0] || null;
    const customerName = data.customerName || customer?.nombre_comercial || customer?.nombre || null;
    if (!customer) {
      let pendingDispatchId = existing[0]?.id || null;
      if (pendingDispatchId) {
        await releaseReservations(conn, pendingDispatchId, existing[0].bodega_id);
        await conn.execute(`DELETE FROM despacho_items WHERE despacho_id = ?`, [pendingDispatchId]);
        await conn.execute(`DELETE FROM despacho_demanda_items WHERE despacho_id = ?`, [pendingDispatchId]);
        await conn.execute(
          `UPDATE despachos
           SET tercero_id = NULL, cliente_nombre = ?, bodega_id = ?, estado = 'borrador',
               observaciones = ?, siigo_invoice_name = ?, total_factura = ?, siigo_synced_at = NOW()
           WHERE id = ?`,
          [customerName || 'PENDIENTE DATOS CLIENTE', bodegaId,
           `Factura ${data.name} pendiente de sincronizar cliente`, data.name, data.total || null, pendingDispatchId]
        );
      } else {
        const [inserted] = await conn.execute(
          `INSERT INTO despachos
             (numero, tercero_id, cliente_nombre, bodega_id, estado, usuario_id,
              observaciones, siigo_invoice_id, siigo_invoice_name, total_factura,
              siigo_synced_at, creado_en)
           VALUES (?, NULL, ?, ?, 'borrador', ?, ?, ?, ?, ?, NOW(), NOW())`,
          [numero, customerName || 'PENDIENTE DATOS CLIENTE', bodegaId, userId,
           `Factura ${data.name} pendiente de sincronizar cliente`, data.id, data.name, data.total || null]
        );
        pendingDispatchId = inserted.insertId;
      }
      for (const item of preparedItems) {
        await upsertDemand(conn, {
          dispatchId: pendingDispatchId,
          productId: item.productId,
          invoiced: item.quantity,
          reserved: 0,
          status: 'PENDIENTE_DATOS_CLIENTE',
        });
      }
      await conn.commit();
      const notification = await notifyRoles({
        event: `dispatch_pending_customer:${pendingDispatchId}`,
        roles: ['admin'],
        text: `Factura ${data.name} pendiente: el cliente ${data.customerIdentification || data.customerId} no esta sincronizado en el WMS.`,
        fallbackRoles: [],
      }).catch(error => [{ status: 'error', error: error.message }]);
      return {
        status: 'pending_customer',
        id: pendingDispatchId,
        numero: existing[0]?.numero || numero,
        estado: 'PENDIENTE_DATOS_CLIENTE',
        siigo_invoice_id: data.id,
        siigo_invoice_name: data.name,
        notification,
      };
    }
    if (!existing.length) {
      await rejectMissingQuotationReference(conn, { data, customer, bodegaId });
    }
    if (!existing.length && data.quotationReference) {
      const converted = await convertQuotationReservation(conn, {
        data,
        customer,
        customerName,
        bodegaId,
        numero,
        userId,
      });
      await conn.commit();
      return converted;
    }
    let dispatchId;
    let status;
    if (existing.length) {
      const [currentItems] = await conn.execute(
        `SELECT p.siigo_code, di.cantidad_sol, di.precio_unitario,
                di.descuento, di.bodega_siigo_id
         FROM despacho_items di
         JOIN productos p ON p.id = di.producto_id
         WHERE di.despacho_id = ?`,
        [existing[0].id]
      );
      const sameHeader = Number(existing[0].tercero_id) === Number(customer.id)
        && Number(existing[0].total_factura || 0) === Number(data.total || 0)
        && Number(existing[0].bodega_id) === Number(bodegaId);
      if (sameHeader
          && JSON.stringify(invoiceSignature(currentItems)) === JSON.stringify(invoiceSignature(data.items))) {
        await conn.commit();
        return { status: 'duplicate', ...existing[0] };
      }

      dispatchId = existing[0].id;
      status = 'updated';
      await releaseReservations(conn, dispatchId, existing[0].bodega_id);
      await conn.execute(`DELETE FROM despacho_items WHERE despacho_id = ?`, [dispatchId]);
      await conn.execute(`DELETE FROM despacho_demanda_items WHERE despacho_id = ?`, [dispatchId]);
      await conn.execute(
        `UPDATE despachos
         SET tercero_id = ?, cliente_nombre = ?, bodega_id = ?, usuario_id = ?,
             observaciones = ?, siigo_invoice_name = ?, cufe = ?, stamp_status = ?,
             total_factura = ?, estado = 'picking', siigo_synced_at = NOW()
         WHERE id = ? AND estado IN ('picking','borrador')`,
        [customer.id, customerName, bodegaId, userId,
         data.observations || `Actualizado desde SIIGO ${data.name}`,
         data.name, data.cufe || null, data.stampStatus || null, data.total || null, dispatchId]
      );
    } else {
      const [inserted] = await conn.execute(
        `INSERT INTO despachos
           (numero, tercero_id, cliente_nombre, bodega_id, estado, usuario_id,
            observaciones, siigo_invoice_id, siigo_invoice_name, cufe,
            stamp_status, total_factura, siigo_synced_at, creado_en)
         VALUES (?, ?, ?, ?, 'picking', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [numero, customer.id, customerName, bodegaId, userId,
         data.observations || `Importado desde SIIGO ${data.name}`,
         data.id, data.name, data.cufe || null, data.stampStatus || null, data.total || null]
      );
      dispatchId = inserted.insertId;
      status = 'created';
    }
    const reserved = [];
    const shortages = [];

    for (const item of preparedItems) {
      const allocations = await allocateProduct(conn, {
        productId: item.productId,
        bodegaId: item.bodegaId,
        quantity: item.quantity,
        invoiceName: data.name,
      });
      for (const allocation of allocations) {
        const [stockUpdate] = await conn.execute(
          `UPDATE stock
           SET reservada = COALESCE(reservada, 0) + ?, actualizado_en = NOW()
           WHERE id = ? AND (cantidad - COALESCE(reservada, 0)) >= ?`,
          [allocation.quantity, allocation.stockId, allocation.quantity]
        );
        if (stockUpdate.affectedRows !== 1) {
          throw httpError(409, `El stock del lote ${allocation.lpn} cambio durante la reserva`);
        }
        await conn.execute(
          `INSERT INTO despacho_items
             (despacho_id, producto_id, ubicacion_id, lote, cantidad_sol,
              cantidad_des, precio_unitario, descuento, bodega_siigo_id)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [dispatchId, item.productId, allocation.ubicacionId, allocation.lpn,
           allocation.quantity, item.price || null, item.discount, item.remoteWarehouse]
        );
        reserved.push({
          sku: item.code,
          lote: allocation.lpn,
          ubicacion: allocation.ubicacion,
          cantidad: allocation.quantity,
        });
      }
      const reservedQuantity = Number((item.quantity - Number(allocations.shortage || 0)).toFixed(4));
      const demandStatus = Number(allocations.shortage || 0) > 0 ? 'PENDIENTE_STOCK' : 'RESERVADO';
      await upsertDemand(conn, {
        dispatchId,
        productId: item.productId,
        invoiced: item.quantity,
        reserved: reservedQuantity,
        status: demandStatus,
      });
      if (Number(allocations.shortage || 0) > 0) {
        shortages.push({ sku: item.code, cantidad: Number(allocations.shortage) });
      }
    }

    await conn.commit();
    const notificationState = shortages.length ? 'shortage' : 'ready';
    const notification = await notifyRoles({
      event: `dispatch_${notificationState}:${dispatchId}`,
      roles: ['despacho'],
      text: [
        shortages.length ? `Factura ${data.name} pendiente de stock` : `Despacho listo para factura ${data.name}`,
        `Cliente: ${customerName}`,
        ...reserved.map(item => `${item.sku}: ${item.cantidad} und | lote ${item.lote} | ubicacion ${item.ubicacion}`),
        ...shortages.map(item => `${item.sku}: faltan ${item.cantidad} und`),
        shortages.length ? 'No confirmes el despacho hasta completar la reserva.' : `Confirma el despacho ${existing[0]?.numero || numero} cuando salga fisicamente.`,
      ].join('\n'),
    }).catch(error => [{ status: 'error', error: error.message }]);
    return {
      status,
      id: dispatchId,
      numero: existing[0]?.numero || numero,
      estado: 'picking',
      siigo_invoice_id: data.id,
      siigo_invoice_name: data.name,
      reserved,
      shortages,
      ready_to_dispatch: shortages.length === 0,
      notification,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      const [rows] = await conn.execute(
        `SELECT id, numero, estado FROM despachos WHERE siigo_invoice_id = ? LIMIT 1`,
        [data.id]
      ).catch(() => [[]]);
      if (rows.length) return { status: 'duplicate', ...rows[0] };
    }
    throw err;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function cancelImportedInvoice(siigoInvoiceId, reason) {
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT id, numero, estado, bodega_id, siigo_invoice_id, siigo_invoice_name
       FROM despachos WHERE siigo_invoice_id = ? LIMIT 1 FOR UPDATE`,
      [siigoInvoiceId]
    );
    if (!rows.length) {
      await conn.commit();
      return { status: 'not_found', siigo_invoice_id: siigoInvoiceId };
    }
    const dispatch = rows[0];
    if (dispatch.estado === 'anulado') {
      await conn.commit();
      return { status: 'cancelled_duplicate', ...dispatch };
    }
    if (dispatch.estado !== 'picking') {
      await conn.commit();
      return { status: 'completed_change', ...dispatch };
    }

    const released = await releaseReservations(conn, dispatch.id, dispatch.bodega_id);
    await conn.execute(
      `UPDATE despachos
       SET estado = 'anulado',
           observaciones = CONCAT(COALESCE(observaciones, ''), '\n', ?)
       WHERE id = ? AND estado = 'picking'`,
      [reason || 'Factura anulada o eliminada en SIIGO; reserva liberada', dispatch.id]
    );
    await conn.commit();
    return { status: 'cancelled', ...dispatch, released };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = {
  buildSiigoDispatchNumber,
  importInvoice,
  cancelImportedInvoice,
  invoiceSignature,
  allocateProduct,
  releaseReservations,
};
