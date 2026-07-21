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
  const docId = await getConfigValue('doc_id_factura_cmp');
  if (!docId) throw new Error('doc_id_factura_cmp no configurado. Ejecutar sync-document-types primero.');

  // 4. Construir payload SIIGO
  const payload = {
    document: { id: Number(docId) },
    date: (rec.completado_en || rec.creado_en)
      ? new Date(rec.completado_en || rec.creado_en).toISOString().substring(0, 10)
      : new Date().toISOString().substring(0, 10),
    supplier: rec.tercero_siigo_id
      ? { id: rec.tercero_siigo_id }
      : {
          person_type:    rec.person_type    || 'company',
          id_type:        { id: rec.id_type  || '31' },
          identification: rec.identification || rec.proveedor_nombre || '',
          name:           rec.tercero_nombre || rec.proveedor_nombre || 'PROVEEDOR',
          branch_office:  rec.branch_office  || 0,
        },
    // Factura física del proveedor (opcional)
    ...(rec.proveedor_invoice_number ? {
      provider_invoice: {
        prefix: rec.proveedor_invoice_prefix || '',
        number: rec.proveedor_invoice_number,
        date:   rec.proveedor_invoice_date
          ? new Date(rec.proveedor_invoice_date).toISOString().substring(0, 10)
          : new Date().toISOString().substring(0, 10),
      },
    } : {}),
    items: items.map(i => ({
      code:      i.siigo_code,
      quantity:  Number(i.cantidad_rec || i.cantidad_esp || 1),
      price:     Number(i.precio_unitario || 0),
      discount:  Number(i.descuento || 0),
      taxes: i.tax_classification === 'Taxed'
        ? [{ id: 8187 }]  // IVA 19% sandbox — ajustar según doc-types en producción
        : [],
    })),
    observations: rec.observaciones || `Recepción WMS ${rec.numero}`,
  };

  // 5. Enviar a SIIGO
  const resp = await siigoPost('/v1/purchases', payload, {
    entidad:    'compra',
    entidad_id: recepcionId,
  });

  const siigoId   = resp?.id   || null;
  const siigoName = resp?.name || null;

  // 6. Guardar resultado en recepciones
  await query(
    `UPDATE recepciones
     SET siigo_purchase_id = ?, siigo_purchase_name = ?, siigo_synced_at = NOW()
     WHERE id = ?`,
    [siigoId, siigoName, recepcionId]
  );

  return { ok: true, siigo_id: siigoId, siigo_name: siigoName };
}

module.exports = { pushCompraToSiigo };
