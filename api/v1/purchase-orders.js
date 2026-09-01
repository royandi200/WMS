const { createConnection, query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { normalizePurchaseOrderInput } = require('../_lib/purchase-orders');
const { normalizePurchaseOrderPdf, safeDownloadName } = require('../_lib/purchase-order-documents');
const {
  cancelPurchaseOrder,
  normalizePurchaseOrderCancellation,
} = require('../_lib/purchase-order-cancellation');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.RECEPTION_READ);
  const documentId = Number(req.query?.document_id || 0);
  if (Number.isInteger(documentId) && documentId > 0) {
    const documents = await query(
      `SELECT d.nombre_original, d.mime_type, d.contenido
         FROM orden_compra_documentos d
         JOIN ordenes_compra_proveedor oc ON oc.id = d.orden_compra_id
        WHERE d.id = ? AND d.activo = 1
        LIMIT 1`,
      [documentId]
    );
    if (!documents.length) throw httpError(404, 'Documento de orden de compra no encontrado');
    const name = safeDownloadName(documents[0].nombre_original);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(documents[0].contenido);
  }
  const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 200);
  const estado = String(req.query?.estado || '').trim().toUpperCase();
  const where = estado ? 'WHERE oc.estado = ?' : '';
  const params = estado ? [estado, limit] : [limit];
  const rows = await query(
    `SELECT oc.id, oc.numero, oc.tercero_id, oc.proveedor_nombre, oc.fecha_orden,
            oc.estado, oc.archivo_nombre, oc.creado_en, oc.actualizado_en,
            oc.motivo_cancelacion, oc.cancelada_en, oc.cancelada_por,
            d.id AS documento_id, d.nombre_original AS documento_nombre,
            d.tamano_bytes AS documento_tamano, d.sha256 AS documento_sha256,
            u.nombre AS creado_por_nombre,
            cu.nombre AS cancelada_por_nombre,
            COUNT(oci.id) AS total_items,
            COALESCE(SUM(oci.cantidad_ordenada), 0) AS total_unidades
     FROM ordenes_compra_proveedor oc
     JOIN usuarios u ON u.id = oc.creado_por
     LEFT JOIN usuarios cu ON cu.id = oc.cancelada_por
     LEFT JOIN orden_compra_proveedor_items oci ON oci.orden_compra_id = oc.id
     LEFT JOIN orden_compra_documentos d ON d.orden_compra_id = oc.id AND d.activo = 1
     ${where}
     GROUP BY oc.id, oc.numero, oc.tercero_id, oc.proveedor_nombre, oc.fecha_orden,
              oc.estado, oc.archivo_nombre, oc.creado_en, oc.actualizado_en,
              oc.motivo_cancelacion, oc.cancelada_en, oc.cancelada_por,
              d.id, d.nombre_original, d.tamano_bytes, d.sha256, u.nombre, cu.nombre
     ORDER BY oc.creado_en DESC
     LIMIT ?`,
    params
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePatch(req, res) {
  const user = await requireCapability(req, CAPABILITIES.PURCHASE_ORDER_CANCEL);
  const input = normalizePurchaseOrderCancellation(req.body || {});
  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();
    const result = await cancelPurchaseOrder(conn, { ...input, userId: user.id });
    await conn.commit();
    return res.status(200).json({ ok: true, data: result });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function resolveProduct(conn, item) {
  const [rows] = await conn.execute(
    `SELECT id, siigo_code, nombre
     FROM productos
     WHERE activo = 1
       AND ((? IS NOT NULL AND id = ?) OR (? IS NOT NULL AND UPPER(siigo_code) = UPPER(?)))
     LIMIT 1`,
    [item.productId, item.productId, item.sku, item.sku]
  );
  if (!rows.length) throw httpError(404, `Producto no encontrado: ${item.sku || item.productId}`);
  return rows[0];
}

async function createPurchaseOrderRecord(conn, { input, document, userId }) {
  const [existing] = await conn.execute(
      `SELECT id, numero, estado, archivo_hash
       FROM ordenes_compra_proveedor WHERE numero = ? LIMIT 1 FOR UPDATE`,
      [input.numero]
  );
  if (existing.length) {
    if (existing[0].archivo_hash === input.hash) {
      const [documents] = await conn.execute(
          `SELECT id, sha256 FROM orden_compra_documentos
            WHERE orden_compra_id = ? AND activo = 1 LIMIT 1 FOR UPDATE`,
          [existing[0].id]
      );
      if (documents.length && documents[0].sha256 !== document.hash) {
        throw httpError(409, `La orden ${input.numero} ya existe con un PDF diferente`);
      }
      if (!documents.length) {
        const [attached] = await conn.execute(
            `INSERT INTO orden_compra_documentos
               (orden_compra_id, version, nombre_original, mime_type, tamano_bytes,
                sha256, contenido, activo, cargado_por, creado_en)
             VALUES (?, 1, ?, ?, ?, ?, ?, 1, ?, NOW())`,
            [existing[0].id, document.name, document.mimeType, document.size,
             document.hash, document.content, userId]
        );
        await conn.execute(
            `UPDATE ordenes_compra_proveedor SET archivo_nombre = ?, actualizado_en = NOW() WHERE id = ?`,
            [document.name, existing[0].id]
        );
        return { status: 200, data: { ...existing[0], duplicate: true, document_attached: true, documento_id: attached.insertId } };
      }
      return { status: 200, data: { ...existing[0], duplicate: true, documento_id: documents[0].id } };
    }
    throw httpError(409, `La orden ${input.numero} ya existe con contenido diferente`);
  }

  const [suppliers] = await conn.execute(
      `SELECT id, COALESCE(NULLIF(nombre_comercial, ''), nombre) AS nombre
         FROM terceros
        WHERE id = ? AND tipo = 'Supplier' AND activo = 1
          AND siigo_id IS NOT NULL AND siigo_id <> ''
        LIMIT 1`,
      [input.terceroId]
  );
  if (!suppliers.length) throw httpError(404, 'Proveedor sincronizado no encontrado');
  input.proveedorNombre = suppliers[0].nombre;

  const resolvedItems = [];
  for (const item of input.items) {
    resolvedItems.push({ ...item, product: await resolveProduct(conn, item) });
  }

  const [created] = await conn.execute(
      `INSERT INTO ordenes_compra_proveedor
         (numero, tercero_id, proveedor_nombre, fecha_orden, estado, archivo_nombre,
          archivo_hash, datos_origen, creado_por, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, 'CARGADA', ?, ?, ?, ?, NOW(), NOW())`,
      [input.numero, input.terceroId, input.proveedorNombre, input.fechaOrden,
       document.name, input.hash,
       input.sourceData == null ? null : JSON.stringify(input.sourceData), userId]
  );

  const [storedDocument] = await conn.execute(
      `INSERT INTO orden_compra_documentos
         (orden_compra_id, version, nombre_original, mime_type, tamano_bytes,
          sha256, contenido, activo, cargado_por, creado_en)
       VALUES (?, 1, ?, ?, ?, ?, ?, 1, ?, NOW())`,
      [created.insertId, document.name, document.mimeType, document.size,
       document.hash, document.content, userId]
  );

  for (const item of resolvedItems) {
    await conn.execute(
        `INSERT INTO orden_compra_proveedor_items
           (orden_compra_id, producto_id, referencia_origen, descripcion_origen,
            cantidad_ordenada, unidad, precio_unitario, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [created.insertId, item.product.id, item.sku || item.product.siigo_code,
         item.description, item.quantity, item.unit, item.unitPrice]
    );
  }
  return {
    status: 201,
    data: {
      id: created.insertId,
      numero: input.numero,
      estado: 'CARGADA',
      documento_id: storedDocument.insertId,
      documento_nombre: document.name,
      items: resolvedItems.map(item => ({
        producto_id: item.product.id,
        sku: item.product.siigo_code,
        producto: item.product.nombre,
        cantidad_ordenada: item.quantity,
      })),
    },
  };
}

async function loadPurchaseOrderDraft(conn, draftId) {
  const [drafts] = await conn.execute(
    `SELECT d.id, d.estado, d.orden_compra_id, d.referencia_documento,
            a.nombre_original, a.mime_type, a.tamano_bytes, a.sha256, a.contenido
       FROM documentos_bodega_borrador d
       LEFT JOIN documento_bodega_borrador_archivos a ON a.documento_id = d.id
      WHERE d.id = ? AND d.tipo_documento = 'ORDEN_COMPRA'
      LIMIT 1 FOR UPDATE`,
    [draftId]
  );
  if (!drafts.length) throw httpError(404, 'Borrador de orden de compra no encontrado');
  const draft = drafts[0];
  if (draft.estado === 'DESCARTADO') throw httpError(409, 'El borrador fue descartado');
  if (!draft.orden_compra_id && !draft.contenido) {
    throw httpError(409, 'El borrador no conserva el PDF original; reenvia el documento');
  }
  return draft;
}

async function handlePost(req, res) {
  const user = await requireCapability(req, CAPABILITIES.RECEPTION_CREATE);
  const body = req.body || {};
  const draftId = Number(body.document_draft_id || body.documento_borrador_id || 0) || null;
  const input = normalizePurchaseOrderInput(body);
  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();
    let draft = null;
    let document;
    if (draftId) {
      draft = await loadPurchaseOrderDraft(conn, draftId);
      if (draft.orden_compra_id) {
        await conn.commit();
        return res.status(200).json({
          ok: true,
          data: { id: draft.orden_compra_id, numero: input.numero, estado: 'CARGADA', duplicate: true },
        });
      }
      document = {
        name: draft.nombre_original,
        mimeType: draft.mime_type,
        size: Number(draft.tamano_bytes),
        hash: draft.sha256,
        content: draft.contenido,
      };
      if (input.numero !== draft.referencia_documento) {
        throw httpError(409, 'El numero revisado no coincide con la referencia del PDF');
      }
      const [extractedItems] = await conn.execute(
        `SELECT sku_extraido AS sku, descripcion_extraida AS descripcion,
                cantidad, unidad, precio_unitario
           FROM documento_bodega_borrador_items
          WHERE documento_id = ? ORDER BY id`,
        [draft.id]
      );
      input.sourceData = {
        document_draft_id: draft.id,
        extracted_items: extractedItems,
      };
    } else {
      document = normalizePurchaseOrderPdf(body);
    }

    const created = await createPurchaseOrderRecord(conn, { input, document, userId: user.id });
    if (draft) {
      await conn.execute(
        `UPDATE documentos_bodega_borrador
            SET estado = 'VINCULADO', orden_compra_id = ?, revisado_por = ?,
                revisado_en = NOW(), actualizado_en = NOW()
          WHERE id = ? AND orden_compra_id IS NULL`,
        [created.data.id, user.id, draft.id]
      );
    }
    await conn.commit();
    return res.status(created.status).json({ ok: true, data: created.data });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST,PATCH');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'PATCH') return await handlePatch(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[purchase-orders]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
