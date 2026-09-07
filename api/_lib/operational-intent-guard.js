const { currentText } = require('./additional-operation-input');

function assertOperationalIntent(action, rawBody, info) {
  if (!['GESTION_DEVOLUCION', 'AJUSTAR_MATERIALES_PRODUCCION', 'REPORTE_MERMA'].includes(action)) return;
  const text = currentText(rawBody, info).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Never turn a disabled disposition into another stock movement, even when
  // the model replaced its state with CUARENTENA or RECUPERABLE.
  if (/\b(?:destruccion|destruir|destruye|destruyan|destruyamos|destruyo)\b/.test(text)) {
    throw Object.assign(new Error('La disposicion final esta deshabilitada. No se registro otra operacion ni se modifico inventario.'), { status: 409 });
  }
  if (action === 'GESTION_DEVOLUCION' && /\b(?:devuelvo|devolver|devolucion|sobrantes?)\b/.test(text)
      && /\b(?:op-[a-z0-9-]+|orden(?: de produccion)?\s+(?:id\s*)?\d+)\b/.test(text)) {
    throw Object.assign(new Error('El mensaje corresponde a materiales de produccion, no a una devolucion de cliente. Indica el ajuste de materiales de la orden, cantidad, producto, lote y ubicacion. No se modifico inventario.'), { status: 409 });
  }
}

function publicOperationalError(error) {
  const status = Number(error.status || 500);
  if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
    return 'No fue posible completar la operacion por concurrencia. Consulta su estado antes de reintentar.';
  }
  if (error.sql || error.sqlMessage || status >= 500) {
    return 'No fue posible completar la operacion. Consulta su estado antes de reintentar.';
  }
  return error.message || 'Solicitud no valida';
}

module.exports = { assertOperationalIntent, publicOperationalError };
