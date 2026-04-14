const { WebhookLog } = require('../../models');

/**
 * Registra cada mensaje recibido y cada respuesta enviada.
 * status: RECEIVED | PROCESSED | REJECTED | ERROR
 */
exports.logWebhook = async ({ from, action, priority, payload, response, status }) => {
  try {
    await WebhookLog.create({
      from_phone:   from     || null,
      action:       action   || 'UNKNOWN',
      priority:     priority || 'baja',
      payload:      JSON.stringify(payload  || {}),
      response:     JSON.stringify(response || {}),
      status
    });
  } catch (e) {
    // No bloquear el flujo principal si el log falla
    console.error('[WebhookLog] Error al guardar log:', e.message);
  }
};

/**
 * Consulta el historial de logs con filtros opcionales
 */
exports.getWebhookLogs = async ({ from, action, status, page = 1, limit = 50 }) => {
  const where = {};
  if (from)   where.from_phone = from;
  if (action) where.action     = action;
  if (status) where.status     = status;

  return WebhookLog.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit)
  });
};
