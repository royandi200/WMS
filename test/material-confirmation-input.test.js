const test = require('node:test');
const assert = require('node:assert/strict');
const { materialConfirmationInput } = require('../api/_lib/material-confirmation-input');

const base = { id: 395, producto_id: 51, cantidad: '1.0000', lote: 'LOTE-QA', referencia_id: 77,
  referencia_tipo: 'consumo_produccion', siigo_code: '00051-MPASH', codigo_orden: 'OP-77',
  ubicacion_id: 62, ubicacion: 'B16' };
const db = { execute: async (sql, args) => {
  assert.match(sql, /m.usuario_id = \?/);
  assert.deepEqual(args, [395, 20]);
  return [[base]];
} };

test('repeated delivery is not additional consent even if model invents a base and flag', async () => {
  const result = await materialConfirmationInput({}, { cantidad: 1, confirmar_nuevo_ajuste: true,
    id_ajuste_existente: 'AJUSTE-77-0001' }, 'Entrega 1 gramo adicional de gomas para la orden 77', 20);
  assert.equal(result.confirmar_nuevo_ajuste, false);
  assert.equal(result.id_ajuste_existente, undefined);
});

test('explicit short confirmation recovers stable operative fields from persisted own movement', async () => {
  const one = await materialConfirmationInput(db, {}, 'Confirma un ajuste nuevo como el movimiento ID 395.', 20);
  const retry = await materialConfirmationInput(db, { id_ajuste_existente: 'AJUSTE-INVENTADO' },
    'Confirmo otro ajuste como el movimiento ID 395.', 20);
  assert.equal(one.id_orden, 'OP-77');
  assert.equal(one.cantidad, 1);
  assert.equal(one.id_item, '00051-MPASH');
  assert.deepEqual(one, retry);
});

test('negative confirmation never enables an additional operation', async () => {
  await assert.rejects(materialConfirmationInput({}, { confirmar_nuevo_ajuste: true }, 'No confirmo otro ajuste', 20), /negada o cancelada/);
});

test('confirmation with unknown, foreign or invented movement fails closed', async () => {
  await assert.rejects(materialConfirmationInput({}, { id_ajuste_existente: 'AJUSTE-77-0001' }, 'Confirmo otro ajuste', 20), /Selecciona/);
  await assert.rejects(materialConfirmationInput({ execute: async () => [[]] }, {}, 'Confirmo otro ajuste movimiento 395', 20), /No existe/);
});

test('explicit confirmation cannot silently change quantity, order, lot or location', async () => {
  for (const params of [{ cantidad: 2 }, { id_orden: 78 }, { id_lote: 'OTRO' }, { ubicacion: 'A1' }, { tipo: 'DEVOLUCION' }]) {
    await assert.rejects(materialConfirmationInput(db, params, 'Confirma otro ajuste movimiento 395', 20), /no coinciden/);
  }
});
