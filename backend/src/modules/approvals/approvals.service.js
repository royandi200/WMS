const { ApprovalQueue, User } = require('../../models');
const AppError = require('../../utils/AppError');
const receptionService  = require('../reception/reception.service');
const productionService = require('../production/production.service');
const dispatchService   = require('../dispatch/dispatch.service');
const wasteService      = require('../waste/waste.service');
const returnsService    = require('../returns/returns.service');
const builderBotService = require('../webhook/builderbot.service');

// Mapa de acción -> función de servicio a ejecutar
const ACTION_HANDLERS = {
  INGRESO_RECEPCION:           (p, u) => receptionService.receive(p, u),
  SOLICITAR_INICIO_PRODUCCION: (p, u) => productionService.start(p, u),
  CONFIRMAR_MATERIALES:        (p, u) => productionService.confirmMaterials(p, u),
  SOLICITAR_CIERRE_PRODUCCION: (p, u) => productionService.close(p, u),
  SOLICITAR_DESPACHO:          (p, u) => dispatchService.dispatch(p, u),
  REPORTE_MERMA:               (p, u) => wasteService.report(p, u),
  GESTION_DEVOLUCION:          (p, u) => returnsService.processReturn(p, u)
};

exports.list = () => ApprovalQueue.findAll({
  where: { status: 'PENDIENTE' },
  include: [{ model: User, as: 'requester', attributes: ['name','phone'] }],
  order: [['created_at','ASC']]
});

exports.approve = async (request_code, approver) => {
  const req = await ApprovalQueue.findOne({ where: { request_code, status: 'PENDIENTE' } });
  if (!req) throw new AppError(`Solicitud ${request_code} no encontrada o ya procesada`, 404);

  const handler = ACTION_HANDLERS[req.action];
  if (!handler) throw new AppError(`No hay handler para la acción ${req.action}`, 422);

  const result = await handler(req.payload, approver);

  await req.update({ status: 'APROBADO', processed_by: approver.id, processed_at: new Date() });

  // Notificar al operario que solicitó
  const requester = await User.findByPk(req.requested_by);
  if (requester?.phone) {
    await builderBotService.sendMessage(
      requester.phone,
      `✅ *Solicitud ${request_code} Aprobada*\nAcción: ${req.action.replace(/_/g,' ')}\nAprobada por: ${approver.name}`
    ).catch(() => {});
  }

  return { request_code, action: req.action, result };
};

exports.reject = async ({ request_code, reason }, approver) => {
  const req = await ApprovalQueue.findOne({ where: { request_code, status: 'PENDIENTE' } });
  if (!req) throw new AppError(`Solicitud ${request_code} no encontrada o ya procesada`, 404);

  await req.update({ status: 'RECHAZADO', processed_by: approver.id, processed_at: new Date(), reject_reason: reason });

  const requester = await User.findByPk(req.requested_by);
  if (requester?.phone) {
    await builderBotService.sendMessage(
      requester.phone,
      `❌ *Solicitud ${request_code} Rechazada*\n${reason ? 'Motivo: ' + reason : 'Sin motivo especificado'}`
    ).catch(() => {});
  }

  return { request_code, status: 'RECHAZADO' };
};
