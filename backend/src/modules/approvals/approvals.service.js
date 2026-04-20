const { Op } = require('sequelize');
const { ApprovalQueue, User } = require('../../models');
const AppError = require('../../utils/AppError');
const receptionService  = require('../reception/reception.service');
const productionService = require('../production/production.service');
const dispatchService   = require('../dispatch/dispatch.service');
const wasteService      = require('../waste/waste.service');
const returnsService    = require('../returns/returns.service');

const ACTION_HANDLERS = {
  INGRESO_RECEPCION:           (p, u) => receptionService.receive(p, u),
  SOLICITAR_INICIO_PRODUCCION: (p, u) => productionService.start(p, u),
  CONFIRMAR_MATERIALES:        (p, u) => productionService.confirmMaterials(p, u),
  SOLICITAR_CIERRE_PRODUCCION: (p, u) => productionService.close(p, u),
  SOLICITAR_DESPACHO:          (p, u) => dispatchService.dispatch(p, u),
  REPORTE_MERMA:               (p, u) => wasteService.report(p, u),
  GESTION_DEVOLUCION:          (p, u) => returnsService.processReturn(p, u)
};

function buildWhere(estado) {
  const value = String(estado || 'PENDIENTE').trim().toUpperCase();
  if (value === 'ALL' || value === 'TODOS') return {};
  if (value === 'HISTORIAL') {
    return { estado: { [Op.in]: ['APROBADO', 'RECHAZADO', 'EXPIRADO'] } };
  }
  return { estado: value };
}

function serializeSolicitud(solicitud) {
  const payload = solicitud.payload || {};
  return {
    id: solicitud.id,
    codigo_solicitud: solicitud.codigo_solicitud,
    tipo: solicitud.accion,
    accion: solicitud.accion,
    estado: solicitud.estado,
    cantidad: payload.cantidad ?? payload.cantidad_real ?? payload.cantidad_planificada ?? payload.cantidad_deseada ?? null,
    lote: payload.id_lote ?? payload.lote ?? payload.lot ?? payload.lote_usado ?? payload.lote_sugerido ?? null,
    creado_en: solicitud.creado_en,
    procesado_en: solicitud.procesado_en,
    motivo_rechazo: solicitud.motivo_rechazo,
    producto_nombre: payload.producto_nombre ?? payload.producto ?? payload.id_producto_final ?? payload.id_item ?? payload.sku ?? null,
    siigo_code: payload.siigo_code ?? payload.sku ?? null,
    id_item: payload.id_item ?? payload.id_producto_final ?? null,
    id_orden: payload.id_orden ?? null,
    bodega_orig_nombre: payload.bodega_origen ?? payload.bodega_orig_nombre ?? null,
    bodega_dest_nombre: payload.bodega_destino ?? payload.bodega_dest_nombre ?? null,
    usuario_nombre: solicitud.solicitante?.nombre ?? null,
    procesado_por_nombre: solicitud.procesador?.nombre ?? null,
    payload,
  };
}

exports.list = async ({ estado = 'PENDIENTE', limit = 50 } = {}) => {
  const parsedLimit = Number(limit);
  const rows = await ApprovalQueue.findAll({
    where: buildWhere(estado),
    include: [
      { model: User, as: 'solicitante', attributes: ['nombre', 'email'] },
      { model: User, as: 'procesador', attributes: ['nombre', 'email'] },
    ],
    order: [['creado_en', String(estado || 'PENDIENTE').toUpperCase() === 'PENDIENTE' ? 'ASC' : 'DESC']],
    ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
  });

  return rows.map(serializeSolicitud);
};

exports.approve = async (codigo_solicitud, aprobador) => {
  const solicitud = await ApprovalQueue.findOne({ where: { codigo_solicitud, estado: 'PENDIENTE' } });
  if (!solicitud) throw new AppError(`Solicitud ${codigo_solicitud} no encontrada o ya procesada`, 404);

  const handler = ACTION_HANDLERS[solicitud.accion];
  if (!handler) throw new AppError(`No hay handler para la acción ${solicitud.accion}`, 422);

  const result = await handler(solicitud.payload, aprobador);

  await solicitud.update({
    estado: 'APROBADO',
    procesado_por: aprobador.id,
    procesado_en: new Date()
  });

  return { codigo_solicitud, accion: solicitud.accion, result };
};

exports.reject = async ({ codigo_solicitud, motivo }, aprobador) => {
  const solicitud = await ApprovalQueue.findOne({ where: { codigo_solicitud, estado: 'PENDIENTE' } });
  if (!solicitud) throw new AppError(`Solicitud ${codigo_solicitud} no encontrada o ya procesada`, 404);

  await solicitud.update({
    estado: 'RECHAZADO',
    procesado_por: aprobador.id,
    procesado_en: new Date(),
    motivo_rechazo: motivo
  });

  return { codigo_solicitud, estado: 'RECHAZADO' };
};

exports.approveByCode = (rc, u) => exports.approve(rc, u);
exports.rejectByCode = (d, u) => exports.reject({ codigo_solicitud: d.request_code, motivo: d.reason }, u);
