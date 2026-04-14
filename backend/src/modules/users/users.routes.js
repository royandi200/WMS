const router = require('express').Router();
const ctrl = require('./users.controller');
const auth = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { createUserSchema, updateUserSchema } = require('./users.validation');

router.use(auth);

router.get('/',      authorize('Admin'),                    ctrl.list);
router.post('/',     authorize('Admin'), validate(createUserSchema), ctrl.create);
router.get('/:id',   authorize('Admin', 'Validador'),       ctrl.getOne);
router.put('/:id',   authorize('Admin'), validate(updateUserSchema), ctrl.update);
router.delete('/:id',authorize('Admin'),                   ctrl.remove);

module.exports = router;
