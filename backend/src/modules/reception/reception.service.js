const { sequelize, Producto, Stock, Recepcion, RecepcionItem } = require('../../models');
const { generateLPN } = require('../../utils/generateCodes');
const { logKardex } = require('../../utils/kardexHelper');
const AppError = require('../../utils/AppError');

exports.receive = async ({ producto_id, qty_total, qty_damaged = 0, proveedor, fecha_vencimiento, notas }, usuario) => {
  const producto = await Producto.findByPk(producto_id);
  if (!producto) throw new AppError('Producto no encontrado', 404);

  const qty_good = qty_total - qty_damaged;
  if (qty_good < 0) throw new AppError('La cantidad dañada no puede superar el total', 400);

  // Mantener compatibilidad con llamadas desde webhook que usan product_id
  const result = { producto: { id: producto.id, siigo_code: producto.siigo_code }, stocks: [] };

  await sequelize.transaction(async (t) => {
    // Crear cabecera de recepción
    const recepcion = await Recepcion.create({
      producto_id,
      cantidad_total:   qty_total,
      cantidad_buena:   qty_good,
      cantidad_danada:  qty_damaged,
      proveedor:        proveedor || null,
      fecha_vencimiento: fecha_vencimiento || null,
      recibido_por:     usuario.id,
      notas
    }, { transaction: t });

    // --- Stock DISPONIBLE (unidades buenas) ---
    if (qty_good > 0) {
      const lote = generateLPN('L');
      const stock = await Stock.create({
        lote,
        producto_id,
        cantidad:         qty_good,
        reservada:        0,
        proveedor:        proveedor || null,
        fecha_vencimiento: fecha_vencimiento || null,
        origen:           'recepcion',
        estado:           'disponible',
        recibido_por:     usuario.id,
        notas
      }, { transaction: t });

      await logKardex({
        loteId:          stock.id,
        productoId:      producto_id,
        usuarioId:       usuario.id,
        tipo:            'entrada',
        cantidad:        qty_good,
        saldoDespues:    qty_good,
        referenciaTipo:  'recepcion',
        referenciaCodigo: lote,
        notas:           `Recepción de ${proveedor || 'proveedor'}`
      }, t);

      result.stocks.push({ lote, estado: 'disponible', cantidad: qty_good });
    }

    // --- Stock CUARENTENA (unidades dañadas) ---
    if (qty_damaged > 0) {
      const loteNov = generateLPN('L') + '-NOV';
      const stockNov = await Stock.create({
        lote:             loteNov,
        producto_id,
        cantidad:         qty_damaged,
        reservada:        0,
        proveedor:        proveedor || null,
        origen:           'recepcion',
        estado:           'cuarentena',
        recibido_por:     usuario.id,
        notas:            'Dañado en recepción'
      }, { transaction: t });

      await logKardex({
        loteId:          stockNov.id,
        productoId:      producto_id,
        usuarioId:       usuario.id,
        tipo:            'entrada',
        cantidad:        qty_damaged,
        saldoDespues:    qty_damaged,
        referenciaTipo:  'novedad',
        referenciaCodigo: loteNov,
        notas:           'Unidades dañadas enviadas a cuarentena'
      }, t);

      result.stocks.push({ lote: loteNov, estado: 'cuarentena', cantidad: qty_damaged });
    }
  });

  // Compatibilidad con builderbot que espera `lots` (alias)
  result.lots = result.stocks.map(s => ({ lpn: s.lote, status: s.estado === 'disponible' ? 'DISPONIBLE' : 'CUARENTENA', qty: s.cantidad }));
  return result;
};
