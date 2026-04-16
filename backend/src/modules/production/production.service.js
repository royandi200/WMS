const { sequelize, Producto, OrdenProduccion, Lot, BOM } = require('../../models');
const { Op } = require('sequelize');
const { generateOrderCode, generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');
const { v4: uuidv4 } = require('uuid');

// Bodegas por convención
const BODEGA = { PPAL: 1, CUARENTENA: 2, DEVOL: 3, PROD: 4 };

// Helper: busca una orden por PK numérico o por codigo_orden
async function findOrden(order_id, options = {}) {
  const byPk = await OrdenProduccion.findByPk(order_id, options);
  if (byPk) return byPk;
  return OrdenProduccion.findOne({
    where: { codigo_orden: String(order_id) },
    ...options,
  });
}

// ─── Inicia orden de producción ────────────────────────────────────────────────
exports.start = async ({ product_id, qty_planned, notas }, usuario) => {
  const producto = await Producto.findByPk(product_id);
  if (!producto) throw new AppError('Producto no encontrado', 404);

  const bom = await BOM.findAll({
    where: { producto_final_id: product_id },
    include: [{ model: Producto, as: 'insumo' }],
  });
  if (!bom.length) throw new AppError(`No existe BOM para ${producto.siigo_code}`, 422);

  // Validar stock de cada insumo en tabla lots
  const faltantes = [];
  for (const item of bom) {
    const necesario  = parseFloat(item.cantidad_por_unidad) * qty_planned;
    const disponible = await Lot.sum('qty_current', {
      where: { product_id: item.insumo_id, status: 'DISPONIBLE' },
    }) || 0;
    if (disponible < necesario) {
      faltantes.push(
        `${item.insumo.siigo_code}: necesita ${necesario} ${item.unidad}, disponible ${disponible}`
      );
    }
  }
  if (faltantes.length) throw new AppError('Stock insuficiente para iniciar producción', 409, faltantes);

  const codigo_orden = generateOrderCode();
  const orden = await OrdenProduccion.create({
    codigo_orden,
    producto_id:       product_id,
    cantidad_planeada: qty_planned,
    fase:              'F0',
    estado:            'PLANEADA',
    creado_por:        usuario.id,
    notas,
  });

  await logKardex({
    productoId:       product_id,
    usuarioId:        usuario.id,
    action:           'PRODUCCION_PLANEADA',
    cantidad:         qty_planned,
    referenciaTipo:   'orden_produccion',
    referenciaCodigo: codigo_orden,
    notas:            'Orden creada. Pendiente confirmar materiales',
  });

  return {
    order: { ...orden.toJSON(), order_code: codigo_orden },
    bom_required: bom.map(b => ({
      sku:    b.insumo.siigo_code,
      needed: b.cantidad_por_unidad * qty_planned,
      unit:   b.unidad,
    })),
  };
};

// ─── Confirma materiales: descuenta insumos FIFO desde lots ─────────────────────
exports.confirmMaterials = async ({ order_id, exception_lot_id }, usuario) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const orden = await findOrden(order_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new AppError('Orden no encontrada', 404);
    if (orden.fase !== 'F0') throw new AppError(`La orden ya pasó la fase F0 (actual: ${orden.fase})`, 409);

    const bom     = await BOM.findAll({ where: { producto_final_id: orden.producto_id }, transaction: t });
    const consumido = [];

    for (const item of bom) {
      const necesario = parseFloat(item.cantidad_por_unidad) * parseFloat(orden.cantidad_planeada);

      const orderClause = exception_lot_id
        ? sequelize.literal(`CASE WHEN id = '${exception_lot_id}' THEN 0 ELSE 1 END, created_at ASC`)
        : [['created_at', 'ASC']];

      const lots = await Lot.findAll({
        where: { product_id: item.insumo_id, status: 'DISPONIBLE', qty_current: { [Op.gt]: 0 } },
        order: orderClause,
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      let restante = necesario;
      for (const lot of lots) {
        if (restante <= 0) break;
        const tomar     = Math.min(parseFloat(lot.qty_current), restante);
        const nuevoQty  = parseFloat(lot.qty_current) - tomar;
        await lot.update({
          qty_current: nuevoQty,
          status:      nuevoQty === 0 ? 'AGOTADO' : 'DISPONIBLE',
        }, { transaction: t });

        await logKardex({
          loteId:           lot.id,
          productoId:       item.insumo_id,
          usuarioId:        usuario.id,
          tipo:             'consumo',
          cantidad:         tomar,
          saldoDespues:     nuevoQty,
          referenciaTipo:   'orden_produccion',
          referenciaCodigo: orden.codigo_orden,
          notas:            `Consumo FIFO para orden ${orden.codigo_orden}`,
        }, t);

        consumido.push({ lpn: lot.lpn, qty_taken: tomar });
        restante -= tomar;
      }
      if (restante > 0) throw new AppError('Stock insuficiente para insumo durante confirmación', 409);
    }

    await orden.update({
      fase:                     'F1',
      estado:                   'EN_PROCESO',
      materiales_confirmados_en: new Date(),
    }, { transaction: t });

    return { order_code: orden.codigo_orden, phase: 'F1', consumed: consumido };
  });
};

// ─── Avanza fase ────────────────────────────────────────────────────────────────
// FIX: busca por id numérico O por codigo_orden; valida que esté EN_PROCESO
exports.advancePhase = async ({ order_id, phase }, usuario) => {
  const orden = await findOrden(order_id);
  if (!orden) throw new AppError('Orden no encontrada', 404);

  if (orden.estado !== 'EN_PROCESO') {
    throw new AppError(
      `La orden ${orden.codigo_orden} está en estado "${orden.estado}". ` +
      'Solo se pueden registrar avances de fase en órdenes EN_PROCESO.',
      409
    );
  }

  const faseAnterior = orden.fase;
  await orden.update({ fase: phase });

  await logKardex({
    productoId:       orden.producto_id,
    usuarioId:        usuario.id,
    action:           'AVANCE_FASE',
    cantidad:         0,
    referenciaTipo:   'orden_produccion',
    referenciaCodigo: orden.codigo_orden,
    notas:            `Avance de fase ${faseAnterior} → ${phase}`,
  });

  return { order_code: orden.codigo_orden, phase_from: faseAnterior, phase_to: phase };
};

// ─── Cierra producción: ingresa producto terminado a bodega principal ─────────
exports.close = async ({ order_id, qty_real }, usuario) => {
  return sequelize.transaction({ isolationLevel: 'SERIALIZABLE' }, async (t) => {
    const orden = await findOrden(order_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden)                    throw new AppError('Orden no encontrada', 404);
    if (orden.estado === 'CERRADA') throw new AppError('La orden ya está cerrada', 409);
    if (orden.fase === 'F0')        throw new AppError('Debes confirmar materiales antes de cerrar', 409);

    const lpn = `LPN-${orden.codigo_orden}`;
    const lot = await Lot.create({
      id:                  uuidv4(),
      lpn,
      product_id:          orden.producto_id,
      bodega_id:           BODEGA.PPAL,
      qty_initial:         qty_real,
      qty_current:         qty_real,
      origin:              'PRODUCCION',
      status:              'DISPONIBLE',
      production_order_id: orden.id,
      received_by:         usuario.id,
    }, { transaction: t });

    await orden.update({
      cantidad_real: qty_real,
      fase:          'F5',
      estado:        'CERRADA',
      cerrado_en:    new Date(),
      aprobado_por:  usuario.id,
    }, { transaction: t });

    await logKardex({
      loteId:           lot.id,
      productoId:       orden.producto_id,
      usuarioId:        usuario.id,
      action:           'CIERRE_PRODUCCION',
      cantidad:         qty_real,
      saldoDespues:     qty_real,
      referenciaTipo:   'orden_produccion',
      referenciaCodigo: orden.codigo_orden,
      notas:            'Producto terminado ingresado a bodega',
      aprobadoPor:      usuario.id,
    }, t);

    const diff = parseFloat(orden.cantidad_planeada) - qty_real;
    const mermaMsg = diff > 0
      ? `Merma de cierre: ${diff} unidades`
      : diff < 0
        ? `Sobreproducción: ${Math.abs(diff)} unidades extra`
        : 'Sin diferencia';

    return {
      order_code:    orden.codigo_orden,
      qty_planned:   orden.cantidad_planeada,
      qty_real,
      lpn_terminado: lpn,
      mermaMsg,
    };
  });
};

// ─── Listado y detalle ──────────────────────────────────────────────────────────
exports.list = ({ status, page = 1, limit = 30 }) => {
  const where = {};
  if (status) where.estado = status;
  return OrdenProduccion.findAndCountAll({
    where,
    include: [{ model: Producto, as: 'producto', attributes: ['siigo_code', 'nombre'] }],
    order:  [['creado_en', 'DESC']],
    limit:  parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
  });
};

exports.getOne = async (id) => {
  const o = await findOrden(id, {
    include: [{ model: Producto, as: 'producto' }],
  });
  if (!o) throw new AppError('Orden no encontrada', 404);
  return o;
};
