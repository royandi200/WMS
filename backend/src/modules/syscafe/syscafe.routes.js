const router       = require('express').Router();
const ctrl         = require('./syscafe.controller');
const syscafeAuth  = require('./syscafe.middleware');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');

/**
 * Rutas del módulo SysCafé.
 * Prefijo registrado en index.js: /api/v1/syscafe
 */

// ── Endpoint que SysCafé consume (autenticación por token fijo Bearer) ───────
router.get('/GetFacturas', syscafeAuth, ctrl.getFacturas);

// ── Confirmación de documentos procesados ────────────────────────────────────
router.post('/confirmar', syscafeAuth, ctrl.confirmar);

// ── Estado de sincronización (para dashboard WMS, requiere JWT) ──────────────
router.get('/sync-status', authenticate, authorize('Admin', 'Validador'), ctrl.syncStatus);

module.exports = router;
