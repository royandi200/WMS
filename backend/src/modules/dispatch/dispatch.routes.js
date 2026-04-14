const router = require('express').Router();
const ctrl = require('./dispatch.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { dispatchSchema } = require('./dispatch.validation');

router.use(auth);
router.post('/', authorize('Admin','Validador'), validate(dispatchSchema), ctrl.dispatch);

module.exports = router;
