const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeDispatchPackaging } = require('../api/_lib/dispatch-packaging');

function fixture({ stockAvailable = true } = {}) {
  const statements = [];
  return {
    statements,
    async execute(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes('FROM stock s') && sql.includes('FOR UPDATE')) {
        return [[{ id: 111, producto_id: 11, bodega_id: 1, ubicacion_id: 2,
          lote: 'LOTE-CAJA', siigo_code: '00040-CMV', nombre: 'CAJA MASTER VINAGRE x 24',
          clase: 'CAJA' }]];
      }
      if (sql.startsWith('UPDATE stock')) return [{ affectedRows: stockAvailable ? 1 : 0 }];
      if (sql.startsWith('UPDATE lots')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT id, qty_current FROM lots')) {
        return [[{ id: 'LOT-UUID', qty_current: 7 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
}

const packaging = { boxesDeclared: true, lidsDeclared: true,
  lines: [{ stockId: 111, quantity: 2, sku: '00040-CMV' }] };

test('el consumo registra stock, lote, movimiento y kardex para el SKU declarado', async () => {
  const conn = fixture();
  const consumed = await consumeDispatchPackaging(conn,
    { type: 'SIIGO', referenceId: 60, userId: 4, packaging });
  assert.deepEqual(consumed.map(line => [line.sku, line.cantidad]), [['00040-CMV', 2]]);
  assert.ok(conn.statements.some(call => call.sql.includes('INSERT INTO despacho_embalaje_consumos')));
  assert.ok(conn.statements.some(call => call.sql.includes('INSERT INTO movimientos')));
  assert.ok(conn.statements.some(call => call.sql.includes('INSERT INTO kardex')));
  assert.deepEqual(conn.statements.find(call => call.sql.startsWith('UPDATE stock')).params,
    [2, 111, 2]);
});

test('sin saldo libre se rechaza antes de registrar movimientos de embalaje', async () => {
  const conn = fixture({ stockAvailable: false });
  await assert.rejects(consumeDispatchPackaging(conn,
    { type: 'MAQUILA_3Q', referenceId: 17, userId: 4, packaging }), /Stock insuficiente/u);
  assert.equal(conn.statements.some(call => call.sql.includes('INSERT INTO movimientos')), false);
});

test('sin declaración separada de cajas y tapas no se confirma el consumo', async () => {
  const conn = fixture();
  await assert.rejects(consumeDispatchPackaging(conn,
    { type: 'SIIGO', referenceId: 60, userId: 4,
      packaging: { boxesDeclared: true, lines: [] } }), /por separado/u);
  assert.deepEqual(conn.statements, []);
});
