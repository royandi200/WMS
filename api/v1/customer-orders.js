const { createConnection, query } = require('../_lib/db');
const { cors, requireCapability, requireRole } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { documentDraftStatus } = require('../_lib/document-draft-status');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function warningsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return ['No se pudieron interpretar las advertencias del documento'];
  }
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function normalizeCustomerOrderReview(body = {}) {
  if (body.confirmar_revision !== true) {
    throw httpError(400, 'Confirma que revisaste los datos contra el PDF original');
  }
  const clientName = cleanText(body.cliente_nombre, 200);
  const documentDate = cleanText(body.fecha_documento, 10);
  const reason = cleanText(body.motivo, 300);
  const reference = cleanText(body.referencia_documento, 80);
  if (!clientName) throw httpError(400, 'Indica el cliente final');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(documentDate)
    || Number.isNaN(new Date(`${documentDate}T00:00:00Z`).getTime())
    || new Date(`${documentDate}T00:00:00Z`).toISOString().slice(0, 10) !== documentDate) {
    throw httpError(400, 'Indica una fecha de OC válida');
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw httpError(400, 'La OC debe tener entre 1 y 100 productos');
  }
  const items = body.items.map((item, index) => {
    const sku = cleanText(item?.sku, 80).toUpperCase();
    const quantity = Number(item?.cantidad);
    if (!sku) throw httpError(400, `El producto ${index + 1} requiere SKU`);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 999999999) {
      throw httpError(400, `La cantidad de ${sku} debe ser un número entero positivo de unidades (máximo 999999999)`);
    }
    return { sku, quantity };
  });
  return { clientName, documentDate, reason, reference, items };
}

async function listCustomerOrders({ pendingOnly = false } = {}) {
  const rows = await query(
    `SELECT pc.id, pc.referencia, pc.cliente_nombre, pc.fecha_documento,
            pc.documento_borrador_id, pc.estado, pc.aprobado_en,
            u.nombre AS aprobado_por_nombre,
            i.id AS item_id, i.producto_id, p.siigo_code AS sku, p.nombre AS producto,
            i.cantidad_ordenada, i.unidad,
            COALESCE(op.cantidad_liberada, 0) AS cantidad_liberada
       FROM pedidos_cliente pc
       JOIN pedido_cliente_items i ON i.pedido_cliente_id = pc.id
       JOIN productos p ON p.id = i.producto_id
       LEFT JOIN usuarios u ON u.id = pc.aprobado_por
       LEFT JOIN (
         SELECT pedido_cliente_item_id,
                SUM(CASE WHEN estado = 'CERRADA' THEN cantidad_real ELSE cantidad_planeada END) AS cantidad_liberada
           FROM ordenes_produccion
          WHERE pedido_cliente_item_id IS NOT NULL AND estado <> 'CANCELADA'
          GROUP BY pedido_cliente_item_id
       ) op ON op.pedido_cliente_item_id = i.id
      WHERE pc.estado = 'ACTIVO'
      ORDER BY pc.id DESC, i.id ASC
      LIMIT 500`,
    []
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.id)) grouped.set(row.id, {
      id: row.id,
      identificador: `PED ID ${row.id}`,
      referencia: row.referencia,
      cliente_nombre: row.cliente_nombre,
      fecha_documento: row.fecha_documento,
      documento_borrador_id: row.documento_borrador_id,
      estado: row.estado,
      aprobado_en: row.aprobado_en,
      aprobado_por_nombre: row.aprobado_por_nombre,
      items: [],
    });
    const remaining = Math.max(0, Number(row.cantidad_ordenada) - Number(row.cantidad_liberada));
    grouped.get(row.id).items.push({
      id: row.item_id,
      producto_id: row.producto_id,
      sku: row.sku,
      producto: row.producto,
      cantidad_ordenada: Number(row.cantidad_ordenada),
      cantidad_liberada: Number(row.cantidad_liberada),
      cantidad_pendiente: Number(remaining.toFixed(3)),
      unidad: row.unidad,
    });
  }
  const orders = [...grouped.values()];
  return pendingOnly ? orders.filter((order) => order.items.some((item) => item.cantidad_pendiente > 0)) : orders;
}

