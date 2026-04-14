const { sequelize, Product, ProductionOrder, Lot, BOM } = require('../../models');
const { Op } = require('sequelize');
const { generateOrderCode, generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const { consumeFIFO } = require('../../utils/inventoryHelper');
const AppError = require('../../utils/AppError');

// Inicia una orden de producción. Valida BOM y stock antes de crear.
exports.start = async ({ product_id, qty_planned, notes }, user) => {
  const product = await Product.findByPk(product_id);
  if (!product) throw new AppError('Producto no encontrado', 404);

  const bom = await BOM.findAll({
    where: { product_id },
    include: [{ model: Product, as: 'input_product' }]
  });
  if (!bom.length) throw new AppError(`No existe BOM (receta) para ${product.sku}`, 422);

  // Validar stock de cada insumo
  const shortages = [];
  for (const item of bom) {
    const needed = parseFloat(item.qty_per_unit) * qty_planned;
    const available = await Lot.sum('qty_current', {
      where: { product_id: item.input_product_id, status: 'DISPONIBLE' }
    }) || 0;
    if (available < needed) {
      shortages.push(`${item.input_product.sku}: necesita ${needed} ${item.unit}, disponible ${available}`);
    }
  }
  if (shortages.length) throw new AppError('Stock insuficiente para iniciar producción', 409, shortages);

  const order_code = generateOrderCode();
  const order = await ProductionOrder.create({
    order_code, product_id, qty_planned,
    phase: 'F0', status: 'PLANEADA',
    created_by: user.id, notes
  });

  await logKardex({
    productId: product_id, userId: user.id,
    action: 'PRODUCCION_PLANEADA', qty: qty_planned,
    reference: order_code, notes: `Orden creada. Pendiente confirmar materiales`
  });

  return { order, bom_required: bom.map(b => ({ sku: b.input_product.sku, needed: b.qty_per_unit * qty_planned, unit: b.unit })) };
};

// Confirma materiales: descuenta insumos por FIFO dentro de una transacción
exports.confirmMaterials = async ({ order_id, exception_lot_id }, user) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const order = await ProductionOrder.findByPk(order_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!order) throw new AppError('Orden no encontrada', 404);
    if (order.phase !== 'F0') throw new AppError(`La orden ya pasó la fase F0 (fase actual: ${order.phase})`, 409);

    const bom = await BOM.findAll({ where: { product_id: order.product_id }, transaction: t });
    const consumed = [];

    for (const item of bom) {
      const needed = parseFloat(item.qty_per_unit) * parseFloat(order.qty_planned);
      let lots;

      // Si hay lote de excepción, priorizarlo (override FIFO para ese insumo)
      if (exception_lot_id) {
        lots = await Lot.findAll({
          where: { product_id: item.input_product_id, status: 'DISPONIBLE', qty_current: { [Op.gt]: 0 } },
          order: sequelize.literal(`CASE WHEN id = '${exception_lot_id}' THEN 0 ELSE 1 END, created_at ASC`),
          lock: t.LOCK.UPDATE, transaction: t
        });
      } else {
        lots = await Lot.findAll({
          where: { product_id: item.input_product_id, status: 'DISPONIBLE', qty_current: { [Op.gt]: 0 } },
          order: [['created_at', 'ASC']],
          lock: t.LOCK.UPDATE, transaction: t
        });
      }

      let remaining = needed;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(parseFloat(lot.qty_current), remaining);
        const newQty = parseFloat(lot.qty_current) - take;
        await lot.update({ qty_current: newQty, status: newQty === 0 ? 'AGOTADO' : 'DISPONIBLE' }, { transaction: t });
        await logKardex({
          lotId: lot.id, productId: item.input_product_id, userId: user.id,
          action: 'CONSUMO_MATERIAL', qty: take, balanceAfter: newQty,
          reference: order.order_code, notes: `Consumo FIFO para orden ${order.order_code}`
        }, t);
        consumed.push({ lpn: lot.lpn, qty_taken: take });
        remaining -= take;
      }
      if (remaining > 0) throw new AppError(`Stock insuficiente para insumo durante confirmación`, 409);
    }

    await order.update({ phase: 'F1', status: 'EN_PROCESO', materials_confirmed_at: new Date() }, { transaction: t });
    return { order_code: order.order_code, phase: 'F1', consumed };
  });
};

exports.advancePhase = async ({ order_id, phase }, user) => {
  const order = await ProductionOrder.findByPk(order_id);
  if (!order) throw new AppError('Orden no encontrada', 404);
  if (order.status === 'CERRADA') throw new AppError('La orden ya está cerrada', 409);
  await order.update({ phase });
  await logKardex({ productId: order.product_id, userId: user.id, action: 'AVANCE_FASE', qty: 0, reference: order.order_code, notes: `Avance a fase ${phase}` });
  return { order_code: order.order_code, phase };
};

// Cierra la producción, ingresa producto terminado al inventario
exports.close = async ({ order_id, qty_real }, user) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const order = await ProductionOrder.findByPk(order_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!order) throw new AppError('Orden no encontrada', 404);
    if (order.status === 'CERRADA') throw new AppError('La orden ya está cerrada', 409);
    if (order.phase === 'F0') throw new AppError('Debes confirmar materiales antes de cerrar', 409);

    const lpnTerminado = `LPN-${order.order_code}`;
    const lot = await Lot.create({
      lpn: lpnTerminado, product_id: order.product_id,
      qty_initial: qty_real, qty_current: qty_real,
      origin: 'PRODUCCION', status: 'DISPONIBLE',
      production_order_id: order.id, received_by: user.id
    }, { transaction: t });

    await order.update({ qty_real, phase: 'F5', status: 'CERRADA', closed_at: new Date(), approved_by: user.id }, { transaction: t });

    await logKardex({
      lotId: lot.id, productId: order.product_id, userId: user.id,
      action: 'CIERRE_PRODUCCION', qty: qty_real, balanceAfter: qty_real,
      reference: order.order_code, notes: 'Producto terminado ingresado a bodega', approvedBy: user.id
    }, t);

    const diff = parseFloat(order.qty_planned) - qty_real;
    const mermaMsg = diff > 0 ? `Merma de cierre: ${diff} unidades` : diff < 0 ? `Sobreproducción: ${Math.abs(diff)} unidades extra` : 'Sin diferencia';
    return { order_code: order.order_code, qty_planned: order.qty_planned, qty_real, lpn_terminado: lpnTerminado, mermaMsg };
  });
};

exports.list = ({ status, page = 1, limit = 30 }) => {
  const where = {};
  if (status) where.status = status;
  return ProductionOrder.findAndCountAll({
    where, include: [{ model: Product, as: 'product', attributes: ['sku','name'] }],
    order: [['created_at','DESC']], limit: parseInt(limit), offset: (parseInt(page)-1)*parseInt(limit)
  });
};

exports.getOne = async (id) => {
  const o = await ProductionOrder.findByPk(id, { include: [{ model: Product, as: 'product' }] });
  if (!o) throw new AppError('Orden no encontrada', 404);
  return o;
};
