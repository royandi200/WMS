const crypto = require('crypto');
const { createConnection } = require('./db');
const { workflowFlags } = require('./feature-flags');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function confirmImportedDispatch({ dispatchId, invoiceId, userId }) {
  const localId = Number(dispatchId || 0) || null;
  const remoteId = String(invoiceId || '').trim();
  if (!localId && !remoteId) throw httpError(400, 'despacho_id o siigo_invoice_id es obligatorio');
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT id, numero, estado, bodega_id, siigo_invoice_id, siigo_invoice_name
       FROM despachos WHERE ${localId ? 'id = ?' : 'siigo_invoice_id = ?'}
       LIMIT 1 FOR UPDATE`,
      [localId || remoteId]
    );
    if (!rows.length) throw httpError(404, 'Despacho no encontrado');
    const dispatch = rows[0];
    if (dispatch.estado === 'despachado') {
      await conn.commit();
      return {
        already_completed: true,
        despacho_id: dispatch.id,
        numero: dispatch.numero,
        siigo_invoice_id: dispatch.siigo_invoice_id,
        lotes: [],
      };
    }
    if (dispatch.estado !== 'picking') {
      throw httpError(409, `El despacho esta en estado ${dispatch.estado} y debe estar en picking`);
    }
    const [demand] = await conn.execute(
      `SELECT estado, cantidad_facturada, cantidad_reservada
       FROM despacho_demanda_items WHERE despacho_id = ? FOR UPDATE`,
      [dispatch.id]
    );
    const incomplete = demand.some(item =>
      Number(item.cantidad_reservada || 0) < Number(item.cantidad_facturada || 0)
      || ['PENDIENTE_STOCK', 'PENDIENTE_DATOS_CLIENTE'].includes(item.estado)
    );
    if (incomplete && !workflowFlags().allowPartialDispatch) {
      throw httpError(409, 'La factura aun tiene unidades pendientes de reserva; el despacho parcial esta desactivado');
    }

    const [items] = await conn.execute(
      `SELECT di.id, di.producto_id, di.ubicacion_id, di.lote, di.cantidad_sol,
              p.siigo_code
       FROM despacho_items di JOIN productos p ON p.id = di.producto_id
       WHERE di.despacho_id = ? ORDER BY di.id FOR UPDATE`,
      [dispatch.id]
    );
    if (!items.length) throw httpError(409, 'Despacho sin reservas de inventario');
    const dispatched = [];
    for (const item of items) {
      const quantity = Number(item.cantidad_sol || 0);
      if (!item.lote || quantity <= 0) throw httpError(409, 'Reserva de despacho invalida');
      const [stockUpdate] = await conn.execute(
        `UPDATE stock SET cantidad = cantidad - ?, reservada = reservada - ?, actualizado_en = NOW()
         WHERE producto_id = ? AND bodega_id = ? AND lote = ? AND (ubicacion_id <=> ?)
           AND cantidad >= ? AND reservada >= ? LIMIT 1`,
        [quantity, quantity, item.producto_id, dispatch.bodega_id, item.lote,
         item.ubicacion_id, quantity, quantity]
      );
      if (stockUpdate.affectedRows !== 1) throw httpError(409, `La reserva del lote ${item.lote} ya no esta disponible`);
      const [lotUpdate] = await conn.execute(
        `UPDATE lots SET qty_current = qty_current - ?, updated_at = NOW()
         WHERE lpn = ? AND qty_current >= ?`,
        [quantity, item.lote, quantity]
      );
      if (lotUpdate.affectedRows !== 1) throw httpError(409, `Saldo insuficiente en lote ${item.lote}`);
      await conn.execute(
        `UPDATE lots SET status = IF(qty_current <= 0, 'DESPACHADO', 'DISPONIBLE') WHERE lpn = ?`,
        [item.lote]
      );
      await conn.execute(`UPDATE despacho_items SET cantidad_des = ? WHERE id = ?`, [quantity, item.id]);
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_orig, ubicacion_orig, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id, siigo_sync, siigo_voucher_id)
         VALUES ('salida', ?, ?, ?, ?, ?, ?, 'factura_siigo', ?, 1, ?)`,
        [item.producto_id, dispatch.bodega_id, item.ubicacion_id, item.lote,
         quantity, dispatch.id, userId, dispatch.siigo_invoice_id]
      );
      const [lots] = await conn.execute(`SELECT id, qty_current FROM lots WHERE lpn = ? LIMIT 1`, [item.lote]);
      const balance = Number(lots[0]?.qty_current || 0);
      await conn.execute(
        `INSERT INTO kardex
           (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
            reference, notes, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'DESPACHO', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), crypto.randomUUID(), lots[0]?.id || null, item.producto_id,
         userId, -quantity, balance,
         `factura-siigo:${dispatch.siigo_invoice_name || dispatch.siigo_invoice_id}`,
         `Despacho ${dispatch.numero}`, userId]
      );
      dispatched.push({ sku: item.siigo_code, lote: item.lote, cantidad: quantity, saldo_lote: balance });
    }
    await conn.execute(`UPDATE despachos SET estado = 'despachado', despachado_en = NOW() WHERE id = ?`, [dispatch.id]);
    await conn.execute(
      `UPDATE despacho_demanda_items
       SET cantidad_despachada = cantidad_reservada,
           estado = IF(cantidad_reservada >= cantidad_facturada, 'DESPACHADO', 'PARCIAL'),
           actualizado_en = NOW() WHERE despacho_id = ?`,
      [dispatch.id]
    );
    await conn.commit();
    return {
      already_completed: false,
      despacho_id: dispatch.id,
      numero: dispatch.numero,
      siigo_invoice_id: dispatch.siigo_invoice_id,
      siigo_invoice_name: dispatch.siigo_invoice_name,
      lotes: dispatched,
      mensaje: `Despacho ${dispatch.numero} confirmado para factura ${dispatch.siigo_invoice_name}`,
    };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = { confirmImportedDispatch };
