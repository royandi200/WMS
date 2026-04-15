const { sequelize, Lot, WasteRecord, Producto } = require('../../models');
const { generateWasteCode } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

// Mapa tipo merma → action kardex
const WASTE_ACTION = {
  MERMA_EN_MAQUINA:    'MERMA_PROCESO',
  MERMA_EN_ESTANTERIA: 'MERMA_BODEGA',
  MERMA_CIERRE_WIP:    'MERMA_CIERRE_WIP',
  RECHAZO_PROVEEDOR:   'INGRESO_NOVEDAD',
  VENCIMIENTO:         'MERMA_BODEGA',
  AJUSTE_MANUAL:       'AJUSTE_MANUAL',
};

exports.report = async (
  { type, product_id, qty, lot_id, production_order_id, reason },
  usuario
) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    let saldoDespues = null;

    if (lot_id) {
      const lot = await Lot.findByPk(lot_id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!lot) throw new AppError('Lote no encontrado', 404);
      if (parseFloat(lot.qty_current) < qty)
        throw new AppError(`El lote solo tiene ${lot.qty_current} unidades`, 409);

      const nuevoQty = parseFloat(lot.qty_current) - qty;
      await lot.update({
        qty_current: nuevoQty,
        status:      nuevoQty === 0 ? 'AGOTADO' : lot.status,
      }, { transaction: t });
      saldoDespues = nuevoQty;
    }

    const codigo = generateWasteCode();
    const registro = await WasteRecord.create({
      codigo,
      tipo:          type,
      producto_id:   product_id,
      lote_id:       lot_id             || null,
      orden_id:      production_order_id || null,
      cantidad:      qty,
      motivo:        reason,
      reportado_por: usuario.id,
      aprobado_por:  usuario.id,
      estado:        'APROBADO',
    }, { transaction: t });

    await logKardex({
      loteId:           lot_id,
      productoId:       product_id,
      usuarioId:        usuario.id,
      action:           WASTE_ACTION[type] || 'MERMA_BODEGA',
      cantidad:         qty,
      saldoDespues,
      referenciaTipo:   'merma',
      referenciaCodigo: codigo,
      notas:            reason || type,
      aprobadoPor:      usuario.id,
    }, t);

    registro.waste_code = codigo;
    return registro;
  });
};

exports.list = ({ product_id, type, page = 1, limit = 30 }) => {
  const where = {};
  if (product_id) where.producto_id = product_id;
  if (type)       where.tipo = type;
  return WasteRecord.findAndCountAll({
    where,
    include: [{ model: Producto, as: 'producto', attributes: ['siigo_code', 'nombre'] }],
    order:  [['creado_en', 'DESC']],
    limit:  parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
  });
};
