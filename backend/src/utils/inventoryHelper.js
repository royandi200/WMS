const { Stock, Producto, BOM, OrdenProduccion, sequelize } = require('../models');
const { Op } = require('sequelize');
const AppError = require('./AppError');

/**
 * Retorna el stock consolidado de un producto.
 * Usa la tabla stock con campos: cantidad, reservada, estado
 */
async function getStockSummary(productoId) {
  const rows = await Stock.findAll({
    where: { producto_id: productoId, estado: { [Op.in]: ['disponible', 'cuarentena', 'comprometido'] } },
    attributes: ['estado', [sequelize.fn('SUM', sequelize.col('cantidad')), 'total'], [sequelize.fn('SUM', sequelize.col('reservada')), 'totalReservada']],
    group: ['estado'],
    raw: true
  });

  let disponible = 0, cuarentena = 0, comprometido = 0, reservada = 0;
  rows.forEach(r => {
    if (r.estado === 'disponible')    disponible   = parseFloat(r.total);
    if (r.estado === 'cuarentena')   cuarentena   = parseFloat(r.total);
    if (r.estado === 'comprometido') comprometido = parseFloat(r.total);
    reservada += parseFloat(r.totalReservada || 0);
  });

  return {
    disponible,
    cuarentena,
    comprometido,
    reservada,
    disponible_neto: disponible - reservada,
    fisico_total:    disponible + cuarentena
  };
}

/**
 * Verifica si hay suficiente stock disponible para cubrir una cantidad requerida.
 */
async function assertStock(productoId, cantidadRequerida, t) {
  const summary = await getStockSummary(productoId);
  if (summary.disponible_neto < cantidadRequerida) {
    const producto = await Producto.findByPk(productoId);
    throw new AppError(
      `Stock insuficiente para ${producto?.siigo_code || productoId}. ` +
      `Disponible neto: ${summary.disponible_neto}, Requerido: ${cantidadRequerida}`,
      409
    );
  }
  return summary;
}

/**
 * Consume unidades de stock disponibles usando FIFO (ORDER BY creado_en ASC).
 */
async function consumeFIFO({ productoId, cantidadNecesaria, referenciaCodigo, usuarioId, tipo }, t) {
  const stockRows = await Stock.findAll({
    where: { producto_id: productoId, estado: 'disponible', cantidad: { [Op.gt]: 0 } },
    order: [['creado_en', 'ASC']],
    lock: t ? t.LOCK.UPDATE : undefined,
    transaction: t
  });

  let restante = cantidadNecesaria;
  const consumido = [];

  for (const stock of stockRows) {
    if (restante <= 0) break;
    const tomar   = Math.min(parseFloat(stock.cantidad), restante);
    const nuevaCant = parseFloat(stock.cantidad) - tomar;

    await stock.update(
      { cantidad: nuevaCant, estado: nuevaCant === 0 ? 'agotado' : 'disponible' },
      { transaction: t }
    );

    consumido.push({ stockId: stock.id, lote: stock.lote, cantidadTomada: tomar, cantidadRestante: nuevaCant });
    restante -= tomar;
  }

  if (restante > 0) {
    throw new AppError(`Stock insuficiente durante FIFO. Faltan ${restante} unidades.`, 409);
  }

  return consumido;
}

module.exports = { getStockSummary, assertStock, consumeFIFO };
