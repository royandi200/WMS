const router = require('express').Router();
const ctrl = require('./waste.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { wasteSchema } = require('./waste.validation');

router.use(auth);
router.post('/', authorize('Admin','Validador'), validate(wasteSchema), ctrl.report);
router.get('/',  authorize('Admin','Validador','Consulta'), ctrl.list);

module.exports = router;
