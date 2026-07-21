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
  const docId    = await getConfigValue('doc_id_factura_vta');
  const sellerId = await getConfigValue('default_seller_id');
  if (!docId) throw new Error('doc_id_factura_vta no configurado. Ejecutar sync-document-types primero.');

  // 4. Construir payload SIIGO
  const payload = {
    document: { id: Number(docId) },
    date: (desp.despachado_en || desp.creado_en)
      ? new Date(desp.despachado_en || desp.creado_en).toISOString().substring(0, 10)
      : new Date().toISOString().substring(0, 10),
    customer: desp.tercero_siigo_id
      ? { id: desp.tercero_siigo_id }
      : {
          person_type:    desp.person_type    || 'company',
          id_type:        { id: desp.id_type  || '13' },
          identification: desp.identification || desp.cliente_nombre || '',
          name:           desp.tercero_nombre || desp.cliente_nombre || 'CLIENTE',
          branch_office:  desp.branch_office  || 0,
        },
    seller: sellerId ? { id: Number(sellerId) } : undefined,
    items: items.map(i => ({
      code:      i.siigo_code,
      quantity:  Number(i.cantidad_des || i.cantidad_sol || 1),
      price:     Number(i.precio_unitario ?? i.precio_venta ?? 0),
      discount:  Number(i.descuento || 0),
      taxes: i.tax_classification === 'Taxed'
        ? [{ id: 8187 }]  // IVA 19% sandbox — ajustar según producción
        : [],
    })),
    observations: desp.observaciones || `Despacho WMS ${desp.numero}`,
    // Facturación electrónica DIAN
    stamp: { send: true },
    send_email: false,
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
       WHERE referencia_id = ? AND referencia_tipo LIKE 'despacho%' LIMIT 5`,
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
     WHERE referencia_id = ? AND referencia_tipo LIKE 'despacho%'`,
    [siigoId, despachoId]
  ).catch(() => {});

  return { ok: true, siigo_id: siigoId, siigo_name: siigoName, cufe, stamp_status: stampStatus };
}

module.exports = { pushFacturaToSiigo };
