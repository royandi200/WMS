// POST /api/v1/production/confirm
// Body: { order_id }  — order_id puede ser id numérico o codigo_orden
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  let user;
  try { user = verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { order_id } = req.body || {};
    if (!order_id) return res.status(400).json({ ok: false, error: 'order_id requerido' });

    const rows = await query(
      `SELECT * FROM ordenes_produccion WHERE id=? OR codigo_orden=? LIMIT 1`,
      [order_id, order_id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    const orden = rows[0];
    if (orden.fase !== 'F0') return res.status(409).json({ ok: false, error: `La orden ya pasó F0 (fase actual: ${orden.fase})` });

    // Consumo FIFO simplificado por cada insumo del BOM
    const bom = await query(`SELECT * FROM bom WHERE producto_final_id=?`, [orden.producto_id]);
    const consumido = [];
    for (const item of bom) {
      const necesario = parseFloat(item.cantidad_por_unidad) * parseFloat(orden.cantidad_planeada);
      const lots = await query(
        `SELECT * FROM lots WHERE product_id=? AND status='DISPONIBLE' AND qty_current>0 ORDER BY created_at ASC`,
        [item.insumo_id]
      );
      let restante = necesario;
      for (const lot of lots) {
        if (restante <= 0) break;
        const tomar = Math.min(parseFloat(lot.qty_current), restante);
        const nuevoQty = parseFloat(lot.qty_current) - tomar;
        await query(
          `UPDATE lots SET qty_current=?, status=? WHERE id=?`,
          [nuevoQty, nuevoQty === 0 ? 'AGOTADO' : 'DISPONIBLE', lot.id]
        );
        consumido.push({ lpn: lot.lpn, qty_taken: tomar });
        restante -= tomar;
      }
      if (restante > 0) return res.status(409).json({ ok: false, error: 'Stock insuficiente durante confirmación' });
    }

    await query(
      `UPDATE ordenes_produccion SET fase='F1', estado='EN_PROCESO', materiales_confirmados_en=NOW() WHERE id=?`,
      [orden.id]
    );
    return res.status(200).json({ ok: true, data: { order_code: orden.codigo_orden, phase: 'F1', consumed: consumido } });
  } catch (err) {
    console.error('[production/confirm]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al confirmar materiales' });
  }
};
