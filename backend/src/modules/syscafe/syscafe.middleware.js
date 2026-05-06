/**
 * Middleware de autenticación para el endpoint SysCafé.
 * SysCafé debe enviar: Authorization: Bearer <SYSCAFE_API_TOKEN>
 */
const logger = require('../../config/logger');

module.exports = function syscafeAuth(req, res, next) {
  const EXPECTED = `Bearer ${process.env.SYSCAFE_API_TOKEN}`;
  const received = req.headers['authorization'] || '';

  if (!process.env.SYSCAFE_API_TOKEN) {
    logger.warn('[SysCafé] SYSCAFE_API_TOKEN no configurado en .env');
    return res.status(500).json({ error: 'Integración no configurada' });
  }

  if (received !== EXPECTED) {
    logger.warn(`[SysCafé] Token inválido recibido: ${received.substring(0, 30)}...`);
    return res.status(401).json({ error: 'Token inválido o ausente' });
  }

  next();
};
