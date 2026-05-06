const { Op }              = require('sequelize');
const { Despacho, DespachoItem, Product, Tercero } = require('../../models');
const SyscafeSync         = require('../../models/SyscafeSync');
const { mapDespachoToDocument } = require('./syscafe.mapper');
const logger              = require('../../config/logger');

/**
 * Devuelve los documentos pendientes de sincronización para una fecha dada.
 * Si no se especifica fecha, devuelve todos los pendientes.
 *
 * @param {string|null} fecha  — YYYY-MM-DD  (opcional)
 * @param {number}      consec — número de secuencia mínimo (opcional, default 0)
 * @returns {object[]}  array de DOCUMENTs para SysCafé
 */
async function getDocumentosPendientes(fecha = null, consec = 0) {
  // Construir WHERE sobre despachos
  const where = { estado: 'despachado' };

  if (fecha) {
    const inicio = new Date(`${fecha}T00:00:00.000Z`);
    const fin    = new Date(`${fecha}T23:59:59.999Z`);
    where.creado_en = { [Op.between]: [inicio, fin] };
  }

  if (consec && parseInt(consec) > 0) {
    where.id = { [Op.gt]: parseInt(consec) };
  }

  // Traer despachos que aún NO están marcados como 'enviado'
  const syncEnviados = await SyscafeSync.findAll({
    where: { status: 'enviado' },
    attributes: ['despacho_id']
  });
  const idsEnviados = syncEnviados.map(s => s.despacho_id);

  if (idsEnviados.length) {
    where.id = where.id
      ? { ...where.id, [Op.notIn]: idsEnviados }
      : { [Op.notIn]: idsEnviados };
  }

  const despachos = await Despacho.findAll({
    where,
    include: [
      {
        model: DespachoItem,
        as:    'items',
        include: [{ model: Product, as: 'producto' }]
      },
      { model: Tercero, as: 'tercero', required: false }
    ],
    order: [['creado_en', 'ASC']]
  });

  logger.info(`[SysCafé] Despachos pendientes a sincronizar: ${despachos.length}`);
  return despachos.map(mapDespachoToDocument);
}

/**
 * Marca un despacho como sincronizado.
 * Llama esto DESPUÉS de confirmar que SysCafé procesó la respuesta.
 *
 * @param {string} numero  — número de despacho WMS (noext)
 */
async function marcarEnviado(numero) {
  const despacho = await Despacho.findOne({ where: { numero } });
  if (!despacho) return;

  await SyscafeSync.upsert({
    despacho_id: despacho.id,
    numero,
    status:      'enviado',
    enviado_en:  new Date()
  });

  logger.info(`[SysCafé] Despacho ${numero} marcado como enviado`);
}

/**
 * Marca un despacho como error (para reintentos)
 */
async function marcarError(numero, respuesta) {
  const despacho = await Despacho.findOne({ where: { numero } });
  if (!despacho) return;

  const existing = await SyscafeSync.findOne({ where: { despacho_id: despacho.id } });
  if (existing) {
    await existing.increment('intentos');
    await existing.update({ status: 'error', respuesta: String(respuesta) });
  } else {
    await SyscafeSync.create({
      despacho_id: despacho.id,
      numero,
      status:      'error',
      respuesta:   String(respuesta),
      intentos:    1
    });
  }
}

module.exports = { getDocumentosPendientes, marcarEnviado, marcarError };
