const { createConnection } = require('./db');
const { allocateProduct, releaseReservations, invoiceSignature } = require('./siigo.invoice-import');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeQuotation(quotation) {
  const customer = quotation?.customer || {};
  return {
    id: String(quotation?.id || '').trim(),
    name: String(quotation?.name || '').trim(),
    customerId: String(customer.id || '').trim(),
    customerIdentification: String(customer.identification || '').trim(),
    total: Number(quotation?.total || 0),
    items: Array.isArray(quotation?.items) ? quotation.items : [],
  };
}

async function ensureTable(conn) {
  await conn.execute(
    `CREATE TABLE IF NOT EXISTS siigo_cotizacion_reservas (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       siigo_quotation_id VARCHAR(60) NOT NULL UNIQUE,
       siigo_quotation_name VARCHAR(50) NULL,
       despacho_id INT UNSIGNED NULL UNIQUE,
       estado VARCHAR(20) NOT NULL,
       motivo TEXT NULL,
       usuario_id INT UNSIGNED NULL,
       expira_en DATETIME NULL,
       creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_cotizacion_reservas_estado (estado)
     )`
  );
}

async function saveBlocked(data, userId, reason) {
  const conn = await createConnection();
  try {
    await ensureTable(conn);
    await conn.execute(
      `INSERT INTO siigo_cotizacion_reservas
         (siigo_quotation_id, siigo_quotation_name, estado, motivo, usuario_id, creado_en)
       VALUES (?, ?, 'BLOQUEADA', ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         siigo_quotation_name = VALUES(siigo_quotation_name),
         estado = IF(estado = 'RESERVADA', estado, 'BLOQUEADA'),
         motivo = IF(estado = 'RESERVADA', motivo, VALUES(motivo)),
         usuario_id = VALUES(usuario_id),
         actualizado_en = NOW()`,
      [data.id, data.name || null, reason, userId]
    );
  } finally {
    await conn.end().catch(() => {});
  }
  return {
    status: 'blocked',
    siigo_quotation_id: data.id,
    siigo_quotation_name: data.name,
    reason,
  };
}

