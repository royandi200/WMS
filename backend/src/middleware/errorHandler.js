const logger = require('../config/logger');
const AppError = require('../utils/AppError');

module.exports = (err, req, res, next) => {
  // Log del error
  if (err.statusCode >= 500 || !err.isOperational) {
    logger.error(err);
  } else {
    logger.warn(`[${err.statusCode}] ${err.message} — ${req.method} ${req.originalUrl}`);
  }

  // Errores de Sequelize
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      ok: false,
      message: 'Ya existe un registro con esos datos únicos',
      details: err.errors?.map(e => e.message)
    });
  }
  if (err.name === 'SequelizeValidationError') {
    return res.status(422).json({
      ok: false,
      message: 'Error de validación en base de datos',
      details: err.errors?.map(e => e.message)
    });
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(409).json({
      ok: false,
      message: 'Referencia inválida: el registro relacionado no existe'
    });
  }

  // Error operacional (creado con AppError)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      ok: false,
      message: err.message,
      ...(err.details && { details: err.details })
    });
  }

  // Error inesperado
  res.status(500).json({
    ok: false,
    message: 'Error interno del servidor'
  });
};
