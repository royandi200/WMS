const { sequelize, Product, Lot } = require('../../models');
const { generateLPN, generateWasteCode } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.receive = async ({ product_id, qty_total, qty_damaged = 0, supplier, expiry_date, notes }, user) => {
  const product = await Product.findByPk(product_id);
  if (!product) throw new AppError('Producto no encontrado', 404);

  const qty_good = qty_total - qty_damaged;
  if (qty_good < 0) throw new AppError('La cantidad dañada no puede superar el total', 400);

  const result = { product: { id: product.id, sku: product.sku }, lots: [] };

  await sequelize.transaction(async (t) => {
    // --- Lote DISPONIBLE (unidades buenas) ---
    if (qty_good > 0) {
      const lpn = generateLPN('L');
      const lot = await Lot.create({
        lpn,
        product_id,
        qty_initial:  qty_good,
        qty_current:  qty_good,
        supplier:     supplier || null,
        expiry_date:  expiry_date || null,
        origin:       'RECEPCION',
        status:       'DISPONIBLE',
        received_by:  user.id,
        notes
      }, { transaction: t });

      await logKardex({
        lotId: lot.id, productId: product_id, userId: user.id,
        action: 'INGRESO_RECEPCION', qty: qty_good, balanceAfter: qty_good,
        reference: lpn, notes: `Recepción de ${supplier || 'proveedor'}`
      }, t);

      result.lots.push({ lpn, status: 'DISPONIBLE', qty: qty_good });
    }

    // --- Lote CUARENTENA (unidades dañadas) ---
    if (qty_damaged > 0) {
      const lpnNov = generateLPN('L') + '-NOV';
      const lotNov = await Lot.create({
        lpn:          lpnNov,
        product_id,
        qty_initial:  qty_damaged,
        qty_current:  qty_damaged,
        supplier:     supplier || null,
        origin:       'RECEPCION',
        status:       'CUARENTENA',
        received_by:  user.id,
        notes:        'Dañado en recepción'
      }, { transaction: t });

      await logKardex({
        lotId: lotNov.id, productId: product_id, userId: user.id,
        action: 'INGRESO_NOVEDAD', qty: qty_damaged, balanceAfter: qty_damaged,
        reference: lpnNov, notes: 'Unidades dañadas enviadas a cuarentena'
      }, t);

      result.lots.push({ lpn: lpnNov, status: 'CUARENTENA', qty: qty_damaged });
    }
  });

  return result;
};
