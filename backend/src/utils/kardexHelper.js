const { Movimiento } = require('../models');
const { v4: uuidv4 } = require('uuid');

/**
 * Registra un movimiento en la tabla movimientos.
 * Campos alineados con el esquema real de BD.
 */
async function logKardex({ loteId, productoId, usuarioId, tipo, cantidad, saldoDespues, referenciaTipo, referenciaCodigo, notas, aprobadoPor }, t) {
  return Movimiento.create({
    uuid:             uuidv4(),
    lote_id:          loteId    || null,
    producto_id:      productoId || null,
    usuario_id:       usuarioId  || null,
    tipo,
    cantidad,
    saldo_despues:    saldoDespues    || null,
    referencia_tipo:  referenciaTipo  || null,
    referencia_codigo: referenciaCodigo || null,
    notas:            notas      || null,
    aprobado_por:     aprobadoPor || null
  }, t ? { transaction: t } : {});
}

module.exports = { logKardex };
