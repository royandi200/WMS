const test = require('node:test');
const assert = require('node:assert/strict');
const { currentUserText } = require('../api/_lib/builderbot-user-text');
const { stockProductionIntent, productionRequestIntent, contextualProductionReply } =
  require('../api/_lib/stock-production-intent');
const { normalizeProductReference } = require('../api/_lib/product-references');
const { pickOptionNumber } = require('../api/_lib/production-pick-guide');

const marker = '_event_document__15dbae31-ac11-49d8-9aef-93c5e805b7e7';

test('stale PDF marker yields to the current audio transcript when classification is empty', () => {
  const body = { body: marker, text: marker, query: marker,
    document_url: 'https://example.test/audio/file-1.oga',
    voice_text: 'Vamos a producir 4 tarros de Ashawanda 60 para stock de seguridad' };
  assert.equal(currentUserText(body, {}), body.voice_text);
  assert.deepEqual(stockProductionIntent(currentUserText(body, {})), {
    id_producto_final: 'Ashawanda 60', cantidad_planificada: 4,
    origen_tipo: 'STOCK_SEGURIDAD',
  });
});

test('a written reply never reuses the previous audio transcript', () => {
  const body = { body: marker, text: marker, query: marker,
    document_url: 'https://example.test/audio/file-1.oga',
    voice_text: 'Llegaron 30 unidades' };
  assert.equal(currentUserText(body, { text: 'Sí' }), 'Sí');
  assert.equal(stockProductionIntent('Sí'), null);
});

test('a tagged BBC echo uses the matching current transport message for a pending pick option', () => {
  const body = { body: ' Opción 8', text: ' Opción 8', voice_text: 'cambio de lote, partida 7' };
  const info = { body: '{name}="Prueba"\n[Wednesday, October 14, 2026 17:22:49]:  Opción 8' };
  assert.equal(currentUserText(body, info), ' Opción 8');
  assert.equal(pickOptionNumber(currentUserText(body, info)), 8);
  assert.equal(currentUserText(body, info, { allowParams: false }), ' Opción 8');
  assert.equal(currentUserText(body, { body: 'Opción 8\n{name}="Prueba"\n[Wednesday, October 14, 2026 17:22:49]: Opción 8' }), ' Opción 8');
});

test('a tagged message with no matching transport copy is not promoted to a new command', () => {
  const body = { body: 'No', text: 'No' };
  const info = { body: '{name}="Prueba"\n[Wednesday, October 14, 2026 17:22:49]: Confirmo materiales OP ID 119' };
  assert.equal(currentUserText(body, info), info.body);
  assert.equal(pickOptionNumber(currentUserText(body, info)), null);
});

test('PDF events do not turn stale voice text into a production request', () => {
  const body = { body: marker, document_url: 'https://example.test/document/file-1.pdf',
    voice_text: 'Vamos a producir 4 tarros de Ashawanda 60 para stock de seguridad' };
  assert.equal(currentUserText(body, {}), marker);
  assert.equal(stockProductionIntent(currentUserText(body, {})), null);
});

test('explicit stock-production speech accepts numbers and words but not missing data', () => {
  assert.equal(stockProductionIntent('Vamos a producir tres tarros de Ashagwanda 60 para stock de seguridad').cantidad_planificada, 3);
  assert.equal(stockProductionIntent('{name}="Juan Esteban"\n[Friday, September 25, 2026 12:36:27]: Vamos a producir 3 tarros de Ashagwanda 60 para stock de seguridad.').cantidad_planificada, 3);
  assert.equal(stockProductionIntent('Vamos a producir cuatro tarros de Ashawanda 60'), null);
  assert.equal(stockProductionIntent('Vamos a producir tarros de Ashawanda 60 para stock de seguridad'), null);
  assert.equal(normalizeProductReference('Ashawanda 60'), 'ashwagandha 60');
  assert.equal(normalizeProductReference('Ashagwanda 60'), 'ashwagandha 60');
});

test('a short destination retains only the immediately pending product and quantity', () => {
  const prior = 'vamos a producir 1 tarro de ashwagandha 120';
  const question = 'Entendí 1 und de ashwagandha 120. ¿Es para stock de seguridad o para un pedido de cliente? No se creó la OP.';
  assert.deepEqual(productionRequestIntent(prior), {
    id_producto_final: 'ashwagandha 120', cantidad_planificada: 1,
  });
  assert.deepEqual(contextualProductionReply('stock de seguridad', prior, question), {
    origin: 'STOCK_SEGURIDAD', request: productionRequestIntent(prior),
  });
  assert.deepEqual(contextualProductionReply('pedido de cliente', prior, question), {
    origin: 'OC_CLIENTE', request: productionRequestIntent(prior),
  });
  assert.deepEqual(contextualProductionReply('stock de seguridad',
    'vamos a producir 1 tarro de ashwagandha 60', question).request,
  { id_producto_final: 'ashwagandha 60', cantidad_planificada: 1 });
  assert.equal(contextualProductionReply('stock de seguridad', prior, 'Stock insuficiente'), null);
  assert.equal(contextualProductionReply('stock de seguridad', 'hola', question), null);
  assert.equal(contextualProductionReply('stock de seguridad',
    'vamos a producir 1 tarro de ashwagandha 120 para stock de seguridad', question), null);
});
