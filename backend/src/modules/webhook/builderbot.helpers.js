const { User, Role, Product, Lot } = require('../../models');
const AppError = require('../../utils/AppError');

/**
 * Busca o crea un usuario ghost por número de teléfono.
 * Permite que operarios de WhatsApp actúen en el sistema sin login tradicional.
 */
exports.buildBotUser = async (phone) => {
  let user = await User.findOne({
    where: { phone },
    include: [{ model: Role, as: 'role' }]
  });

  if (!user) {
    // Rol por defecto para usuarios WhatsApp no registrados
    const defaultRole = await Role.findOne({ where: { name: 'Operario' } });
    if (!defaultRole) throw new AppError('Rol Operario no configurado en el sistema', 500);
    user = await User.create({
      name:  `WhatsApp-${phone}`,
      phone,
      role_id: defaultRole.id,
      active: true,
      password_hash: 'bot-user-no-login'
    });
    user = await User.findByPk(user.id, { include: [{ model: Role, as: 'role' }] });
  }

  return {
    id:    user.id,
    name:  user.name,
    phone: user.phone,
    role:  user.role?.name
  };
};

/**
 * Busca un producto por SKU (busca en tabla skus o en productos.siigo_code)
 */
exports.findProductBySku = async (sku) => {
  // Buscar primero en tabla skus
  const { Sku } = require('../../models');
  const skuRow = await Sku.findOne({
    where: { sku, activo: 1 },
    include: [{ model: Product, as: 'product' }]
  });
  if (skuRow?.product) return skuRow.product;

  // Fallback: buscar directo en productos por siigo_code
  const product = await Product.findOne({ where: { siigo_code: sku, activo: 1 } });
  if (!product) throw new AppError(`Producto con SKU "${sku}" no encontrado`, 404);
  return product;
};

/**
 * Busca un lote por LPN
 */
exports.findLotByLpn = async (lpn) => {
  const lot = await Lot.findOne({ where: { lpn } });
  if (!lot) throw new AppError(`Lote "${lpn}" no encontrado`, 404);
  return lot;
};
