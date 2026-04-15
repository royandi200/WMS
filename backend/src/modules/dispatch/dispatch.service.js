const { sequelize, Lot, Producto, Despacho } = require('../../models');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.dispatch = async ({ lot_id, qty, customer, siigo_order_id, notas }, usuario) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {

    const lot = await Lot.findByPk(lot_id, {
      include: [{ model: Producto, as: 'producto' }],
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!lot) throw new AppError('Lote no encontrado', 404);
    if (lot.status !== 'DISPONIBLE')
      throw new AppError(`El lote está en estado ${lot.status}, no se puede despachar`, 409);
    if (parseFloat(lot.qty_current) < qty)
      throw new AppError(`Stock insuficiente: lote tiene ${lot.qty_current}, solicitas ${qty}`, 409);

    const qty_remaining = parseFloat(lot.qty_current) - qty;

    await lot.update({
      qty_current: qty_remaining,
      status:      qty_remaining === 0 ? 'DESPACHADO' : 'DISPONIBLE',
    }, { transaction: t });

    await Despacho.create({
      lot_id:         lot.id,
      producto_id:    lot.product_id,
      cantidad:       qty,
      cliente:        customer,
      orden_siigo:    siigo_order_id || null,
      despachado_por: usuario.id,
      notas,
    }, { transaction: t });

    await logKardex({
      loteId:           lot.id,
      productoId:       lot.product_id,
      usuarioId:        usuario.id,
      tipo:             'despacho',
      cantidad:         qty,
      saldoDespues:     qty_remaining,
      referenciaTipo:   'despacho',
      referenciaCodigo: siigo_order_id || lot.lpn,
      notas:            `Despacho a ${customer}. ${notas || ''}`.trim(),
      aprobadoPor:      usuario.id,
    }, t);

    return {
      lpn:            lot.lpn,
      sku:            lot.producto.siigo_code,
      qty_dispatched: qty,
      qty_remaining,
      customer,
      status: qty_remaining === 0 ? 'DESPACHADO' : 'DISPONIBLE',
    };
  });
};
