const { sequelize, Lot, WasteRecord, Product } = require('../../models');
const { generateWasteCode } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.report = async ({ type, product_id, qty, lot_id, production_order_id, reason }, user) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    // Si hay lote, descontar del lote
    let balanceAfter = null;
    if (lot_id) {
      const lot = await Lot.findByPk(lot_id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!lot) throw new AppError('Lote no encontrado', 404);
      if (parseFloat(lot.qty_current) < qty) throw new AppError(`El lote solo tiene ${lot.qty_current} unidades`, 409);
      const newQty = parseFloat(lot.qty_current) - qty;
      await lot.update({ qty_current: newQty, status: newQty === 0 ? 'AGOTADO' : lot.status }, { transaction: t });
      balanceAfter = newQty;
    }

    const wasteCode = generateWasteCode();
    const record = await WasteRecord.create({
      waste_code: wasteCode, type, product_id, lot_id: lot_id || null,
      production_order_id: production_order_id || null,
      qty, reason, reported_by: user.id, approved_by: user.id, status: 'APROBADO'
    }, { transaction: t });

    const actionMap = {
      MERMA_EN_MAQUINA:    'MERMA_PROCESO',
      MERMA_EN_ESTANTERIA: 'MERMA_BODEGA',
      MERMA_CIERRE_WIP:    'MERMA_CIERRE_WIP',
      RECHAZO_PROVEEDOR:   'INGRESO_NOVEDAD',
      VENCIMIENTO:         'MERMA_BODEGA',
      AJUSTE_MANUAL:       'AJUSTE_MANUAL'
    };

    await logKardex({
      lotId: lot_id, productId: product_id, userId: user.id,
      action: actionMap[type] || 'MERMA_BODEGA', qty, balanceAfter,
      reference: wasteCode, notes: reason || type, approvedBy: user.id
    }, t);

    return record;
  });
};

exports.list = ({ product_id, type, page = 1, limit = 30 }) => {
  const where = {};
  if (product_id) where.product_id = product_id;
  if (type) where.type = type;
  return WasteRecord.findAndCountAll({
    where, include: [{ model: Product, as: 'product', attributes: ['sku','name'] }],
    order: [['created_at','DESC']], limit: parseInt(limit), offset: (parseInt(page)-1)*parseInt(limit)
  });
};
