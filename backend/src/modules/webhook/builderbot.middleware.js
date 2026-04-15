const AppError       = require('../../utils/AppError');
const { logWebhook } = require('./webhookLog.service');

/**
 * Parsea info sea que llegue como objeto o como string JSON.
 * Igual que bardj-ai: nunca asume el tipo del campo info.
 */
function parseInfo(rawInfo) {
  if (!rawInfo) return {};
  if (typeof rawInfo === 'object') return rawInfo;
  try { return JSON.parse(rawInfo); } catch { return {}; }
}

/**
 * Valida que info.kw coincida con BUILDERBOT_KW del .env
 * Registra cada intento (válido o no) en webhook_logs
 */
exports.validateKw = async (req, res, next) => {
  const rawBody = req.body;
  const from    = rawBody?.from;

  // info puede llegar como objeto o como string JSON — parsearlo siempre
  const info   = parseInfo(rawBody?.info || rawBody?.body);
  const kw     = info?.kw;
  const action = info?.['@ction'] || info?.['acti@n'] || info?.action || 'UNKNOWN';

  await logWebhook({
    from,
    action,
    priority: info?.priority || 'baja',
    payload:  rawBody,
    response: null,
    status:   'RECEIVED'
  }).catch(() => {});

  if (!kw || kw !== process.env.BUILDERBOT_KW) {
    await logWebhook({
      from,
      action:   'AUTH_FAIL',
      payload:  rawBody,
      response: { error: 'kw inválido' },
      status:   'REJECTED'
    }).catch(() => {});
    return next(new AppError('No autorizado', 401));
  }

  // Pasar el info ya parseado al controller para no re-parsear
  req._parsedInfo = info;
  next();
};
