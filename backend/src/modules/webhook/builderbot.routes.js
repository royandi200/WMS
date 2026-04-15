const router = require('express').Router();
const ctrl   = require('./builderbot.controller');
const { validateKw } = require('./builderbot.middleware');

// CORS preflight — igual que bardj-ai/api/webhook.js
router.options('/', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(200).end();
});

// POST /api/v1/webhook/builderbot
router.post(
  '/',
  (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  },
  validateKw,
  ctrl.handle
);

module.exports = router;
