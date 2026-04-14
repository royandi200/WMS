const { sequelize, Producto, OrdenProduccion, Stock, BOM } = require('../../models');
const { Op } = require('sequelize');
const { generateOrderCode, generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const { consumeFIFO } = require('../../utils/inventoryHelper');
const AppError = require('../../utils/AppError');

// Inicia una orden de producción. Valida BOM y stock antes de crear.
exports.start = async ({ product_id, qty_planned, notas }, usuario) => {
  const producto = await Producto.findByPk(product_id);
  if (!producto) throw new AppError('Producto no encontrado', 404);

  const bom = await BOM.findAll({
    where: { producto_final_id: product_id },
    include: [{ model: Producto, as: 'insumo' }]
  });
  if (!bom.length) throw new AppError(`No existe BOM (receta) para ${producto.siigo_code}`, 422);

  // Validar stock de cada insumo
  const faltantes = [];
  for (const item of bom) {
    const necesario  = parseFloat(item.cantidad_por_unidad) * qty_planned;
    const disponible = await Stock.sum('cantidad', {
      where: { producto_id: item.insumo_id, estado: 'disponible' }
    }) || 0;
    if (disponible < necesario) {
      faltantes.push(`${item.insumo.siigo_code}: necesita ${necesario} ${item.unidad}, disponible ${disponible}`);
    }
  }
  if (faltantes.length) throw new AppError('Stock insuficiente para iniciar producción', 409, faltantes);

  const codigo_orden = generateOrderCode();
  const orden = await OrdenProduccion.create({
    codigo_orden,
    producto_id:    product_id,
    cantidad_planeada: qty_planned,
    fase:           'F0',
    estado:         'PLANEADA',
    creado_por:     usuario.id,
    notas
  });

  await logKardex({
    productoId:      product_id,
    usuarioId:       usuario.id,
    tipo:            'nota',
    cantidad:        qty_planned,
    referenciaTipo:  'orden_produccion',
    referenciaCodigo: codigo_orden,
    notas:           'Orden creada. Pendiente confirmar materiales'
  });

  return {
    order:    { ...orden.toJSON(), order_code: codigo_orden },
    bom_required: bom.map(b => ({ sku: b.insumo.siigo_code, needed: b.cantidad_por_unidad * qty_planned, unit: b.unidad }))
  };
};

// Confirma materiales: descuenta insumos por FIFO
exports.confirmMaterials = async ({ order_id, exception_lot_id }, usuario) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const orden = await OrdenProduccion.findByPk(order_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new AppError('Orden no encontrada', 404);
    if (orden.fase !== 'F0') throw new AppError(`La orden ya pasó la fase F0 (fase actual: ${orden.fase})`, 409);

    const bom = await BOM.findAll({ where: { producto_final_id: orden.producto_id }, transaction: t });
    const consumido = [];

    for (const item of bom) {
      const necesario = parseFloat(item.cantidad_por_unidad) * parseFloat(orden.cantidad_planeada);
      let stocks;

      if (exception_lot_id) {
        stocks = await Stock.findAll({
          where: { producto_id: item.insumo_id, estado: 'disponible', cantidad: { [Op.gt]: 0 } },
          order: sequelize.literal(`CASE WHEN id = '${exception_lot_id}' THEN 0 ELSE 1 END, creado_en ASC`),
          lock: t.LOCK.UPDATE, transaction: t
        });
      } else {
        stocks = await Stock.findAll({
          where: { producto_id: item.insumo_id, estado: 'disponible', cantidad: { [Op.gt]: 0 } },
          order: [['creado_en', 'ASC']],
          lock: t.LOCK.UPDATE, transaction: t
        });
      }

      let restante = necesario;
      for (const stock of stocks) {
        if (restante <= 0) break;
        const tomar   = Math.min(parseFloat(stock.cantidad), restante);
        const nuevaCant = parseFloat(stock.cantidad) - tomar;
        await stock.update({ cantidad: nuevaCant, estado: nuevaCant === 0 ? 'agotado' : 'disponible' }, { transaction: t });
        await logKardex({
          loteId:          stock.id,
          productoId:      item.insumo_id,
          usuarioId:       usuario.id,
          tipo:            'consumo',
          cantidad:        tomar,
          saldoDespues:    nuevaCant,
          referenciaTipo:  'orden_produccion',
          referenciaCodigo: orden.codigo_orden,
          notas:           `Consumo FIFO para orden ${orden.codigo_orden}`
        }, t);
        consumido.push({ lote: stock.lote, qty_taken: tomar });
        restante -= tomar;
      }
      if (restante > 0) throw new AppError(`Stock insuficiente para insumo durante confirmación`, 409);
    }

    await orden.update({ fase: 'F1', estado: 'EN_PROCESO', materiales_confirmados_en: new Date() }, { transaction: t });
    return { order_code: orden.codigo_orden, phase: 'F1', consumed: consumido };
  });
};

