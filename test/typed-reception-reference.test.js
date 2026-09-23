const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  typedReceptionReferences,
  singleTypedReceptionReference,
  purchaseOrderParamsFromText,
  preparationIntentFromText,
} = require('../api/_lib/typed-reception-reference');
const { purchaseOrderTextReference, explicitConfirmation } = require('../api/_lib/builderbot-reception');
const { receptionPartidas } = require('../api/_lib/reception-partidas');

test('speech transcription spacing does not change an explicit OC, IO or MQ identity', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  assert.match(prompt, /`OCID 38`.*significan `OC ID 38`/u);
  for (const phrase of [
    'Prepara la recepción OCID 38',
    'Prepara la recepción OC ID38',
    'Prepara la recepción O C ID 38',
    'Prepara la recepción OC-ID-38',
    'Prepara la recepción OC, ID 38',
    'Prepara la recepción OC ID, 38',
    'Prepara la recepción orden de compra ID 38',
    'Prepara la recepción OC 38',
  ]) {
    assert.deepEqual(singleTypedReceptionReference(phrase), { kind: 'OC', id: 38 }, phrase);
  }
  assert.deepEqual(singleTypedReceptionReference('Recibe IOID34'), { kind: 'IO', id: 34 });
  assert.deepEqual(singleTypedReceptionReference('Recibe MQID 13'), { kind: 'MQ', id: 13 });
  assert.deepEqual(singleTypedReceptionReference('Recibe IN AND OUT ID 34'), { kind: 'IO', id: 34 });
});

test('bare numbers and documentary codes are not silently treated as short IDs', () => {
  for (const phrase of ['ID 38', 'la 38', 'OC-DEMO-38-001', 'OC-38', 'SKU OC38-TEST']) {
    assert.deepEqual(typedReceptionReferences(phrase), [], phrase);
  }
  assert.throws(() => singleTypedReceptionReference('OCID 38 o IOID 38'),
    error => error.status === 409);
  assert.equal(purchaseOrderParamsFromText({ orden_compra_id: 39,
    numero_oc: 'OTRA-OC' }, 'OCID 38').orden_compra_id, 38);
  assert.throws(() => purchaseOrderParamsFromText({}, 'MQID 38'),
    error => error.status === 409);
});

test('spoken OCID 38 works for preparation and final confirmation but not IO', () => {
  const order = { id: 38, numero: 'DEMO-OC-38', tipo_recepcion: 'INSUMOS_MP' };
  assert.equal(purchaseOrderParamsFromText({}, 'Prepara la recepción OCID 38').orden_compra_id, 38);
  assert.equal(purchaseOrderTextReference('Prepara la recepción OCID 38', order), true);
  assert.equal(purchaseOrderTextReference('Prepara la recepción OC, ID 38', order), true);
  assert.equal(explicitConfirmation('Confirmo la recepción OCID 38', order,
    { confirmacion_final: true }), true);
  assert.equal(purchaseOrderTextReference('Prepara la recepción IOID 38', order), false);
});

test('clear preparation intent is recoverable even when the model chooses chat', () => {
  const webhook = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(webhook, /const receptionIntent = preparationIntentFromText\(rawText\)/u);
  assert.deepEqual(preparationIntentFromText('Prepara la recepción OCID 38'),
    { kind: 'OC', id: 38 });
  assert.deepEqual(preparationIntentFromText('Por favor, prepara la recepción IOID 34'),
    { kind: 'IO', id: 34 });
  for (const phrase of [
    'Cómo preparo la recepción OCID 38',
    'No prepares la recepción OCID 38',
    'Prepara la recepción ID 38',
    'Prepara la recepción MQID 38',
    'Prepara la recepción OCID 38 o IOID 34',
  ]) assert.equal(preparationIntentFromText(phrase), null, phrase);
});

test('full text reception recovers the OC ID even when transcription joins the tokens', () => {
  const params = receptionPartidas({}, { rawText: [
    'OCID 38',
    '00001-TPBI: cantidad 2 und, condición DISPONIBLE, lote T-1, vencimiento 2027-12-31, ubicación A8',
  ].join('\n') });
  assert.equal(params.orden_compra_id, 38);
  assert.equal(params.items[0].sku, '00001-TPBI');
});
