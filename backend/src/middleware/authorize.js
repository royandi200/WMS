const AppError = require('../utils/AppError');

/**
 * Middleware RBAC.
 * Uso: authorize('Admin', 'Validador')  -> cualquiera de esos roles pasa
 *      authorize()                      -> cualquier usuario autenticado pasa
 */
module.exports = (...allowedRoles) => (req, res, next) => {
  if (!req.user) return next(new AppError('No autenticado', 401));
  if (allowedRoles.length === 0) return next();
  if (allowedRoles.includes(req.userRole)) return next();
  return next(new AppError(
    `Tu rol (${req.userRole}) no tiene permiso para esta acción`,
    403
  ));
};
