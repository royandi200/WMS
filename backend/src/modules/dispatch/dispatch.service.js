const { sequelize, Stock, Producto, Despacho } = require('../../models');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.dispatch = async ({ lot_id, qty, customer, siigo_order_id, notas }, usuario) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const stock = await Stock.findByPk(lot_id, {
      include: [{ model: Producto, as: 'producto' }],
      lock: t.LOCK.UPDATE, transaction: t
    });
    if (!stock) throw new AppError('Lote/Stock no encontrado', 404);
    if (stock.estado !== 'disponible') throw new AppError(`El lote está en estado ${stock.estado}, no se puede despachar`, 409);
    if (parseFloat(stock.cantidad) < qty) {
      throw new AppError(`Stock insuficiente: Lote tiene ${stock.cantidad}, solicitas ${qty}`, 409);
    }

    const nuevaCant = parseFloat(stock.cantidad) - qty;
    await stock.update({
      cantidad: nuevaCant,
      estado: nuevaCant === 0 ? 'despachado' : 'disponible'
    }, { transaction: t });

    // Registrar despacho
    await Despacho.create({
      stock_id:     stock.id,
      producto_id:  stock.producto_id,
      cantidad:     qty,
      cliente:      customer,
      orden_siigo:  siigo_order_id || null,
      despachado_por: usuario.id,
      notas
    }, { transaction: t });

    await logKardex({
      loteId:          stock.id,
      productoId:      stock.producto_id,
      usuarioId:       usuario.id,
      tipo:            'salida',
      cantidad:        qty,
      saldoDespues:    nuevaCant,
      referenciaTipo:  'despacho',
      referenciaCodigo: siigo_order_id || stock.lote,
      notas:           `Despacho a ${customer}. ${notas || ''}`.trim(),
      aprobadoPor:     usuario.id
    }, t);

    return {
      lpn:           stock.lote,
      sku:           stock.producto.siigo_code,
      qty_dispatched: qty,
      qty_remaining:  nuevaCant,
      customer,
      status: nuevaCant === 0 ? 'despachado' : 'disponible'
    };
  });
};
