const router = require('express').Router();
const builderbotRouter = require('./builderbot.routes');

router.use('/builderbot', builderbotRouter);

module.exports = router;
