const router = require('express').Router();
const ctrl = require('./reception.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { receptionSchema } = require('./reception.validation');

router.use(auth);

router.post('/', authorize('Admin','Validador','Operario'), validate(receptionSchema), ctrl.receive);

module.exports = router;
