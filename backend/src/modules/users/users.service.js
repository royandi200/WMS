const bcrypt = require('bcryptjs');
const { User: Usuario, Role: Rol } = require('../../models');
const AppError = require('../../utils/AppError');

function normalizeUserInput(data = {}) {
  const normalized = {
    nombre: data.nombre ?? data.name,
    telefono: data.telefono ?? data.phone,
    email: data.email,
    rol_id: data.rol_id ?? data.role_id,
    activo: data.activo ?? data.active,
  };

  Object.keys(normalized).forEach((key) => {
    if (normalized[key] === undefined) delete normalized[key];
  });
  return normalized;
}

exports.list = () => Usuario.findAll({
  include: [{ model: Rol, as: 'rol', attributes: ['id','nombre'] }],
  attributes: { exclude: ['password_hash'] }
});

exports.create = async (data) => {
  const { password } = data;
  const attrs = normalizeUserInput(data);
  const hash = await bcrypt.hash(password, 12);
  const usuario = await Usuario.create({ ...attrs, password_hash: hash });
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
  await u.update(normalizeUserInput(data));
  return exports.getOne(id);
};

exports.remove = async (id) => {
  const u = await Usuario.findByPk(id);
  if (!u) throw new AppError('Usuario no encontrado', 404);
  await u.update({ activo: false });
};
