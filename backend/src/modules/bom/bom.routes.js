const router = require('express').Router();
const ctrl = require('./bom.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { bomSchema } = require('./bom.validation');

router.use(auth);
router.get('/:product_id',  authorize('Admin','Validador','Operario','Consulta'), ctrl.getByProduct);
router.post('/',            authorize('Admin'),                                   validate(bomSchema), ctrl.upsert);
router.delete('/:id',       authorize('Admin'),                                   ctrl.remove);

module.exports = router;
