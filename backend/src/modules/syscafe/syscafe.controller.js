const syscafeSvc = require('./syscafe.service');
const logger     = require('../../config/logger');

/**
 * GET /api/v1/syscafe/GetFacturas?fecha=YYYY-MM-DD&consec=0
 *
 * SysCafé llama a este endpoint periódicamente para jalar las facturas/pedidos
 * generados por el WMS.
 */
exports.getFacturas = async (req, res, next) => {
  try {
    const { fecha, consec = 0 } = req.query;

    // Validar formato de fecha si viene
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    }

    const documentos = await syscafeSvc.getDocumentosPendientes(fecha || null, consec);

    logger.info(`[SysCafé] GetFacturas → ${documentos.length} documentos devueltos (fecha=${fecha || 'todos'}, consec=${consec})`);

    return res.status(200).json(documentos);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/syscafe/confirmar
 *
 * SysCafé (o un proceso interno) confirma que los documentos fueron procesados.
 * Body: { numeros: ["D-20260501-001", "D-20260501-002"] }
 */
exports.confirmar = async (req, res, next) => {
  try {
    const { numeros } = req.body;

    if (!Array.isArray(numeros) || numeros.length === 0) {
      return res.status(400).json({ error: '"numeros" debe ser un array no vacío de strings' });
    }

    const resultados = [];
    for (const numero of numeros) {
      await syscafeSvc.marcarEnviado(numero);
      resultados.push({ numero, status: 'enviado' });
    }

    logger.info(`[SysCafé] Confirmación recibida: ${numeros.join(', ')}`);
    return res.status(200).json({ ok: true, procesados: resultados });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/syscafe/sync-status
 *
 * Panel interno — ver estado de sincronización sin auth de SysCafé.
 * Protegido solo por el JWT del WMS (agregado en routes).
 */
exports.syncStatus = async (req, res, next) => {
  try {
    const SyscafeSync = require('../../models/SyscafeSync');
    const { Op }      = require('sequelize');

    const [pendientes, enviados, errores] = await Promise.all([
      SyscafeSync.count({ where: { status: 'pendiente' } }),
      SyscafeSync.count({ where: { status: 'enviado'   } }),
      SyscafeSync.count({ where: { status: 'error'     } })
    ]);

    const ultimosErrores = await SyscafeSync.findAll({
      where: { status: 'error' },
      order: [['actualizado_en', 'DESC']],
      limit: 10
    });

    return res.status(200).json({
      resumen:        { pendientes, enviados, errores },
      ultimos_errores: ultimosErrores
    });
  } catch (err) {
    next(err);
  }
};
