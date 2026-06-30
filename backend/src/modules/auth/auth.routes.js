const router = require('express').Router();
const ctrl = require('./auth.controller');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const { loginSchema, refreshSchema, changePasswordSchema } = require('./auth.validation');

router.post('/login',           validate(loginSchema),          ctrl.login);
router.post('/refresh',         validate(refreshSchema),        ctrl.refresh);
router.post('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword);

module.exports = router;
