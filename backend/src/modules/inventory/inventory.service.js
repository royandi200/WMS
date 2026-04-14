const { Product, Lot, Kardex, User, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { getStockSummary } = require('../../utils/inventoryHelper');
const AppError = require('../../utils/AppError');

// Resumen global de todos los productos activos
exports.globalSummary = async () => {
  const products = await Product.findAll({ where: { active: true } });
  return Promise.all(products.map(async p => ({
    ...p.toJSON(),
    stock: await getStockSummary(p.id)
  })));
};

// Stock detallado de un producto con sus lotes
exports.productStock = async (productId) => {
  const product = await Product.findByPk(productId);
  if (!product) throw new AppError('Producto no encontrado', 404);

  const lots = await Lot.findAll({
    where: {
      product_id: productId,
      status: { [Op.notIn]: ['AGOTADO', 'DESPACHADO'] }
    },
    order: [['created_at', 'ASC']]
  });

  const summary = await getStockSummary(productId);
  return { product, lots, summary };
};

// Detalle de un lote por LPN
exports.lotDetail = async (lpn) => {
  const lot = await Lot.findOne({
    where: { lpn },
    include: [{ model: Product, as: 'product' }]
  });
  if (!lot) throw new AppError(`Lote ${lpn} no encontrado`, 404);
  return lot;
};

// Kardex con filtros y paginación
exports.kardexList = async ({ sku, product_id, lot_id, action, page = 1, limit = 50 }) => {
  const where = {};
  if (product_id) where.product_id = product_id;
  if (lot_id)     where.lot_id = lot_id;
  if (action)     where.action = action;

  // Buscar por SKU
  if (sku) {
    const p = await Product.findOne({ where: { sku } });
    if (p) where.product_id = p.id;
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { count, rows } = await Kardex.findAndCountAll({
    where,
    include: [
      { model: Product, as: 'product', attributes: ['sku','name'] },
      { model: Lot, as: 'lot', attributes: ['lpn'] },
      { model: User, as: 'user', attributes: ['name','phone'] }
    ],
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset
  });

  return { total: count, page: parseInt(page), limit: parseInt(limit), rows };
};

// Productos por debajo del stock mínimo
exports.lowStock = async () => {
  const products = await Product.findAll({ where: { active: true, min_stock: { [Op.gt]: 0 } } });
  const alerts = [];
  for (const p of products) {
    const s = await getStockSummary(p.id);
    if (s.disponible_neto < parseFloat(p.min_stock)) {
      alerts.push({
        product: { id: p.id, sku: p.sku, name: p.name, unit: p.unit },
        min_stock: p.min_stock,
        disponible_neto: s.disponible_neto,
        deficit: parseFloat(p.min_stock) - s.disponible_neto
      });
    }
  }
  return alerts;
};
