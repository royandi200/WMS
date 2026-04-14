const router = require('express').Router();
const ctrl   = require('./builderbot.controller');
const { validateKw } = require('./builderbot.middleware');

// POST /api/v1/webhook/builderbot
router.post('/', validateKw, ctrl.handle);

module.exports = router;
