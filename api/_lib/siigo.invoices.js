// api/_lib/siigo.invoices.js
// Fase 4 — Crear Factura de Venta (FV) en SIIGO al confirmar un despacho.
//
// Uso:
//   const { pushFacturaToSiigo } = require('./siigo.invoices');
//   await pushFacturaToSiigo(despachoId, conn);
//
// Flujo:
//   1. Lee datos de despachos + despacho_items + productos + terceros
//   2. Construye el payload para POST /v1/invoices
//   3. Envía a SIIGO y guarda siigo_invoice_id, cufe, stamp_status en despachos
//   4. Si falla con 4xx/5xx marca siigo_sync=0 en movimientos para reintento

const { siigoPost } = require('./siigo.service');
const { query }     = require('./db');

async function getConfigValue(clave) {
  const rows = await query(`SELECT valor FROM siigo_config WHERE clave = ? LIMIT 1`, [clave]);
  return rows[0]?.valor ?? null;
}

async function getRequiredConfig(clave) {
  const value = await getConfigValue(clave);
  if (!value) throw new Error(`${clave} no configurado`);
  return value;
}

function calculateInvoiceTotal(items, taxPercentage) {
  return Number(items.reduce((total, item) => {
    const quantity = Number(item.cantidad_des ?? item.cantidad_sol ?? 0);
    const price = Number(item.precio_unitario ?? item.precio_venta ?? 0);
    const discount = Number(item.descuento || 0);
    if (quantity <= 0 || price <= 0) {
      throw new Error(`Item ${item.siigo_code || ''} sin cantidad o precio valido`);
    }
    const base = quantity * price * (1 - discount / 100);
    const tax = item.tax_classification === 'Taxed' ? base * taxPercentage / 100 : 0;
    return total + base + tax;
  }, 0).toFixed(2));
}

async function pushFacturaToSiigo(despachoId, conn) {
  const q = conn
    ? (sql, p) => conn.query(sql, p).then(([r]) => r)
    : (sql, p) => query(sql, p);

  // 1. Datos del despacho
  const [despRows] = await (conn
    ? conn.execute(
        `SELECT d.*, t.siigo_id AS tercero_siigo_id, t.identification,
                t.nombre AS tercero_nombre, t.person_type, t.id_type, t.branch_office
         FROM despachos d
         LEFT JOIN terceros t ON t.id = d.tercero_id
         WHERE d.id = ? LIMIT 1`, [despachoId])
    : query(
        `SELECT d.*, t.siigo_id AS tercero_siigo_id, t.identification,
                t.nombre AS tercero_nombre, t.person_type, t.id_type, t.branch_office
         FROM despachos d
         LEFT JOIN terceros t ON t.id = d.tercero_id
         WHERE d.id = ? LIMIT 1`, [despachoId]).then(r => [r]));

  const desp = despRows[0];
  if (!desp) throw new Error(`Despacho ${despachoId} no encontrado`);
  if (desp.siigo_invoice_id) return { already_synced: true, siigo_id: desp.siigo_invoice_id };

  // 2. Items del despacho
  const items = await query(
    `SELECT di.*, p.siigo_code, p.siigo_id AS producto_siigo_id,
            p.nombre AS producto_nombre, p.unit_code, p.tax_classification, p.precio_venta
     FROM despacho_items di
     JOIN productos p ON p.id = di.producto_id
     WHERE di.despacho_id = ?`,
    [despachoId]
  );
  if (!items.length) throw new Error('Despacho sin items');

  // 3. ID del tipo de comprobante FV
  const docId       = await getRequiredConfig('doc_id_factura_vta');
  const sellerId    = await getRequiredConfig('default_seller_id');
  const paymentId   = await getRequiredConfig('default_payment_fv_id');
  const taxId       = await getRequiredConfig('default_tax_id');
  const taxPercent  = Number(await getConfigValue('default_tax_percentage') || 19);
  const warehouseId = await getConfigValue('default_warehouse_id');
  if (!docId) throw new Error('doc_id_factura_vta no configurado. Ejecutar sync-document-types primero.');
  if (!desp.identification) throw new Error('El despacho requiere un cliente sincronizado con SIIGO');

  const total = calculateInvoiceTotal(items, taxPercent);

  // 4. Construir payload SIIGO
  const payload = {
    document: { id: Number(docId) },
    date: (desp.despachado_en || desp.creado_en)
      ? new Date(desp.despachado_en || desp.creado_en).toISOString().substring(0, 10)
      : new Date().toISOString().substring(0, 10),
    customer: {
      identification: desp.identification,
      branch_office: Number(desp.branch_office || 0),
    },
    seller: Number(sellerId),
    items: items.map(i => ({
      code:      i.siigo_code,
      quantity:  Number(i.cantidad_des ?? i.cantidad_sol ?? 0),
      price:     Number(i.precio_unitario ?? i.precio_venta ?? 0),
      discount:  Number(i.descuento || 0),
      ...(i.bodega_siigo_id || warehouseId
        ? { warehouse: Number(i.bodega_siigo_id || warehouseId) }
        : {}),
      taxes: i.tax_classification === 'Taxed'
        ? [{ id: Number(taxId) }]
        : [],
    })),
    observations: desp.observaciones || `Despacho WMS ${desp.numero}`,
    payments: [{ id: Number(paymentId), value: total }],
    stamp: { send: process.env.SIIGO_STAMP_SEND === 'true' },
    mail: { send: false },
  };

  // 5. Enviar a SIIGO
  let resp;
  try {
    resp = await siigoPost('/v1/invoices', payload, {
      entidad:    'factura',
      entidad_id: despachoId,
    });
  } catch (err) {
    // Marcar movimiento para reintento
    await query(
      `UPDATE movimientos SET siigo_sync = 0
       WHERE referencia_id = ? AND referencia_tipo = 'despacho_siigo' LIMIT 5`,
      [despachoId]
    ).catch(() => {});
    throw err;
  }

  const siigoId     = resp?.id          || null;
  const siigoName   = resp?.name        || null;
  const cufe        = resp?.stamp?.cufe || resp?.cufe || null;
  const stampStatus = resp?.stamp?.status || null;

  // 6. Guardar resultado en despachos
  await query(
    `UPDATE despachos
     SET siigo_invoice_id = ?, siigo_invoice_name = ?, cufe = ?,
         stamp_status = ?, siigo_synced_at = NOW()
     WHERE id = ?`,
    [siigoId, siigoName, cufe, stampStatus, despachoId]
  );

  // 7. Marcar movimientos como sincronizados
  await query(
    `UPDATE movimientos
     SET siigo_sync = 1, siigo_voucher_id = ?
     WHERE referencia_id = ? AND referencia_tipo = 'despacho_siigo'`,
    [siigoId, despachoId]
  ).catch(() => {});

  return {
    ok: true,
    siigo_id: siigoId,
    siigo_name: siigoName,
    cufe,
    stamp_status: stampStatus,
    total,
  };
}

module.exports = { pushFacturaToSiigo };
