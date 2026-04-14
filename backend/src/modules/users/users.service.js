const bcrypt = require('bcryptjs');
const { User, Role } = require('../../models');
const AppError = require('../../utils/AppError');

exports.list = () => User.findAll({
  include: [{ model: Role, as: 'role', attributes: ['id','name'] }],
  attributes: { exclude: ['password_hash'] }
});

exports.create = async ({ name, phone, email, password, role_id }) => {
  const hash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, phone, email, password_hash: hash, role_id });
  return User.findByPk(user.id, { include: [{ model: Role, as: 'role' }], attributes: { exclude: ['password_hash'] } });
};

exports.getOne = async (id) => {
  const u = await User.findByPk(id, { include: [{ model: Role, as: 'role' }], attributes: { exclude: ['password_hash'] } });
  if (!u) throw new AppError('Usuario no encontrado', 404);
  return u;
};

exports.update = async (id, data) => {
  const u = await User.findByPk(id);
  if (!u) throw new AppError('Usuario no encontrado', 404);
  await u.update(data);
  return exports.getOne(id);
};

exports.remove = async (id) => {
  const u = await User.findByPk(id);
  if (!u) throw new AppError('Usuario no encontrado', 404);
  await u.update({ active: false });
};
