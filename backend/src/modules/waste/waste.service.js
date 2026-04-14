const { sequelize, Stock, Merma, Producto } = require('../../models');
const { generateWasteCode } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.report = async ({ type, product_id, qty, lot_id, production_order_id, reason }, usuario) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    let saldoDespues = null;
    if (lot_id) {
      const stock = await Stock.findByPk(lot_id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!stock) throw new AppError('Lote no encontrado', 404);
      if (parseFloat(stock.cantidad) < qty) throw new AppError(`El lote solo tiene ${stock.cantidad} unidades`, 409);
      const nuevaCant = parseFloat(stock.cantidad) - qty;
      await stock.update({
        cantidad: nuevaCant,
        estado:   nuevaCant === 0 ? 'agotado' : stock.estado
      }, { transaction: t });
      saldoDespues = nuevaCant;
    }

    const codigo = generateWasteCode();
    const registro = await Merma.create({
      codigo,
      tipo:        type,
      producto_id: product_id,
      lote_id:     lot_id || null,
      orden_id:    production_order_id || null,
      cantidad:    qty,
      motivo:      reason,
      reportado_por: usuario.id,
      aprobado_por:  usuario.id,
      estado:      'APROBADO'
    }, { transaction: t });

    const tipoMovMap = {
      MERMA_EN_MAQUINA:    'consumo',
      MERMA_EN_ESTANTERIA: 'salida',
      MERMA_CIERRE_WIP:    'salida',
      RECHAZO_PROVEEDOR:   'entrada',
      VENCIMIENTO:         'salida',
      AJUSTE_MANUAL:       'ajuste'
    };

    await logKardex({
      loteId:          lot_id,
      productoId:      product_id,
      usuarioId:       usuario.id,
      tipo:            tipoMovMap[type] || 'salida',
      cantidad:        qty,
      saldoDespues,
      referenciaTipo:  'merma',
      referenciaCodigo: codigo,
      notas:           reason || type,
      aprobadoPor:     usuario.id
    }, t);

    // Alias para compatibilidad con builderbot
    registro.waste_code = codigo;
    return registro;
  });
};

exports.list = ({ product_id, type, page = 1, limit = 30 }) => {
  const where = {};
  if (product_id) where.producto_id = product_id;
  if (type)       where.tipo = type;
  return Merma.findAndCountAll({
    where,
    include: [{ model: Producto, as: 'producto', attributes: ['siigo_code','nombre'] }],
    order: [['creado_en','DESC']],
    limit:  parseInt(limit),
    offset: (parseInt(page)-1) * parseInt(limit)
  });
};
