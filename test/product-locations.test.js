const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { addPreferredLocations, preferredLocationsByProduct } = require('../api/_lib/product-locations');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database', 'warehouse_positions_master.json'), 'utf8'));
const migration = fs.readFileSync(path.join(root, 'database', '25_product_location_assignments.sql'), 'utf8');

test('warehouse position manifest preserves documented ambiguity without guessing D7', () => {
  assert.equal(manifest.source, 'POSICIONES_bodega.pdf');
  assert.equal(manifest.position_sets.D.values.includes(7), false);
  assert.equal(manifest.position_sets.D.values.filter(value => value === 8).length, 1);
  assert.deepEqual(manifest.assignments.B13.slice(0, 2), ['00276-PTZNASHWAB', '00277-PTZNREM']);
  assert.equal(manifest.canonical_sku_overrides['00276-PTZNASHWAB'], '00276-PTZNASHWA');
  assert.match(manifest.known_issues.join(' '), /00276-PTZNASHWAB/u);
});

test('product location migration is many-to-many and does not mutate inventory', () => {
  assert.match(migration, /UNIQUE KEY uq_producto_ubicacion \(producto_id, ubicacion_id\)/u);
  assert.match(migration, /FOREIGN KEY \(producto_id\) REFERENCES productos\(id\)/u);
  assert.match(migration, /FOREIGN KEY \(ubicacion_id\) REFERENCES ubicaciones\(id\)/u);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:stock|movimientos|kardex)\b/iu);
});

test('preferred locations remain ordered and are attached as suggestions', async () => {
  const db = {
    async execute(sql, params) {
      assert.match(sql, /WHERE pu\.activa = 1 AND pu\.producto_id IN \(\?,\?\)/u);
      assert.deepEqual(params, [10, 20]);
      return [[
        { producto_id: 10, prioridad: 1, tipo_asignacion: 'PRIMARIA', ubicacion_id: 101, ubicacion: 'A8' },
        { producto_id: 10, prioridad: 2, tipo_asignacion: 'SECUNDARIA', ubicacion_id: 102, ubicacion: 'B5' },
      ]];
    },
  };
  const grouped = await preferredLocationsByProduct(db, [10, 20, 10]);
  assert.deepEqual(grouped.get(10).map(location => location.codigo), ['A8', 'B5']);
  assert.deepEqual(grouped.get(20), []);
  const enriched = await addPreferredLocations(db, [{ producto_id: 10 }, { producto_id: 20 }]);
  assert.equal(enriched[0].ubicacion_sugerida, 'A8');
  assert.equal(enriched[0].ubicacion_sugerida_id, 101);
  assert.equal(enriched[1].ubicacion_sugerida, null);
});

test('missing optional assignment table does not block warehouse reception', async () => {
  const error = Object.assign(new Error('missing'), { code: 'ER_NO_SUCH_TABLE' });
  const db = { execute: async () => { throw error; } };
  const enriched = await addPreferredLocations(db, [{ producto_id: 10 }]);
  assert.equal(enriched[0].ubicacion_sugerida, null);
  assert.deepEqual(enriched[0].ubicaciones_sugeridas, []);
});
