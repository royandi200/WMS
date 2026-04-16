// POST /api/v1/production/close
// Body: { order_id, qty_real }  — order_id puede ser id numérico o codigo_orden
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  let user;
  try { user = verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { order_id, qty_real } = req.body || {};
    if (!order_id || qty_real === undefined || qty_real === null)
      return res.status(400).json({ ok: false, error: 'order_id y qty_real son requeridos' });

    const rows = await query(
      `SELECT * FROM ordenes_produccion WHERE id=? OR codigo_orden=? LIMIT 1`,
      [order_id, order_id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    const orden = rows[0];
    if (orden.estado === 'CERRADA') return res.status(409).json({ ok: false, error: 'La orden ya está cerrada' });
    if (orden.fase === 'F0') return res.status(409).json({ ok: false, error: 'Debes confirmar materiales antes de cerrar' });

    // Crear lote de producto terminado
    const lpn    = `LPN-${orden.codigo_orden}`;
    const lotId  = uuidv4();
    const BODEGA_PPAL = 1;
    await query(
      `INSERT INTO lots (id, lpn, product_id, bodega_id, qty_initial, qty_current, origin, status, production_order_id, received_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PRODUCCION', 'DISPONIBLE', ?, ?, NOW())`,
      [lotId, lpn, orden.producto_id, BODEGA_PPAL, qty_real, qty_real, orden.id, user.id]
    );

    // Cerrar la orden
    await query(
      `UPDATE ordenes_produccion
       SET cantidad_real=?, fase='F5', estado='CERRADA', cerrado_en=NOW(), aprobado_por=?
       WHERE id=?`,
      [qty_real, user.id, orden.id]
    );

    const diff = parseFloat(orden.cantidad_planeada) - Number(qty_real);
    const mermaMsg = diff > 0 ? `Merma de cierre: ${diff} unidades`
      : diff < 0 ? `Sobreproducción: ${Math.abs(diff)} unidades extra`
      : 'Sin diferencia';

    return res.status(200).json({
      ok: true,
      data: {
        order_code:    orden.codigo_orden,
        qty_planned:   orden.cantidad_planeada,
        qty_real,
        lpn_terminado: lpn,
        mermaMsg
      }
    });
  } catch (err) {
    console.error('[production/close]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al cerrar producción' });
  }
};
