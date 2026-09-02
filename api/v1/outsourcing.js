const { query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const {
  createOutsourcingOrder,
  linkOutsourcingPurchaseOrder,
  prepareAdditionalShipment,
  confirmOutsourcingShipment,
  cancelOutsourcingShipment,
} = require('../_lib/outsourcing-workflow');

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.OUTSOURCING_READ);
  const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 200);
  const rows = await query(
    `SELECT om.id, om.codigo, om.orden_compra_id, om.tercero_id,
            oc.numero AS orden_compra_numero,
            om.proveedor_nombre, om.producto_id, p.siigo_code AS sku,
            p.nombre AS producto_nombre, om.cantidad_objetivo, om.cantidad_recibida,
            om.estado, om.notas, om.enviado_en, om.completado_en, om.creado_en,
            u.nombre AS creado_por_nombre
       FROM ordenes_maquila om
       LEFT JOIN ordenes_compra_proveedor oc ON oc.id = om.orden_compra_id
       JOIN productos p ON p.id = om.producto_id
       JOIN usuarios u ON u.id = om.creado_por
      GROUP BY om.id, om.codigo, om.orden_compra_id, om.tercero_id,
               oc.numero, om.proveedor_nombre,
               om.producto_id, p.siigo_code, p.nombre, om.cantidad_objetivo,
               om.cantidad_recibida, om.estado, om.notas, om.enviado_en,
               om.completado_en, om.creado_en, u.nombre
      ORDER BY om.creado_en DESC
      LIMIT ?`,
    [limit]
  );
  const materialRows = await query(
    `SELECT mm.orden_maquila_id, p.siigo_code AS sku, p.nombre AS producto,
            mm.unidad, mm.cantidad_teorica, mm.cantidad_enviada,
            mm.cantidad_devuelta, mm.cantidad_conciliada, mm.cantidad_merma,
            (mm.cantidad_enviada - mm.cantidad_devuelta
             - mm.cantidad_conciliada - mm.cantidad_merma) AS cantidad_en_custodia
       FROM maquila_materiales mm
       JOIN productos p ON p.id = mm.producto_id
      WHERE mm.orden_maquila_id IN (${rows.length ? rows.map(() => '?').join(',') : 'NULL'})
      ORDER BY mm.orden_maquila_id, p.siigo_code`,
    rows.map(row => row.id)
  );
  const materialsByOrder = new Map();
  for (const material of materialRows) {
    if (!materialsByOrder.has(material.orden_maquila_id)) materialsByOrder.set(material.orden_maquila_id, []);
    materialsByOrder.get(material.orden_maquila_id).push(material);
  }
  for (const row of rows) row.materiales = materialsByOrder.get(row.id) || [];
  const shipmentRows = await query(
    `SELECT me.id, me.numero, me.orden_maquila_id, om.codigo AS orden_codigo,
            me.tipo, me.estado, me.motivo, me.creado_en,
            mei.cantidad, p.siigo_code AS sku, p.nombre AS producto,
            mml.lote, u.codigo AS ubicacion_origen
       FROM maquila_envios me
       JOIN ordenes_maquila om ON om.id = me.orden_maquila_id
       JOIN maquila_envio_items mei ON mei.maquila_envio_id = me.id
       JOIN maquila_material_lotes mml ON mml.id = mei.maquila_material_lote_id
       JOIN maquila_materiales mm ON mm.id = mml.maquila_material_id
       JOIN productos p ON p.id = mm.producto_id
       JOIN ubicaciones u ON u.id = mml.ubicacion_origen_id
      WHERE me.estado = 'BORRADOR'
      ORDER BY me.creado_en, me.id, mei.id`
  );
  const pendingMap = new Map();
  for (const row of shipmentRows) {
    if (!pendingMap.has(row.id)) {
      pendingMap.set(row.id, {
        id: row.id,
        numero: row.numero,
        orden_maquila_id: row.orden_maquila_id,
        orden_codigo: row.orden_codigo,
        tipo: row.tipo,
        estado: row.estado,
        motivo: row.motivo,
        creado_en: row.creado_en,
        items: [],
      });
    }
    pendingMap.get(row.id).items.push({
      sku: row.sku,
      producto: row.producto,
      cantidad: Number(row.cantidad),
      lote: row.lote,
      ubicacion_origen: row.ubicacion_origen,
    });
  }
  return res.status(200).json({
    ok: true,
    data: { rows, pending_shipments: [...pendingMap.values()], total: rows.length },
  });
}

async function handlePost(req, res) {
  const action = String(req.body?.action || 'CREATE').trim().toUpperCase();
  const user = await requireCapability(req, CAPABILITIES.OUTSOURCING_MANAGE);
  if (action === 'CREATE') {
    const data = await createOutsourcingOrder({ body: req.body || {}, userId: user.id });
    return res.status(201).json({ ok: true, data });
  }
  if (action === 'PREPARE_ADDITIONAL') {
    const data = await prepareAdditionalShipment({ body: req.body || {}, userId: user.id });
    return res.status(201).json({ ok: true, data });
  }
  if (action === 'LINK_PURCHASE_ORDER') {
    const data = await linkOutsourcingPurchaseOrder({ body: req.body || {}, userId: user.id });
    return res.status(200).json({ ok: true, data });
  }
  if (action === 'CONFIRM_SHIPMENT') {
    const data = await confirmOutsourcingShipment({
      shipmentId: req.body?.envio_id || req.body?.shipment_id || req.body?.numero,
      userId: user.id,
    });
    return res.status(200).json({ ok: true, data });
  }
  if (action === 'CANCEL_SHIPMENT') {
    const data = await cancelOutsourcingShipment({
      shipmentId: req.body?.envio_id || req.body?.shipment_id || req.body?.numero,
      userId: user.id,
    });
    return res.status(200).json({ ok: true, data });
  }
  return res.status(400).json({ ok: false, error: 'Accion de maquila no soportada' });
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message, data: error.data });
    console.error('[outsourcing]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
