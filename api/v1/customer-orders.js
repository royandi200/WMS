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

async function listCustomerOrders({ pendingOnly = false } = {}) {
  const rows = await query(
    `SELECT pc.id, pc.referencia, pc.cliente_nombre, pc.fecha_documento,
            pc.documento_borrador_id, pc.estado, pc.aprobado_en,
            i.id AS item_id, i.producto_id, p.siigo_code AS sku, p.nombre AS producto,
            i.cantidad_ordenada, i.unidad,
            COALESCE(op.cantidad_liberada, 0) AS cantidad_liberada
       FROM pedidos_cliente pc
       JOIN pedido_cliente_items i ON i.pedido_cliente_id = pc.id
       JOIN productos p ON p.id = i.producto_id
       LEFT JOIN (
         SELECT pedido_cliente_item_id, SUM(cantidad_planeada) AS cantidad_liberada
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

async function approveCustomerOrderDraft(conn, { draftId, userId }) {
  if (!Number.isSafeInteger(Number(draftId)) || Number(draftId) <= 0) {
    throw httpError(400, 'Indica un borrador de OC de cliente válido');
  }
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
  if (draft.estado === 'DESCARTADO' || draft.estado === 'VINCULADO') {
    throw httpError(409, 'El borrador ya no está pendiente de aprobación');
  }
  if (documentDraftStatus(warningsFromJson(draft.advertencias)) !== 'PENDIENTE_REVISION') {
    throw httpError(409, 'Corrige las advertencias del PDF antes de aprobar el pedido');
  }
  if (!Number(draft.archivos)) throw httpError(409, 'El borrador no conserva el PDF original');
  if (!draft.referencia_documento || !draft.destinatario_nombre || !draft.fecha_documento) {
    throw httpError(409, 'Faltan referencia, cliente o fecha en la OC');
  }
  const [sameReference] = await conn.execute(
    `SELECT id FROM pedidos_cliente
      WHERE cliente_nombre = ? AND referencia = ? LIMIT 1 FOR UPDATE`,
    [draft.destinatario_nombre, draft.referencia_documento]
  );
  if (sameReference.length) {
    throw httpError(409, `Ese cliente ya tiene aprobado ${draft.referencia_documento} como PED ID ${sameReference[0].id}`);
  }
  const [items] = await conn.execute(
    `SELECT i.id, i.producto_id, i.cantidad, i.unidad,
            p.modalidad_operativa, p.activo
       FROM documento_bodega_borrador_items i
       LEFT JOIN productos p ON p.id = i.producto_id
      WHERE i.documento_id = ? ORDER BY i.id FOR UPDATE`,
    [draft.id]
  );
  if (!items.length) throw httpError(409, 'La OC de cliente no tiene productos');
  if (items.some((item) => !item.producto_id || !item.activo
    || item.modalidad_operativa !== 'PR' || item.unidad !== 'und'
    || !Number.isFinite(Number(item.cantidad)) || Number(item.cantidad) <= 0)) {
    throw httpError(409, 'La OC contiene productos no válidos para producción propia');
  }
  const [created] = await conn.execute(
    `INSERT INTO pedidos_cliente
       (referencia, cliente_nombre, fecha_documento, documento_borrador_id,
        estado, aprobado_por, aprobado_en)
     VALUES (?, ?, ?, ?, 'ACTIVO', ?, NOW())`,
    [draft.referencia_documento, draft.destinatario_nombre,
      draft.fecha_documento, draft.id, userId]
  );
  for (const item of items) {
    await conn.execute(
      `INSERT INTO pedido_cliente_items
         (pedido_cliente_id, producto_id, cantidad_ordenada, unidad)
       VALUES (?, ?, ?, 'und')`,
      [created.insertId, item.producto_id, Number(item.cantidad)]
    );
  }
  await conn.execute(
    `UPDATE documentos_bodega_borrador
        SET estado = 'VINCULADO', revisado_por = ?, revisado_en = NOW(), actualizado_en = NOW()
      WHERE id = ? AND estado IN ('PENDIENTE_REVISION','REQUIERE_CORRECCION')`,
    [userId, draft.id]
  );
  return { id: created.insertId, identificador: `PED ID ${created.insertId}`, duplicate: false };
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
