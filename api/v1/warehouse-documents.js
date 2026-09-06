const { query, createConnection } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { registerWarehouseDocumentDraft } = require('../_lib/warehouse-document-intake');
const { safeDownloadName } = require('../_lib/purchase-order-documents');
const {
  discardPurchaseOrderDocumentDraft,
  normalizePurchaseOrderDocumentDiscard,
} = require('../_lib/purchase-order-document-discard');

async function handleGet(req, res) {
  const fileId = Number(req.query?.file_id || 0);
  if (Number.isInteger(fileId) && fileId > 0) {
    const files = await query(
      `SELECT a.nombre_original, a.mime_type, d.tipo_documento
         FROM documento_bodega_borrador_archivos a
         JOIN documentos_bodega_borrador d ON d.id = a.documento_id
        WHERE a.id = ? LIMIT 1`,
      [fileId]
    );
    if (!files.length) {
      await requireCapability(req, CAPABILITIES.RECEPTION_READ);
      return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
    }
    const capability = files[0].tipo_documento === 'ORDEN_COMPRA'
      ? CAPABILITIES.RECEPTION_READ
      : CAPABILITIES.OUTSOURCING_READ;
    await requireCapability(req, capability);
    const contents = await query(
      `SELECT contenido FROM documento_bodega_borrador_archivos WHERE id = ? LIMIT 1`,
      [fileId]
    );
    if (!contents.length) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
    const name = safeDownloadName(files[0].nombre_original);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(contents[0].contenido);
  }

  const documentType = String(req.query?.type || 'SALIDA_BODEGA_3Q').trim().toUpperCase();
  if (!['SALIDA_BODEGA_3Q', 'ORDEN_COMPRA'].includes(documentType)) {
    return res.status(400).json({ ok: false, error: 'Tipo documental no soportado' });
  }
  await requireCapability(
    req,
    documentType === 'ORDEN_COMPRA' ? CAPABILITIES.RECEPTION_READ : CAPABILITIES.OUTSOURCING_READ
  );
  const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 200);
  const rows = await query(
    `SELECT d.id, d.tipo_documento, d.origen, d.referencia_documento,
            d.fecha_documento, d.destinatario_nombre, d.direccion,
            d.ciudad_departamento, d.nit, d.proveedor_nit, d.tercero_id, d.moneda,
            d.telefono, d.total_bultos,
            d.total_unidades, d.total_calculado, d.entrega, d.recibe,
            d.nombre_archivo, d.referencia_origen, d.advertencias, d.estado,
            d.maquila_envio_id, d.orden_compra_id,
            me.numero AS remision_numero, a.id AS archivo_id,
            a.nombre_original AS archivo_nombre, a.tamano_bytes AS archivo_tamano,
            d.creado_en,
            u.nombre AS creado_por_nombre
       FROM documentos_bodega_borrador d
       JOIN usuarios u ON u.id = d.creado_por
       LEFT JOIN maquila_envios me ON me.id = d.maquila_envio_id
       LEFT JOIN documento_bodega_borrador_archivos a ON a.documento_id = d.id
      WHERE d.tipo_documento = ?
      ORDER BY d.creado_en DESC
      LIMIT ?`,
    [documentType, limit]
  );
  const ids = rows.map((row) => row.id);
  const items = ids.length ? await query(
    `SELECT i.documento_id, i.producto_id, i.sku_extraido, i.descripcion_extraida,
            i.cantidad, i.unidad, i.precio_unitario, i.fecha_vencimiento, i.lote,
            p.siigo_code AS sku_catalogo,
            p.nombre AS producto_catalogo
       FROM documento_bodega_borrador_items i
       LEFT JOIN productos p ON p.id = i.producto_id
      WHERE i.documento_id IN (${ids.map(() => '?').join(',')})
      ORDER BY i.documento_id, i.id`,
    ids
  ) : [];
  const byDocument = new Map();
  for (const item of items) {
    if (!byDocument.has(item.documento_id)) byDocument.set(item.documento_id, []);
    byDocument.get(item.documento_id).push(item);
  }
  for (const row of rows) {
    row.items = byDocument.get(row.id) || [];
    row.advertencias = parseJsonArray(row.advertencias);
    row.nit = row.nit ? maskValue(row.nit) : null;
    row.proveedor_nit = row.proveedor_nit ? maskValue(row.proveedor_nit) : null;
    row.telefono = row.telefono ? maskValue(row.telefono) : null;
  }
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function handlePost(req, res) {
  const user = await requireCapability(req, CAPABILITIES.OUTSOURCING_MANAGE);
  const conn = await createConnection();
  try {
    const data = await registerWarehouseDocumentDraft({
      db: conn,
      body: req.body || {},
      userId: user.id,
      origin: 'DASHBOARD',
    });
    return res.status(data.duplicate ? 200 : 201).json({ ok: true, data });
  } finally {
    await conn.end().catch(() => {});
  }
}

async function handleDelete(req, res) {
  const user = await requireCapability(req, CAPABILITIES.PURCHASE_ORDER_CANCEL);
  const input = normalizePurchaseOrderDocumentDiscard(req.body || {});
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const data = await discardPurchaseOrderDocumentDraft(conn, { ...input, userId: user.id });
    await conn.commit();
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function maskValue(value) {
  const text = String(value);
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${'*'.repeat(Math.min(text.length - 4, 8))}${text.slice(-4)}`;
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST,DELETE');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[warehouse-documents]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
