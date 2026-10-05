const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMaterialSegments } = require('../api/_lib/production-close-guide');

test('la frase de la guía P2 separa producto, lote y causa de cada insumo', () => {
  const items = parseMaterialSegments('Repuse 2 tapas sacadas del lote AA-260930-09-TPBI por ruptura y 1 liner sacado del lote AA-260929-01-LINER por daño del sello. No hubo más materiales repuestos');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => [item.producto, item.cantidad, item.lote]), [
    ['tapas', 2, 'AA-260930-09-TPBI'],
    ['liner', 1, 'AA-260929-01-LINER'],
  ]);
  assert.equal(items[0].motivo, 'ruptura');
  assert.match(items[1].motivo, /^daño del sello/u);
});

test('otros participios comunes tampoco quedan en el nombre del producto', () => {
  for (const text of [
    'Repuse 3 etiquetas tomadas del lote L1 por defecto',
    'Repuse 3 etiquetas retiradas de lote L1 por defecto',
    'Repuse 3 etiquetas que saque del lote L1 por defecto',
  ]) {
    const [item] = parseMaterialSegments(text);
    assert.equal(item.producto, 'etiquetas', text);
    assert.equal(item.lote, 'L1', text);
  }
  const [plain] = parseMaterialSegments('Repuse 2 tapas del lote L2 por ruptura');
  assert.equal(plain.producto, 'tapas');
});
