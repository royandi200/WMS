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

    const [active] = await conn.execute(
      `SELECT id, siigo_id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 2`
    );
    if (active.length === 1 && active[0].siigo_id == null) {
      await conn.execute(
        `UPDATE bodegas SET siigo_id = ? WHERE id = ? AND siigo_id IS NULL`,
        [Number(remoteWarehouseId), active[0].id]
      );
      return active[0].id;
    }
    throw httpError(409, `Bodega SIIGO ${remoteWarehouseId} no esta mapeada en WMS`);
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

async function importInvoice(invoice, userId) {
  const data = normalizeInvoice(invoice);
  if (!data.id || !data.name) throw httpError(400, 'Factura SIIGO sin id o nombre');
  if (data.annulled) throw httpError(409, `Factura ${data.name} anulada en SIIGO`);
  if (!data.items.length) throw httpError(400, `Factura ${data.name} sin items`);

  const conn = await createConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.execute(
      `SELECT id, numero, estado, siigo_invoice_id, siigo_invoice_name
       FROM despachos WHERE siigo_invoice_id = ? LIMIT 1 FOR UPDATE`,
      [data.id]
    );
    if (existing.length) {
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
    const dispatchId = inserted.insertId;
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
      status: 'created',
      id: dispatchId,
      numero,
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

module.exports = { importInvoice };
