const { query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');

module.exports = async (req, res) => {
  cors(res, 'GET');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    await requireCapability(req, CAPABILITIES.APPROVALS_READ);

    const estado = String(req.query?.estado || 'PENDIENTE').toUpperCase();
    const limit = Number(req.query?.limit || 50);

    let where = 'WHERE a.estado = ?';
    let params = [estado];

    if (estado === 'HISTORIAL') {
      where = "WHERE a.estado IN ('APROBADO','RECHAZADO','EXPIRADO')";
      params = [];
    }

    const rows = await query(
      `SELECT a.id, a.codigo_solicitud, a.accion, a.estado, a.payload, a.motivo_rechazo, a.procesado_en, a.creado_en,
              s.nombre AS usuario_nombre, p.nombre AS procesado_por_nombre
       FROM aprobaciones a
       LEFT JOIN usuarios s ON s.id = a.solicitado_por
       LEFT JOIN usuarios p ON p.id = a.procesado_por
       ${where}
       ORDER BY a.creado_en DESC
       LIMIT ?`,
      [...params, limit]
    );

    const data = rows.map((row) => {
      let payload = row.payload || {};
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { payload = {}; }
      }
      return {
        id: row.id,
        codigo_solicitud: row.codigo_solicitud,
        tipo: row.accion,
        accion: row.accion,
        estado: row.estado,
        cantidad: payload.cantidad ?? payload.cantidad_real ?? payload.cantidad_planificada ?? payload.cantidad_deseada ?? null,
        lote: payload.id_lote ?? payload.lote ?? payload.lot ?? payload.lote_usado ?? payload.lote_sugerido ?? null,
        creado_en: row.creado_en,
        procesado_en: row.procesado_en,
        motivo_rechazo: row.motivo_rechazo,
        producto_nombre: payload.producto_nombre ?? payload.producto ?? payload.id_producto_final ?? payload.id_item ?? payload.sku ?? null,
        siigo_code: payload.siigo_code ?? payload.sku ?? null,
        id_item: payload.id_item ?? payload.id_producto_final ?? null,
        id_orden: payload.id_orden ?? null,
        bodega_orig_nombre: payload.bodega_origen ?? payload.bodega_orig_nombre ?? null,
        bodega_dest_nombre: payload.bodega_destino ?? payload.bodega_dest_nombre ?? null,
        usuario_nombre: row.usuario_nombre ?? null,
        procesado_por_nombre: row.procesado_por_nombre ?? null,
        payload,
      };
    });

    return res.status(200).json({ ok: true, data: { rows: data, total: data.length } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[api/v1/approvals]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
