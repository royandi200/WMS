const jwt = require('jsonwebtoken');
const { User, Role } = require('../models');
const AppError = require('../utils/AppError');

module.exports = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError('Token de autenticación requerido', 401);
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findOne({
      where: { id: decoded.id, activo: true },
      include: [{ model: Role, as: 'rol' }]
    });

    if (!user) throw new AppError('Usuario no encontrado o inactivo', 401);

    req.user = user;
    req.userRole = user.rol?.nombre;

    if (!req.userRole) {
      throw new AppError('Usuario sin rol asignado', 403);
    }

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return next(new AppError('Token inválido', 401));
    if (err.name === 'TokenExpiredError') return next(new AppError('Token expirado', 401));
    next(err);
  }
};
