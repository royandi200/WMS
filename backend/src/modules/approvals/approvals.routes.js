const router = require('express').Router();
const ctrl = require('./approvals.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { approveSchema, rejectSchema } = require('./approvals.validation');

router.use(auth);
router.get('/',             authorize('Admin','Validador'),  ctrl.list);
router.post('/approve',     authorize('Admin','Validador'),  validate(approveSchema), ctrl.approve);
router.post('/reject',      authorize('Admin','Validador'),  validate(rejectSchema),  ctrl.reject);

module.exports = router;
