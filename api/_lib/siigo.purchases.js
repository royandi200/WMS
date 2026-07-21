// api/_lib/siigo.purchases.js
// Fase 3 — Crear Factura de Compra (FC) en SIIGO al completar una recepción.
//
// Uso:
//   const { pushCompraToSiigo } = require('./siigo.purchases');
//   await pushCompraToSiigo(recepcionId, conn);
//
// Flujo:
//   1. Lee datos de recepciones + recepcion_items + productos + terceros
//   2. Construye el payload para POST /v1/purchases
//   3. Envía a SIIGO y guarda siigo_purchase_id + siigo_purchase_name en recepciones
//   4. Si falla, deja movimiento con siigo_sync=0 para reintento

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

function calculatePurchaseTotal(items, taxPercentage) {
  return Number(items.reduce((total, item) => {
    const quantity = Number(item.cantidad_rec ?? item.cantidad_esp ?? 0);
    const price = Number(item.precio_unitario || 0);
    const discount = Number(item.descuento || 0);
    if (quantity <= 0 || price <= 0) {
      throw new Error(`Item ${item.siigo_code || ''} sin cantidad o precio valido`);
    }
    const base = quantity * price * (1 - discount / 100);
    const tax = item.tax_classification === 'Taxed' ? base * taxPercentage / 100 : 0;
    return total + base + tax;
  }, 0).toFixed(2));
}

async function pushCompraToSiigo(recepcionId, conn) {
  const q = conn
    ? (sql, p) => conn.query(sql, p).then(([r]) => r)
    : (sql, p) => query(sql, p);

  // 1. Datos de la recepcion
  const [recRows] = await (conn
    ? conn.execute(
        `SELECT r.*, t.siigo_id AS tercero_siigo_id, t.identification, t.nombre AS tercero_nombre,
                t.person_type, t.id_type, t.branch_office
         FROM recepciones r
         LEFT JOIN terceros t ON t.id = r.tercero_id
         WHERE r.id = ? LIMIT 1`, [recepcionId])
    : query(
        `SELECT r.*, t.siigo_id AS tercero_siigo_id, t.identification, t.nombre AS tercero_nombre,
                t.person_type, t.id_type, t.branch_office
         FROM recepciones r
         LEFT JOIN terceros t ON t.id = r.tercero_id
         WHERE r.id = ? LIMIT 1`, [recepcionId]).then(r => [r]));

  const rec = recRows[0];
  if (!rec) throw new Error(`Recepcion ${recepcionId} no encontrada`);
  if (rec.siigo_purchase_id) return { already_synced: true, siigo_id: rec.siigo_purchase_id };

  // 2. Items de la recepcion
  const items = await query(
    `SELECT ri.*, p.siigo_code, p.siigo_id AS producto_siigo_id, p.nombre AS producto_nombre,
            p.unit_code, p.tax_classification
     FROM recepcion_items ri
     JOIN productos p ON p.id = ri.producto_id
     WHERE ri.recepcion_id = ?`,
    [recepcionId]
  );
  if (!items.length) throw new Error('Recepción sin items');

  // 3. ID del tipo de comprobante FC
  const docId       = await getRequiredConfig('doc_id_factura_cmp');
  const paymentId   = await getRequiredConfig('default_payment_fc_id');
  const taxId       = await getRequiredConfig('default_tax_id');
  const taxPercent  = Number(await getConfigValue('default_tax_percentage') || 19);
  const warehouseId = await getConfigValue('default_warehouse_id');
  if (!docId) throw new Error('doc_id_factura_cmp no configurado. Ejecutar sync-document-types primero.');
  if (!rec.identification) throw new Error('La recepcion requiere un proveedor sincronizado con SIIGO');
  if (!rec.proveedor_invoice_number) throw new Error('La recepcion requiere numero de factura del proveedor');

  const total = calculatePurchaseTotal(items, taxPercent);

  // 4. Construir payload SIIGO
  const payload = {
    document: { id: Number(docId) },
    date: (rec.completado_en || rec.creado_en)
      ? new Date(rec.completado_en || rec.creado_en).toISOString().substring(0, 10)
      : new Date().toISOString().substring(0, 10),
    supplier: {
      identification: rec.identification,
      branch_office: Number(rec.branch_office || 0),
    },
    provider_invoice: {
      prefix: rec.proveedor_invoice_prefix || 'WQA',
      number: String(rec.proveedor_invoice_number),
    },
    items: items.map(i => ({
      type:      'Product',
      code:      i.siigo_code,
      quantity:  Number(i.cantidad_rec ?? i.cantidad_esp ?? 0),
      price:     Number(i.precio_unitario || 0),
      discount:  Number(i.descuento || 0),
      ...(i.bodega_siigo_id || warehouseId
        ? { warehouse: Number(i.bodega_siigo_id || warehouseId) }
        : {}),
      taxes: i.tax_classification === 'Taxed'
        ? [{ id: Number(taxId) }]
        : [],
    })),
    payments: [{ id: Number(paymentId), value: total }],
    observations: rec.observaciones || `Recepcion WMS ${rec.numero}`,
  };

  // 5. Enviar a SIIGO
  let resp;
  try {
    resp = await siigoPost('/v1/purchases', payload, {
      entidad:    'compra',
      entidad_id: recepcionId,
    });
  } catch (err) {
    await query(
      `UPDATE movimientos SET siigo_sync = 0
       WHERE referencia_id = ? AND referencia_tipo = 'recepcion_siigo' LIMIT 5`,
      [recepcionId]
    ).catch(() => {});
    throw err;
  }

  const siigoId   = resp?.id   || null;
  const siigoName = resp?.name || null;

  // 6. Guardar resultado en recepciones
  await query(
    `UPDATE recepciones
     SET siigo_purchase_id = ?, siigo_purchase_name = ?, siigo_synced_at = NOW()
     WHERE id = ?`,
    [siigoId, siigoName, recepcionId]
  );

  await query(
    `UPDATE movimientos
     SET siigo_sync = 1, siigo_voucher_id = ?
     WHERE referencia_id = ? AND referencia_tipo = 'recepcion_siigo'`,
    [siigoId, recepcionId]
  ).catch(() => {});

  return { ok: true, siigo_id: siigoId, siigo_name: siigoName, total };
}

module.exports = { pushCompraToSiigo };
