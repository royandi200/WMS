const { Lot } = require('../../models');
const { generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.processReturn = async ({ product_id, qty, customer_origin, condition, notes }, user) => {
  const status = condition === 'RECUPERABLE' ? 'DISPONIBLE' : 'CUARENTENA';
  const lpn = generateLPN('DEV');

  const lot = await Lot.create({
    lpn, product_id, qty_initial: qty, qty_current: qty,
    supplier: customer_origin || 'Devolución cliente',
    origin: 'DEVOLUCION', status,
    received_by: user.id, notes
  });

  await logKardex({
    lotId: lot.id, productId: product_id, userId: user.id,
    action: 'DEVOLUCION', qty, balanceAfter: qty,
    reference: lpn, notes: `Devolución ${condition} de ${customer_origin || 'cliente'}`
  });

  return { lpn, status, qty, condition };
};
