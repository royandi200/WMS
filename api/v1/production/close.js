const crypto = require('crypto');
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

  const { order_id, qty_real, qty_waste, waste_reason } = req.body || {};
  const qtyReal = Number(qty_real);
  const qtyWaste = Number(qty_waste);
  if (!order_id || !Number.isFinite(qtyReal) || qtyReal < 0 || !Number.isFinite(qtyWaste) || qtyWaste < 0) {
    return res.status(400).json({ ok: false, error: 'order_id, qty_real y qty_waste son requeridos' });
  }
  if (qtyWaste > 0 && !String(waste_reason || '').trim()) {
    return res.status(400).json({ ok: false, error: 'El motivo de merma es requerido cuando qty_waste es mayor a 0' });
  }

  try {
    const data = await withTransaction(async (tx) => {
      const rows = await tx(
        `SELECT * FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1 FOR UPDATE`,
        [order_id, order_id]
      );
      if (!rows.length) throw httpError(404, 'Orden no encontrada');

      const orden = rows[0];
      if (orden.estado === 'CERRADA') throw httpError(409, 'La orden ya esta cerrada');
      if (orden.fase === 'F0') throw httpError(409, 'Debes confirmar materiales antes de cerrar');
      if (qtyReal === 0 && qtyWaste === 0) {
        throw httpError(400, 'Debes confirmar unidades conformes o merma antes de cerrar');
      }

      const lpn = `LPN-${orden.codigo_orden}`;
      const lotId = crypto.randomUUID();
      const bodegaId = Number(process.env.DEFAULT_PRODUCTION_BODEGA_ID || 1);

      await tx(
        `INSERT INTO lots
           (id, lpn, product_id, bodega_id, qty_initial, qty_current, origin, status,
            received_by, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PRODUCCION', 'DISPONIBLE', ?, ?, NOW())`,
        [
          lotId,
          lpn,
          orden.producto_id,
          bodegaId,
          qtyReal,
          qtyReal,
          user.id,
          `Orden ${orden.codigo_orden} | Merma cierre: ${qtyWaste} | ${waste_reason || 'Sin merma'}`,
        ]
      );

      if (qtyReal > 0) {
        await tx(
          `INSERT INTO stock
             (producto_id, bodega_id, ubicacion_id, lote, cantidad, reservada, actualizado_en)
           VALUES (?, ?, NULL, ?, ?, 0, NOW())`,
          [orden.producto_id, bodegaId, lpn, qtyReal]
        );
      }

      const orderUpdate = await tx(
        `UPDATE ordenes_produccion
         SET cantidad_real = ?, fase = 'F5', estado = 'CERRADA', cerrado_en = NOW(), aprobado_por = ?
         WHERE id = ? AND estado <> 'CERRADA'`,
        [qtyReal, user.id, orden.id]
      );
      if (orderUpdate.affectedRows !== 1) {
        throw httpError(409, 'La orden cambio de estado durante el cierre');
      }

      const planned = Number(orden.cantidad_planeada || 0);
      const diff = planned - qtyReal;
      const mermaMsg = qtyWaste > 0
        ? `Merma declarada: ${qtyWaste} unidades`
        : diff > 0
          ? `Diferencia contra plan: ${diff} unidades`
          : diff < 0
            ? `Sobreproduccion: ${Math.abs(diff)} unidades extra`
            : 'Sin diferencia';

      if (qtyWaste > 0) {
        await tx(
          `INSERT INTO mermas
             (numero, tipo, producto_id, lote, orden_produccion_id, cantidad, motivo, usuario_id, creado_en)
           VALUES (?, 'CIERRE_PRODUCCION', ?, NULL, ?, ?, ?, ?, NOW())`,
          [`MER-${Date.now()}`, orden.producto_id, orden.id, qtyWaste, waste_reason, user.id]
        ).catch(() => {});
      }

      return {
        order_code: orden.codigo_orden,
        qty_planned: orden.cantidad_planeada,
        qty_real: qtyReal,
        qty_waste: qtyWaste,
        lpn_terminado: lpn,
        mermaMsg,
      };
    });

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: 'Ya existe lote para esta orden' });
    }
    console.error('[production/close]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al cerrar produccion' });
  }
};
