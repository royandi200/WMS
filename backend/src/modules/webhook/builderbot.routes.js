const router = require('express').Router();
const ctrl = require('./builderbot.controller');
const { validateKw } = require('./builderbot.middleware');

function setWebhookCors(res) {
  const origin = process.env.BUILDERBOT_ALLOWED_ORIGIN
    || (process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)[0]
    || 'https://app.builderbot.cloud';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuilderBot-Secret, X-Webhook-Secret');
}

router.options('/', (req, res) => {
  setWebhookCors(res);
  res.status(200).end();
});

router.post(
  '/',
  (req, res, next) => {
    setWebhookCors(res);
    next();
  },
  validateKw,
  ctrl.handle
);

module.exports = router;
