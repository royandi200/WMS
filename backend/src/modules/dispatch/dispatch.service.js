const { sequelize, Lot, Product, Despacho, DespachoItem } = require('../../models');
const { logKardex } = require('../../utils/kardexHelper');
const { generateLPN } = require('../../utils/generateCodes');
const AppError = require('../../utils/AppError');

/**
 * Despacha un lote completo o parcial.
 *
 * Body esperado:
 *   lot_id        UUID del lote a despachar
 *   qty           cantidad a despachar
 *   customer      nombre del cliente
 *   bodega_id     id de bodega origen
 *   siigo_order_id  (opcional)
 *   precio_unitario (opcional, default 0)
 *   notas         (opcional)
 */
exports.dispatch = async (
  { lot_id, qty, customer, bodega_id, siigo_order_id, precio_unitario = 0, notas },
  usuario
) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {

    // 1. Bloquear y validar lote
    const lot = await Lot.findByPk(lot_id, {
      include: [{ model: Product, as: 'producto' }],
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!lot)                          throw new AppError('Lote no encontrado', 404);
    if (lot.status !== 'DISPONIBLE')   throw new AppError(`Lote en estado ${lot.status}, no despachable`, 409);
    if (parseFloat(lot.qty_current) < qty)
      throw new AppError(`Stock insuficiente: lote tiene ${lot.qty_current}, solicitas ${qty}`, 409);

    const qty_remaining = parseFloat(lot.qty_current) - qty;

    // 2. Actualizar lote
    await lot.update({
      qty_current: qty_remaining,
      status:      qty_remaining === 0 ? 'DESPACHADO' : 'DISPONIBLE',
    }, { transaction: t });

    // 3. Cabecera de despacho
    const numero = generateLPN('D');
    const despacho = await Despacho.create({
      numero,
      cliente_nombre:  customer,
      bodega_id:       bodega_id || 1,
      estado:          'despachado',
      usuario_id:      usuario.id,
      observaciones:   notas || null,
    }, { transaction: t });

    // 4. Ítem del despacho
    await DespachoItem.create({
      despacho_id:     despacho.id,
      producto_id:     lot.product_id,
      lote:            lot.lpn,
      cantidad_sol:    qty,
      cantidad_des:    qty,
      precio_unitario: precio_unitario,
    }, { transaction: t });

    // 5. Kardex
    await logKardex({
      loteId:           lot.id,
      productoId:       lot.product_id,
      usuarioId:        usuario.id,
      tipo:             'despacho',
      cantidad:         qty,
      saldoDespues:     qty_remaining,
      referenciaTipo:   'despacho',
      referenciaCodigo: siigo_order_id || numero,
      notas:            `Despacho a ${customer}. ${notas || ''}`.trim(),
      aprobadoPor:      usuario.id,
    }, t);

    return {
      despacho_id:    despacho.id,
      numero,
      lpn:            lot.lpn,
      sku:            lot.producto.siigo_code,
      qty_dispatched: qty,
      qty_remaining,
      customer,
      status:         qty_remaining === 0 ? 'DESPACHADO' : 'DISPONIBLE',
    };
  });
};
