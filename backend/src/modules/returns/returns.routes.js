const router = require('express').Router();
const ctrl = require('./returns.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { returnSchema } = require('./returns.validation');

router.use(auth);
router.post('/', authorize('Admin','Validador','Operario'), validate(returnSchema), ctrl.processReturn);

module.exports = router;