exports.advancePhase = async ({ order_id, phase }, usuario) => {
  const orden = await OrdenProduccion.findByPk(order_id);
  if (!orden) throw new AppError('Orden no encontrada', 404);
  if (orden.estado === 'CERRADA') throw new AppError('La orden ya está cerrada', 409);
  await orden.update({ fase: phase });
  await logKardex({
    productoId:      orden.producto_id,
    usuarioId:       usuario.id,
    tipo:            'nota',
    cantidad:        0,
    referenciaTipo:  'orden_produccion',
    referenciaCodigo: orden.codigo_orden,
    notas:           `Avance a fase ${phase}`
  });
  return { order_code: orden.codigo_orden, phase };
};

// Cierra la producción, ingresa producto terminado al inventario
exports.close = async ({ order_id, qty_real }, usuario) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const orden = await OrdenProduccion.findByPk(order_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new AppError('Orden no encontrada', 404);
    if (orden.estado === 'CERRADA') throw new AppError('La orden ya está cerrada', 409);
    if (orden.fase === 'F0')  throw new AppError('Debes confirmar materiales antes de cerrar', 409);

    const loteTerminado = `LPN-${orden.codigo_orden}`;
    const stock = await Stock.create({
      lote:         loteTerminado,
      producto_id:  orden.producto_id,
      cantidad:     qty_real,
      reservada:    0,
      origen:       'produccion',
      estado:       'disponible',
      orden_produccion_id: orden.id,
      recibido_por: usuario.id
    }, { transaction: t });

    await orden.update({
      cantidad_real: qty_real,
      fase:          'F5',
      estado:        'CERRADA',
      cerrado_en:    new Date(),
      aprobado_por:  usuario.id
    }, { transaction: t });

    await logKardex({
      loteId:          stock.id,
      productoId:      orden.producto_id,
      usuarioId:       usuario.id,
      tipo:            'entrada',
      cantidad:        qty_real,
      saldoDespues:    qty_real,
      referenciaTipo:  'orden_produccion',
      referenciaCodigo: orden.codigo_orden,
      notas:           'Producto terminado ingresado a bodega',
      aprobadoPor:     usuario.id
    }, t);

    const diff     = parseFloat(orden.cantidad_planeada) - qty_real;
    const mermaMsg = diff > 0 ? `Merma de cierre: ${diff} unidades` : diff < 0 ? `Sobreproducción: ${Math.abs(diff)} unidades extra` : 'Sin diferencia';
    return {
      order_code:   orden.codigo_orden,
      qty_planned:  orden.cantidad_planeada,
      qty_real,
      lpn_terminado: loteTerminado,
      mermaMsg
    };
  });
};

exports.list = ({ status, page = 1, limit = 30 }) => {
  const where = {};
  if (status) where.estado = status;
  return OrdenProduccion.findAndCountAll({
    where,
    include: [{ model: Producto, as: 'producto', attributes: ['siigo_code','nombre'] }],
    order: [['creado_en','DESC']],
    limit:  parseInt(limit),
    offset: (parseInt(page)-1) * parseInt(limit)
  });
};

exports.getOne = async (id) => {
  const o = await OrdenProduccion.findByPk(id, { include: [{ model: Producto, as: 'producto' }] });
  if (!o) throw new AppError('Orden no encontrada', 404);
  return o;
};
