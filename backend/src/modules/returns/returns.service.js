const { Stock } = require('../../models');
const { generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.processReturn = async ({ product_id, qty, customer_origin, condition, notas }, usuario) => {
  const estado = condition === 'RECUPERABLE' ? 'disponible' : 'cuarentena';
  const lote   = generateLPN('DEV');

  const stock = await Stock.create({
    lote,
    producto_id:  product_id,
    cantidad:     qty,
    reservada:    0,
    proveedor:    customer_origin || 'Devolución cliente',
    origen:       'devolucion',
    estado,
    recibido_por: usuario.id,
    notas
  });

  await logKardex({
    loteId:          stock.id,
    productoId:      product_id,
    usuarioId:       usuario.id,
    tipo:            'entrada',
    cantidad:        qty,
    saldoDespues:    qty,
    referenciaTipo:  'devolucion',
    referenciaCodigo: lote,
    notas:           `Devolución ${condition} de ${customer_origin || 'cliente'}`
  });

  return { lpn: lote, status: estado, qty, condition };
};
