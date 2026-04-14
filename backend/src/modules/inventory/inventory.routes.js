const router = require('express').Router();
const ctrl = require('./inventory.controller');
const auth = require('../../middleware/authenticate');

router.use(auth);

router.get('/summary',          ctrl.globalSummary);      // GET /inventory/summary
router.get('/product/:id',      ctrl.productStock);       // GET /inventory/product/:id
router.get('/lot/:lpn',         ctrl.lotDetail);          // GET /inventory/lot/L-xxx
router.get('/kardex',           ctrl.kardexList);         // GET /inventory/kardex?sku=&page=
router.get('/low-stock',        ctrl.lowStock);           // GET /inventory/low-stock

module.exports = router;
