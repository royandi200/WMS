const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Role } = require('../../models');
const AppError = require('../../utils/AppError');

function signAccess(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role?.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function signRefresh(user) {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

exports.login = async ({ phone, password }) => {
  const user = await User.findOne({
    where: { phone, active: true },
    include: [{ model: Role, as: 'role' }]
  });
  if (!user || !user.password_hash) throw new AppError('Credenciales inválidas', 401);
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AppError('Credenciales inválidas', 401);

  await user.update({ last_login: new Date() });

  return {
    access_token:  signAccess(user),
    refresh_token: signRefresh(user),
    user: { id: user.id, name: user.name, phone: user.phone, role: user.role.name }
  };
};

exports.refresh = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findOne({
      where: { id: decoded.id, active: true },
      include: [{ model: Role, as: 'role' }]
    });
    if (!user) throw new AppError('Usuario no encontrado', 401);
    return { access_token: signAccess(user) };
  } catch {
    throw new AppError('Refresh token inválido o expirado', 401);
  }
};

exports.changePassword = async (userId, { current_password, new_password }) => {
  const user = await User.findByPk(userId);
  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) throw new AppError('Contraseña actual incorrecta', 400);
  const hash = await bcrypt.hash(new_password, 12);
  await user.update({ password_hash: hash });
};
