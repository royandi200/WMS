const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
const noticesPath = path.resolve(__dirname, '../api/_lib/builderbot-notifications.js');
let reviewedHash = null;
let stockUsable = true;
const queries = [];
const allocation = { id: 501, stock_id: 12, lote: 'R5-260923-TRP', ubicacion_id: 2,
  cantidad_reservada: 7, material_id: 10, producto_id: 6, unidad: 'und',
  bodega_id: 1, sku: '00006-TRP', producto_nombre: 'TARRO CUADRADO x 60', ubicacion: 'A10' };

require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { createConnection: async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, async end() {},
    async execute(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('FROM ordenes_produccion op JOIN productos p')) return [[{
        id: 110, codigo_orden: 'OP-20260930-000110', estado: 'APROBADA', fase: 'F0',
        producto_sku: '00102-PTASH60', producto_nombre: 'ASHWAGANDHA X 60',
        cantidad_planeada: 1, origen_tipo: 'STOCK_SEGURIDAD',
      }]];
      if (sql.includes('FROM produccion_material_lotes pml')) return [[allocation]];
      if (sql.includes('SELECT huella FROM produccion_alistamiento_revisiones')) {
        return [reviewedHash ? [{ huella: reviewedHash }] : []];
      }
      if (sql.includes('SELECT s.id FROM stock s')) return [stockUsable
        ? [{ id: allocation.stock_id }] : []];
      if (sql.includes('SELECT id, qty_current FROM lots')) return [[{ id: 8, qty_current: 3 }]];
      if (sql.includes('SELECT nombre FROM usuarios')) return [[{ nombre: 'Alistador QA' }]];
      if (/^\s*UPDATE/u.test(sql)) return [{ affectedRows: 1 }];
      if (/^\s*INSERT/u.test(sql)) return [{ insertId: 1, affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }) } };
require.cache[noticesPath] = { id: noticesPath, filename: noticesPath, loaded: true,
  exports: { notifyRoles: async () => [] } };

const { confirmProductionMaterials } = require('../api/_lib/production-workflow');
const { allocationFingerprint } = require('../api/_lib/production-pick-guide');

test('WhatsApp no descuenta material sin una revisión vigente del mismo alistador', async () => {
  reviewedHash = null;
  queries.length = 0;
  await assert.rejects(confirmProductionMaterials({ orderId: 110, userId: 7,
    requireReviewedPick: true }), /no fue revisado/u);
  assert.ok(!queries.some(({ sql }) => /UPDATE stock|UPDATE lots|INSERT INTO movimientos|UPDATE ordenes_produccion/u.test(sql)));

  reviewedHash = 'huella-antigua';
  queries.length = 0;
  await assert.rejects(confirmProductionMaterials({ orderId: 110, userId: 7,
    requireReviewedPick: true }), /resumen de materiales.*cambió/u);
  assert.ok(!queries.some(({ sql }) => /UPDATE stock|UPDATE lots|INSERT INTO movimientos|UPDATE ordenes_produccion/u.test(sql)));
});

test('la huella vigente permite consumir exactamente las partidas revisadas', async () => {
  reviewedHash = allocationFingerprint([allocation]);
  stockUsable = true;
  queries.length = 0;
  const result = await confirmProductionMaterials({ orderId: 110, userId: 7,
    requireReviewedPick: true });
  assert.equal(result.phase, 'F1');
  assert.equal(result.consumed[0].location, 'A10');
  assert.ok(queries.some(({ sql }) => /UPDATE stock\s+SET cantidad = cantidad -/u.test(sql)));
  assert.ok(queries.some(({ sql }) => /UPDATE produccion_alistamiento_revisiones SET expira_en/u.test(sql)));
});

test('una partida bloqueada o vencida después del resumen impide iniciar la OP', async () => {
  reviewedHash = allocationFingerprint([allocation]);
  stockUsable = false;
  queries.length = 0;
  try {
    await assert.rejects(confirmProductionMaterials({ orderId: 110, userId: 7,
      requireReviewedPick: true }), /ya no está disponible/u);
    assert.ok(!queries.some(({ sql }) => /UPDATE stock|UPDATE lots|INSERT INTO movimientos/u.test(sql)));
  } finally { stockUsable = true; }
});
