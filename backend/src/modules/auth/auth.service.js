const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Role } = require('../../models');
const AppError = require('../../utils/AppError');

function signAccess(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol?.nombre },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function signRefresh(usuario) {
  return jwt.sign(
    { id: usuario.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

exports.login = async ({ email, password }) => {
  const usuario = await User.findOne({
    where: { email, activo: true },
    include: [{ model: Role, as: 'rol' }]
  });

  if (!usuario || !usuario.password_hash) throw new AppError('Credenciales inválidas', 401);

  const valido = await bcrypt.compare(password, usuario.password_hash);
  if (!valido) throw new AppError('Credenciales inválidas', 401);

  return {
    access_token: signAccess(usuario),
    refresh_token: signRefresh(usuario),
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol?.nombre }
  };
};

exports.refresh = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const usuario = await User.findOne({
      where: { id: decoded.id, activo: true },
      include: [{ model: Role, as: 'rol' }]
    });
    if (!usuario) throw new AppError('Usuario no encontrado', 401);
    return { access_token: signAccess(usuario) };
  } catch {
    throw new AppError('Refresh token inválido o expirado', 401);
  }
};

exports.changePassword = async (usuarioId, { current_password, new_password }) => {
  const usuario = await User.findByPk(usuarioId);
  if (!usuario) throw new AppError('Usuario no encontrado', 404);

  const valido = await bcrypt.compare(current_password, usuario.password_hash);
  if (!valido) throw new AppError('Contraseña actual incorrecta', 400);

  const hash = await bcrypt.hash(new_password, 12);
  await usuario.update({ password_hash: hash });
};
