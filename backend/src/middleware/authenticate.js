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
      where: { id: decoded.id, active: true },
      include: [{ model: Role, as: 'role' }]
    });

    if (!user) throw new AppError('Usuario no encontrado o inactivo', 401);

    req.user = user;
    req.userRole = user.role.name;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return next(new AppError('Token inválido', 401));
    if (err.name === 'TokenExpiredError') return next(new AppError('Token expirado', 401));
    next(err);
  }
};
