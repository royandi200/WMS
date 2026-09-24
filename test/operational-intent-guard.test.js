const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertOperationalIntent, assertWasteReasonEvidence, isGenericWasteReason,
  publicOperationalError,
} = require('../api/_lib/operational-intent-guard');

test('waste reason must be a concrete cause supported by the user message', () => {
  const originalAudio = 'en la orden OPID 97 reporta merma de una etiqueta';
  assert.throws(() => assertWasteReasonEvidence(originalAudio, 'merma'), /causa concreta/u);
  assert.throws(() => assertWasteReasonEvidence(originalAudio, 'daño de empaque'), /causa concreta/u);
  assert.throws(() => assertWasteReasonEvidence('reporta una etiqueta por rotura', 'derrame'), /causa concreta/u);
  assert.throws(() => assertWasteReasonEvidence('reporta merma de una etiqueta por 1 unidad', 'etiqueta'), /causa concreta/u);
  assert.throws(() => assertWasteReasonEvidence('se rompió una etiqueta', 'etiqueta'), /causa concreta/u);
  assert.equal(assertWasteReasonEvidence(
    'Reporta merma de una etiqueta de OP ID 97 por daño de empaque', 'daño de empaque'),
  'daño de empaque');
  assert.equal(assertWasteReasonEvidence(
    'La etiqueta se rompió durante la producción', 'rotura'), 'rotura');
  assert.equal(assertWasteReasonEvidence('ruptura', 'ruptura'), 'ruptura');
  assert.equal(assertWasteReasonEvidence(
    'Reporta merma de una tapa por mala manipulación', 'mala manipulación'), 'mala manipulación');
  assert.equal(isGenericWasteReason('pérdida de material en proceso'), true);
});

test('RI-009: destruction cannot be silently converted to a return, waste or adjustment', () => {
  for (const action of ['GESTION_DEVOLUCION', 'AJUSTAR_MATERIALES_PRODUCCION', 'REPORTE_MERMA']) {
    assert.throws(() => assertOperationalIntent(action, { text: 'Registra devolucion para destruccion del despacho ID 56' }, {}), /deshabilitada/);
    assert.throws(() => assertOperationalIntent(action, {}, { body: 'Destruye el producto del lote QA' }), /deshabilitada/);
  }
});

test('RI-006: a production return cannot mutate customer return stock', () => {
  for (const text of ['Devuelvo 5 gramos de gomas de la orden ID 79', 'Devolucion de sobrantes OP-20260906-000079']) {
    assert.throws(() => assertOperationalIntent('GESTION_DEVOLUCION', { text }, {}), /materiales de produccion/);
    assert.doesNotThrow(() => assertOperationalIntent('AJUSTAR_MATERIALES_PRODUCCION', { text }, {}));
  }
});

test('neighboring ordinary actions and independent current text remain unchanged', () => {
  assert.doesNotThrow(() => assertOperationalIntent('GESTION_DEVOLUCION', { text: 'Devuelvo una unidad del despacho ID 58 a cuarentena' }, {}));
  assert.doesNotThrow(() => assertOperationalIntent('REPORTE_MERMA', { text: 'Se perdieron 10 g en la orden 79 por derrame' }, {}));
  assert.doesNotThrow(() => assertOperationalIntent('CONSULTAR_TRAZABILIDAD_LOTE', { text: 'Consulta destruccion historica' }, {}));
  assert.throws(() => assertOperationalIntent('GESTION_DEVOLUCION', { text: 'Destruir el lote' }, { body: 'Devolucion a cuarentena' }), /deshabilitada/);
});

test('SQL and unexpected errors are not exposed, while business validation stays useful', () => {
  assert.doesNotMatch(publicOperationalError({ code: 'ER_LOCK_DEADLOCK', message: 'Deadlock SQL details' }), /Deadlock|SQL/);
  assert.doesNotMatch(publicOperationalError({ status: 400, sqlMessage: 'secret', message: 'secret' }), /secret/);
  assert.doesNotMatch(publicOperationalError(new Error('parseInfo is not defined')), /parseInfo/);
  assert.equal(publicOperationalError({ status: 409, message: 'Falta el lote' }), 'Falta el lote');
});
