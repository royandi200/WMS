const rateLimit = require('express-rate-limit');

// Limitar 200 peticiones por IP cada 15 minutos
module.exports = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Demasiadas peticiones. Por favor intenta de nuevo en 15 minutos.'
  },
  skip: (req) => {
    // No limitar el health check ni el webhook de BuilderBot
    return req.path === '/health' || req.path.startsWith('/api/v1/webhook');
  }
});