async function reserveQuotation(quotation, userId) {
  const data = normalizeQuotation(quotation);
  if (!data.id || !data.name) throw httpError(400, 'Cotizacion SIIGO sin id o nombre');
  if (!data.items.length) throw httpError(400, `Cotizacion ${data.name} sin items`);

  const conn = await createConnection();
  try {
    await ensureTable(conn);
    await conn.beginTransaction();

    const [existingRows] = await conn.execute(
      `SELECT r.*, d.estado AS despacho_estado, d.bodega_id
       FROM siigo_cotizacion_reservas r
       LEFT JOIN despachos d ON d.id = r.despacho_id
       WHERE r.siigo_quotation_id = ?
       LIMIT 1 FOR UPDATE`,
      [data.id]
    );
    const existing = existingRows[0] || null;

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

    const [warehouseRows] = await conn.execute(
      `SELECT id, siigo_id FROM bodegas
       WHERE activa = 1 AND codigo = ? LIMIT 1`,
      [String(process.env.SIIGO_WMS_WAREHOUSE_CODE || 'BG-PPAL').trim()]
    );
    if (!warehouseRows.length) throw httpError(500, 'Bodega principal WMS no configurada');
    const warehouse = warehouseRows[0];

    const codes = [...new Set(data.items.map(item => String(item.code || '').trim()).filter(Boolean))];
    const placeholders = codes.map(() => '?').join(',');
    const [productRows] = await conn.execute(
      `SELECT id, siigo_code FROM productos WHERE siigo_code IN (${placeholders})`,
      codes
    );
    const products = new Map(productRows.map(row => [String(row.siigo_code), row.id]));
    const missing = codes.filter(code => !products.has(code));
    if (missing.length) throw httpError(409, `Productos no sincronizados: ${missing.join(', ')}`);

    if (existing?.estado === 'RESERVADA' && existing.despacho_estado === 'picking') {
      const [currentItems] = await conn.execute(
        `SELECT p.siigo_code, di.cantidad_sol, di.precio_unitario,
                di.descuento, di.bodega_siigo_id
         FROM despacho_items di
         JOIN productos p ON p.id = di.producto_id
         WHERE di.despacho_id = ?`,
        [existing.despacho_id]
      );
      const remoteItems = data.items.map(item => ({
        ...item,
        warehouse: warehouse.siigo_id || 0,
      }));
      if (JSON.stringify(invoiceSignature(currentItems)) === JSON.stringify(invoiceSignature(remoteItems))) {
        await conn.commit();
        return {
          status: 'duplicate',
          id: existing.id,
          despacho_id: existing.despacho_id,
          estado: existing.estado,
          siigo_quotation_id: data.id,
          siigo_quotation_name: data.name,
        };
      }
      await releaseReservations(conn, existing.despacho_id, existing.bodega_id);
      await conn.execute(`DELETE FROM despacho_items WHERE despacho_id = ?`, [existing.despacho_id]);
    }

    const prepared = data.items.map(item => {
      const quantity = Number(item.quantity || 0);
      const code = String(item.code || '').trim();
      if (!code || !Number.isFinite(quantity) || quantity <= 0) {
        throw httpError(400, `Item invalido en cotizacion ${data.name}`);
      }
      return {
        code,
        productId: products.get(code),
        quantity,
        price: Number(item.price || 0),
        discount: Number(item.discount?.percentage ?? item.discount ?? 0),
      };
    });

    const safeName = data.name.replace(/[^A-Za-z0-9-]/g, '').slice(0, 18) || data.id.slice(0, 8);
    const numero = `RES-COT-${safeName}`.slice(0, 30);
    const customer = customerRows[0];
    const customerName = customer.nombre_comercial || customer.nombre || 'CLIENTE SIIGO';
    let dispatchId = existing?.estado === 'RESERVADA' && existing?.despacho_estado === 'picking'
      ? existing.despacho_id
      : null;
    const status = dispatchId ? 'updated' : 'reserved';

    if (dispatchId) {
      await conn.execute(
        `UPDATE despachos
         SET tercero_id = ?, cliente_nombre = ?, bodega_id = ?, usuario_id = ?,
             observaciones = ?, total_factura = ?, siigo_synced_at = NOW()
         WHERE id = ? AND estado = 'picking'`,
        [customer.id, customerName, warehouse.id, userId,
         `Reserva previa por cotizacion SIIGO ${data.name}`, data.total || null, dispatchId]
      );
    } else {
      const [inserted] = await conn.execute(
        `INSERT INTO despachos
           (numero, tercero_id, cliente_nombre, bodega_id, estado, usuario_id,
            observaciones, total_factura, siigo_synced_at, creado_en)
         VALUES (?, ?, ?, ?, 'picking', ?, ?, ?, NOW(), NOW())`,
        [numero, customer.id, customerName, warehouse.id, userId,
         `Reserva previa por cotizacion SIIGO ${data.name}`, data.total || null]
      );
      dispatchId = inserted.insertId;
    }

    const reserved = [];
    for (const item of prepared) {
      const allocations = await allocateProduct(conn, {
        productId: item.productId,
        bodegaId: warehouse.id,
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
           allocation.quantity, item.price || null, item.discount, warehouse.siigo_id || null]
        );
        reserved.push({ sku: item.code, lote: allocation.lpn, cantidad: allocation.quantity });
      }
    }

    await conn.execute(
      `INSERT INTO siigo_cotizacion_reservas
         (siigo_quotation_id, siigo_quotation_name, despacho_id, estado,
          motivo, usuario_id, expira_en, creado_en)
       VALUES (?, ?, ?, 'RESERVADA', NULL, ?, DATE_ADD(NOW(), INTERVAL 2 HOUR), NOW())
       ON DUPLICATE KEY UPDATE
         siigo_quotation_name = VALUES(siigo_quotation_name),
         despacho_id = VALUES(despacho_id), estado = 'RESERVADA', motivo = NULL,
         usuario_id = VALUES(usuario_id), expira_en = VALUES(expira_en),
         actualizado_en = NOW()`,
      [data.id, data.name, dispatchId, userId]
    );

    await conn.commit();
    return {
      status,
      despacho_id: dispatchId,
      numero: status === 'reserved' ? numero : undefined,
      estado: 'RESERVADA',
      siigo_quotation_id: data.id,
      siigo_quotation_name: data.name,
      expires_in_minutes: 120,
      reserved,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.status === 409) return saveBlocked(data, userId, err.message);
    throw err;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function cancelQuotation(siigoQuotationId, reason) {
  const conn = await createConnection();
  try {
    await ensureTable(conn);
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT r.*, d.bodega_id, d.estado AS despacho_estado
       FROM siigo_cotizacion_reservas r
       LEFT JOIN despachos d ON d.id = r.despacho_id
       WHERE r.siigo_quotation_id = ? LIMIT 1 FOR UPDATE`,
      [siigoQuotationId]
    );
    if (!rows.length) {
      await conn.commit();
      return { status: 'not_found', siigo_quotation_id: siigoQuotationId };
    }
    const reservation = rows[0];
    if (reservation.estado === 'RESERVADA' && reservation.despacho_estado === 'picking') {
      await releaseReservations(conn, reservation.despacho_id, reservation.bodega_id);
      await conn.execute(
        `UPDATE despachos
         SET estado = 'anulado', observaciones = CONCAT(COALESCE(observaciones, ''), '\n', ?)
         WHERE id = ? AND estado = 'picking'`,
        [reason || 'Cotizacion eliminada en SIIGO; reserva liberada', reservation.despacho_id]
      );
    }
    await conn.execute(
      `UPDATE siigo_cotizacion_reservas
       SET estado = 'CANCELADA', motivo = ?, expira_en = NULL, actualizado_en = NOW()
       WHERE id = ?`,
      [reason || 'Cotizacion eliminada en SIIGO', reservation.id]
    );
    await conn.commit();
    return {
      status: 'cancelled',
      despacho_id: reservation.despacho_id,
      siigo_quotation_id: siigoQuotationId,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = { reserveQuotation, cancelQuotation };
