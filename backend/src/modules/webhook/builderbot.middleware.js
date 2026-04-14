const AppError = require('../../utils/AppError');
const { logWebhook } = require('./webhookLog.service');

/**
 * Valida que el campo info.kw coincida con BUILDERBOT_KW del .env
 * Registra cada intento (válido o no) en la tabla webhook_logs
 */
exports.validateKw = async (req, res, next) => {
  const { from, info } = req.body;
  const kw = info?.kw;

  await logWebhook({
    from,
    action:    info?.['@ction'] || 'UNKNOWN',
    priority:  info?.priority  || 'baja',
    payload:   req.body,
    response:  null,
    status:    'RECEIVED'
  }).catch(() => {});

  if (!kw || kw !== process.env.BUILDERBOT_KW) {
    await logWebhook({ from, action: 'AUTH_FAIL', payload: req.body, response: { error: 'kw inválido' }, status: 'REJECTED' }).catch(() => {});
    return next(new AppError('No autorizado', 401));
  }
  next();
};
