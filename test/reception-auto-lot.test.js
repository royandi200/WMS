const test = require('node:test');
const assert = require('node:assert/strict');
const { generatedReceptionLot, normalizeRule } = require('../api/_lib/reception-auto-lot');

test('la fecha retrocede cuatro días y conserva la sigla configurada', () => {
  const rule = { sigla: 'ca', dias_retroceso: 4 };
  assert.equal(generatedReceptionLot({ receptionId: 41, itemNumber: 1,
    receivedOn: '2026-09-27', ...rule }), 'R41-01-23092026-CA');
  assert.equal(generatedReceptionLot({ receptionId: 42, itemNumber: 1,
    receivedOn: '2026-09-27', ...rule }), 'R42-01-23092026-CA');
  assert.equal(generatedReceptionLot({ receptionId: 41, itemNumber: 2,
    receivedOn: '2026-09-27', ...rule }), 'R41-02-23092026-CA');
});

test('las partidas y los cruces de mes y año nunca colisionan', () => {
  const options = { receptionId: 5, itemNumber: 1, receivedOn: '2027-01-02',
    sigla: 'XYZ', dias_retroceso: 4, partitionCount: 2 };
  assert.equal(generatedReceptionLot({ ...options, partitionNumber: 1 }), 'R5-01P01-29122026-XYZ');
  assert.equal(generatedReceptionLot({ ...options, partitionNumber: 2 }), 'R5-01P02-29122026-XYZ');
});

test('la configuración rechaza siglas o desplazamientos ambiguos', () => {
  assert.deepEqual(normalizeRule({ sigla: 'ca', dias_retroceso: 4 }),
    { sigla: 'CA', dias_retroceso: 4, activa: true });
  assert.throws(() => normalizeRule({ sigla: 'C A', dias_retroceso: 4 }), /sigla/u);
  assert.throws(() => normalizeRule({ sigla: 'CA', dias_retroceso: -4 }), /días/u);
});
