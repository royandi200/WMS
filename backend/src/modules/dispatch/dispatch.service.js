const { sequelize, Lot, Product } = require('../../models');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.dispatch = async ({ lot_id, qty, customer, siigo_order_id, notes }, user) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const lot = await Lot.findByPk(lot_id, {
      include: [{ model: Product, as: 'product' }],
      lock: t.LOCK.UPDATE, transaction: t
    });
    if (!lot) throw new AppError('Lote no encontrado', 404);
    if (lot.status !== 'DISPONIBLE') throw new AppError(`El lote está en estado ${lot.status}, no se puede despachar`, 409);
    if (parseFloat(lot.qty_current) < qty) {
      throw new AppError(`Stock insuficiente: Lote tiene ${lot.qty_current}, solicitas ${qty}`, 409);
    }

    const newQty = parseFloat(lot.qty_current) - qty;
    await lot.update({
      qty_current: newQty,
      status: newQty === 0 ? 'DESPACHADO' : 'DISPONIBLE'
    }, { transaction: t });

    await logKardex({
      lotId: lot.id, productId: lot.product_id, userId: user.id,
      action: 'DESPACHO', qty, balanceAfter: newQty,
      reference: siigo_order_id || lot.lpn,
      notes: `Despacho a ${customer}. ${notes || ''}`.trim(),
      approvedBy: user.id
    }, t);

    return {
      lpn: lot.lpn, sku: lot.product.sku,
      qty_dispatched: qty, qty_remaining: newQty,
      customer, status: newQty === 0 ? 'DESPACHADO' : 'DISPONIBLE'
    };
  });
};