async function approveCustomerOrderDraft(conn, { draftId, userId, review }) {
  if (!Number.isSafeInteger(Number(draftId)) || Number(draftId) <= 0) {
    throw httpError(400, 'Indica un borrador de OC de cliente válido');
  }
  const input = normalizeCustomerOrderReview(review);
  const [drafts] = await conn.execute(
    `SELECT d.id, d.tipo_documento, d.estado, d.referencia_documento,
            d.destinatario_nombre, d.fecha_documento, d.advertencias,
            (SELECT COUNT(*) FROM documento_bodega_borrador_archivos a
              WHERE a.documento_id = d.id) AS archivos
       FROM documentos_bodega_borrador d
      WHERE d.id = ? AND d.tipo_documento = 'ORDEN_COMPRA_CLIENTE'
      LIMIT 1 FOR UPDATE`,
    [Number(draftId)]
  );
  if (!drafts.length) throw httpError(404, 'Borrador de OC de cliente no encontrado');
  const draft = drafts[0];
  const [existing] = await conn.execute(
    `SELECT id FROM pedidos_cliente WHERE documento_borrador_id = ? LIMIT 1`,
    [draft.id]
  );
  if (existing.length) return { id: existing[0].id, duplicate: true };
  if (!['PENDIENTE_REVISION', 'REQUIERE_CORRECCION'].includes(draft.estado)) {
    throw httpError(409, 'El borrador ya no está pendiente de aprobación');
  }
  if (!Number(draft.archivos)) throw httpError(409, 'El borrador no conserva el PDF original');
  if (!draft.referencia_documento || input.reference !== draft.referencia_documento) {
    throw httpError(409, 'La referencia revisada debe coincidir con el PDF original');
  }
  const [extractedItems] = await conn.execute(
    `SELECT sku_extraido, cantidad, unidad
       FROM documento_bodega_borrador_items i
      WHERE i.documento_id = ? ORDER BY i.id FOR UPDATE`,
    [draft.id]
  );
  const warnings = warningsFromJson(draft.advertencias);
  const before = {
    clientName: draft.destinatario_nombre,
    documentDate: dateOnly(draft.fecha_documento),
    items: extractedItems.map((item) => ({
      sku: String(item.sku_extraido || '').toUpperCase(),
      quantity: Number(item.cantidad),
    })),
  };
  const after = {
    clientName: input.clientName,
    documentDate: input.documentDate,
    items: input.items,
  };
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if ((changed || documentDraftStatus(warnings) === 'REQUIERE_CORRECCION') && input.reason.length < 5) {
    throw httpError(400, 'Explica la corrección o cómo verificaste las advertencias del PDF');
  }
  const resolvedItems = [];
  for (const item of input.items) {
    const [products] = await conn.execute(
      `SELECT id, siigo_code, modalidad_operativa
         FROM productos WHERE UPPER(siigo_code) = ? AND activo = 1 LIMIT 1`,
      [item.sku]
    );
    if (!products.length || products[0].modalidad_operativa !== 'PR') {
      throw httpError(409, `El SKU ${item.sku} no es un producto terminado de producción propia activo`);
    }
    resolvedItems.push({ ...item, productId: products[0].id });
  }
  const [sameReference] = await conn.execute(
    `SELECT id FROM pedidos_cliente
      WHERE cliente_nombre = ? AND referencia = ? LIMIT 1 FOR UPDATE`,
    [input.clientName, draft.referencia_documento]
  );
  if (sameReference.length) {
    throw httpError(409, `Ese cliente ya tiene aprobado ${draft.referencia_documento} como PED ID ${sameReference[0].id}`);
  }
  const [created] = await conn.execute(
    `INSERT INTO pedidos_cliente
       (referencia, cliente_nombre, fecha_documento, documento_borrador_id,
        estado, aprobado_por, aprobado_en)
     VALUES (?, ?, ?, ?, 'ACTIVO', ?, NOW())`,
    [draft.referencia_documento, input.clientName,
      input.documentDate, draft.id, userId]
  );
  for (const item of resolvedItems) {
    await conn.execute(
      `INSERT INTO pedido_cliente_items
         (pedido_cliente_id, producto_id, cantidad_ordenada, unidad)
       VALUES (?, ?, ?, 'und')`,
      [created.insertId, item.productId, item.quantity]
    );
  }
  await conn.execute(
    `UPDATE documentos_bodega_borrador
        SET estado = 'VINCULADO', revisado_por = ?, revisado_en = NOW(), actualizado_en = NOW()
      WHERE id = ? AND estado IN ('PENDIENTE_REVISION','REQUIERE_CORRECCION')`,
    [userId, draft.id]
  );
  await conn.execute(
    `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
     VALUES ('customer_orders', 'INFO', ?, ?, ?, NOW())`,
    [`OC de cliente ${draft.referencia_documento} revisada y aprobada`, userId,
      JSON.stringify({ document_draft_id: draft.id, customer_order_id: created.insertId,
        before, after, original_warnings: warnings, reason: input.reason || null })]
  );
  return { id: created.insertId, identificador: `PED ID ${created.insertId}`, duplicate: false,
    corrected: changed };
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      await requireCapability(req, CAPABILITIES.PRODUCTION_RELEASE);
      const rows = await listCustomerOrders({ pendingOnly: req.query?.pending === '1' });
      return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
    }
    if (req.method === 'POST') {
      const user = await requireRole(req, ['admin', 'administrador', 'supervisor']);
      const conn = await createConnection();
      try {
        await conn.beginTransaction();
        const result = await approveCustomerOrderDraft(conn, {
          draftId: req.body?.document_draft_id,
          userId: user.id,
          review: req.body?.revision,
        });
        await conn.commit();
        return res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
      } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
      } finally {
        await conn.end().catch(() => {});
      }
    }
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, error: 'Ese pedido de cliente ya está aprobado' });
    console.error('[customer-orders]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

module.exports.listCustomerOrders = listCustomerOrders;
module.exports.approveCustomerOrderDraft = approveCustomerOrderDraft;
module.exports.normalizeCustomerOrderReview = normalizeCustomerOrderReview;
