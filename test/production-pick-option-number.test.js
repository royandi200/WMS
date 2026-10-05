const test = require('node:test');
const assert = require('node:assert/strict');
const { pickOptionNumber } = require('../api/_lib/production-pick-guide');

test('el alistador puede elegir el lote con solo el número, como en el cierre', () => {
  assert.equal(pickOptionNumber('7'), 7);
  assert.equal(pickOptionNumber('7.'), 7);
  assert.equal(pickOptionNumber('opción 7'), 7);
  assert.equal(pickOptionNumber('la opción 2'), 2);
  assert.equal(pickOptionNumber('lote 3'), 3);
  assert.equal(pickOptionNumber('número 4'), 4);
  assert.equal(pickOptionNumber('opción siete'), 7);
  assert.equal(pickOptionNumber('la tercera'), 3);
});

test('un número dentro de una frase no se toma como opción', () => {
  assert.equal(pickOptionNumber('partida 1 va para la A10'), null);
  assert.equal(pickOptionNumber('reparte partida 1: 4 en A10 y 3 en A11'), null);
  assert.equal(pickOptionNumber('Confirmo materiales OP ID 114'), null);
  assert.equal(pickOptionNumber('123'), null);
});
