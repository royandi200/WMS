const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeCloseMaterials, normalizeCloseMaterials } = require('../api/_lib/production-close-materials');

test('el cierre exige declaración explícita y causa concreta por material', () => {
  assert.throws(() => normalizeCloseMaterials(undefined), /confirma expresamente/u);
  assert.deepEqual(normalizeCloseMaterials([]), []);
  assert.throws(() => normalizeCloseMaterials([{
    sku: '00001-TPBI', cantidad: 1, lote: 'L-1', motivo: 'merma',
  }]), /causa concreta/u);
  assert.throws(() => normalizeCloseMaterials([{
    sku: '00001-TPBI', cantidad: 0, lote: 'L-1', motivo: 'ruptura',
  }]), /cantidad positiva/u);
  assert.deepEqual(normalizeCloseMaterials([{
    sku: '00001-TPBI', cantidad: 1, lote: 'L-1', motivo: 'ruptura',
  }]), [{ sku: '00001-TPBI', quantity: 1, lot: 'L-1', reason: 'ruptura', location: '' }]);
});

test('nunca descuenta un lote ambiguo o sin saldo disponible', async () => {
  const queries = [];
  const conn = { async execute(sql) {
    queries.push(sql);
    if (sql.startsWith('SELECT qty_current FROM lots')) return [[{ qty_current: 3 }]];
    if (sql.includes('FROM lots')) return [[{ id: 'lot-1', status: 'DISPONIBLE', qty_current: 4, bodega_id: 1 }]];
    if (sql.includes('FROM stock')) return [[
      { id: 1, cantidad: 2, reservada: 0, ubicacion: 'A1', ubicacion_id: 1 },
      { id: 2, cantidad: 2, reservada: 0, ubicacion: 'A2', ubicacion_id: 2 },
    ]];
    throw new Error(`Movimiento inesperado: ${sql}`);
  } };
  const input = { order: { id: 97, codigo_orden: 'OP-97' }, userId: 7,
    materials: [{ id: 11, producto_id: 6, sku: '00001-TPBI', nombre: 'TAPA', unidad: 'und' }],
    lines: normalizeCloseMaterials([{ sku: '00001-TPBI', cantidad: 1, lote: 'L-1', motivo: 'ruptura' }]) };
  await assert.rejects(consumeCloseMaterials(conn, input), /varias ubicaciones/u);
  assert.equal(queries.some((sql) => sql.startsWith('UPDATE')), false);
});

test('descuenta y registra la merma del material solo al consumir el cierre', async () => {
  const queries = [];
  const conn = { async execute(sql) {
    queries.push(sql);
    if (sql.startsWith('SELECT qty_current FROM lots')) return [[{ qty_current: 3 }]];
    if (sql.includes('FROM lots')) return [[{ id: 'lot-1', status: 'DISPONIBLE', qty_current: 4, bodega_id: 1 }]];
    if (sql.includes('FROM stock')) return [[{
      id: 1, cantidad: 4, reservada: 0, ubicacion: 'A1', ubicacion_id: 1, bodega_id: 1,
    }]];
    if (sql.startsWith('UPDATE stock') || sql.startsWith('UPDATE lots SET qty_current')) return [{ affectedRows: 1 }];
    return [{ affectedRows: 1 }];
  } };
  const consumed = await consumeCloseMaterials(conn, {
    order: { id: 97, codigo_orden: 'OP-97' }, userId: 7,
    materials: [{ id: 11, producto_id: 6, sku: '00001-TPBI', nombre: 'TAPA', unidad: 'und' }],
    lines: normalizeCloseMaterials([{ sku: '00001-TPBI', cantidad: 1, lote: 'L-1', motivo: 'ruptura' }]),
  });
  assert.equal(consumed[0].lote, 'L-1');
  assert.equal(consumed[0].motivo, 'ruptura');
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO produccion_material_lotes')), true);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO movimientos')), true);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO kardex')), true);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO mermas')), true);
});
