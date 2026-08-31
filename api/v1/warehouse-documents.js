const { query, createConnection } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { registerWarehouseDocumentDraft } = require('../_lib/warehouse-document-intake');

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.OUTSOURCING_READ);
  const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 200);
  const rows = await query(
    `SELECT d.id, d.tipo_documento, d.origen, d.referencia_documento,
            d.fecha_documento, d.destinatario_nombre, d.direccion,
            d.ciudad_departamento, d.nit, d.telefono, d.total_bultos,
            d.total_unidades, d.total_calculado, d.entrega, d.recibe,
            d.nombre_archivo, d.referencia_origen, d.advertencias, d.estado,
            d.maquila_envio_id, me.numero AS remision_numero, d.creado_en,
            u.nombre AS creado_por_nombre
       FROM documentos_bodega_borrador d
       JOIN usuarios u ON u.id = d.creado_por
       LEFT JOIN maquila_envios me ON me.id = d.maquila_envio_id
      ORDER BY d.creado_en DESC
      LIMIT ?`,
    [limit]
  );
  const ids = rows.map((row) => row.id);
  const items = ids.length ? await query(
    `SELECT i.documento_id, i.producto_id, i.sku_extraido, i.descripcion_extraida,
            i.cantidad, i.fecha_vencimiento, i.lote, p.siigo_code AS sku_catalogo,
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
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[warehouse-documents]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
