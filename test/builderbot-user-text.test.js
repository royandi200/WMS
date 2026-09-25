const test = require('node:test');
const assert = require('node:assert/strict');
const { currentUserText } = require('../api/_lib/builderbot-user-text');
const { stockProductionIntent } = require('../api/_lib/stock-production-intent');
const { normalizeProductReference } = require('../api/_lib/product-references');

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

test('PDF events do not turn stale voice text into a production request', () => {
  const body = { body: marker, document_url: 'https://example.test/document/file-1.pdf',
    voice_text: 'Vamos a producir 4 tarros de Ashawanda 60 para stock de seguridad' };
  assert.equal(currentUserText(body, {}), '');
});

test('explicit stock-production speech accepts numbers and words but not missing data', () => {
  assert.equal(stockProductionIntent('Vamos a producir tres tarros de Ashagwanda 60 para stock de seguridad').cantidad_planificada, 3);
  assert.equal(stockProductionIntent('{name}="Juan Esteban"\n[Friday, September 25, 2026 12:36:27]: Vamos a producir 3 tarros de Ashagwanda 60 para stock de seguridad.').cantidad_planificada, 3);
  assert.equal(stockProductionIntent('Vamos a producir cuatro tarros de Ashawanda 60'), null);
  assert.equal(stockProductionIntent('Vamos a producir tarros de Ashawanda 60 para stock de seguridad'), null);
  assert.equal(normalizeProductReference('Ashawanda 60'), 'ashwagandha 60');
  assert.equal(normalizeProductReference('Ashagwanda 60'), 'ashwagandha 60');
});
