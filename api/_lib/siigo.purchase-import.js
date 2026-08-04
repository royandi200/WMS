const { createConnection } = require('./db');
const { notifyRoles } = require('./builderbot-notifications');
const { resolvePrimaryWarehouse } = require('./warehouses');

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

function itemSignature(items) {
  return items.map(item => ({
    code: String(item.code || item.siigo_code || '').trim(),
    quantity: Number(item.quantity ?? item.cantidad_esp ?? 0),
    price: Number(item.price ?? item.precio_unitario ?? 0),
    discount: Number(item.discount ?? item.descuento ?? 0),
    warehouse: Number(item.warehouse?.id ?? item.warehouse ?? item.bodega_siigo_id ?? 0),
  })).sort((left, right) => left.code.localeCompare(right.code));
}

function sameItems(left, right) {
  return JSON.stringify(itemSignature(left)) === JSON.stringify(itemSignature(right));
}

async function importPurchase(purchase, userId) {
  const data = normalizePurchase(purchase);
  if (!data.id || !data.name) throw httpError(400, 'Compra SIIGO sin id o nombre');
  if (!data.items.length) throw httpError(400, `Compra ${data.name} sin items`);

  const conn = await createConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.execute(
      `SELECT id, numero, estado, tercero_id, proveedor_invoice_prefix,
              proveedor_invoice_number, DATE_FORMAT(proveedor_invoice_date, '%Y-%m-%d') AS invoice_date,
              costo_total
       FROM recepciones WHERE siigo_purchase_id = ? LIMIT 1 FOR UPDATE`,
      [data.id]
    );
    if (existing.length && existing[0].estado !== 'borrador') {
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

    const warehouseId = await resolvePrimaryWarehouse(conn);

    if (existing.length) {
      const [currentItems] = await conn.execute(
        `SELECT p.siigo_code, ri.cantidad_esp, ri.precio_unitario,
                ri.descuento, ri.bodega_siigo_id
         FROM recepcion_items ri
         JOIN productos p ON p.id = ri.producto_id
         WHERE ri.recepcion_id = ?`,
        [existing[0].id]
      );
      const sameHeader = Number(existing[0].tercero_id) === Number(supplierRows[0].id)
        && String(existing[0].proveedor_invoice_prefix || '') === data.invoicePrefix
        && String(existing[0].proveedor_invoice_number || '') === data.invoiceNumber
        && String(existing[0].invoice_date || '') === String(data.date || '')
        && Number(existing[0].costo_total || 0) === Number(data.total || 0);
      if (sameHeader && sameItems(currentItems, data.items)) {
        await conn.commit();
        return { status: 'duplicate', ...existing[0] };
      }
    }

    const safeName = data.name.replace(/[^A-Za-z0-9-]/g, '').slice(0, 18) || data.id.slice(0, 8);
    const numero = `REC-SIIGO-${safeName}`.slice(0, 30);
    const supplier = supplierRows[0];
    const supplierName = data.supplierName || supplier.nombre_comercial || supplier.nombre || 'PROVEEDOR SIIGO';
    let receptionId;
    let status;
    if (existing.length) {
      receptionId = existing[0].id;
      status = 'updated';
      await conn.execute(
        `UPDATE recepciones
         SET tercero_id = ?, proveedor_nombre = ?, proveedor_invoice_prefix = ?,
             proveedor_invoice_number = ?, proveedor_invoice_date = ?, usuario_id = ?,
             observaciones = ?, siigo_purchase_name = ?, costo_total = ?
         WHERE id = ? AND estado = 'borrador'`,
        [supplier.id, supplierName, data.invoicePrefix || null, data.invoiceNumber || null,
         data.date, userId, data.observations || `Actualizada desde SIIGO ${data.name}`,
         data.name, data.total || null, receptionId]
      );
      await conn.execute(`DELETE FROM recepcion_items WHERE recepcion_id = ?`, [receptionId]);
    } else {
      const [inserted] = await conn.execute(
        `INSERT INTO recepciones
           (numero, tercero_id, proveedor_nombre, proveedor_invoice_prefix,
            proveedor_invoice_number, proveedor_invoice_date, bodega_id, estado,
            usuario_id, observaciones, siigo_purchase_id, siigo_purchase_name,
            costo_total, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?, ?, ?, NOW())`,
        [numero, supplier.id, supplierName, data.invoicePrefix || null,
         data.invoiceNumber || null, data.date, warehouseId, userId,
         data.observations || `Importada desde SIIGO ${data.name}`,
         data.id, data.name, data.total || null]
      );
      receptionId = inserted.insertId;
      status = 'created';
    }

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
        [receptionId, products.get(code), quantity, Number(item.price || 0),
         Number(item.discount || 0), warehouse ? Number(warehouse) : null]
      );
    }

    await conn.commit();
    const notification = await notifyRoles({
      event: `reception_pending:${receptionId}`,
      roles: ['recepcion_cierre'],
      text: [
        `Recepcion pendiente por compra ${data.name}`,
        `Proveedor: ${supplierName}`,
        `Items esperados: ${data.items.length}`,
        'Vincula la orden de compra, compara factura y confirma cantidades, lotes, condicion y ubicacion.',
      ].join('\n'),
    }).catch(error => [{ status: 'error', error: error.message }]);
    return {
      status,
      id: receptionId,
      numero: existing[0]?.numero || numero,
      estado: 'borrador',
      siigo_purchase_id: data.id,
      siigo_purchase_name: data.name,
      items: data.items.length,
      notification,
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
