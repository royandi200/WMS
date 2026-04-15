const { Kardex } = require('../models');
const { v4: uuidv4 } = require('uuid');

/**
 * Mapeo de tipos legacy (español) → ENUM action de kardex.
 * Permite que los servicios existentes sigan llamando con `tipo`
 * sin necesidad de cambiar todos los call-sites de golpe.
 */
const TIPO_TO_ACTION = {
  entrada:           'INGRESO_RECEPCION',
  novedad:           'INGRESO_NOVEDAD',
  consumo:           'CONSUMO_MATERIAL',
  despacho:          'DESPACHO',
  merma:             'MERMA_BODEGA',
  merma_proceso:     'MERMA_PROCESO',
  merma_cierre:      'MERMA_CIERRE_WIP',
  devolucion:        'DEVOLUCION',
  produccion:        'PRODUCCION_PLANEADA',
  cierre_produccion: 'CIERRE_PRODUCCION',
  avance_fase:       'AVANCE_FASE',
  ajuste_manual:     'AJUSTE_MANUAL',
  siigo_sync:        'SIIGO_SYNC',
};

/**
 * Registra un movimiento en la tabla `kardex`.
 *
 * Acepta tanto los campos legacy en español (retrocompatibilidad)
 * como los campos nuevos en inglés.
 *
 * @param {object} params
 * @param {string}  params.loteId          - lot_id (UUID del lote)
 * @param {number}  params.productoId      - product_id
 * @param {number}  params.usuarioId       - user_id
 * @param {string}  params.tipo            - tipo legacy → se mapea a action ENUM
 * @param {string}  [params.action]        - action ENUM directa (tiene prioridad sobre tipo)
 * @param {number}  params.cantidad        - qty
 * @param {number}  [params.saldoDespues]  - balance_after
 * @param {string}  [params.referenciaTipo]
 * @param {string}  [params.referenciaCodigo]
 * @param {string}  [params.notas]
 * @param {number}  [params.aprobadoPor]   - approved_by
 * @param {object}  [t]                    - Sequelize transaction
 */
async function logKardex(
  {
    loteId, productoId, usuarioId,
    tipo, action,
    cantidad, saldoDespues,
    referenciaTipo, referenciaCodigo,
    notas, aprobadoPor,
  },
  t
) {
  const resolvedAction = action || TIPO_TO_ACTION[tipo] || 'AJUSTE_MANUAL';

  const reference = [referenciaTipo, referenciaCodigo]
    .filter(Boolean)
    .join(':')
    .slice(0, 100) || null;

  return Kardex.create(
    {
      id:            uuidv4(),
      tx_id:         uuidv4(),
      lot_id:        loteId        || null,
      product_id:    productoId,
      user_id:       usuarioId,
      action:        resolvedAction,
      qty:           cantidad,
      balance_after: saldoDespues  || null,
      reference,
      notes:         notas         || null,
      approved_by:   aprobadoPor   || null,
    },
    t ? { transaction: t } : {}
  );
}

module.exports = { logKardex };
