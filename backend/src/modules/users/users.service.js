const bcrypt = require('bcryptjs');
const { Usuario, Rol } = require('../../models');
const AppError = require('../../utils/AppError');

exports.list = () => Usuario.findAll({
  include: [{ model: Rol, as: 'rol', attributes: ['id','nombre'] }],
  attributes: { exclude: ['password_hash'] }
});

exports.create = async ({ nombre, email, password, rol_id }) => {
  const hash = await bcrypt.hash(password, 12);
  const usuario = await Usuario.create({ nombre, email, password_hash: hash, rol_id });
  return Usuario.findByPk(usuario.id, { include: [{ model: Rol, as: 'rol' }], attributes: { exclude: ['password_hash'] } });
};

exports.getOne = async (id) => {
  const u = await Usuario.findByPk(id, { include: [{ model: Rol, as: 'rol' }], attributes: { exclude: ['password_hash'] } });
  if (!u) throw new AppError('Usuario no encontrado', 404);
  return u;
};

exports.update = async (id, data) => {
  const u = await Usuario.findByPk(id);
  if (!u) throw new AppError('Usuario no encontrado', 404);
  await u.update(data);
  return exports.getOne(id);
};

exports.remove = async (id) => {
  const u = await Usuario.findByPk(id);
  if (!u) throw new AppError('Usuario no encontrado', 404);
  await u.update({ activo: false });
};
