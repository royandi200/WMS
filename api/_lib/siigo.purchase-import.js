const { createConnection } = require('./db');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizePurchase(purchase) {
  const supplier = purchase?.supplier || {};
  const providerInvoice = purchase?.provider_invoice || {};
  return {
    id: String(purchase?.id || '').trim(),
    name: String(purchase?.name || '').trim(),
    date: purchase?.date || null,
    supplierId: String(supplier.id || '').trim(),
    supplierIdentification: String(supplier.identification || '').trim(),
    supplierName: String(supplier.name || supplier.business_name || '').trim(),
    invoicePrefix: String(providerInvoice.prefix || '').trim(),
    invoiceNumber: String(providerInvoice.number || '').trim(),
    total: Number(purchase?.total || 0),
    observations: String(purchase?.observations || '').trim(),
    items: Array.isArray(purchase?.items) ? purchase.items : [],
  };
}

async function importPurchase(purchase, userId) {
  const data = normalizePurchase(purchase);
  if (!data.id || !data.name) throw httpError(400, 'Compra SIIGO sin id o nombre');
  if (!data.items.length) throw httpError(400, `Compra ${data.name} sin items`);

  const conn = await createConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.execute(
      `SELECT id, numero, estado FROM recepciones WHERE siigo_purchase_id = ? LIMIT 1 FOR UPDATE`,
      [data.id]
    );
    if (existing.length) {
      await conn.commit();
      return { status: 'duplicate', ...existing[0] };
    }

    const [supplierRows] = await conn.execute(
      `SELECT id, nombre, nombre_comercial
       FROM terceros
       WHERE siigo_id = ? OR identification = ?
       ORDER BY siigo_id = ? DESC
       LIMIT 1`,
      [data.supplierId, data.supplierIdentification, data.supplierId]
    );
    if (!supplierRows.length) {
      throw httpError(409, `Proveedor ${data.supplierIdentification || data.supplierId} no sincronizado`);
    }

    const productCodes = [...new Set(data.items.map(item => String(item.code || '').trim()).filter(Boolean))];
    if (!productCodes.length) throw httpError(400, `Compra ${data.name} sin codigos de producto`);
    const placeholders = productCodes.map(() => '?').join(',');
    const [productRows] = await conn.execute(
      `SELECT id, siigo_code FROM productos WHERE siigo_code IN (${placeholders})`,
      productCodes
    );
    const products = new Map(productRows.map(row => [String(row.siigo_code), row.id]));
    const missing = productCodes.filter(code => !products.has(code));
    if (missing.length) {
      throw httpError(409, `Productos no sincronizados: ${missing.join(', ')}`);
    }

    const [warehouseRows] = await conn.execute(
      `SELECT id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 1`
    );
    if (!warehouseRows.length) throw httpError(500, 'No hay bodega WMS activa');

    const safeName = data.name.replace(/[^A-Za-z0-9-]/g, '').slice(0, 18) || data.id.slice(0, 8);
    const numero = `REC-SIIGO-${safeName}`.slice(0, 30);
    const supplier = supplierRows[0];
    const supplierName = data.supplierName || supplier.nombre_comercial || supplier.nombre || 'PROVEEDOR SIIGO';
    const [inserted] = await conn.execute(
      `INSERT INTO recepciones
         (numero, tercero_id, proveedor_nombre, proveedor_invoice_prefix,
          proveedor_invoice_number, proveedor_invoice_date, bodega_id, estado,
          usuario_id, observaciones, siigo_purchase_id, siigo_purchase_name,
          costo_total, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?, ?, ?, NOW())`,
      [numero, supplier.id, supplierName, data.invoicePrefix || null,
       data.invoiceNumber || null, data.date, warehouseRows[0].id, userId,
       data.observations || `Importada desde SIIGO ${data.name}`,
       data.id, data.name, data.total || null]
    );

    for (const item of data.items) {
      const code = String(item.code || '').trim();
      const quantity = Number(item.quantity || 0);
      if (!code || !Number.isFinite(quantity) || quantity <= 0) {
        throw httpError(400, `Item invalido en compra ${data.name}`);
      }
      const warehouse = item.warehouse?.id ?? item.warehouse ?? null;
      await conn.execute(
        `INSERT INTO recepcion_items
           (recepcion_id, producto_id, cantidad_esp, cantidad_rec,
            precio_unitario, descuento, bodega_siigo_id)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [inserted.insertId, products.get(code), quantity, Number(item.price || 0),
         Number(item.discount || 0), warehouse ? Number(warehouse) : null]
      );
    }

    await conn.commit();
    return {
      status: 'created',
      id: inserted.insertId,
      numero,
      estado: 'borrador',
      siigo_purchase_id: data.id,
      siigo_purchase_name: data.name,
      items: data.items.length,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      const [rows] = await conn.execute(
        `SELECT id, numero, estado FROM recepciones WHERE siigo_purchase_id = ? LIMIT 1`,
        [data.id]
      ).catch(() => [[]]);
      if (rows.length) return { status: 'duplicate', ...rows[0] };
    }
    throw err;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = { importPurchase };
