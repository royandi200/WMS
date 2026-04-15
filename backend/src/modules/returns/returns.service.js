const { Lot } = require('../../models');
const { generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const { v4: uuidv4 } = require('uuid');

const BODEGA = { PPAL: 1, CUARENTENA: 2, DEVOL: 3 };

exports.processReturn = async (
  { product_id, qty, customer_origin, condition, notas },
  usuario
) => {
  const status   = condition === 'RECUPERABLE' ? 'DISPONIBLE' : 'CUARENTENA';
  const bodega_id = condition === 'RECUPERABLE' ? BODEGA.DEVOL : BODEGA.CUARENTENA;
  const lpn      = generateLPN('DEV');

  const lot = await Lot.create({
    id:          uuidv4(),
    lpn,
    product_id,
    bodega_id,
    qty_initial: qty,
    qty_current: qty,
    supplier:    customer_origin || 'Devolución cliente',
    origin:      'DEVOLUCION',
    status,
    received_by: usuario.id,
    notes:       notas || null,
  });

  await logKardex({
    loteId:           lot.id,
    productoId:       product_id,
    usuarioId:        usuario.id,
    action:           'DEVOLUCION',
    cantidad:         qty,
    saldoDespues:     qty,
    referenciaTipo:   'devolucion',
    referenciaCodigo: lpn,
    notas:            `Devolución ${condition} de ${customer_origin || 'cliente'}`,
  });

  return { lpn, status, qty, condition, bodega_id };
};
