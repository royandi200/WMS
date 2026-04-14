const AppError = require('../utils/AppError');

/**
 * Middleware de validación con Joi.
 * Uso: validate(schema) donde schema es un objeto Joi.
 */
module.exports = (schema, property = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
  if (error) {
    const details = error.details.map(d => d.message);
    return next(new AppError('Error de validación', 422, details));
  }
  req[property] = value;
  next();
};
