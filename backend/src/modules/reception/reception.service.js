const { sequelize, Product, Lot, Recepcion } = require('../../models');
const { generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');
const { v4: uuidv4 } = require('uuid');

const BODEGA = { PPAL: 1, CUARENTENA: 2 };

exports.receive = async (
  { producto_id, qty_total, qty_damaged = 0, proveedor, fecha_vencimiento, notas },
  usuario
) => {
  const producto = await Product.findByPk(producto_id);
  if (!producto) throw new AppError('Producto no encontrado', 404);

  const qty_good = qty_total - qty_damaged;
  if (qty_good < 0) throw new AppError('La cantidad dañada no puede superar el total', 400);

  const result = { producto: { id: producto.id, siigo_code: producto.siigo_code }, lots: [] };

  await sequelize.transaction(async (t) => {

    await Recepcion.create({
      producto_id,
      cantidad_total:    qty_total,
      cantidad_buena:    qty_good,
      cantidad_danada:   qty_damaged,
      proveedor:         proveedor         || null,
      fecha_vencimiento: fecha_vencimiento || null,
      recibido_por:      usuario.id,
      notas:             notas             || null,
    }, { transaction: t });

    // --- Lote DISPONIBLE ---
    if (qty_good > 0) {
      const lpn = generateLPN('L');

      const lot = await Lot.create({
        id:          uuidv4(),
        lpn,
        product_id:  producto_id,
        bodega_id:   BODEGA.PPAL,
        qty_initial: qty_good,
        qty_current: qty_good,
        supplier:    proveedor            || null,
        expiry_date: fecha_vencimiento    || null,
        origin:      'RECEPCION',
        status:      'DISPONIBLE',
        received_by: usuario.id,
        notes:       notas                || null,
      }, { transaction: t });

      await logKardex({
        loteId:           lot.id,
        productoId:       producto_id,
        usuarioId:        usuario.id,
        tipo:             'entrada',
        cantidad:         qty_good,
        saldoDespues:     qty_good,
        referenciaTipo:   'recepcion',
        referenciaCodigo: lpn,
        notas:            `Recepción de ${proveedor || 'proveedor'}`,
      }, t);

      result.lots.push({ lpn, status: 'DISPONIBLE', qty_current: qty_good });
    }

    // --- Lote CUARENTENA ---
    if (qty_damaged > 0) {
      const lpnNov = generateLPN('L') + '-NOV';

      const lotNov = await Lot.create({
        id:          uuidv4(),
        lpn:         lpnNov,
        product_id:  producto_id,
        bodega_id:   BODEGA.CUARENTENA,
        qty_initial: qty_damaged,
        qty_current: qty_damaged,
        supplier:    proveedor            || null,
        origin:      'RECEPCION',
        status:      'CUARENTENA',
        received_by: usuario.id,
        notes:       'Dañado en recepción',
      }, { transaction: t });

      await logKardex({
        loteId:           lotNov.id,
        productoId:       producto_id,
        usuarioId:        usuario.id,
        tipo:             'novedad',
        cantidad:         qty_damaged,
        saldoDespues:     qty_damaged,
        referenciaTipo:   'novedad',
        referenciaCodigo: lpnNov,
        notas:            'Unidades dañadas enviadas a cuarentena',
      }, t);

      result.lots.push({ lpn: lpnNov, status: 'CUARENTENA', qty_current: qty_damaged });
    }
  });

  // Alias legacy para builderbot
  result.stocks = result.lots.map(l => ({
    lote:     l.lpn,
    estado:   l.status === 'DISPONIBLE' ? 'disponible' : 'cuarentena',
    cantidad: l.qty_current,
  }));

  return result;
};
