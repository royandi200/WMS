const { AprobacionSolicitud, Usuario } = require('../../models');
const AppError = require('../../utils/AppError');
const receptionService  = require('../reception/reception.service');
const productionService = require('../production/production.service');
const dispatchService   = require('../dispatch/dispatch.service');
const wasteService      = require('../waste/waste.service');
const returnsService    = require('../returns/returns.service');
const builderBotService = require('../webhook/builderbot.service');

const ACTION_HANDLERS = {
  INGRESO_RECEPCION:           (p, u) => receptionService.receive(p, u),
  SOLICITAR_INICIO_PRODUCCION: (p, u) => productionService.start(p, u),
  CONFIRMAR_MATERIALES:        (p, u) => productionService.confirmMaterials(p, u),
  SOLICITAR_CIERRE_PRODUCCION: (p, u) => productionService.close(p, u),
  SOLICITAR_DESPACHO:          (p, u) => dispatchService.dispatch(p, u),
  REPORTE_MERMA:               (p, u) => wasteService.report(p, u),
  GESTION_DEVOLUCION:          (p, u) => returnsService.processReturn(p, u)
};

exports.list = () => AprobacionSolicitud.findAll({
  where: { estado: 'PENDIENTE' },
  include: [{ model: Usuario, as: 'solicitante', attributes: ['nombre','email'] }],
  order: [['creado_en','ASC']]
});

exports.approve = async (codigo_solicitud, aprobador) => {
  const solicitud = await AprobacionSolicitud.findOne({ where: { codigo_solicitud, estado: 'PENDIENTE' } });
  if (!solicitud) throw new AppError(`Solicitud ${codigo_solicitud} no encontrada o ya procesada`, 404);

  const handler = ACTION_HANDLERS[solicitud.accion];
  if (!handler) throw new AppError(`No hay handler para la acción ${solicitud.accion}`, 422);

  const result = await handler(solicitud.payload, aprobador);

  await solicitud.update({
    estado:       'APROBADO',
    procesado_por: aprobador.id,
    procesado_en:  new Date()
  });

  const solicitante = await Usuario.findByPk(solicitud.solicitado_por);
  if (solicitante?.email) {
    builderBotService.sendMessage(
      solicitante.email,
      `✅ *Solicitud ${codigo_solicitud} Aprobada*\nAcción: ${solicitud.accion.replace(/_/g,' ')}\nAprobada por: ${aprobador.nombre}`
    ).catch(() => {});
  }

  return { codigo_solicitud, accion: solicitud.accion, result };
};

exports.reject = async ({ codigo_solicitud, motivo }, aprobador) => {
  const solicitud = await AprobacionSolicitud.findOne({ where: { codigo_solicitud, estado: 'PENDIENTE' } });
  if (!solicitud) throw new AppError(`Solicitud ${codigo_solicitud} no encontrada o ya procesada`, 404);

  await solicitud.update({
    estado:           'RECHAZADO',
    procesado_por:    aprobador.id,
    procesado_en:     new Date(),
    motivo_rechazo:   motivo
  });

  const solicitante = await Usuario.findByPk(solicitud.solicitado_por);
  if (solicitante?.email) {
    builderBotService.sendMessage(
      solicitante.email,
      `❌ *Solicitud ${codigo_solicitud} Rechazada*\n${motivo ? 'Motivo: ' + motivo : 'Sin motivo especificado'}`
    ).catch(() => {});
  }

  return { codigo_solicitud, estado: 'RECHAZADO' };
};

// Alias para compatibilidad con builderbot que usa request_code
exports.approveByCode  = (rc, u) => exports.approve(rc, u);
exports.rejectByCode   = (d, u)  => exports.reject({ codigo_solicitud: d.request_code, motivo: d.reason }, u);
