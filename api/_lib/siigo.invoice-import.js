const { createConnection } = require('./db');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeInvoice(invoice) {
  const customer = invoice?.customer || {};
  return {
    id: String(invoice?.id || '').trim(),
    name: String(invoice?.name || '').trim(),
    date: invoice?.date || null,
    customerId: String(customer.id || '').trim(),
    customerIdentification: String(customer.identification || '').trim(),
    customerName: String(customer.name || customer.commercial_name || '').trim(),
    total: Number(invoice?.total || 0),
    observations: String(invoice?.observations || '').trim(),
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

  const [rows] = await conn.execute(
    `SELECT id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 1`
  );
  if (!rows.length) throw httpError(500, 'No hay bodega WMS activa');
  return rows[0].id;
}

async function allocateProduct(conn, { productId, bodegaId, quantity, invoiceName }) {
  const [rows] = await conn.execute(
    `SELECT s.id AS stock_id, s.ubicacion_id, s.lote,
            (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
            COALESCE(l.expiry_date, s.fecha_venc) AS vence
     FROM stock s
     LEFT JOIN lots l ON BINARY l.lpn = BINARY s.lote
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
        lpn: row.lote,
        quantity: allocated,
        expiry: row.vence || null,
      });
      remaining = Number((remaining - allocated).toFixed(4));
    }
  }

  if (remaining > 0) {
    const available = Number(quantity) - remaining;
    throw httpError(
      409,
      `Stock WMS insuficiente para ${invoiceName}. Solicitado: ${quantity}; disponible trazable: ${available}`
    );
  }
  return allocations;
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
    if (existing.length && existing[0].estado !== 'picking') {
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
    if (!customerRows.length) {
      throw httpError(409, `Cliente ${data.customerIdentification || data.customerId} no sincronizado`);
    }

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
    const safeName = data.name.replace(/[^A-Za-z0-9-]/g, '').slice(0, 18) || data.id.slice(0, 8);
    const numero = `DSP-SIIGO-${safeName}`.slice(0, 30);
    const customer = customerRows[0];
    const customerName = data.customerName || customer.nombre_comercial || customer.nombre || 'CLIENTE SIIGO';
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
      await conn.execute(
        `UPDATE despachos
         SET tercero_id = ?, cliente_nombre = ?, bodega_id = ?, usuario_id = ?,
             observaciones = ?, siigo_invoice_name = ?, cufe = ?, stamp_status = ?,
             total_factura = ?, siigo_synced_at = NOW()
         WHERE id = ? AND estado = 'picking'`,
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
        reserved.push({ sku: item.code, lote: allocation.lpn, cantidad: allocation.quantity });
      }
    }

    await conn.commit();
    return {
      status,
      id: dispatchId,
      numero: existing[0]?.numero || numero,
      estado: 'picking',
      siigo_invoice_id: data.id,
      siigo_invoice_name: data.name,
      reserved,
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
  importInvoice,
  cancelImportedInvoice,
  invoiceSignature,
  allocateProduct,
  releaseReservations,
};
