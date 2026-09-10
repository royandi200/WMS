const test = require('node:test');
const assert = require('node:assert/strict');
const { currentText } = require('../api/_lib/additional-operation-input');
const { dispatchConfirmationInput } = require('../api/_lib/dispatch-confirmation-input');
const { recoverReceptionPreview } = require('../api/_lib/reception-json-envelope');

test('N1-04: transport timestamp is removed only from legacy info, not human outer text', () => {
  const text = 'Confirma una nueva produccion adicional para la orden ID 81.';
  const stamped = '[Sunday, September 6, 2026 23:34:14]: ' + text;
  const marker = '_event_document__cc05fd12-630d-4b49-b065-f9da56993581';
  assert.equal(currentText({ body: marker, text: marker }, { body: stamped }), text);
  assert.equal(currentText({ text: 'No confirmo.' }, { body: stamped }), 'No confirmo.');
  assert.equal(currentText({ body: stamped }, { body: text }), stamped);
  assert.equal(currentText({ body: '' }, { body: stamped }), '');
});

test('N1-05: model omission cannot turn a partial request into a full dispatch', () => {
  for (const text of [
    'Confirma parcialmente el despacho ID 60 enviando solo 1 unidad de las 2 solicitadas.',
    'Confirma despacho ID 60, solo una unidad.',
    'No confirmes el despacho ID 60.',
    'Confirma despacho ID 60 excepto las etiquetas.',
    'Confirma despacho ID 60, deja el resto pendiente.',
    'Confirma el despacho ID 60 enviando 1 de las 2 solicitadas.',
    'Confirma el despacho ID 60 enviando la mitad.',
  ]) assert.throws(() => dispatchConfirmationInput(text, { id_despacho: 60 }), e => e.status === 409);
  assert.deepEqual(dispatchConfirmationInput('Confirma el despacho ID 60.', {}), {});
  assert.deepEqual(dispatchConfirmationInput('Confirma el despacho ID 3Q-17.', {}), {});
  assert.deepEqual(dispatchConfirmationInput('Confirma el despacho DSP-SIIGO-FV-DEMO-IO-001.', {}), {});
  assert.deepEqual(dispatchConfirmationInput('Confirma despacho ID 60 con 2 unidades.', {}), { expectedQuantity: 2 });
  assert.throws(() => dispatchConfirmationInput('', {}), e => e.status === 409);
  assert.throws(() => dispatchConfirmationInput('Confirma despacho ID 60.', { parcial: true }), e => e.status === 409);
});

const text = 'Para la recepcion OC ID 18 llegaron 5 unidades: 3 disponibles, 1 cuarentena y 1 rechazada.';
function envelope() {
  return { kw: 'g0m@s', '@ction': 'CONFIRMAR_RECEPCION_OC', body: text,
    params: { orden_compra_id: 18, confirmacion_final: false, items: [{
      sku: 'SKU-QA', cantidad_recibida: 5, distribuciones: [
        { cantidad: 3, condicion: 'DISPONIBLE', lote: 'LOT-QA', ubicacion: 'B13', fecha_vencimiento: '2027-11-30' },
        { cantidad: 1, condicion: 'CUARENTENA', lote: 'LOT-QA', ubicacion: 'CUAR', fecha_vencimiento: '2027-11-30', motivo: 'sello dudoso' },
        { cantidad: 1, condicion: 'RECHAZADO', lote: 'LOT-QA', ubicacion: 'CUAR', fecha_vencimiento: '2027-11-30', motivo: 'envase roto' },
      ],
    }] } };
}
test('N1-09: recover only the two observed closing-envelope errors for a receipt preview', () => {
  const valid = JSON.stringify(envelope());
  for (const suffix of ['}]}}}', '}]}}]}}']) {
    const malformed = valid.replace(/\}\]\}\]\}\}$/, suffix);
    assert.throws(() => JSON.parse(malformed));
    assert.deepEqual(recoverReceptionPreview(malformed, { body: text }), envelope());
  }
});
test('recovery fails closed for truncation, changed values, missing evidence or final confirmation', () => {
  const e = envelope();
  const damaged = x => JSON.stringify(x).replace(/\}\]\}\]\}\}$/, '}]}}}');
  assert.equal(recoverReceptionPreview(damaged(e), {}), null);
  assert.equal(recoverReceptionPreview(damaged(e), { body: 'Confirmo la recepcion OC ID 18' }), null);
  e.params.confirmacion_final = true;
  assert.equal(recoverReceptionPreview(damaged(e), { body: text }), null);
  e.params.confirmacion_final = false; e.params.items[0].cantidad_recibida = 9;
  assert.equal(recoverReceptionPreview(damaged(e), { body: text }), null);
  assert.equal(recoverReceptionPreview(JSON.stringify(envelope()).slice(0, -35), { body: text }), null);
  assert.equal(recoverReceptionPreview(damaged(envelope()).replace('"cantidad":3', '"cantidad":'), { body: text }), null);
  const invalid = envelope();
  invalid.params.items[0].distribuciones[0] = null;
  assert.equal(recoverReceptionPreview(damaged(invalid), { body: text }), null);
});
