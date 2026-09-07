const test = require('node:test');
const assert = require('node:assert/strict');
const { receptionPartidas } = require('../api/_lib/reception-partidas');
const { buildConfirmationItems } = require('../api/_lib/builderbot-reception');
const fs = require('node:fs');
const path = require('node:path');

function preview() {
  return { orden_compra_id: 21, confirmacion_final: false,
    partidas: [3, 1, 1].map((cantidad, i) => ({ sku: '00276-PTZNASHWA',
      total_recibido: 5, cantidad, condicion: ['DISPONIBLE', 'CUARENTENA', 'RECHAZADO'][i],
      lote: 'CRIT-IO-ZENOVA-260907', fecha_vencimiento: '2027-11-30',
      ubicacion: i ? 'CUAR-C-1-01' : 'B13', motivo: i ? ['','sello dudoso','envase roto'][i] : undefined })) };
}

test('flat receipt groups the real 3/1/1 fixture without altering values or input', () => {
  const input = preview(), before = structuredClone(input);
  const result = receptionPartidas(input);
  assert.deepEqual(input, before);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].cantidad_recibida, 5);
  assert.deepEqual(result.items[0].distribuciones.map(r => r.cantidad), [3, 1, 1]);
  assert.deepEqual(result.items[0].distribuciones.map(r => r.condicion), ['DISPONIBLE', 'CUARENTENA', 'RECHAZADO']);
  assert.equal(result.items[0].distribuciones[2].motivo, 'envase roto');
  assert.equal(result.confirmacion_final, false);
  assert.equal(Object.hasOwn(result, 'partidas'), false);
  assert.deepEqual(receptionPartidas(input), result);
});

test('flat receipt groups interleaved products, fractional quantities and multiple lots', () => {
  const input = preview();
  const other = { ...input.partidas[0], sku: 'MP-1', total_recibido: 1.1, cantidad: 0.6, motivo_diferencia: 'faltante' };
  input.partidas.splice(1, 0, other);
  input.partidas.push({ ...other, cantidad: 0.5, lote: 'OTHER' });
  const result = receptionPartidas(input);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].cantidad_recibida, 1.1);
  assert.equal(result.items[1].motivo_diferencia, 'faltante');
});

test('legacy input and final confirmation remain unchanged; flat confirmation cannot override a draft', () => {
  for (const input of [{ items: [] }, { orden_compra_id: 21, confirmacion_final: true }]) {
    assert.equal(receptionPartidas(input), input);
  }
  for (const flag of [true, 'true', 'false', undefined]) {
    assert.throws(() => receptionPartidas({ ...preview(), confirmacion_final: flag }), /solo se envian/);
  }
  for (const key of ['items', 'productos', 'lineas']) {
    assert.throws(() => receptionPartidas({ ...preview(), [key]: [] }), /no ambos/);
  }
});

test('flat receipt fails closed on omissions, totals, unknown fields and invalid numbers', () => {
  for (const edit of [
    p => { p.partidas = []; }, p => { p.partidas = [null]; },
    p => { p.partidas[0].cantidad = 5; }, p => { p.partidas[1].total_recibido = 1; },
    p => { p.partidas[0].cantidad = '3'; }, p => { p.partidas[0].cantidad = NaN; },
    p => { p.partidas[0].cantidad = Infinity; }, p => { p.partidas[0].cantidad = -1; },
    p => { p.partidas[0].lote = ''; }, p => { delete p.partidas[0].ubicacion; },
    p => { p.partidas[0].fecha_vencimiento = null; }, p => { p.partidas[1].motivo = ''; },
    p => { p.partidas[1].condicion = 'BUENO'; }, p => { p.partidas[0].unidad = 'kg'; },
    p => { p.partidas[1].motivo_diferencia = 'different'; },
    p => { p.partidas = Array(2001).fill(p.partidas[0]); },
  ]) {
    const input = preview(); edit(input);
    assert.throws(() => receptionPartidas(input), error => error.status === 400);
  }
});

test('adapter never bypasses domain validation (missing SKU or location still fails)', async () => {
  const db = { async execute() { return [[]]; } };
  await assert.rejects(buildConfirmationItems(db, [{ producto_id: 104 }], receptionPartidas(preview())));
});

test('published receipt prompt examples parse; preview uses flat rows and confirmation carries no rows', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  const section = prompt.split('### 5. CONFIRMAR_RECEPCION_OC')[1].split('### 5. LIBERAR_ORDEN_PRODUCCION')[0];
  const examples = [...section.matchAll(/^\{\r?\n[\s\S]*?^\}/gm)].map(m => JSON.parse(m[0]));
  assert.equal(examples.length, 2);
  assert.equal(receptionPartidas(examples[0]).items[0].cantidad_recibida, 5);
  assert.deepEqual(examples[1].params, { orden_compra_id: 5, confirmacion_final: true });
});
