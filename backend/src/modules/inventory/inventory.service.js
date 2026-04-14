const { Producto, Stock, Movimiento, Usuario, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { getStockSummary } = require('../../utils/inventoryHelper');
const AppError = require('../../utils/AppError');

// Resumen global de todos los productos activos
exports.globalSummary = async () => {
  const productos = await Producto.findAll({ where: { activo: true } });
  return Promise.all(productos.map(async p => ({
    ...p.toJSON(),
    stock: await getStockSummary(p.id)
  })));
};

// Stock detallado de un producto con sus lotes/stocks
exports.productStock = async (productoId) => {
  const producto = await Producto.findByPk(productoId);
  if (!producto) throw new AppError('Producto no encontrado', 404);

  const stocks = await Stock.findAll({
    where: {
      producto_id: productoId,
      estado: { [Op.notIn]: ['agotado', 'despachado'] }
    },
    order: [['creado_en', 'ASC']]
  });

  const summary = await getStockSummary(productoId);
  return { producto, stocks, summary };
};

// Detalle de un stock/lote por código de lote
exports.lotDetail = async (lote) => {
  const stock = await Stock.findOne({
    where: { lote },
    include: [{ model: Producto, as: 'producto' }]
  });
  if (!stock) throw new AppError(`Lote ${lote} no encontrado`, 404);
  return stock;
};

// Movimientos con filtros y paginación
exports.kardexList = async ({ sku, producto_id, stock_id, tipo, page = 1, limit = 50 }) => {
  const where = {};
  if (producto_id) where.producto_id = producto_id;
  if (stock_id)    where.lote_id = stock_id;
  if (tipo)        where.tipo = tipo;

  if (sku) {
    const p = await Producto.findOne({ where: { siigo_code: sku } });
    if (p) where.producto_id = p.id;
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { count, rows } = await Movimiento.findAndCountAll({
    where,
    include: [
      { model: Producto, as: 'producto', attributes: ['siigo_code','nombre'] },
      { model: Usuario,  as: 'usuario',  attributes: ['nombre','email'] }
    ],
    order: [['creado_en', 'DESC']],
    limit: parseInt(limit),
    offset
  });

  return { total: count, page: parseInt(page), limit: parseInt(limit), rows };
};

// Productos por debajo del stock mínimo
exports.lowStock = async () => {
  const productos = await Producto.findAll({ where: { activo: true, stock_minimo: { [Op.gt]: 0 } } });
  const alertas = [];
  for (const p of productos) {
    const s = await getStockSummary(p.id);
    if (s.disponible_neto < parseFloat(p.stock_minimo)) {
      alertas.push({
        producto: { id: p.id, siigo_code: p.siigo_code, nombre: p.nombre, unidad: p.unidad },
        stock_minimo:    p.stock_minimo,
        disponible_neto: s.disponible_neto,
        deficit:         parseFloat(p.stock_minimo) - s.disponible_neto
      });
    }
  }
  return alertas;
};
