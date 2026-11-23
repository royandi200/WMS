function draftInputError(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function assertDraftEvidence(rawText, evidence) {
  const text = String(rawText || '').trim().normalize('NFC');
  const fragment = typeof evidence === 'string' ? evidence.trim().normalize('NFC') : '';
  if (!fragment || fragment.length > 4000 || !text.includes(fragment)) {
    throw draftInputError('Dime qué dato quieres registrar o cambiar en este borrador y cuál es el valor correcto.');
  }
}

function checkDraftFields(value, allowed, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.keys(value).length || Object.keys(value).some(key => !allowed.includes(key))) {
    throw draftInputError(message);
  }
}

function clarifyDraft(action, ask) {
  const common = {
    campo: '¿Qué dato del borrador quieres cambiar?',
    valor: '¿Cuál es el dato correcto? Dímelo tal como lo ves en la etiqueta o en el resumen.',
  };
  const byWorkflow = action === 'AVANZAR_RECEPCION_GUIADA_OC' ? {
    borrador: '¿Qué recepción quieres revisar? Indica su OC ID o IO ID.',
    producto: '¿De qué producto de la recepción hablas? Puedes darme el nombre o el SKU del resumen.',
    partida: '¿Cuál de las partidas de ese producto quieres cambiar? Indica el número que aparece en el resumen.',
  } : {
    borrador: '¿Qué cierre quieres revisar? Indica su OP ID.',
    partida: '¿Qué partida de insumo repuesto quieres cambiar? Indica el nombre del insumo o el número de partida.',
    tipo_merma: '¿La merma corresponde al producto terminado no conforme o a un insumo?',
    ubicacion: '¿La nueva ubicación es para el producto terminado conforme o para una partida de insumo?',
  };
  const questions = { ...common, ...byWorkflow };
  if (typeof ask !== 'string' || !Object.hasOwn(questions, ask)) {
    throw draftInputError('Indica qué dato del borrador quieres revisar.');
  }
  return questions[ask];
}

module.exports = { assertDraftEvidence, checkDraftFields, clarifyDraft, draftInputError };
