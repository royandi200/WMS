const router = require('express').Router();
const ctrl = require('./production.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const v = require('./production.validation');

router.use(auth);

router.post('/start',             authorize('Admin','Validador','Operario'), validate(v.startSchema),    ctrl.start);
router.post('/confirm-materials', authorize('Admin','Validador','Operario'), validate(v.confirmSchema),  ctrl.confirmMaterials);
router.post('/advance-phase',     authorize('Admin','Validador','Operario'), validate(v.advanceSchema),  ctrl.advancePhase);
router.post('/close',             authorize('Admin','Validador','Operario'), validate(v.closeSchema),    ctrl.close);
router.get('/',                   authorize('Admin','Validador','Consulta'), ctrl.list);
router.get('/:id',                authorize('Admin','Validador','Operario','Consulta'), ctrl.getOne);

module.exports = router;
