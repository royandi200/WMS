const { Usuario, Rol, Producto, Stock } = require('../../models');
const AppError = require('../../utils/AppError');

/**
 * Busca o crea un usuario ghost por número de teléfono (campo `telefono` en usuarios).
 */
exports.buildBotUser = async (phone) => {
  let usuario = await Usuario.findOne({
    where: { telefono: phone },
    include: [{ model: Rol, as: 'rol' }]
  });

  if (!usuario) {
    const rolDefault = await Rol.findOne({ where: { nombre: 'Operario' } });
    if (!rolDefault) throw new AppError('Rol Operario no configurado en el sistema', 500);
    usuario = await Usuario.create({
      nombre:        `WhatsApp-${phone}`,
      telefono:      phone,
      email:         `wa_${phone}@wms.local`,
      rol_id:        rolDefault.id,
      activo:        true,
      password_hash: 'bot-user-no-login'
    });
    usuario = await Usuario.findByPk(usuario.id, { include: [{ model: Rol, as: 'rol' }] });
  }

  return {
    id:     usuario.id,
    nombre: usuario.nombre,
    name:   usuario.nombre,   // alias para compatibilidad
    phone:  usuario.telefono,
    rol:    usuario.rol?.nombre,
    role:   usuario.rol?.nombre  // alias para compatibilidad
  };
};

/**
 * Busca un producto por SKU en tabla skus o por siigo_code
 */
exports.findProductBySku = async (sku) => {
  // Buscar primero en tabla skus
  try {
    const { Sku } = require('../../models');
    const skuRow = await Sku.findOne({
      where: { sku, activo: 1 },
      include: [{ model: Producto, as: 'producto' }]
    });
    if (skuRow?.producto) return skuRow.producto;
  } catch (e) { /* tabla skus puede no existir aún */ }

  // Fallback: buscar directo en productos por siigo_code
  const producto = await Producto.findOne({ where: { siigo_code: sku, activo: true } });
  if (!producto) throw new AppError(`Producto con SKU "${sku}" no encontrado`, 404);
  return producto;
};

/**
 * Busca un stock/lote por código de lote
 */
exports.findLotByLpn = async (lote) => {
  const stock = await Stock.findOne({ where: { lote } });
  if (!stock) throw new AppError(`Lote "${lote}" no encontrado`, 404);
  return stock;
};
