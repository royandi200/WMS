const { withTransaction } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let user;
  try {
    user = await requireRole(req, ['Admin', 'Supervisor', 'Operario']);
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }

  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ ok: false, error: 'order_id requerido' });

  try {
    const data = await withTransaction(async (tx) => {
      const rows = await tx(
        `SELECT * FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1 FOR UPDATE`,
        [order_id, order_id]
      );
      if (!rows.length) throw httpError(404, 'Orden no encontrada');

      const orden = rows[0];
      if (orden.fase !== 'F0') {
        throw httpError(409, `La orden ya paso F0 (fase actual: ${orden.fase})`);
      }

      const bom = await tx(
        `SELECT * FROM bom WHERE producto_final_id = ? AND activo = 1`,
        [orden.producto_id]
      );
      if (!bom.length) throw httpError(422, 'La orden no tiene BOM activo');

      const consumed = [];
      for (const item of bom) {
        const necesario = Number(item.cantidad_por_unidad) * Number(orden.cantidad_planeada);
        let restante = necesario;

        const lots = await tx(
          `SELECT id, lpn, qty_current
           FROM lots
           WHERE product_id = ? AND status = 'DISPONIBLE' AND qty_current > 0
           ORDER BY
             CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END,
             expiry_date ASC,
             created_at ASC
           FOR UPDATE`,
          [item.insumo_id]
        );

        for (const lot of lots) {
          if (restante <= 0.000001) break;

          const disponible = Number(lot.qty_current);
          const tomar = Math.min(disponible, restante);
          const nuevoQty = Number((disponible - tomar).toFixed(4));
          const lotUpdate = await tx(
            `UPDATE lots
             SET qty_current = ?, status = ?, updated_at = NOW()
             WHERE id = ? AND qty_current >= ?`,
            [nuevoQty, nuevoQty <= 0 ? 'AGOTADO' : 'DISPONIBLE', lot.id, tomar]
          );
          if (lotUpdate.affectedRows !== 1) {
            throw httpError(409, 'Stock insuficiente durante confirmacion');
          }

          const stockUpdate = await tx(
            `UPDATE stock
             SET cantidad = cantidad - ?, actualizado_en = NOW()
             WHERE producto_id = ? AND lote = ? AND cantidad >= ?`,
            [tomar, item.insumo_id, lot.lpn, tomar]
          );

          if (stockUpdate.affectedRows === 0) {
            const stockRows = await tx(
              `SELECT id, cantidad FROM stock WHERE producto_id = ? AND lote = ? LIMIT 1 FOR UPDATE`,
              [item.insumo_id, lot.lpn]
            );
            if (stockRows.length && Number(stockRows[0].cantidad) < tomar) {
              throw httpError(409, 'Stock insuficiente durante confirmacion');
            }
          }

          consumed.push({ product_id: item.insumo_id, lpn: lot.lpn, qty_taken: tomar });
          restante = Number((restante - tomar).toFixed(6));
        }

        if (restante > 0.000001) {
          throw httpError(409, 'Stock insuficiente durante confirmacion');
        }
      }

      const orderUpdate = await tx(
        `UPDATE ordenes_produccion
         SET fase = 'F1', estado = 'EN_PROCESO', materiales_conf_en = NOW(), aprobado_por = ?
         WHERE id = ? AND fase = 'F0'`,
        [user.id, orden.id]
      );
      if (orderUpdate.affectedRows !== 1) {
        throw httpError(409, 'La orden cambio de estado durante la confirmacion');
      }

      return { order_code: orden.codigo_orden, phase: 'F1', consumed };
    });

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[production/confirm]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al confirmar materiales' });
  }
};
