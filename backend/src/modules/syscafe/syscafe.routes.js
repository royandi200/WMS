const router       = require('express').Router();
const ctrl         = require('./syscafe.controller');
const syscafeAuth  = require('./syscafe.middleware');
const { verifyToken } = require('../auth/auth.middleware');

/**
 * Rutas del módulo SysCafé.
 * Prefijo registrado en index.js: /api/v1/syscafe
 */

// ── Endpoint que SysCafé consume (autenticación por token fijo Bearer) ───────
router.get('/GetFacturas', syscafeAuth, ctrl.getFacturas);

// ── Confirmación de documentos procesados ────────────────────────────────────
router.post('/confirmar', syscafeAuth, ctrl.confirmar);

// ── Estado de sincronización (para dashboard WMS, requiere JWT) ──────────────
router.get('/sync-status', verifyToken, ctrl.syncStatus);

module.exports = router;
