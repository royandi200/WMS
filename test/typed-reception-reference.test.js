const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  typedReceptionReferences,
  singleTypedReceptionReference,
  purchaseOrderParamsFromText,
  preparationIntentFromText,
  preparationClarificationCandidate,
  confirmedPreparationReference,
  clarifiedPreparationReference,
} = require('../api/_lib/typed-reception-reference');
const { purchaseOrderTextReference, explicitConfirmation,
  prepareReceptionFromPurchaseOrder, prepareReceptionFromOutsourcing } = require('../api/_lib/builderbot-reception');
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
  assert.match(webhook, /selected\.kind === 'MQ' \? 'PREPARAR_RECEPCION_MAQUILA'/u);
  assert.ok(webhook.indexOf('const receptionIntent = preparationIntentFromText(rawText)')
    < webhook.indexOf("case 'PREPARAR_RECEPCION_OC':"));
  assert.deepEqual(preparationIntentFromText('Prepara la recepción OCID 38'),
    { kind: 'OC', id: 38 });
  assert.deepEqual(preparationIntentFromText('Por favor, prepara la recepción IOID 34'),
    { kind: 'IO', id: 34 });
  assert.deepEqual(preparationIntentFromText('Prepara la orden IOIB34'),
    { kind: 'IO', id: 34 });
  assert.deepEqual(preparationIntentFromText('Prepara la recepción MQIB 13'),
    { kind: 'MQ', id: 13 });
  assert.deepEqual(preparationIntentFromText('Prepara la orden MQID13'),
    { kind: 'MQ', id: 13 });
  assert.deepEqual(preparationIntentFromText('Prepara MQIB13'),
    { kind: 'MQ', id: 13 });
  assert.deepEqual(preparationIntentFromText('Prepara la recepción OC y B38'),
    { kind: 'OC', id: 38 });
  assert.deepEqual(preparationIntentFromText('Prepara la recepción OCIB38'),
    { kind: 'OC', id: 38 });
  assert.deepEqual(preparationIntentFromText('Prepara la recepción OCIP 38'),
    { kind: 'OC', id: 38 });
  assert.deepEqual(preparationIntentFromText('Prepara la recepción O, C y D, 38'),
    { kind: 'OC', id: 38 });
  for (const phrase of [
    'Cómo preparo la recepción OCID 38',
    'No prepares la recepción OCID 38',
    'Prepara la recepción ID 38',
    'Prepara pedido de cliente OCID 38',
    'Prepara la recepción OCID 38 o IOID 34',
    'Prepara la recepción MQIB38 o OCID 38',
  ]) assert.equal(preparationIntentFromText(phrase), null, phrase);
});

test('a short yes resumes only a single immediately proposed preparation reference', () => {
  assert.deepEqual(confirmedPreparationReference('sí',
    'Prepara la recepción OC y B38',
    '¿Te refieres a la recepción OC ID 38? Si es así, confírmame.'),
  { kind: 'OC', id: 38 });
  assert.equal(confirmedPreparationReference('sí',
    'Prepara la recepción OC y B38',
    '¿Me confirmas la recepción OC ID 38 o la recepción IO ID 34?'), null);
  assert.equal(confirmedPreparationReference('sí',
    'Quiero saber el stock OC ID 38',
    '¿Te refieres a OC ID 38?'), null);
  assert.equal(confirmedPreparationReference('sí, pero IO ID 34',
    'Prepara la recepción OC y B38',
    '¿Te refieres a OC ID 38?'), null);
  assert.equal(purchaseOrderTextReference('Prepara la recepción OC y B38',
    { id: 38, tipo_recepcion: 'INSUMOS_MP' }), false);
  assert.deepEqual(clarifiedPreparationReference('O, C y D, 38',
    'Prepara la recepción OCIP 38',
    '¿Te refieres a OC ID 38, IO ID 38 o MQ ID 38?'), { kind: 'OC', id: 38 });
  assert.equal(clarifiedPreparationReference('O, C y D, 39',
    'Prepara la recepción OCIP 38',
    '¿Te refieres a OC ID 38, IO ID 38 o MQ ID 38?'), null);
  assert.equal(clarifiedPreparationReference('38',
    'Prepara la recepción OCIP 38',
    '¿Te refieres a OC ID 38, IO ID 38 o MQ ID 38?'), null);
  assert.equal(preparationClarificationCandidate('Confirmo la recepción OC ID 38'), null);
  assert.equal(clarifiedPreparationReference('O, C y D, 38',
    'Quiero saber el stock',
    '¿Te refieres a OC ID 38, IO ID 38 o MQ ID 38?'), null);
  assert.equal(purchaseOrderTextReference('Confirmo la recepción OCIP 38',
    { id: 38, tipo_recepcion: 'INSUMOS_MP' }), false);
  assert.deepEqual(confirmedPreparationReference('sí',
    'Prepara la orden MQIB13',
    '¿Te refieres a la recepción MQ ID 13?'), { kind: 'MQ', id: 13 });
});

test('preparation checks the selected order namespace without loosening final receipt evidence', async () => {
  const attempt = (tipo_recepcion, rawText, confirmedReference = null) =>
    prepareReceptionFromPurchaseOrder({
      db: { execute: async () => [[{ id: 38, numero: 'ORDER-38',
        estado: 'CANCELADA', tipo_recepcion }]] },
      params: { orden_compra_id: 38 }, userId: 1, rawText,
      requireExplicitTextReference: true, confirmedReference,
    });
  await assert.rejects(attempt('INSUMOS_MP', 'Prepara la recepción OC y B38'),
    /La orden de compra esta CANCELADA/u);
  await assert.rejects(attempt('IN_OUT', 'Prepara la recepción OC y B38'),
    /El ID 38 es ambiguo/u);
  await assert.rejects(attempt('INSUMOS_MP', 'sí', { kind: 'OC', id: 38 }),
    /La orden de compra esta CANCELADA/u);
  await assert.rejects(attempt('INSUMOS_MP', 'sí', { kind: 'IO', id: 38 }),
    /El ID 38 es ambiguo/u);
});

test('MQ audio preparation stays in its own namespace and does not relax final confirmation', async () => {
  const attempt = rawText => prepareReceptionFromOutsourcing({
    db: { execute: async () => [[{ id: 13, codigo: 'MQ-3Q-13',
      estado: 'CANCELADA', orden_compra_id: 38,
      cantidad_objetivo: 1, cantidad_recibida: 0 }]] },
    params: { orden_maquila_id: 13 }, userId: 1, rawText,
    requireExplicitTextReference: true,
  });
  await assert.rejects(attempt('Prepara la orden MQIB13'), /La orden MQ-3Q-13 esta CANCELADA/u);
  await assert.rejects(attempt('Prepara la orden OCIB13'), /El ID 13 es ambiguo/u);
  await assert.rejects(attempt('Confirmo la recepción MQIB13'), /El ID 13 es ambiguo/u);
});

test('full text reception recovers the OC ID even when transcription joins the tokens', () => {
  const params = receptionPartidas({}, { rawText: [
    'OCID 38',
    '00001-TPBI: cantidad 2 und, condición DISPONIBLE, lote T-1, vencimiento 2027-12-31, ubicación A8',
  ].join('\n') });
  assert.equal(params.orden_compra_id, 38);
  assert.equal(params.items[0].sku, '00001-TPBI');
});
