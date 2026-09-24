const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
let fixture;
let queries;

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    createConnection: async () => ({
      async execute(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('FROM pedidos_cliente pc')) return [[{
          order_id: 3, item_id: 8, estado: 'ACTIVO', producto_id: 74,
          cantidad_ordenada: fixture.ordered, sku: '00102-PTASH60',
          producto: 'ASHWAGANDHA X 60', modalidad_operativa: 'PR',
        }]];
        if (sql.includes('FROM ordenes_produccion')) return [[{ total: fixture.released }]];
        if (sql.includes('FROM bodegas')) return [[{ id: 1 }]];
        if (sql.includes('FROM bom b')) return [[
          { insumo_id: 19, cantidad_por_unidad: 1, unidad: 'und', sku: '00001-TPBI', nombre: 'Tapa' },
          { insumo_id: 60, cantidad_por_unidad: 180, unidad: 'g', sku: '00051-MPASH', nombre: 'Gomas' },
        ]];
        if (sql.includes('FROM stock s')) return [[...fixture.stock[params[0]]]];
        throw new Error(`Consulta inesperada: ${sql}`);
      },
      async end() {},
    }),
  },
};

const { planProductionMaterials, previewCustomerOrderMaterials } =
  require('../api/_lib/production-material-availability');

function setFixture({ ordered = 5, released = 0, lids = 6, gummies = 1100 } = {}) {
  queries = [];
  fixture = {
    ordered, released,
    stock: {
      19: [{ id: 1, lote: 'T-1', ubicacion_id: 10, ubicacion_codigo: 'A8', disponible: lids }],
      60: [{ id: 2, lote: 'G-1', ubicacion_id: 11, ubicacion_codigo: 'B16', disponible: gummies }],
    },
  };
}

test('la preparación comprueba el pendiente y el stock libre sin reservar', async () => {
  setFixture();
  const result = await previewCustomerOrderMaterials({ orderId: 3, itemId: 8 });
  assert.equal(result.ready, true);
  assert.equal(result.planned_quantity, 5);
  assert.deepEqual(result.materials.map((item) => [item.sku, item.required, item.available, item.missing]), [
    ['00001-TPBI', 5, 6, 0], ['00051-MPASH', 900, 1100, 0],
  ]);
  assert.ok(queries.every(({ sql }) => !/FOR UPDATE|^\s*(?:INSERT|UPDATE|DELETE)/iu.test(sql)));
});

test('señala exactamente el material faltante y no marca lista la OP', async () => {
  setFixture({ lids: 3, gummies: 1000 });
  const result = await previewCustomerOrderMaterials({ orderId: 3, itemId: 8 });
  assert.equal(result.ready, false);
  assert.equal(result.materials[0].missing, 2);
  assert.equal(result.materials[1].missing, 0);
});

test('la liberación usa el mismo plan FEFO pero bloquea stock para reservar', async () => {
  setFixture({ ordered: 5, released: 2 });
  const conn = await require.cache[dbPath].exports.createConnection();
  const result = await planProductionMaterials(conn, {
    productId: 74, quantity: 3, warehouseId: 1, lockStock: true,
  });
  assert.deepEqual(result.shortages, []);
  assert.equal(result.plan[1].required, 540);
  assert.ok(queries.filter(({ sql }) => sql.includes('FROM stock s'))
    .every(({ sql }) => sql.includes('FOR UPDATE')));
});

test('no se ofrece preparar un ítem sin unidades pendientes', async () => {
  setFixture({ ordered: 5, released: 5 });
  await assert.rejects(previewCustomerOrderMaterials({ orderId: 3, itemId: 8 }),
    /ya no tiene unidades pendientes/u);
});
