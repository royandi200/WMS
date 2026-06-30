const AppError = require('../../utils/AppError');
const { logWebhook } = require('./webhookLog.service');
const crypto = require('crypto');

function parseInfo(rawInfo) {
  if (!rawInfo) return {};
  if (typeof rawInfo === 'object') return rawInfo;
  try { return JSON.parse(rawInfo); } catch { return {}; }
}

function safeEqual(expectedValue, providedValue) {
  const expected = Buffer.from(String(expectedValue || ''));
  const provided = Buffer.from(String(providedValue || ''));
  return expected.length > 0
    && expected.length === provided.length
    && crypto.timingSafeEqual(expected, provided);
}

exports.validateKw = async (req, res, next) => {
  const rawBody = req.body;
  const from = rawBody?.from;
  const info = parseInfo(rawBody?.info || rawBody?.body);
  const kw = info?.kw;
  const action = info?.['@ction'] || info?.['acti@n'] || info?.action || 'UNKNOWN';

  await logWebhook({
    from,
    action,
    priority: info?.priority || 'baja',
    payload: rawBody,
    response: null,
    status: 'RECEIVED',
  }).catch(() => {});

  const configuredSecret = process.env.BUILDERBOT_WEBHOOK_SECRET;
  const providedSecret = req.headers['x-builderbot-secret']
    || req.headers['x-webhook-secret']
    || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (!configuredSecret) {
    return next(new AppError('Webhook no configurado', 500));
  }

  if (!safeEqual(configuredSecret, providedSecret)) {
    await logWebhook({
      from,
      action: 'AUTH_FAIL',
      payload: rawBody,
      response: { error: 'webhook secret invalido' },
      status: 'REJECTED',
    }).catch(() => {});
    return next(new AppError('No autorizado', 401));
  }

  // kw is a BuilderBot flow marker, not the security secret.
  if (process.env.BUILDERBOT_KW && kw && kw !== process.env.BUILDERBOT_KW) {
    await logWebhook({
      from,
      action: 'FLOW_KW_MISMATCH',
      payload: rawBody,
      response: { expected_kw: process.env.BUILDERBOT_KW, received_kw: kw },
      status: 'REJECTED',
    }).catch(() => {});
    return next(new AppError('Flujo BuilderBot no autorizado', 403));
  }

  req._parsedInfo = info;
  next();
};
