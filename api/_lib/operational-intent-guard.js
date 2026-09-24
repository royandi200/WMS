const { currentText } = require('./additional-operation-input');

const WASTE_REASON_STOP_WORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'por', 'que',
  'se', 'su', 'un', 'una', 'unos', 'unas', 'y',
]);
const KNOWN_CAUSE_WORDS = new Set([
  'dano', 'rotura', 'derrame', 'vencimiento', 'contaminacion',
  'defecto', 'caida', 'despegue',
]);

function normalizedWords(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().match(/[a-z0-9]+/gu) || [];
}

function causeWord(word) {
  if (/^(?:dan|dano)/u.test(word)) return 'dano';
  if (/^(?:rotur|ruptur|rot[ao]s?$|romp)/u.test(word)) return 'rotura';
  if (/^derram/u.test(word)) return 'derrame';
  if (/^(?:venc|caduc)/u.test(word)) return 'vencimiento';
  if (/^contamin/u.test(word)) return 'contaminacion';
  if (/^defect/u.test(word)) return 'defecto';
  if (/^(?:caid|cay)/u.test(word)) return 'caida';
  if (/^despeg/u.test(word)) return 'despegue';
  return word;
}

function isGenericWasteReason(value) {
  const words = normalizedWords(value).filter(word => !WASTE_REASON_STOP_WORDS.has(word));
  return !words.length || words.every(word => [
    'merma', 'mermas', 'perdida', 'perdidas', 'desperdicio', 'desperdicios',
    'producto', 'material', 'proceso', 'sin', 'motivo', 'especificar', 'desconocido',
  ].includes(word));
}

function assertWasteReasonEvidence(userText, proposedReason) {
  const reason = String(proposedReason || '').trim();
  const ask = '¿Cuál fue la causa concreta de la merma? No se registró otra merma ni se modificó inventario.';
  if (!reason || isGenericWasteReason(reason)) {
    throw Object.assign(new Error(ask), { status: 409 });
  }
  const words = normalizedWords(userText);
  const text = words.join(' ');
  const reasonWords = normalizedWords(reason)
    .filter(word => !WASTE_REASON_STOP_WORDS.has(word))
    .map(causeWord);
  const spokenWords = new Set(words.map(causeWord));
  const causeWordEvidence = reasonWords.some(word => KNOWN_CAUSE_WORDS.has(word)
    && spokenWords.has(word));
  const cuePositions = words.flatMap((word, index) =>
    ['por', 'porque', 'motivo', 'causa', 'razon', 'debido'].includes(word) ? [index] : []);
  const cuePhraseEvidence = cuePositions.some(index => {
    const afterCue = new Set(words.slice(index + 1).map(causeWord));
    return reasonWords.every(word => afterCue.has(word));
  });
  if (!text || !reasonWords.every(word => spokenWords.has(word))
    || (!causeWordEvidence && !cuePhraseEvidence)) {
    throw Object.assign(new Error(ask), { status: 409 });
  }
  return reason;
}

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

module.exports = {
  assertOperationalIntent, assertWasteReasonEvidence, isGenericWasteReason,
  publicOperationalError,
};
