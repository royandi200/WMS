const test = require('node:test');
const assert = require('node:assert/strict');
const { contextualProductMatches } = require('../api/_lib/product-references');

// Merma de bodega: «1 liner del lote X» se resuelve dentro del producto del lote.
test('«liner» identifica un único producto cuando el contexto es el producto del lote', () => {
  const scoped = [{ id: 35, siigo_code: '00035-LNTP60', nombre: 'LINER TARRO x 60', alias: null }];
  const matches = contextualProductMatches('liner', scoped);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].siigo_code, '00035-LNTP60');
});

test('un nombre que no corresponde al producto del lote sigue sin resolverse', () => {
  const scoped = [{ id: 35, siigo_code: '00035-LNTP60', nombre: 'LINER TARRO x 60', alias: null }];
  assert.equal(contextualProductMatches('etiqueta', scoped).length, 0);
});
