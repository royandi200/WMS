const { Lot, Product, BOM, ProductionOrder, sequelize } = require('../models');
const { Op } = require('sequelize');
const AppError = require('./AppError');

/**
 * Retorna el stock consolidado de un producto (equivalente a wms_ConsultarInventario).
 * No persiste nada — es una consulta en tiempo real que reemplaza inventario_global.
 */
async function getStockSummary(productId) {
  const lots = await Lot.findAll({
    where: { product_id: productId, status: { [Op.in]: ['DISPONIBLE', 'CUARENTENA', 'COMPROMETIDO'] } },
    attributes: ['status', [sequelize.fn('SUM', sequelize.col('qty_current')), 'total']],
    group: ['status'],
    raw: true
  });

  let disponible = 0, cuarentena = 0, comprometido = 0;
  lots.forEach(r => {
    if (r.status === 'DISPONIBLE')   disponible   = parseFloat(r.total);
    if (r.status === 'CUARENTENA')  cuarentena   = parseFloat(r.total);
    if (r.status === 'COMPROMETIDO') comprometido = parseFloat(r.total);
  });

  return {
    disponible,
    cuarentena,
    comprometido,
    disponible_neto: disponible - comprometido,
    fisico_total: disponible + cuarentena
  };
}

/**
 * Verifica si hay suficiente stock disponible para cubrir una cantidad requerida.
 * Lanza AppError si no hay suficiente.
 */
async function assertStock(productId, qtyRequired, t) {
  const summary = await getStockSummary(productId);
  if (summary.disponible_neto < qtyRequired) {
    const product = await Product.findByPk(productId);
    throw new AppError(
      `Stock insuficiente para ${product?.sku || productId}. ` +
      `Disponible neto: ${summary.disponible_neto}, Requerido: ${qtyRequired}`,
      409
    );
  }
  return summary;
}

/**
 * Consume unidades de lotes disponibles usando FIFO (ORDER BY created_at ASC).
 * Retorna el detalle de lotes consumidos.
 */
async function consumeFIFO({ productId, qtyNeeded, reference, userId, action }, t) {
  const availableLots = await Lot.findAll({
    where: { product_id: productId, status: 'DISPONIBLE', qty_current: { [Op.gt]: 0 } },
    order: [['created_at', 'ASC']],
    lock: t ? t.LOCK.UPDATE : undefined,
    transaction: t
  });

  let remaining = qtyNeeded;
  const consumed = [];

  for (const lot of availableLots) {
    if (remaining <= 0) break;
    const take = Math.min(parseFloat(lot.qty_current), remaining);
    const newQty = parseFloat(lot.qty_current) - take;

    await lot.update(
      { qty_current: newQty, status: newQty === 0 ? 'AGOTADO' : 'DISPONIBLE' },
      { transaction: t }
    );

    consumed.push({ lotId: lot.id, lpn: lot.lpn, qtyTaken: take, qtyRemaining: newQty });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new AppError(`Stock insuficiente durante FIFO. Faltan ${remaining} unidades.`, 409);
  }

  return consumed;
}

module.exports = { getStockSummary, assertStock, consumeFIFO };
